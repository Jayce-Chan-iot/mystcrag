"""Fail-closed quality gates for DIY tray and photographic bead runtime assets."""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
TRAY_DIR = REPO_ROOT / "apps" / "frontend" / "public" / "trays"
BEAD_DIR = REPO_ROOT / "apps" / "frontend" / "public" / "beads" / "photographic"

TRAY_NAMES = (
    "bone-china.webp",
    "clear-acrylic.webp",
    "french-linen.webp",
    "oak-wood.webp",
)

BEAD_NAMES = (
    "amazonite.webp",
    "amethyst.webp",
    "aquamarine.webp",
    "black-onyx.webp",
    "citrine.webp",
    "clear-quartz.webp",
    "fluorite.webp",
    "garnet.webp",
    "green-aventurine.webp",
    "labradorite.webp",
    "lapis-lazuli.webp",
    "moonstone.webp",
    "obsidian.webp",
    "prehnite.webp",
    "red-agate.webp",
    "rhodonite.webp",
    "rose-quartz.webp",
    "smoky-quartz.webp",
    "sunstone.webp",
    "tiger-eye.webp",
)

CORNER_ALPHA_MAX = 8
TRAY_SIZE = 1024
TRAY_CENTER_TOLERANCE = 16
BEAD_SIZE = 512
BEAD_CENTER_TOLERANCE = 4
BEAD_LONGEST_MIN = 430
BEAD_LONGEST_MAX = 440


@dataclass(frozen=True)
class AssetMeasurement:
    width: int
    height: int
    alpha_bbox: tuple[int, int, int, int]
    corner_alpha_max: int


def measure(path: Path) -> AssetMeasurement:
    image = Image.open(path).convert("RGBA")
    alpha = image.getchannel("A")
    bbox = alpha.getbbox() or (0, 0, 0, 0)
    corners = [
        alpha.getpixel((0, 0)),
        alpha.getpixel((image.width - 1, 0)),
        alpha.getpixel((0, image.height - 1)),
        alpha.getpixel((image.width - 1, image.height - 1)),
    ]
    return AssetMeasurement(image.width, image.height, bbox, max(corners))


def _alpha_box_stats(bbox: tuple[int, int, int, int]) -> tuple[float, float, int, int]:
    left, top, right, bottom = bbox
    cx = (left + right) / 2.0
    cy = (top + bottom) / 2.0
    return cx, cy, right - left, bottom - top


def verify_tray(path: Path) -> tuple[bool, list[str]]:
    if not path.is_file():
        return False, ["missing file"]
    m = measure(path)
    issues: list[str] = []
    if (m.width, m.height) != (TRAY_SIZE, TRAY_SIZE):
        issues.append(f"size={m.width}x{m.height} expected {TRAY_SIZE}x{TRAY_SIZE}")
    if m.corner_alpha_max > CORNER_ALPHA_MAX:
        issues.append(f"corner_alpha={m.corner_alpha_max} expected <= {CORNER_ALPHA_MAX}")
    left, top, right, bottom = m.alpha_bbox
    if right <= left or bottom <= top:
        issues.append(f"empty alpha bbox={m.alpha_bbox}")
    else:
        cx, cy, bw, bh = _alpha_box_stats(m.alpha_bbox)
        half = TRAY_SIZE / 2.0
        if abs(cx - half) > TRAY_CENTER_TOLERANCE or abs(cy - half) > TRAY_CENTER_TOLERANCE:
            issues.append(f"alpha center=({cx:.1f},{cy:.1f}) expected near ({half:.1f},{half:.1f})")
        if bw == TRAY_SIZE and bh == TRAY_SIZE and m.corner_alpha_max > CORNER_ALPHA_MAX:
            issues.append("opaque full-frame rectangle")
    return (not issues), issues


def verify_bead(path: Path) -> tuple[bool, list[str]]:
    if not path.is_file():
        return False, ["missing file"]
    m = measure(path)
    issues: list[str] = []
    if (m.width, m.height) != (BEAD_SIZE, BEAD_SIZE):
        issues.append(f"size={m.width}x{m.height} expected {BEAD_SIZE}x{BEAD_SIZE}")
    if m.corner_alpha_max > CORNER_ALPHA_MAX:
        issues.append(f"corner_alpha={m.corner_alpha_max} expected <= {CORNER_ALPHA_MAX}")
    left, top, right, bottom = m.alpha_bbox
    if right <= left or bottom <= top:
        issues.append(f"empty alpha bbox={m.alpha_bbox}")
    else:
        cx, cy, bw, bh = _alpha_box_stats(m.alpha_bbox)
        half = BEAD_SIZE / 2.0
        if abs(cx - half) > BEAD_CENTER_TOLERANCE or abs(cy - half) > BEAD_CENTER_TOLERANCE:
            issues.append(f"alpha center=({cx:.1f},{cy:.1f}) expected within {BEAD_CENTER_TOLERANCE}px of ({half:.1f},{half:.1f})")
        longest = max(bw, bh)
        if not (BEAD_LONGEST_MIN <= longest <= BEAD_LONGEST_MAX):
            issues.append(f"longest_alpha_side={longest} expected {BEAD_LONGEST_MIN}-{BEAD_LONGEST_MAX}")
    return (not issues), issues


def _format_line(kind: str, path: Path, ok: bool, issues: list[str], m: AssetMeasurement | None) -> str:
    if m is None:
        return f"FAIL {kind} {path.name}: {'; '.join(issues)}"
    status = "PASS" if ok else "FAIL"
    left, top, right, bottom = m.alpha_bbox
    cx, cy, bw, bh = _alpha_box_stats(m.alpha_bbox)
    detail = f"size={m.width}x{m.height} bbox=({left},{top},{right},{bottom}) center=({cx:.1f},{cy:.1f}) longest={max(bw, bh)} corner_a={m.corner_alpha_max}"
    if issues:
        detail += " | " + "; ".join(issues)
    return f"{status} {kind} {path.name}: {detail}"


def run(kind: str) -> int:
    failures = 0
    if kind in ("tray", "all"):
        for name in TRAY_NAMES:
            path = TRAY_DIR / name
            ok, issues = verify_tray(path)
            m = measure(path) if path.is_file() else None
            print(_format_line("tray", path, ok, issues, m))
            if not ok:
                failures += 1
    if kind in ("bead", "all"):
        for name in BEAD_NAMES:
            path = BEAD_DIR / name
            ok, issues = verify_bead(path)
            m = measure(path) if path.is_file() else None
            print(_format_line("bead", path, ok, issues, m))
            if not ok:
                failures += 1
    print(f"summary: {failures} failure(s)")
    return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify DIY tray and bead asset geometry and alpha.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--trays-only", action="store_true")
    group.add_argument("--beads-only", action="store_true")
    args = parser.parse_args(argv)
    if args.trays_only:
        return run("tray")
    if args.beads_only:
        return run("bead")
    return run("all")


if __name__ == "__main__":
    sys.exit(main())
