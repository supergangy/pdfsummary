"""요약본을 이루는 데이터 구조."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

# 표시 종류
HIGHLIGHT = "highlight"      # 형광펜
UNDERLINE = "underline"      # 밑줄
STRIKEOUT = "strikeout"      # 취소선
CIRCLE = "circle"            # 동그라미/네모로 감싼 부분
HANDWRITING = "handwriting"  # 손글씨 메모
NOTE = "note"                # 입력한 메모 (스티커 메모, 텍스트 상자, 형광펜에 단 댓글)

# 어디서 찾았는지
SRC_ANNOT = "annotation"   # PDF 주석 (Adobe, 미리보기, Xodo, Flexcil 등)
SRC_DRAWING = "drawing"    # 페이지에 굳어진 펜 획 (GoodNotes, Notability 내보내기 등)
SRC_SCAN = "scan"          # 스캔 이미지에서 색으로 찾은 것
SRC_DIFF = "diff"          # 필기 전 원본 PDF와 비교해서 찾은 것

KIND_LABELS = {
    HIGHLIGHT: "형광펜",
    UNDERLINE: "밑줄",
    STRIKEOUT: "취소선",
    CIRCLE: "동그라미",
    HANDWRITING: "손글씨",
    NOTE: "메모",
}

Rect = tuple[float, float, float, float]


@dataclass
class Mark:
    """책에 남긴 표시 하나 (형광펜 한 구간, 손글씨 한 덩어리 등)."""

    page: int                       # 0부터 시작하는 페이지 번호
    kind: str
    rect: Rect
    source: str
    color: Optional[tuple[float, float, float]] = None
    text: str = ""                  # 표시된 인쇄 글자 또는 입력한 메모 내용
    image: Optional[bytes] = None   # 원본 그대로 잘라낸 PNG (손글씨, 글자층 없는 스캔)
    context: str = ""               # 주변 인쇄 글자 (AI가 손글씨를 읽을 때 참고)
    transcription: Optional[str] = None   # AI가 읽은 손글씨
    confidence: Optional[str] = None      # high / medium / low
    unclear: list[str] = field(default_factory=list)
    show_image: bool = False        # 결과물에 원본 이미지를 보여줄지
    is_symbol: bool = False         # 글자가 아니라 별표·체크·화살표 같은 기호
    notes: list["Mark"] = field(default_factory=list)  # 이 표시에 딸린 메모
    parts: list[Rect] = field(default_factory=list)    # 여러 줄에 걸친 경우 줄별 영역

    @property
    def page_no(self) -> int:
        return self.page + 1

    @property
    def body(self) -> str:
        """결과물에 쓸 대표 글."""
        if self.kind == HANDWRITING:
            return self.transcription or ""
        return self.text


def union(a: Rect, b: Rect) -> Rect:
    return (min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3]))


def expand(r: Rect, d: float) -> Rect:
    return (r[0] - d, r[1] - d, r[2] + d, r[3] + d)


def intersects(a: Rect, b: Rect) -> bool:
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def area(r: Rect) -> float:
    return max(0.0, r[2] - r[0]) * max(0.0, r[3] - r[1])


def gap(a: Rect, b: Rect) -> float:
    """두 사각형 사이의 최단 거리 (겹치면 0)."""
    dx = max(0.0, max(a[0], b[0]) - min(a[2], b[2]))
    dy = max(0.0, max(a[1], b[1]) - min(a[3], b[3]))
    return (dx * dx + dy * dy) ** 0.5
