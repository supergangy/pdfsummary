"""명령줄 실행: pdfsummary 책.pdf"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pymupdf

from . import __version__
from .colors import COLOR_NAMES, ColorFilter, color_key, parse_label, to_hex
from .extract import Options, extract
from .models import HANDWRITING, HIGHLIGHT
from .organize import (
    add_sentences,
    attach_notes,
    by_color,
    by_page,
    decide_images,
    drop_empty,
    from_tree,
    merge_adjacent,
    number_marks,
    reading_order,
)
from .outline import build_tree, font_headings, merge_headings, section_text, toc_headings
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
    p.add_argument("--original", type=Path, metavar="원본.pdf",
                   help="필기하기 전 원본 PDF. 주면 원본에도 있는 색칠·밑줄(책 자체의 것)은 빼고 내가 더한 것만 찾음")
    p.add_argument("--color", action="append", default=[], metavar="색",
                   help="형광펜은 이 색만 인정. 색 이름(노랑) 또는 코드(#F5E663). 여러 번 또는 쉼표로. 색 코드는 --list-colors로 확인")
    p.add_argument("--list-colors", action="store_true",
                   help="이 PDF에서 찾은 형광펜 색과 개수만 보여 주고 끝냄 (--color에 넣을 코드 찾기)")
    p.add_argument(
        "--handwriting",
        choices=["auto", "ai", "image", "both"],
        default="auto",
        help="손글씨 처리: auto=AI로 읽고 애매하면 원본도 같이(기본), ai=글만, image=원본 이미지 그대로(AI 안 씀), both=글+원본 항상",
    )
    p.add_argument("--no-ai", action="store_true", help="Claude AI를 쓰지 않음 (--handwriting image와 같음)")
    p.add_argument("--model", default=None, help="손글씨를 읽을 Claude 모델 (기본: claude-opus-5-5)")
    p.add_argument("--group-by", choices=["chapter", "page", "color"], default="chapter",
                   help="정리 방식: chapter=목차(큰 제목 > 작은 제목)별(기본), page=쪽별, color=색별")
    p.add_argument("--context", choices=["auto", "ai", "sentence", "none"], default="auto",
                   help="문맥 보충: sentence=표시한 부분이 든 문장 전체를 같이 보여 줌, "
                        "ai=거기에 더해 AI가 단원 개요와 표시마다 연결 설명을 붙임, "
                        "auto=AI를 쓸 수 있으면 ai, 아니면 sentence(기본), none=표시한 부분만")
    p.add_argument("--headings", choices=["auto", "toc", "font"], default="auto",
                   help="목차 찾기: toc=PDF 책갈피만, font=글자 크기·굵기로 찾은 제목만, auto=둘 다(기본)")
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
    try:
        color_filter = ColorFilter(args.color)
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

    original = None
    if args.original:
        try:
            original = pymupdf.open(args.original)
        except Exception as e:
            log(f"원본 PDF를 열 수 없습니다: {e}")
            return 2
        if original.page_count != doc.page_count:
            log(f"ℹ️  원본({original.page_count}쪽)과 필기본({doc.page_count}쪽)의 쪽 수가 다릅니다. "
                "같은 번호의 쪽끼리 비교하고, 원본에 없는 쪽은 비교 없이 찾습니다.")

    title = args.title or (doc.metadata or {}).get("title") or args.pdf.stem
    out_dir = args.out or args.pdf.with_name(f"{args.pdf.stem}_요약")

    log(f"📖 {args.pdf.name} ({doc.page_count}쪽) 에서 표시한 부분을 찾는 중…")
    opts = Options(pages=pages, drawings=not args.no_drawings, scan=args.scan, image_dpi=args.dpi, original=original)
    marks, infos = extract(doc, opts, log)
    line_heights = {i: info.line_height for i, info in infos.items()}

    if args.list_colors:
        print_colors(marks)
        return 0

    marks = drop_empty(marks)
    if color_filter:
        before = len(marks)
        marks = [m for m in marks if m.kind != HIGHLIGHT or color_filter.accepts(m.color, m.source)]
        log(f"  지정한 색이 아닌 형광펜 {before - len(marks)}개를 뺐습니다.")
    marks = reading_order(marks)
    out_dir.mkdir(parents=True, exist_ok=True)
    marks = merge_adjacent(marks, line_heights)

    mode = "image" if args.no_ai else args.handwriting
    context = args.context
    need_ai = [m for m in marks if m.image and (m.kind == HANDWRITING or not m.text)]
    wants_ai = (mode != "image" and need_ai) or (not args.no_ai and context in ("auto", "ai"))
    reader = _make_reader(args, out_dir, log) if wants_ai else None
    if context == "auto":
        context = "ai" if reader is not None else "sentence"
    elif context == "ai" and reader is None:
        log("ℹ️  AI를 쓸 수 없어 단원 개요·연결 설명 없이 앞뒤 문장만 붙입니다.")
        context = "sentence"

    if reader is not None and mode != "image" and need_ai:
        _read_with_ai(reader, need_ai)

    if not args.no_attach:
        marks = attach_notes(marks, line_heights)
    decide_images(marks, mode)
    number_marks(marks)
    if context != "none":
        add_sentences(marks, opts.texts.get)

    # 목차 나무 (어느 정리 방식이든 표시마다 '어느 단원인지'를 알려 주려고 만든다)
    log("📑 목차 정리 중…")
    last_page = max((m.page for m in marks), default=0)
    toc_h = toc_headings(doc.get_toc(), opts.texts.get) if args.headings in ("auto", "toc") else []
    font_h = font_headings(opts.texts.all(upto=last_page + 1)) if args.headings in ("auto", "font") else []
    tree = build_tree(merge_headings(toc_h, font_h), marks)

    if context == "ai" and reader is not None and marks:
        with_marks = [n for n in tree.walk() if n.marks]
        parents = [n for n in tree.walk() if len(n.children) >= 2 or (n.children and n.marks)]
        items = [(n, *section_text(n, opts.texts.get)) for n in with_marks]
        log(f"🧠 AI로 단원 개요·연결 설명 만드는 중 (요청 {len(items) + len(parents)}번)…")
        reader.explain_sections(title, items, parents, _progress("   단원"))
        for n in tree.walk():
            if not n.children and len(n.marks) < 2:
                n.overview = ""   # 표시 하나뿐인 작은 단원은 개요가 그 표시 설명과 겹친다

    if args.group_by == "page":
        sections = by_page(marks)
    elif args.group_by == "color":
        sections = by_color(marks, labels)
    else:
        sections = from_tree(tree)

    show_path = args.group_by != "chapter"   # 쪽별·색별로 볼 때는 표시마다 어느 단원인지 적어 준다
    written = []
    if "html" in formats:
        path = out_dir / "요약.html"
        path.write_text(to_html(title, sections, labels, args.pdf.name, show_path), encoding="utf-8")
        written.append(path)
    if "md" in formats:
        path = out_dir / "요약.md"
        path.write_text(to_markdown(title, sections, labels, out_dir / "images", "images", show_path), encoding="utf-8")
        written.append(path)
    if "json" in formats:
        path = out_dir / "요약.json"
        path.write_text(to_json(title, sections, labels), encoding="utf-8")
        written.append(path)

    log(f"✅ {stats_line(marks) or '표시한 부분 없음'}")
    for p in written:
        log(f"   → {p}")
    return 0


def print_colors(marks) -> None:
    """찾은 형광펜 색을 코드별로 묶어 보여 준다."""
    groups: dict[str, list] = {}
    for m in marks:
        if m.kind != HIGHLIGHT or m.color is None:
            continue
        exact = m.source in ColorFilter.EXACT_SOURCES
        code = to_hex(m.color) if exact else f"({COLOR_NAMES[color_key(m.color)][0]} 계열)"
        groups.setdefault(code, []).append(m)
    if not groups:
        print("형광펜을 찾지 못했습니다.")
        return
    print(f"{'색 코드':<14}{'색':<6}{'개수':>5}  쪽            예시")
    for code, ms in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        name = COLOR_NAMES[color_key(ms[0].color)][0]
        pages = sorted({m.page_no for m in ms})
        page_s = ",".join(map(str, pages[:5])) + ("…" if len(pages) > 5 else "")
        sample = next((m.text for m in ms if m.text), "(글자 없음)")
        sample = sample[:24] + ("…" if len(sample) > 24 else "")
        print(f"{code:<14}{name:<6}{len(ms):>5}  {page_s:<13} {sample}")
    print("\n내 형광펜 색만 남기려면: --color \"#코드\" (여러 개는 쉼표로)")
    print("(괄호로 된 '계열'은 원본 비교·스캔에서 찾은 것이라 정확한 코드 대신 색 이름으로 거르세요. 예: --color 노랑)")


def _make_reader(args, out_dir: Path, log):
    from .ai import DEFAULT_MODEL, AIReader, has_credentials

    if not has_credentials():
        log("ℹ️  ANTHROPIC_API_KEY가 없어 AI 없이 정리합니다 (손글씨는 원본 이미지, 문맥은 앞뒤 문장). "
            "AI를 쓰려면 README의 'AI 설정'을 보세요.")
        return None
    reader = AIReader(model=args.model or DEFAULT_MODEL, cache_path=out_dir / ".ai_cache.json")
    if not reader.available:
        log(f"ℹ️  {reader.disabled_reason} — AI 없이 정리합니다.")
        return None
    return reader


def _progress(label):
    return lambda d, n: print(f"\r{label} {d}/{n}", end="" if d < n else "\n", file=sys.stderr)


def _read_with_ai(reader, todo) -> None:
    hand = [m for m in todo if m.kind == HANDWRITING]
    rest = [m for m in todo if m.kind != HANDWRITING]
    if hand:
        reader.transcribe_handwriting(hand, _progress("  ✍️  손글씨 읽는 중"))
    if rest:
        reader.read_highlighted(rest, _progress("  🔎 스캔 글자 읽는 중"))


if __name__ == "__main__":
    sys.exit(main())
