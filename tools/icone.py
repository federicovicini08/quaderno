"""Genera le icone PNG di Quaderno senza librerie esterne."""
import struct, zlib, sys

BG = (0x17, 0x1a, 0x21)
PAGE = (0xe9, 0xec, 0xf2)
BARS = [(0x5b, 0x8d, 0xef), (0x3f, 0xb6, 0x8b), (0xf2, 0x99, 0x4a), (0xa7, 0x8b, 0xfa)]

def rrect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def colore(u, v):
    # u, v in [0,1]
    if rrect(u, v, .24, .16, .76, .84, .06):
        for i, c in enumerate(BARS):
            y0 = .30 + i * .125
            if rrect(u, v, .34, y0, .66 if i % 2 == 0 else .58, y0 + .065, .03):
                return c
        return PAGE
    return BG

def png(n, path, ss=3):
    rows = []
    for j in range(n):
        row = bytearray([0])
        for i in range(n):
            acc = [0, 0, 0]
            for a in range(ss):
                for b in range(ss):
                    c = colore((i + (a + .5) / ss) / n, (j + (b + .5) / ss) / n)
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]
            row += bytes(int(x / (ss * ss) + .5) for x in acc)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0)) + chunk(b"IDAT", raw) + chunk(b"IEND", b""))

for n, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
    png(n, "icons/" + name)
print("ok")
