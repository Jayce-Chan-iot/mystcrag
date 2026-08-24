"""Convert generated white-background bead photos into 512x512 RGBA webp assets.

Flood-fills from the four corners so interior highlights stay opaque,
then crops to the bead's bounding box and rescales to ~85% frame coverage.
"""
import sys
from pathlib import Path

from PIL import Image

FRAME = 512
TARGET_FILL = 0.85


def process(source: Path, target: Path) -> None:
    image = Image.open(source).convert("RGBA")
    image = image.resize((FRAME, FRAME), Image.LANCZOS) if image.size != (FRAME, FRAME) else image
    width, height = image.size
    pixels = image.load()
    visited = bytearray(width * height)
    stack = []
    for x in range(width):
        stack.append((x, 0))
        stack.append((x, height - 1))
    for y in range(height):
        stack.append((0, y))
        stack.append((width - 1, y))
    threshold = 242

    def is_white(x: int, y: int) -> bool:
        r, g, b, _ = pixels[x, y]
        return r >= threshold and g >= threshold and b >= threshold

    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= width or y >= height:
            continue
        index = y * width + x
        if visited[index]:
            continue
        visited[index] = 1
        if not is_white(x, y):
            continue
        r, g, b, _ = pixels[x, y]
        pixels[x, y] = (r, g, b, 0)
        stack.extend([(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)])

    for y in range(height):
        for x in range(width):
            index = y * width + x
            if not visited[index]:
                continue
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            near_transparent = any(
                0 <= nx < width and 0 <= ny < height and pixels[nx, ny][3] == 0
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1))
            )
            if near_transparent:
                pixels[x, y] = (r, g, b, 140)

    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox:
        content = image.crop(bbox)
        longest = max(content.size)
        scaled = int(FRAME * TARGET_FILL / longest * max(content.size))
        scaled = max(1, min(FRAME, scaled))
        content = content.resize((scaled, scaled), Image.LANCZOS)
        canvas = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
        canvas.paste(
            content,
            ((FRAME - content.size[0]) // 2, (FRAME - content.size[1]) // 2),
            content
        )
        image = canvas

    image.save(target, "WEBP", quality=92, method=6)
    print(f"wrote {target}")


if __name__ == "__main__":
    process(Path(sys.argv[1]), Path(sys.argv[2]))
