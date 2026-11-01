import json
import re
from types import SimpleNamespace

import pymupdf

from pdfsummary.ai import AIReader
from pdfsummary.cli import main
from pdfsummary.extract import Options, TextCache, extract
from pdfsummary.organize import add_sentences, from_tree, merge_adjacent, number_marks, reading_order
from pdfsummary.outline import Heading, build_tree, font_headings, merge_headings, section_text, toc_headings


def _prepare(textbook):
    doc = pymupdf.open(textbook)
    texts = TextCache(doc)
    marks, infos = extract(doc, Options(texts=texts))
    marks = merge_adjacent(reading_order(marks), {i: v.line_height for i, v in infos.items()})
    number_marks(marks)
    add_sentences(marks, texts.get)
    return doc, texts, marks


def test_font_headings_levels_and_running_header(textbook):
    doc, texts, _ = _prepare(textbook)
    heads = font_headings(texts.all())
    got = [(h.level, h.title) for h in heads]
    assert got == [
        (1, "Ⅰ. 세포와 에너지"),
        (2, "1. 광합성"), (3, "명반응"), (3, "탄소 고정 반응"),
        (2, "2. 세포 호흡"), (3, "해당 과정"), (3, "산화적 인산화"),
    ]
    # 매 쪽 머리말·쪽 번호는 제목이 아님
    assert all("핵심 개념" not in t for _, t in got)


def test_tree_paths_and_sections(textbook):
    doc, texts, marks = _prepare(textbook)
    tree = build_tree(font_headings(texts.all()), marks)
    paths = {m.text: m.heading_path for m in marks}
    assert paths["최종 전자 수용체는 산소이다"] == ["Ⅰ. 세포와 에너지", "2. 세포 호흡", "산화적 인산화"]
    secs = from_tree(tree)
    assert [(s.level, s.title, s.count) for s in secs] == [
        (1, "Ⅰ. 세포와 에너지", 5), (2, "1. 광합성", 2), (3, "명반응", 1), (3, "탄소 고정 반응", 1),
        (2, "2. 세포 호흡", 3), (3, "해당 과정", 2), (3, "산화적 인산화", 1),
    ]
    # 단원 본문은 그 제목부터 다음 제목 전까지
    node = next(n for n in tree.walk() if n.title == "명반응")
    text, abridged = section_text(node, texts.get)
    assert text.startswith("명반응") and text.endswith("ATP와 NADPH가 만들어진다.") and not abridged
    assert "탄소 고정" not in text


def test_sentence_context(textbook):
    _, _, marks = _prepare(textbook)
    by_text = {m.text: m for m in marks}
    # 앞줄에서 시작한 문장도 처음부터
    m = by_text["ATP와 NADPH가 만들어진다"]
    assert m.sentence == [("이 과정에서 ", False), ("ATP와 NADPH가 만들어진다", True), (".", False)]
    # 따로 칠한 두 군데를 합친 경우 칠한 곳만 강조, 사이 글은 문맥
    m = next(m for m in marks if m.text.startswith("캘빈 회로"))
    assert [t for t, hl in m.sentence if hl] == ["캘빈 회로", "ATP와 NADPH를 사용하여 이산화탄소를 포도당으로 합성한다"]
    assert m.sentence[0] == ("탄소 고정 반응은 스트로마에서 일어나며 ", False)   # 제목 줄은 문맥에 안 들어감
    # 문장 전체를 칠했으면 문맥 없음
    assert by_text["최종 전자 수용체는 산소이다"].sentence == []


def test_toc_merge_prefers_bookmarks(sample_pdf):
    doc = pymupdf.open(sample_pdf)
    texts = TextCache(doc)
    toc = toc_headings(doc.get_toc(), texts.get)
    merged = merge_headings(toc, font_headings(texts.all()))
    assert [(h.level, h.title, h.source) for h in merged] == [
        (1, "1. 광합성의 개요", "toc"), (1, "2. 세포 호흡", "toc"), (1, "3. 유전자 발현", "toc"),
    ]
    assert toc[0].y > 0   # 책갈피 제목의 쪽 안 위치도 찾음


def test_merge_adds_deeper_font_headings():
    toc = [Heading(0, 50, 1, "1장 광합성", "toc")]
    font = [Heading(0, 50, 1, "1장 광합성", "font"), Heading(0, 200, 2, "명반응", "font"), Heading(1, 30, 1, "본문 큰 글씨", "font")]
    merged = merge_headings(toc, font)
    assert [(h.level, h.title) for h in merged] == [(1, "1장 광합성"), (2, "명반응")]


def test_ai_section_explanations(textbook, tmp_path):
    doc, texts, marks = _prepare(textbook)
    tree = build_tree(font_headings(texts.all()), marks)
    calls = []

    def create(**kw):
        prompt = kw["messages"][0]["content"][-1]["text"]
        calls.append(prompt)
        if "items" in kw["output_config"]["format"]["schema"]["properties"]:
            ids = [int(x) for x in re.findall(r"^\[(\d+)\]", prompt, re.M)]
            data = {"overview": "개요", "items": [{"id": i, "context": f"설명{i}"} for i in ids]}
        else:
            data = {"overview": "상위 개요"}
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=json.dumps(data, ensure_ascii=False))])

    r = AIReader(cache_path=tmp_path / "c.json", workers=1)
    r.client = SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))
    r.disabled_reason = None
    with_marks = [n for n in tree.walk() if n.marks]
    parents = [n for n in tree.walk() if len(n.children) >= 2]
    r.explain_sections("교과서", [(n, *section_text(n, texts.get)) for n in with_marks], parents)

    assert all(m.ai_context == f"설명{m.uid}" for m in marks)
    assert {n.title for n in parents} == {"Ⅰ. 세포와 에너지", "1. 광합성", "2. 세포 호흡"}
    assert all(n.overview == "상위 개요" for n in parents)
    assert len(calls) == len(with_marks) + len(parents)
    # 단원 프롬프트에는 목차 위치, 본문, 표시가 들어감
    p = next(c for c in calls if "> 산화적 인산화" in c)
    assert "최종 전자 수용체는 산소이다" in p and "<단원_본문>" in p


def test_cli_outline_output(textbook, tmp_path):
    out = tmp_path / "o"
    assert main([str(textbook), "-o", str(out), "--no-ai", "--format", "md,html,json"]) == 0
    md = (out / "요약.md").read_text(encoding="utf-8")
    assert "**목차**" in md and "    - 산화적 인산화 (1)" in md
    assert "## Ⅰ. 세포와 에너지" in md and "#### 해당 과정" in md
    assert "이 과정에서 **ATP와 NADPH가 만들어진다**." in md
    html = (out / "요약.html").read_text(encoding="utf-8")
    assert '<nav class="toc">' in html and 'data-toggle="hide-ctx"' in html
    data = json.loads((out / "요약.json").read_text(encoding="utf-8"))
    item = data["sections"][2]["items"][0]
    assert item["heading_path"] == ["Ⅰ. 세포와 에너지", "1. 광합성", "명반응"]
    assert item["sentence"] == "이 과정에서 ATP와 NADPH가 만들어진다."


def test_cli_color_mode_shows_path(textbook, tmp_path):
    out = tmp_path / "o"
    assert main([str(textbook), "-o", str(out), "--no-ai", "--format", "md", "--group-by", "color", "--context", "none"]) == 0
    md = (out / "요약.md").read_text(encoding="utf-8")
    assert "`Ⅰ. 세포와 에너지 > 2. 세포 호흡 > 산화적 인산화 · p.2" in md
    assert "이 과정에서" not in md   # --context none
