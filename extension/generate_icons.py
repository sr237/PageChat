"""Generate simple indigo PageChat PNG icons using only Python's standard library."""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).parent / "icons"


# Packages one PNG data block and calculates its checksum.
def chunk(kind, data):
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


# Chooses the icon pixel color for the chat bubble and its three dots.
def pixel(x, y, size):
    pad = size * 0.12
    radius = size * 0.24
    cx, cy = size / 2, size / 2
    dx, dy = abs(x - cx), abs(y - cy)
    inside = dx <= size / 2 - pad and dy <= size / 2 - pad
    if inside:
        for dot_x in (size * .36, size * .5, size * .64):
            if (x - dot_x) ** 2 + (y - size * .5) ** 2 <= (size * .055) ** 2:
                return (255, 255, 255, 255)
    if inside and (dx <= size / 2 - pad - radius or dy <= size / 2 - pad - radius or (dx - (size / 2 - pad - radius)) ** 2 + (dy - (size / 2 - pad - radius)) ** 2 <= radius ** 2):
        # Small lower-left tail keeps the shape recognizable at 16 pixels.
        if x < size * .35 and y > size * .68 and y < size * .84 and y > (size * .96 - x * .8):
            inside = True
        return (79, 70, 229, 255)
    return (0, 0, 0, 0)


# Draws the icon at one size and writes it as a PNG file.
def write_png(size):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            row.extend(pixel(x + .5, y + .5, size))
        rows.append(bytes(row))
    raw = b"".join(rows)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">2I5B", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    (OUT / f"{size}.png").write_bytes(png)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for dimension in (16, 48, 128):
        write_png(dimension)
