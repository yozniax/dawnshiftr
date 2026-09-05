#!/usr/bin/env python3
"""Generate DAWNSHIFTr icons: black field, reddish-orange dawn sun + bars."""
import struct
import zlib
from pathlib import Path

ORANGE = (232, 90, 42, 255)
ORANGE_HI = (255, 140, 90, 255)
WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 255)

OUT = Path("/workspace/icons")


def png(w, h, pixels):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw.extend(pixels[y * w + x])
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)),
            chunk(b"IDAT", zlib.compress(bytes(raw), 9)),
            chunk(b"IEND", b""),
        ]
    )


def blend(dst, src):
    a = src[3] / 255
    if a <= 0:
        return dst
    return tuple(int(dst[i] * (1 - a) + src[i] * a) for i in range(3)) + (255,)


def disk(px, py, cx, cy, r, color):
    d2 = (px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2
    if d2 <= (r - 0.55) ** 2:
        return color
    if d2 <= (r + 0.45) ** 2:
        t = (r + 0.45) - d2**0.5
        a = max(0, min(1, t))
        return (color[0], color[1], color[2], int(255 * a))
    return None


def rect(px, py, x0, y0, x1, y1, color):
    if x0 <= px < x1 and y0 <= py < y1:
        return color
    return None


def draw(size):
    pix = [BLACK] * (size * size)
    s = size / 128

    def setp(x, y, c):
        if c is None or not (0 <= x < size and 0 <= y < size):
            return
        i = y * size + x
        pix[i] = blend(pix[i], c)

    horizon = int(size * 0.62)
    sun_r = 32 * s
    sun_cx = size * 0.5
    sun_cy = horizon - 4 * s
    for y in range(size):
        for x in range(size):
            if y > horizon:
                continue
            c = disk(x, y, sun_cx, sun_cy, sun_r, ORANGE)
            setp(x, y, c)
            hi = disk(x, y, sun_cx - 8 * s, sun_cy - 8 * s, sun_r * 0.28, ORANGE_HI)
            setp(x, y, hi)

    for y in range(horizon, min(size, horizon + max(1, int(3 * s)))):
        for x in range(int(size * 0.08), int(size * 0.92)):
            setp(x, y, WHITE)

    for y in range(horizon, size):
        for x in range(size):
            dist = abs(x + 0.5 - sun_cx) / max(1, size * 0.42)
            fade = max(0, 1 - dist) * max(0, 1 - (y - horizon) / max(1, size * 0.40))
            if fade > 0.08:
                setp(x, y, (ORANGE[0], ORANGE[1], ORANGE[2], int(110 * fade)))

    return pix


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        (OUT / f"icon{size}.png").write_bytes(png(size, size, draw(size)))
        print("wrote", size)


if __name__ == "__main__":
    main()
