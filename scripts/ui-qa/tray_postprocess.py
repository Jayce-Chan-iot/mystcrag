"""Normalize native-alpha tray renders into deterministic runtime WebPs."""

from __future__ import annotations

import argparse
import io
import math
from pathlib import Path

from PIL import Image

FRAME = 1024
TARGET_DIAMETER = 901
MAX_BYTES = 900 * 1024
QUALITY_CANDIDATES = (95, 92, 90, 88, 85, 82, 80)


def _neutralize_edge_fringe(image: Image.Image, center: tuple[float, float], radius: float, neutral: bool) -> None:
    pixels = image.load()
    cx, cy = center
    inner = radius * 0.84
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            distance = math.hypot(x - cx, y - cy)
            if not neutral and distance < inner:
                continue
            green_bias = g - max(r, b)
            magenta_bias = min(r, b) - g
            red_bias = r - max(g, b)
            blue_bias = b - max(r, g)
            if neutral:
                contaminated = max(r, g, b) - min(r, g, b) > 38
            else:
                contaminated = green_bias > 18 or magenta_bias > 42 or red_bias > 58 or blue_bias > 58
            if contaminated:
                luminance = round(0.2126 * r + 0.7152 * g + 0.0722 * b)
                pixels[x, y] = (luminance, luminance, luminance, a)


def _apply_radial_clip(image: Image.Image, center: tuple[float, float], radius: float) -> None:
    pixels = image.load()
    cx, cy = center
    feather = 2.5
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            distance = math.hypot(x - cx, y - cy)
            if distance >= radius:
                pixels[x, y] = (r, g, b, 0)
            elif distance > radius - feather:
                scale = (radius - distance) / feather
                pixels[x, y] = (r, g, b, round(a * max(0.0, min(1.0, scale))))


def _encode_webp(image: Image.Image) -> tuple[bytes, int]:
    for quality in QUALITY_CANDIDATES:
        output = io.BytesIO()
        image.save(output, "WEBP", quality=quality, method=6, exact=True)
        payload = output.getvalue()
        if len(payload) <= MAX_BYTES:
            return payload, quality
    raise SystemExit(f"encoded tray exceeds {MAX_BYTES} bytes at quality {QUALITY_CANDIDATES[-1]}")


def process(source: Path, target: Path, source_radius: float, neutral: bool = False) -> None:
    if source.resolve() == target.resolve():
        raise SystemExit("source and target must differ")
    image = Image.open(source).convert("RGBA")
    center = (image.width / 2.0, image.height / 2.0)
    if source_radius <= 0 or source_radius > min(image.size) / 2:
        raise SystemExit(f"invalid --source-radius {source_radius} for {image.size}")

    _neutralize_edge_fringe(image, center, source_radius, neutral)
    _apply_radial_clip(image, center, source_radius)

    cx, cy = center
    crop = image.crop(
        (
            round(cx - source_radius),
            round(cy - source_radius),
            round(cx + source_radius),
            round(cy + source_radius),
        )
    )
    crop = crop.resize((TARGET_DIAMETER, TARGET_DIAMETER), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (FRAME, FRAME), (0, 0, 0, 0))
    offset = (FRAME - TARGET_DIAMETER) // 2
    canvas.paste(crop, (offset, offset))

    payload, quality = _encode_webp(canvas)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    print(f"wrote {target} bytes={len(payload)} quality={quality} source_radius={source_radius:g} neutral={neutral}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--source-radius", type=float, required=True)
    parser.add_argument("--neutral", action="store_true", help="neutralize chroma across a colorless acrylic subject")
    args = parser.parse_args()
    process(args.source, args.target, args.source_radius, args.neutral)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
