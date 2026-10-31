"""명령줄 실행: pdfsummary 책.pdf"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pymupdf

from . import __version__
from .colors import parse_label
from .extract import Options, extract
from .models import HANDWRITING
from .organize import (
    attach_notes,
    by_chapter,
    by_color,
    by_page,
    decide_images,
    drop_empty,
    merge_adjacent,
    reading_order,
)
from .render import stats_line, to_html, to_json, to_markdown


def parse_pages(spec: str, count: int) -> list[int]:
    """'1-10,15,20-' → 0부터 시작하는 페이지 번호 목록."""
    pages: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            start = int(a) if a else 1
            end = int(b) if b else count
        else:
            start = end = int(part)
        if start < 1 or end > count or start > end:
            raise ValueError(f"페이지 범위가 잘못되었습니다: {part} (전체 {count}쪽)")
        pages.update(range(start - 1, end))
    return sorted(pages)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="pdfsummary",
        description="PDF 책에 형광펜·밑줄·손글씨로 표시한 부분만 뽑아 요약본을 만듭니다.",
    )
    p.add_argument("pdf", type=Path, help="필기한 PDF 파일")
    p.add_argument("-o", "--out", type=Path, help="결과를 저장할 폴더 (기본: <파일이름>_요약)")
    p.add_argument("--pages", help="처리할 페이지. 예: 1-30,45,50-")
    p.add_argument(
        "--handwriting",
        choices=["auto", "ai", "image", "both"],
        default="auto",
        help="손글씨 처리: auto=AI로 읽고 애매하면 원본도 같이(기본), ai=글만, image=원본 이미지 그대로(AI 안 씀), both=글+원본 항상",
    )
    p.add_argument("--no-ai", action="store_true", help="Claude AI를 쓰지 않음 (--handwriting image와 같음)")
    p.add_argument("--model", default=None, help="손글씨를 읽을 Claude 모델 (기본: claude-opus-5-5)")
    p.add_argument("--group-by", choices=["chapter", "page", "color"], default="chapter",
                   help="정리 방식: chapter=목차 단원별(기본, 목차 없으면 페이지 순), page=쪽별, color=색별")
    p.add_argument("--label", action="append", default=[], metavar="색=이름",
                   help="색에 의미 붙이기. 예: --label 노랑=핵심 --label pink=정의 (여러 번 가능)")
    p.add_argument("--no-attach", action="store_true", help="손글씨·메모를 가까운 형광펜 밑에 붙이지 않고 따로 둠")
    p.add_argument("--no-drawings", action="store_true",
                   help="페이지에 굳어진 펜 획(GoodNotes·Notability 내보내기)은 찾지 않음. 책 그림이 손글씨로 잡힐 때 사용")
    p.add_argument("--scan", choices=["auto", "on", "off"], default="auto",
                   help="스캔본(사진 PDF)에서 형광펜 색 찾기. auto=스캔 페이지에서만(기본)")
    p.add_argument("--format", default="html,md", help="만들 파일 종류: html,md,json 중 쉼표로 (기본 html,md)")
    p.add_argument("--title", help="요약본 제목 (기본: PDF 제목 또는 파일 이름)")
    p.add_argument("--dpi", type=int, default=200, help="원본 이미지 해상도 (기본 200)")
    p.add_argument("-V", "--version", action="version", version=f"pdfsummary {__version__}")
    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    log = lambda s: print(s, file=sys.stderr)

    if not args.pdf.exists():
        log(f"파일이 없습니다: {args.pdf}")
        return 2
    try:
        labels = dict(parse_label(s) for s in args.label)
    except ValueError as e:
        log(str(e))
        return 2
    formats = {f.strip().lower() for f in args.format.split(",") if f.strip()}
    bad = formats - {"html", "md", "json"}
    if bad:
        log(f"모르는 형식: {', '.join(sorted(bad))} (html, md, json 중에서)")
        return 2

    try:
        doc = pymupdf.open(args.pdf)
    except Exception as e:
        log(f"PDF를 열 수 없습니다: {e}")
        return 2
    if doc.needs_pass:
        log("암호가 걸린 PDF입니다. 암호를 풀고 다시 시도하세요.")
        return 2

    try:
        pages = parse_pages(args.pages, doc.page_count) if args.pages else None
    except ValueError as e:
        log(str(e))
        return 2

    title = args.title or (doc.metadata or {}).get("title") or args.pdf.stem
    out_dir = args.out or args.pdf.with_name(f"{args.pdf.stem}_요약")
    out_dir.mkdir(parents=True, exist_ok=True)

    log(f"📖 {args.pdf.name} ({doc.page_count}쪽) 에서 표시한 부분을 찾는 중…")
    opts = Options(pages=pages, drawings=not args.no_drawings, scan=args.scan, image_dpi=args.dpi)
    marks, infos = extract(doc, opts, log)
    line_heights = {i: info.line_height for i, info in infos.items()}

    marks = reading_order(drop_empty(marks))
    marks = merge_adjacent(marks, line_heights)

    mode = "image" if args.no_ai else args.handwriting
    need_ai = [m for m in marks if m.image and (m.kind == HANDWRITING or not m.text)]
    if mode != "image" and need_ai:
        _run_ai(need_ai, args, out_dir, log)

    if not args.no_attach:
        marks = attach_notes(marks, line_heights)
    decide_images(marks, mode)

    if args.group_by == "page":
        sections = by_page(marks)
    elif args.group_by == "color":
        sections = by_color(marks, labels)
    else:
        toc = doc.get_toc()
        sections = by_chapter(marks, toc) if toc else by_page(marks)

    written = []
    if "html" in formats:
        path = out_dir / "요약.html"
        path.write_text(to_html(title, sections, labels, args.pdf.name), encoding="utf-8")
        written.append(path)
    if "md" in formats:
        path = out_dir / "요약.md"
        path.write_text(to_markdown(title, sections, labels, out_dir / "images", "images"), encoding="utf-8")
        written.append(path)
    if "json" in formats:
        path = out_dir / "요약.json"
        path.write_text(to_json(title, sections, labels), encoding="utf-8")
        written.append(path)

    log(f"✅ {stats_line(marks) or '표시한 부분 없음'}")
    for p in written:
        log(f"   → {p}")
    return 0


def _run_ai(todo, args, out_dir: Path, log) -> None:
    from .ai import DEFAULT_MODEL, AIReader, has_credentials

    if not has_credentials():
        log("ℹ️  ANTHROPIC_API_KEY가 없어 손글씨는 원본 이미지로 넣습니다. (AI로 읽으려면 README의 'AI 설정'을 보세요)")
        return
    reader = AIReader(model=args.model or DEFAULT_MODEL, cache_path=out_dir / ".ai_cache.json")
    if not reader.available:
        log(f"ℹ️  {reader.disabled_reason} — 원본 이미지로 넣습니다.")
        return
    hand = [m for m in todo if m.kind == HANDWRITING]
    rest = [m for m in todo if m.kind != HANDWRITING]

    def prog(label):
        return lambda d, n: print(f"\r  {label} {d}/{n}", end="" if d < n else "\n", file=sys.stderr)

    if hand:
        reader.transcribe_handwriting(hand, prog("✍️  손글씨 읽는 중"))
    if rest:
        reader.read_highlighted(rest, prog("🔎 스캔 글자 읽는 중"))


if __name__ == "__main__":
    sys.exit(main())
