"""형광펜·펜 색을 사람이 부르는 이름으로 바꾼다."""

from __future__ import annotations

import colorsys
from typing import Optional

# (영문 키, 한글 이름, 결과물에 칠할 색)
COLOR_NAMES = {
    "yellow": ("노랑", "#ffe066"),
    "orange": ("주황", "#ffb366"),
    "red": ("빨강", "#ff8080"),
    "pink": ("분홍", "#ff9ecf"),
    "purple": ("보라", "#c9a3ff"),
    "blue": ("파랑", "#8cc8ff"),
    "green": ("초록", "#9be59b"),
    "black": ("검정", "#9a9a9a"),
    "gray": ("회색", "#c8c8c8"),
}

# 한글 이름으로도 라벨을 지정할 수 있게
KOREAN_TO_KEY = {v[0]: k for k, v in COLOR_NAMES.items()}


def color_key(rgb: Optional[tuple[float, float, float]]) -> str:
    """RGB(0~1)를 가장 가까운 색 이름 키로."""
    if not rgb:
        return "yellow"
    r, g, b = (max(0.0, min(1.0, float(c))) for c in rgb[:3])
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if s < 0.18 or l < 0.12:
        return "black" if l < 0.45 else "gray"
    deg = h * 360
    if deg < 15 or deg >= 345:
        # 빨강 계열 중 밝으면 분홍
        return "pink" if l > 0.7 else "red"
    if deg < 40:
        return "orange"
    if deg < 70:
        return "yellow"
    if deg < 165:
        return "green"
    if deg < 255:
        return "blue"
    if deg < 290:
        return "purple"
    return "pink"


def color_name(rgb) -> str:
    return COLOR_NAMES[color_key(rgb)][0]


def color_css(rgb) -> str:
    return COLOR_NAMES[color_key(rgb)][1]


def parse_label(spec: str) -> tuple[str, str]:
    """'yellow=핵심' 또는 '노랑=핵심' 을 ('yellow', '핵심')으로."""
    if "=" not in spec:
        raise ValueError(f"라벨은 색=이름 형식이어야 합니다: {spec!r}")
    key, label = spec.split("=", 1)
    key = key.strip().lower()
    key = KOREAN_TO_KEY.get(key, key)
    if key not in COLOR_NAMES:
        raise ValueError(
            f"모르는 색 {key!r}. 사용 가능: "
            + ", ".join(f"{k}({v[0]})" for k, v in COLOR_NAMES.items())
        )
    return key, label.strip()


def to_hex(rgb) -> str:
    r, g, b = (max(0, min(255, round(float(c) * 255))) for c in rgb[:3])
    return f"#{r:02X}{g:02X}{b:02X}"


def from_hex(code: str) -> tuple[float, float, float]:
    s = code.strip().lstrip("#")
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    if len(s) != 6 or any(c not in "0123456789abcdefABCDEF" for c in s):
        raise ValueError(f"색 코드는 #RRGGBB 형식이어야 합니다: {code!r}")
    return tuple(int(s[i : i + 2], 16) / 255 for i in (0, 2, 4))


class ColorFilter:
    """'형광펜은 이 색만' 거르기.

    - 색 이름(노랑, pink …)을 주면 그 계열 전체를 받는다.
    - 색 코드(#F5E663)를 주면, 펜 색을 정확히 아는 경우(주석·벡터 획)에는 그 색과 가까운 것만 받는다.
      종이 위에 비친 색만 보이는 경우(스캔·원본 비교)에는 실제보다 연하게 보이므로 같은 계열이면 받는다.
    """

    EXACT_SOURCES = ("annotation", "drawing")

    def __init__(self, specs: list[str], tolerance: float = 0.05):
        self.families: set[str] = set()
        self.codes: list[tuple[float, float, float]] = []
        self.tolerance = tolerance
        for spec in specs:
            for part in spec.split(","):
                part = part.strip()
                if not part:
                    continue
                if part.startswith("#") or (len(part) in (3, 6) and all(c in "0123456789abcdefABCDEF" for c in part)):
                    self.codes.append(from_hex(part))
                    continue
                key = KOREAN_TO_KEY.get(part, part.lower())
                if key not in COLOR_NAMES:
                    raise ValueError(
                        f"모르는 색 {part!r}. 색 이름("
                        + ", ".join(v[0] for v in COLOR_NAMES.values())
                        + ") 또는 #RRGGBB 코드를 쓰세요."
                    )
                self.families.add(key)

    def __bool__(self) -> bool:
        return bool(self.families or self.codes)

    def accepts(self, rgb, source: str) -> bool:
        if not self:
            return True
        if rgb is None:
            return False
        key = color_key(rgb)
        if key in self.families:
            return True
        for code in self.codes:
            if source in self.EXACT_SOURCES:
                dist = sum((a - b) ** 2 for a, b in zip(code, rgb[:3])) ** 0.5 / 3**0.5
                if dist <= self.tolerance:
                    return True
            elif color_key(code) == key:
                return True
        return False
