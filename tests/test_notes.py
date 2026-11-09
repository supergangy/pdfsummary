"""필기 앱 노트(원본 PDF + 획) → 잉크 주석 PDF → 기존 분석."""

import json
import time
import urllib.request
from pathlib import Path

import pymupdf
import pytest

from pdfsummary.cli import main
from pdfsummary.notes import NoteError, build_note_pdf, check_spec

from test_server import call, server  # noqa: F401


def _hl_over(page_rect_disp, width=None):
    """화면 좌표의 글자 상자 위를 가로지르는 형광펜 획."""
    r = page_rect_disp
    y = (r.y0 + r.y1) / 2
    return {"tool": "highlighter", "color": "#FFE14D", "width": width or r.height,
            "pts": [r.x0, y, 0.5, (r.x0 + r.x1) / 2, y + 0.4, 0.5, r.x1, y, 0.5]}


def _underline(r):
    y = r.y1 + 1.5
    return {"tool": "pen", "color": "#1E4FD8", "width": 1.6, "pts": [r.x0, y, 0.5, (r.x0 + r.x1) / 2, y + 0.3, 0.5, r.x1, y, 0.5]}


def _run(pdf: Path, out: Path, *extra):
    rc = main([str(pdf), "-o", str(out), "--format", "json", "--no-ai", "--style", "list", *extra],
              log=lambda s: None, progress=lambda *a: None)
    assert rc == 0
    data = json.loads((out / "요약.json").read_text(encoding="utf-8"))
    return [m for sec in data["sections"] for m in sec.get("items", [])]


def test_note_strokes_become_marks_and_book_colors_are_ignored(book_pair, tmp_path):
    orig, _ = book_pair
    with pymupdf.open(orig) as d:
        pg = d[0]
        hl = pg.search_for("활성화 에너지를 낮추는")   # 두 줄에 걸쳐 있다 → 줄마다 한 번씩 긋는다
        ul = pg.search_for("경쟁적 저해제")[0]
        w, h = pg.rect.width, pg.rect.height
    spec = {"title": "효소 노트", "pages": [{"w": w, "h": h, "pdf": 0, "strokes": [*(_hl_over(r) for r in hl), _underline(ul)]},
                                          {"w": 595, "h": 842, "strokes": []}]}
    out_pdf = tmp_path / "note.pdf"
    assert build_note_pdf(spec, orig, out_pdf) == 2
    marks = _run(out_pdf, tmp_path / "o", "--no-drawings", "--scan", "off")
    kinds = {(m["kind"], m["text"]) for m in marks}
    texts = " ".join(t for k, t in kinds if k == "highlight")
    assert "활성화 에너지를" in texts and "낮추는" in texts, kinds
    assert any(k == "underline" and "경쟁적 저해제" in t for k, t in kinds), kinds
    # 책에 원래 인쇄된 강조('생체 촉매', '기질 특이성')는 표시로 잡히지 않는다
    assert not any("생체 촉매" in t or "기질 특이성" in t for _, t in kinds)


def test_rotated_page_coordinates(book_pair, tmp_path):
    orig, _ = book_pair
    rot = tmp_path / "rot.pdf"
    with pymupdf.open(orig) as d:
        d[0].set_rotation(90)
        d.save(rot)
    with pymupdf.open(rot) as d:
        pg = d[0]
        r = pg.search_for("경쟁적 저해제")[0] * pg.rotation_matrix   # 화면에 보이는 자리
        w, h = pg.rect.width, pg.rect.height
    # 돌린 쪽에서는 글줄이 세로로 보이므로 세로로 긋는다
    x = (r.x0 + r.x1) / 2
    stroke = {"tool": "highlighter", "color": "#FF9EC7", "width": r.width,
              "pts": [x, r.y0, 0.5, x, (r.y0 + r.y1) / 2, 0.5, x, r.y1, 0.5]}
    out_pdf = tmp_path / "rnote.pdf"
    build_note_pdf({"pages": [{"w": w, "h": h, "pdf": 0, "strokes": [stroke]}]}, rot, out_pdf)
    marks = _run(out_pdf, tmp_path / "o2", "--no-drawings", "--scan", "off")
    assert [m["text"] for m in marks if m["kind"] == "highlight"] == ["경쟁적 저해제"]


def test_blank_notebook_handwriting(tmp_path):
    scribble = []
    for i in range(40):
        scribble += [100 + i * 3, 200 + (i % 5) * 4, 0.5]
    spec = {"pages": [{"w": 595, "h": 842, "strokes": [{"tool": "pen", "color": "#000000", "width": 2, "pts": scribble}]}]}
    out_pdf = tmp_path / "blank.pdf"
    build_note_pdf(spec, None, out_pdf)
    marks = _run(out_pdf, tmp_path / "o3")
    assert [m["kind"] for m in marks] == ["handwriting"]


def test_spec_validation():
    with pytest.raises(NoteError):
        check_spec({"pages": []}, False)
    with pytest.raises(NoteError):
        check_spec({"pages": [{"w": 100, "h": 100, "pdf": 0}]}, False)   # 원본 없이 원본 쪽
    with pytest.raises(NoteError):
        check_spec({"pages": [{"w": 100, "h": 100, "pdf": 5}]}, True, 2)
    pages = check_spec({"pages": [{"w": 100, "h": 100, "strokes": [
        {"tool": "pen", "color": "#000000", "width": 2, "pts": [1, 2, 0.5, "x", 3, 0.5]},
        {"tool": "eraser", "pts": [1, 2, 0.5]},
        {"tool": "pen", "color": "red", "width": 9999, "pts": [1, 2, 0.5]}]}]}, False)
    ss = pages[0]["strokes"]
    assert len(ss) == 2 and ss[0]["pts"] == [(1.0, 2.0)] and ss[1]["width"] == 60


def test_server_notes_flow(server, book_pair):  # noqa: F811
    orig, _ = book_pair
    s, b, _ = call(server, "/api/upload?name=book.pdf", raw=Path(orig).read_bytes(), method="PUT")
    fid = json.loads(b)["id"]
    with pymupdf.open(orig) as d:
        r = d[0].search_for("경쟁적 저해제")[0]
        w, h = d[0].rect.width, d[0].rect.height
    note = {"title": "효소 노트", "pages": [{"w": w, "h": h, "pdf": 0, "strokes": [_hl_over(r)]}]}
    s, b, _ = call(server, "/api/notes", data={"file": fid, "note": note})
    assert s == 200, b
    up = json.loads(b)
    assert up["pages"] == 1 and up["name"] == "효소 노트.pdf"
    s, b, _ = call(server, "/api/run", data={"file": up["id"], "options": {"style": "list", "only_ink": True, "group_by": "page"}})
    job = json.loads(b)["job"]
    for _ in range(400):
        st = json.loads(call(server, f"/api/job/{job}")[1])
        if st["status"] != "running":
            break
        time.sleep(0.05)
    assert st["status"] == "done", st
    assert st["summary"].startswith("형광펜 1"), st["summary"]
    html = call(server, "/r/" + job + "/" + urllib.request.quote("요약.html"))[1].decode()
    assert "경쟁적 저해제" in html
    # 잘못된 요청
    assert call(server, "/api/notes", data={"file": "nope", "note": note})[0] == 400
    assert call(server, "/api/notes", data={"note": {"pages": [{"w": 1, "h": 1, "pdf": 0}]}})[0] == 400


def test_text_boxes_become_notes(tmp_path):
    spec = {"pages": [{"w": 595, "h": 842, "strokes": [
        {"tool": "text", "color": "#1E4FD8", "width": 16, "pts": [100, 100, 0, 300, 140, 0], "text": "시험에 꼭 나옴: 효소-기질 복합체"},
        {"tool": "text", "pts": [1, 2, 0, 3, 4, 0], "text": "   "},   # 빈 글은 버림
    ]}]}
    out_pdf = tmp_path / "t.pdf"
    build_note_pdf(spec, None, out_pdf)
    marks = _run(out_pdf, tmp_path / "o5")
    assert [(m["kind"], m["text"]) for m in marks] == [("note", "시험에 꼭 나옴: 효소-기질 복합체")]
