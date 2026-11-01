"""시험용 PDF 만들기: 세 가지 필기 방식을 한 권에 담는다.

1쪽: PDF 주석으로 필기 (형광펜·밑줄 주석, 스티커 메모, 잉크 펜 손글씨/밑줄/동그라미)
2쪽: GoodNotes처럼 필기가 페이지에 굳어진 경우 (반투명 굵은 획 + 둥근 펜 획)
3쪽: 형광펜 칠한 종이책을 스캔한 경우 (페이지 전체가 이미지)

    python examples/make_sample.py sample.pdf
"""

from __future__ import annotations

import math
import sys

import pymupdf

FONT = "korea"  # PyMuPDF 내장 한글 글꼴

PARAS = [
    "광합성은 식물이 빛 에너지를 이용하여 이산화탄소와 물로부터 포도당을 만드는 과정이다.",
    "이 과정은 엽록체의 틸라코이드 막에서 일어나는 명반응과 스트로마에서 일어나는 암반응으로 나뉜다.",
    "명반응에서는 물이 분해되어 산소가 발생하고, ATP와 NADPH가 만들어진다.",
    "암반응(캘빈 회로)에서는 명반응의 산물을 이용해 이산화탄소를 고정한다.",
    "광합성 속도는 빛의 세기, 이산화탄소 농도, 온도의 영향을 받는다.",
    "빛의 세기가 일정 수준 이상이 되면 광합성 속도는 더 이상 증가하지 않는데, 이를 광포화점이라 한다.",
]


def write_text(page: pymupdf.Page, heading: str, paras: list[str]) -> None:
    page.insert_text((60, 70), heading, fontname=FONT, fontsize=18)
    box = pymupdf.Rect(60, 95, 430, 760)
    html_like = "\n\n".join(paras)
    page.insert_textbox(box, html_like, fontname=FONT, fontsize=11.5, lineheight=1.6)


def squiggle_word(x: float, y: float, letters: int, size: float = 9.0, seed: int = 0) -> list[list[tuple[float, float]]]:
    """손글씨 흉내: 글자마다 작은 고리 모양 획."""
    strokes = []
    for k in range(letters):
        cx = x + k * size * 0.9
        pts = []
        for t in range(14):
            a = t / 13 * 2 * math.pi * 1.3 + seed + k
            pts.append((cx + math.cos(a) * size * 0.35 + t * 0.25, y + math.sin(a * 1.4) * size * 0.45))
        strokes.append(pts)
    return strokes


def page_annotations(doc: pymupdf.Document) -> None:
    page = doc.new_page()
    write_text(page, "1. 광합성의 개요", PARAS)

    # 형광펜 주석 (노랑, 두 줄에 걸침)
    quads = page.search_for("빛 에너지를 이용하여 이산화탄소와 물로부터 포도당을 만드는 과정이다.", quads=True)
    page.add_highlight_annot(quads)

    # 분홍 형광펜 + 댓글
    q = page.search_for("명반응", quads=True)[0]
    hl = page.add_highlight_annot(q)
    hl.set_colors(stroke=(1, 0.6, 0.8))
    hl.set_info(content="틸라코이드 = 명반응 장소")
    hl.update()

    # 밑줄 주석
    q = page.search_for("ATP와 NADPH", quads=True)
    page.add_underline_annot(q)

    # 스티커 메모
    r = page.search_for("광포화점")[0]
    page.add_text_annot((r.x1 + 60, r.y0), "시험에 자주 나옴!")

    # 잉크 펜: 오른쪽 여백 손글씨 (명반응 근처)
    r = page.search_for("명반응에서는")[0]
    ink = page.add_ink_annot(squiggle_word(450, r.y0 + 6, 5, seed=1) + squiggle_word(450, r.y0 + 20, 3, seed=2))
    ink.set_colors(stroke=(0.1, 0.2, 0.8))
    ink.set_border(width=1.2)
    ink.update()

    # 잉크 펜: 밑줄
    r = page.search_for("캘빈 회로")[0]
    ink = page.add_ink_annot([[(r.x0, r.y1 + 2), (r.x0 + r.width / 2, r.y1 + 2.6), (r.x1, r.y1 + 2)]])
    ink.set_colors(stroke=(0.9, 0.1, 0.1))
    ink.set_border(width=1.0)
    ink.update()

    # 잉크 펜: 동그라미
    r = page.search_for("온도")[0]
    cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
    rx, ry = r.width / 2 + 5, r.height / 2 + 4
    circle = [(cx + rx * math.cos(t / 30 * 2 * math.pi), cy + ry * math.sin(t / 30 * 2 * math.pi)) for t in range(32)]
    ink = page.add_ink_annot([circle])
    ink.set_colors(stroke=(0.1, 0.6, 0.2))
    ink.set_border(width=1.0)
    ink.update()

    # 형광펜을 잉크 주석으로 칠한 경우 (반투명 굵은 펜)
    r = page.search_for("이산화탄소 농도")[0]
    ink = page.add_ink_annot([[(r.x0, (r.y0 + r.y1) / 2), (r.x1, (r.y0 + r.y1) / 2)]])
    ink.set_colors(stroke=(0.3, 0.9, 0.3))
    ink.set_border(width=r.height)
    ink.set_opacity(0.4)
    ink.update()


def page_flattened(doc: pymupdf.Document) -> None:
    page = doc.new_page()
    paras = [
        "세포 호흡은 포도당을 분해하여 생명 활동에 필요한 에너지를 얻는 과정이다.",
        "해당 과정은 세포질에서 일어나며 포도당 1분자가 피루브산 2분자로 분해된다.",
        "TCA 회로와 전자 전달계는 미토콘드리아에서 일어나며 대부분의 ATP가 이 단계에서 생성된다.",
        "산소가 없을 때는 발효가 일어나 젖산이나 에탄올이 만들어진다.",
    ]
    write_text(page, "2. 세포 호흡", paras)
    sh = page.new_shape()

    # GoodNotes 형광펜처럼: 반투명 굵은 획 (페이지 내용에 직접 그림)
    r = page.search_for("포도당 1분자가 피루브산 2분자로 분해된다")[0]
    y = (r.y0 + r.y1) / 2
    sh.draw_polyline([(r.x0, y), (r.x0 + r.width * 0.5, y + 0.4), (r.x1, y)])
    sh.finish(color=(1, 0.85, 0), width=r.height * 1.1, stroke_opacity=0.35, lineCap=1, closePath=False)

    # 펜 손글씨 (둥근 끝, 검정) - 아래 여백
    for stroke in squiggle_word(80, 470, 6, size=11, seed=3):
        sh.draw_polyline(stroke)
        sh.finish(color=(0.05, 0.05, 0.05), width=1.4, lineCap=1, lineJoin=1, closePath=False)
    sh.commit()

    # 책 자체의 표 선 (손글씨로 잡히면 안 됨)
    sh = page.new_shape()
    sh.draw_rect(pymupdf.Rect(60, 560, 430, 640))
    sh.draw_line((60, 600), (430, 600))
    sh.finish(color=(0, 0, 0), width=0.6)
    sh.commit()


def page_scanned(doc: pymupdf.Document) -> None:
    # 종이책을 흉내 낸 페이지를 이미지로 만든 뒤 그 이미지만 담은 페이지를 만든다
    tmp = pymupdf.open()
    p = tmp.new_page()
    paras = [
        "유전자는 DNA의 특정 염기 서열로, 단백질 합성에 필요한 정보를 담고 있다.",
        "전사는 DNA의 유전 정보가 mRNA로 옮겨지는 과정이고, 번역은 mRNA의 정보에 따라 단백질이 합성되는 과정이다.",
        "코돈은 연속된 세 개의 염기로 하나의 아미노산을 지정한다.",
    ]
    write_text(p, "3. 유전자 발현", paras)
    r = p.search_for("코돈은 연속된 세 개의 염기로")[0]
    p.draw_rect(r, color=None, fill=(1, 0.93, 0.3), fill_opacity=0.55, overlay=True)
    pix = p.get_pixmap(dpi=150)

    page = doc.new_page()
    page.insert_image(page.rect, stream=pix.tobytes("png"))


def main(path: str) -> None:
    doc = pymupdf.open()
    page_annotations(doc)
    page_flattened(doc)
    page_scanned(doc)
    doc.set_toc([[1, "1. 광합성의 개요", 1], [1, "2. 세포 호흡", 2], [1, "3. 유전자 발현", 3]])
    doc.set_metadata({"title": "생명과학 정리 노트(예시)"})
    doc.save(path)
    print(path)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "sample.pdf")


# ── 책 자체에 색칠이 있는 경우 (원본 비교 / 색 지정 시험용) ─────────────────

BOOK_YELLOW = (1.0, 0.95, 0.55)     # 책에 인쇄된 강조 색
MY_YELLOW = (0.96, 0.9, 0.39)       # 내 형광펜 색 (#F5E663)
MY_PINK = (1.0, 0.55, 0.75)


def make_book_pair(original_path: str, annotated_path: str) -> None:
    """original: 책 자체에 노란 강조·빨간 밑줄이 인쇄된 원본
    annotated: 그 위에 내가 형광펜(노랑·분홍)과 손글씨를 더한 것.
               손글씨는 '그림 한 장'으로 덮어씌운다 (필기를 이미지로 굳혀 내보내는 앱 흉내)."""
    orig = pymupdf.open()
    page = orig.new_page()
    paras = [
        "효소는 생명체 내에서 일어나는 화학 반응의 활성화 에너지를 낮추는 생체 촉매이다.",
        "효소는 기질 특이성이 있어 특정한 기질과만 결합하며, 이때 효소-기질 복합체가 형성된다.",
        "효소의 활성은 온도와 pH의 영향을 받으며, 최적 온도와 최적 pH에서 가장 높다.",
        "경쟁적 저해제는 기질과 구조가 비슷하여 효소의 활성 부위에 결합한다.",
    ]
    write_text(page, "4. 효소", paras)
    # 책 자체의 강조: 불투명 노란 바탕 + 반투명 노란 바탕 + 빨간 직선 밑줄
    r = page.search_for("생체 촉매")[0]
    page.draw_rect(r, color=None, fill=BOOK_YELLOW, overlay=False)
    r = page.search_for("기질 특이성")[0]
    page.draw_rect(r, color=None, fill=BOOK_YELLOW, fill_opacity=0.5)
    r = page.search_for("최적 온도")[0]
    page.draw_line((r.x0, r.y1 + 1), (r.x1, r.y1 + 1), color=(0.85, 0.1, 0.1), width=1)
    orig.save(original_path)

    ann = pymupdf.open(original_path)
    page = ann[0]
    sh = page.new_shape()
    for phrase, color in (("활성화 에너지를 낮추는", MY_YELLOW), ("경쟁적 저해제", MY_PINK)):
        r = page.search_for(phrase)[0]
        y = (r.y0 + r.y1) / 2
        sh.draw_polyline([(r.x0, y), (r.x0 + r.width / 2, y + 0.3), (r.x1, y)])
        sh.finish(color=color, width=r.height, stroke_opacity=0.45, lineCap=1, closePath=False)
    sh.commit()

    # 손글씨를 투명 배경 그림으로 만들어 덮는다
    r = page.search_for("경쟁적 저해제")[0]
    ink = pymupdf.open()
    ip = ink.new_page(width=page.rect.width, height=page.rect.height)
    s2 = ip.new_shape()
    for stroke in squiggle_word(450, r.y0 + 6, 5, seed=4):
        s2.draw_polyline(stroke)
        s2.finish(color=(0.1, 0.2, 0.75), width=1.3, lineCap=1, closePath=False)
    s2.commit()
    # 그림으로 굳은 형광펜 (초록)
    g = page.search_for("가장 높다")[0]
    ip.draw_rect(g, color=None, fill=(0.4, 0.9, 0.4), fill_opacity=0.45)
    pix = ip.get_pixmap(dpi=150, alpha=True)
    page.insert_image(page.rect, stream=pix.tobytes("png"), overlay=True)
    ann.save(annotated_path)
