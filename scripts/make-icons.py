#!/usr/bin/env python3
"""Generate DAWNSHIFTr icons: orange radio silhouette that stays readable at 16px."""
from pathlib import Path

from PIL import Image, ImageDraw

ORANGE = (232, 90, 42, 255)  # --accent #e85a2a
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"


def punch_ellipse(img, bbox):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse(bbox, fill=255)
    img.paste(Image.new("RGBA", img.size, (0, 0, 0, 0)), mask=mask)


def punch_round_rect(img, bbox, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(bbox, radius=radius, fill=255)
    img.paste(Image.new("RGBA", img.size, (0, 0, 0, 0)), mask=mask)


def radio16():
    """Integer-pixel radio: body + fat antenna + one speaker hole."""
    img = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([1, 5, 14, 15], radius=3, fill=ORANGE)
    d.line([(11, 5), (14, 1)], fill=ORANGE, width=2)
    d.ellipse([12, 0, 15, 3], fill=ORANGE)
    punch_ellipse(img, [3, 7, 9, 13])
    return img


def radio(size):
    if size <= 16:
        return radio16()

    src = max(512, size * 8)
    img = Image.new("RGBA", (src, src), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = src

    def box(x0, y0, x1, y1):
        return [x0 * s, y0 * s, x1 * s, y1 * s]

    def xy(x, y):
        return x * s, y * s

    def thick(frac, min_at_target):
        return max(min_at_target * src / size, frac * s)

    d.rounded_rectangle(box(0.07, 0.30, 0.93, 0.93), radius=0.13 * s, fill=ORANGE)

    ax0, ay0 = xy(0.72, 0.30)
    ax1, ay1 = xy(0.90, 0.07)
    aw = thick(0.09, 2.6)
    d.line([(ax0, ay0), (ax1, ay1)], fill=ORANGE, width=int(aw))
    cap = aw * 0.55
    d.ellipse([ax0 - cap, ay0 - cap, ax0 + cap, ay0 + cap], fill=ORANGE)
    ball = thick(0.10, 2.8) * 0.5
    d.ellipse([ax1 - ball, ay1 - ball, ax1 + ball, ay1 + ball], fill=ORANGE)

    punch_ellipse(img, box(0.16, 0.40, 0.58, 0.82))
    punch_ellipse(img, box(0.64, 0.46, 0.86, 0.68))
    if size >= 48:
        punch_round_rect(img, box(0.62, 0.74, 0.88, 0.84), 0.04 * s)

    return img.resize((size, size), Image.Resampling.LANCZOS)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        path = OUT / f"icon{size}.png"
        radio(size).save(path, "PNG", optimize=True)
        print("wrote", path)


if __name__ == "__main__":
    main()
