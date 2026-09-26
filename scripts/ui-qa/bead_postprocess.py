"""Convert source bead photos into centered 512x512 RGBA webp assets.

Flood-fills white studio backgrounds from the four corners so interior
highlights stay opaque, then crops to the alpha bounds and rescales the
longest side to the target frame fill without distorting aspect ratio.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

FRAME = 512
DEFAULT_TARGET_FILL = 0.85
FILL_MIN = 0.84
FILL_MAX = 0.86


def _flood_fill_white(image: Image.Image) -> Image.Image:
    width, height = image.size
    pixels = image.load()
    visited = bytearray(width * height)
    stack: list[tuple[int, int]] = []
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
    return image


def _prepare_source(source: Path) -> Image.Image:
    image = Image.open(source).convert("RGBA")
    # JPEG / opaque studio photos need white-background removal.
    if source.suffix.lower() in {".jpg", ".jpeg"}:
        if max(image.size) > FRAME:
            scale = FRAME / max(image.size)
            image = image.resize(
                (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
                Image.LANCZOS,
            )
        image = _flood_fill_white(image)
    return image


def process(source: Path, target: Path, target_fill: float = DEFAULT_TARGET_FILL) -> None:
    if not FILL_MIN <= target_fill <= FILL_MAX:
        raise SystemExit(f"--target-fill must be between {FILL_MIN} and {FILL_MAX}, got {target_fill}")
    if source.resolve() == target.resolve():
        raise SystemExit("source and target must differ")

    image = _prepare_source(source)
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        raise SystemExit(f"source has empty alpha bounds: {source}")

    content = image.crop(bbox)
    longest = max(content.size)
    target_longest = round(FRAME * target_fill)
    if longest != target_longest:
        scale = target_longest / longest
        new_size = (
            max(1, round(content.width * scale)),
            max(1, round(content.height * scale)),
        )
        content = content.resize(new_size, Image.LANCZOS)

    canvas = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    paste_x = (FRAME - content.width) // 2
    paste_y = (FRAME - content.height) // 2
    canvas.paste(content, (paste_x, paste_y), content)

    target.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(target, "WEBP", quality=92, method=6)
    print(f"wrote {target} fill={target_fill} longest={max(content.size)}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Normalize one bead photo into a 512x512 RGBA webp.")
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--target-fill", type=float, default=DEFAULT_TARGET_FILL)
    args = parser.parse_args(argv)
    process(args.source, args.target, args.target_fill)
    return 0


if __name__ == "__main__":
    sys.exit(main())
