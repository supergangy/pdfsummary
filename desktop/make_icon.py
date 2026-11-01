"""앱 아이콘 그리기: 남색 바탕에 책 한 쪽, 형광펜 줄 두 개.

    python desktop/make_icon.py   →  desktop/icon.png, icon.ico, icon.icns
"""

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).parent
S = 1024


def draw() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((40, 40, S - 40, S - 40), radius=220, fill=(24, 46, 92, 255))
    # 종이
    d.rounded_rectangle((250, 190, 774, 834), radius=40, fill=(250, 248, 242, 255))
    # 인쇄 글줄
    y = 290
    for w in (420, 380, 420, 300, 420, 360, 420):
        d.rounded_rectangle((310, y, 310 + w, y + 26), radius=13, fill=(180, 184, 192, 255))
        y += 72
    # 형광펜 (반투명 노랑·분홍)
    over = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    o = ImageDraw.Draw(over)
    o.rounded_rectangle((296, 346, 716, 404), radius=18, fill=(255, 214, 0, 170))
    o.rounded_rectangle((296, 634, 690, 692), radius=18, fill=(255, 92, 160, 150))
    img = Image.alpha_composite(img, over)
    # 펜 밑줄
    d = ImageDraw.Draw(img)
    d.line((310, 560, 560, 556, 640, 562), fill=(47, 111, 222, 255), width=14, joint="curve")
    return img


def main() -> None:
    img = draw()
    img.save(HERE / "icon.png")
    img.save(HERE / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    img.save(HERE / "icon.icns")
    print("icon.png, icon.ico, icon.icns")


if __name__ == "__main__":
    main()
