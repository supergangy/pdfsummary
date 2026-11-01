import json

import pymupdf

from pdfsummary import render_booklet as rb
from pdfsummary.booklet import BOOKLET_SCHEMA, Chunk, chunk_content, merge_units, plan_chunks, write_booklet
from pdfsummary.cli import main
from pdfsummary.models import HANDWRITING, HIGHLIGHT, SRC_SCAN, Mark


def unit(title, heading="1. 개념 및 배경", text="내용", cont=False, points=(), pages=(1,)):
    return {"chapter": "Part 1", "title": title, "continues_previous": cont, "intro": "개요",
            "sections": [{"heading": heading, "blocks": [{"type": "paragraph", "text": text, "items": [], "columns": [], "rows": []}]}],
            "points": [{"topic": t, "memo": "m", "stars": 2, "evidence": "23년.기사"} for t in points], "pages": list(pages)}


def test_plan_chunks():
    marks = [Mark(4, HIGHLIGHT, (0, 0, 1, 1), "annotation"), Mark(5, HIGHLIGHT, (0, 0, 1, 1), "annotation"),
             Mark(20, HIGHLIGHT, (0, 0, 1, 1), "annotation")]
    focus = plan_chunks(30, marks, "focus")
    # 표시가 있는 쪽 + 바로 앞 쪽(제목이 앞 쪽에 있을 수 있어서), 떨어진 쪽은 따로
    assert [c.pages for c in focus] == [[3, 4, 5], [19, 20]]
    assert [len(c.marks) for c in focus] == [2, 1]
    assert [c.pages for c in plan_chunks(14, [], "all")] == [list(range(0, 6)), list(range(6, 12)), [12, 13]]
    assert [c.pages for c in plan_chunks(30, [], "all", pages=[2, 3, 9])] == [[2, 3], [9]]


def test_merge_units():
    us = [unit("SNMP", points=["a"]), unit("SNMP", text="이어서", points=["a", "b"], pages=(2,)),
          unit("다음 주제", cont=True, heading="2. 동작 원리 / 구조", pages=(3,)), unit("MIB", pages=(4,))]
    out = merge_units(us)
    assert [u["title"] for u in out] == ["SNMP", "MIB"]
    snmp = out[0]
    assert [s["heading"] for s in snmp["sections"]] == ["1. 개념 및 배경", "2. 동작 원리 / 구조"]
    assert [b["text"] for b in snmp["sections"][0]["blocks"]] == ["내용", "이어서"]
    assert [p["topic"] for p in snmp["points"]] == ["a", "b"]
    assert snmp["pages"] == [1, 2, 3]


def test_chunk_content_has_pages_marks_and_crops(sample_pdf):
    doc = pymupdf.open(sample_pdf)
    text_mark = Mark(0, HIGHLIGHT, (0, 0, 1, 1), "annotation", (1, 1, 0), text="빛 에너지")
    scan_mark = Mark(2, HIGHLIGHT, (0, 0, 1, 1), SRC_SCAN, (1, 1, 0), image=doc[2].get_pixmap(dpi=30).tobytes("png"))
    hand = Mark(0, HANDWRITING, (0, 0, 1, 1), "annotation", transcription="물의 광분해")
    from pdfsummary.extract import TextCache

    content = chunk_content(doc, Chunk([0, 1, 2], [text_mark, scan_mark, hand]), "focus", TextCache(doc).get)
    images = [b for b in content if b["type"] == "image"]
    texts = "\n".join(b["text"] for b in content if b["type"] == "text")
    assert len(images) == 4   # 쪽 3장 + 글자를 못 읽은 스캔 표시 그림 1장
    assert all(i["source"]["media_type"] == "image/jpeg" for i in images)
    assert '[표시 1] 1쪽 형광펜(노랑): "빛 에너지"' in texts
    assert "[표시 2] 3쪽 형광펜(노랑): (위 그림 참고)" in texts
    assert '[표시 3] 1쪽 손글씨 메모: "물의 광분해"' in texts
    assert "<1쪽_글자층>" in texts and "<3쪽_글자층>" not in texts   # 스캔 쪽은 글자층이 없음
    assert "표시한 내용을 중심으로" in texts and "책에 원래 인쇄된 색 글씨" in texts


def test_schema_is_strict():
    unit_schema = BOOKLET_SCHEMA["properties"]["units"]["items"]
    assert unit_schema["additionalProperties"] is False
    assert set(unit_schema["required"]) == set(unit_schema["properties"])


def test_write_booklet_parallel_keeps_page_order(sample_pdf):
    doc = pymupdf.open(sample_pdf)

    class FakeReader:
        def ask_content(self, content, schema, max_tokens, effort="medium", stream=False):
            first = next(b["text"] for b in content if b["type"] == "text" and b["text"].startswith("[책"))
            n = int(first.split()[1].rstrip("쪽]"))
            return {"units": [unit(f"주제{n}", pages=(n,), cont=False)]}

        def save_cache(self):
            pass

    chunks = plan_chunks(doc.page_count, [], "all", per_chunk=1)
    out = write_booklet(FakeReader(), doc, chunks, "all", workers=3)
    assert [u["title"] for u in out] == ["주제1", "주제2", "주제3"]


def test_inline_markup_is_safe():
    s = rb.inline("**굵게** ==칠함== `rm -rf <x>` <script>")
    assert "<b>굵게</b>" in s and "<mark>칠함</mark>" in s and "<code>rm -rf &lt;x&gt;</code>" in s
    assert "<script>" not in s
    assert rb.inline("`**x**`") == "<code>**x**</code>"   # 코드 안은 그대로


def test_render_booklet():
    us = merge_units([unit("SNMP", points=["community string"]), unit("MIB", pages=(3, 4, 5, 9))])
    us[0]["sections"][0]["blocks"].append({"type": "table", "text": "", "items": [], "columns": ["버전", "보안"],
                                           "rows": [["v1", "==없음== | 평문"]]})
    html = rb.to_html("책", us, "a.pdf", "#ff9ecf")
    assert "SNMP 핵심 정리" in html and '<nav class="toc">' in html and "--mark:#ff9ecf" in html
    assert "<td>★★<span class=\"ev\">23년.기사</span></td>" in html
    assert "2. 실무 및 시험 포인트 정리" in html
    assert "원본 3–5, 9쪽" in html
    md = rb.to_markdown("책", us, "a.pdf")
    assert "| v1 | ==없음== \\| 평문 |" in md and "### 2. 실무 및 시험 포인트 정리" in md


def _fake_ai(monkeypatch, response):
    import pdfsummary.ai as ai

    monkeypatch.setattr(ai, "has_credentials", lambda: True)
    calls = []

    def fake(self, content, schema, max_tokens, effort="medium", stream=False):
        calls.append(content)
        return response

    monkeypatch.setattr(ai.AIReader, "ask_content", fake)
    orig = ai.AIReader.__init__

    def init(self, *a, **k):
        orig(self, *a, **k)
        self.client = object()
        self.disabled_reason = None

    monkeypatch.setattr(ai.AIReader, "__init__", init)
    return calls


def test_cli_booklet(textbook, tmp_path, monkeypatch):
    calls = _fake_ai(monkeypatch, {"units": [unit("광합성", points=["명반응"])]})
    out = tmp_path / "o"
    assert main([str(textbook), "-o", str(out), "--format", "html,md,json"]) == 0
    assert len(calls) == 1
    assert "광합성 핵심 정리" in (out / "요약.html").read_text(encoding="utf-8")
    assert json.loads((out / "요약.json").read_text(encoding="utf-8"))["units"][0]["title"] == "광합성"
    assert (out / "표시모음.html").exists()   # 무엇을 표시로 찾았는지 확인용


def test_cli_booklet_falls_back_when_ai_gives_nothing(textbook, tmp_path, monkeypatch):
    _fake_ai(monkeypatch, None)
    out = tmp_path / "o"
    assert main([str(textbook), "-o", str(out), "--format", "md"]) == 0
    assert "**목차**" in (out / "요약.md").read_text(encoding="utf-8")   # 표시 모음으로 대신


def test_cli_without_ai_makes_list(textbook, tmp_path, monkeypatch):
    monkeypatch.setattr("pdfsummary.ai.has_credentials", lambda: False)
    out = tmp_path / "o"
    assert main([str(textbook), "-o", str(out), "--format", "md"]) == 0
    assert not (out / "표시모음.html").exists()
