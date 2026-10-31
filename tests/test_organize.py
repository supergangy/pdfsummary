from pdfsummary.models import HANDWRITING, HIGHLIGHT, NOTE, Mark
from pdfsummary.organize import attach_notes, by_chapter, decide_images, merge_adjacent, reading_order

Y = (1, 1, 0)


def hl(text, rect, page=0, color=Y):
    return Mark(page, HIGHLIGHT, rect, "annotation", color, text=text, parts=[rect])


def test_merge_two_lines_of_same_highlight():
    a = hl("광합성은 빛을", (300, 100, 420, 112))
    b = hl("이용한다.", (60, 118, 120, 130))
    c = hl("다른 문단", (60, 200, 120, 212))
    out = merge_adjacent(reading_order([c, b, a]), {0: 12})
    assert [m.text for m in out] == ["광합성은 빛을 이용한다.", "다른 문단"]


def test_different_colors_not_merged():
    a = hl("하나", (60, 100, 120, 112))
    b = hl("둘", (60, 118, 120, 130), color=(1, 0.6, 0.8))
    assert len(merge_adjacent([a, b], {0: 12})) == 2


def test_margin_note_attaches_by_vertical_distance():
    a = hl("핵심 문장", (60, 100, 200, 112))
    far = hl("먼 문장", (60, 400, 200, 412))
    note = Mark(0, HANDWRITING, (460, 98, 540, 120), "annotation")
    lonely = Mark(0, NOTE, (460, 700, 480, 720), "annotation", text="따로")
    out = attach_notes([a, note, far, lonely], {0: 12})
    assert out == [a, far, lonely]
    assert a.notes == [note]


def test_decide_images_auto():
    sure = Mark(0, HANDWRITING, (0, 0, 1, 1), "x", image=b"png", transcription="ATP", confidence="high")
    unsure = Mark(0, HANDWRITING, (0, 0, 1, 1), "x", image=b"png", transcription="ATP?", confidence="low")
    unread = Mark(0, HANDWRITING, (0, 0, 1, 1), "x", image=b"png")
    decide_images([sure, unsure, unread], "auto")
    assert (sure.show_image, unsure.show_image, unread.show_image) == (False, True, True)
    decide_images([sure], "both")
    assert sure.show_image
    decide_images([sure], "image")
    assert sure.show_image


def test_by_chapter():
    marks = [hl("a", (0, 0, 1, 1), page=0), hl("b", (0, 0, 1, 1), page=4), hl("c", (0, 0, 1, 1), page=9)]
    toc = [[1, "1장", 1], [2, "1.1", 3], [1, "2장", 9]]
    secs = by_chapter(marks, toc)
    assert [(s.title, [m.text for m in s.marks]) for s in secs] == [("1장", ["a"]), ("1.1", ["b"]), ("2장", ["c"])]
