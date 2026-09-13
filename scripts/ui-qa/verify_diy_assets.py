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
# Expected outer subject diameter ≈ 0.88 * 1024 = 901 (rimRadiusRatio 0.44)
TRAY_LONGEST_MIN = 880
TRAY_LONGEST_MAX = 910
BEAD_SIZE = 512
BEAD_CENTER_TOLERANCE = 4
BEAD_LONGEST_MIN = 430
BEAD_LONGEST_MAX = 440

# Enhanced tray quality gates (Codex review: islands, chroma fringe, black specks)
ISLAND_ALPHA_MIN = 12
ISLAND_RADIUS_RATIO = 0.52  # beyond this from center, only soft contact shadow allowed
ISLAND_MAX_COUNT = 8
EDGE_RING_INNER = 0.40
EDGE_RING_OUTER = 0.50
EDGE_CHROMA_SAT_MAX = 42  # max(max-min) on RGB for fringe detection
EDGE_GREEN_BIAS_MAX = 18  # g - max(r,b) residual
EDGE_MAGENTA_BIAS_MAX = 55  # min(r,b) - g residual
BLACK_SPECK_LUMA = 28
BLACK_SPECK_MAX_COUNT = 12
BLACK_SPECK_MIN_ALPHA = 40
# Hard-cutout alpha blocks (binary mask with no intermediate AA)
BLOCK_SIZE = 8
BLOCK_BINARY_RATIO = 0.90
BLOCK_MAX_COUNT = 24


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


def _saturation(r: int, g: int, b: int) -> int:
    return max(r, g, b) - min(r, g, b)


def _check_tray_artifacts(image: Image.Image) -> list[str]:
    """Detect alpha islands outside the subject, edge chroma fringe, and black specks."""
    issues: list[str] = []
    w, h = image.size
    pix = image.load()
    cx, cy = w / 2.0, h / 2.0
    outer_r = min(w, h) * ISLAND_RADIUS_RATIO
    ring_in = min(w, h) * EDGE_RING_INNER
    ring_out = min(w, h) * EDGE_RING_OUTER

    # Discrete alpha islands outside the main subject disc
    island_candidates = 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            a = pix[x, y][3]
            if a < ISLAND_ALPHA_MIN:
                continue
            dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if dist <= outer_r:
                continue
            # Outside subject: require a 4-neighbourhood mostly transparent to count as island/noise
            neigh = 0
            opaque_n = 0
            for nx, ny in ((x - 2, y), (x + 2, y), (x, y - 2), (x, y + 2)):
                if 0 <= nx < w and 0 <= ny < h:
                    neigh += 1
                    if pix[nx, ny][3] >= ISLAND_ALPHA_MIN:
                        opaque_n += 1
            if neigh and opaque_n <= 1:
                island_candidates += 1
    if island_candidates > ISLAND_MAX_COUNT:
        issues.append(f"alpha_islands={island_candidates} expected <= {ISLAND_MAX_COUNT}")

    # Edge ring: high-saturation green/magenta fringe
    green_hits = 0
    magenta_hits = 0
    for y in range(0, h, 1):
        for x in range(0, w, 1):
            a = pix[x, y][3]
            if a < 8:
                continue
            dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if dist < ring_in or dist > ring_out:
                continue
            r, g, b, _ = pix[x, y]
            sat = _saturation(r, g, b)
            green_bias = g - max(r, b)
            magenta_bias = min(r, b) - g
            # Green residue can be low-sat on acrylic; detect bias alone when strong enough.
            if green_bias >= EDGE_GREEN_BIAS_MAX:
                green_hits += 1
            elif sat >= EDGE_CHROMA_SAT_MAX and green_bias >= EDGE_GREEN_BIAS_MAX:
                green_hits += 1
            if magenta_bias >= EDGE_MAGENTA_BIAS_MAX and sat >= 70:
                magenta_hits += 1
    if green_hits > 40:
        issues.append(f"edge_green_fringe={green_hits} expected <= 40")
    if magenta_hits > 40:
        issues.append(f"edge_magenta_fringe={magenta_hits} expected <= 40")

    # Isolated dark/black speckles with alpha
    black_hits = 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            r, g, b, a = pix[x, y]
            if a < BLACK_SPECK_MIN_ALPHA:
                continue
            if (r + g + b) / 3.0 >= BLACK_SPECK_LUMA:
                continue
            # speck: dark pixel with mostly non-dark neighbours
            dark_n = 0
            n = 0
            for nx, ny in ((x - 2, y), (x + 2, y), (x, y - 2), (x, y + 2), (x - 2, y - 2), (x + 2, y + 2)):
                if 0 <= nx < w and 0 <= ny < h:
                    n += 1
                    rr, gg, bb, aa = pix[nx, ny]
                    if aa >= BLACK_SPECK_MIN_ALPHA and (rr + gg + bb) / 3.0 < BLACK_SPECK_LUMA + 15:
                        dark_n += 1
            if n and dark_n <= 1:
                black_hits += 1
    if black_hits > BLACK_SPECK_MAX_COUNT:
        issues.append(f"black_specks={black_hits} expected <= {BLACK_SPECK_MAX_COUNT}")

    # Hard-cutout binary alpha blocks (no anti-aliasing)
    block_hits = 0
    for by in range(0, h - BLOCK_SIZE + 1, BLOCK_SIZE):
        for bx in range(0, w - BLOCK_SIZE + 1, BLOCK_SIZE):
            bdist = ((bx + BLOCK_SIZE / 2 - cx) ** 2 + (by + BLOCK_SIZE / 2 - cy) ** 2) ** 0.5
            if bdist > ring_out + 40:
                continue
            zeros = 0
            fulls = 0
            mids = 0
            for y in range(by, by + BLOCK_SIZE):
                for x in range(bx, bx + BLOCK_SIZE):
                    a = pix[x, y][3]
                    if a <= 2:
                        zeros += 1
                    elif a >= 253:
                        fulls += 1
                    else:
                        mids += 1
            total = BLOCK_SIZE * BLOCK_SIZE
            binary = zeros + fulls
            # Straddling edge with almost no intermediate alpha = hard pixel block
            if zeros >= 2 and fulls >= 2 and binary / total >= BLOCK_BINARY_RATIO and mids <= 2:
                block_hits += 1
    if block_hits > BLOCK_MAX_COUNT:
        issues.append(f"alpha_blocks={block_hits} expected <= {BLOCK_MAX_COUNT}")

    return issues


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
        longest = max(bw, bh)
        if not (TRAY_LONGEST_MIN <= longest <= TRAY_LONGEST_MAX):
            issues.append(f"longest_alpha_side={longest} expected {TRAY_LONGEST_MIN}-{TRAY_LONGEST_MAX}")
        if bw == TRAY_SIZE and bh == TRAY_SIZE and m.corner_alpha_max > CORNER_ALPHA_MAX:
            issues.append("opaque full-frame rectangle")
    if path.is_file() and not issues:
        # Artifact checks only when geometry already passes
        issues.extend(_check_tray_artifacts(Image.open(path).convert("RGBA")))
    elif path.is_file():
        issues.extend(_check_tray_artifacts(Image.open(path).convert("RGBA")))
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
            issues.append(
                f"alpha center=({cx:.1f},{cy:.1f}) expected within {BEAD_CENTER_TOLERANCE}px of ({half:.1f},{half:.1f})"
            )
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
    detail = (
        f"size={m.width}x{m.height} bbox=({left},{top},{right},{bottom}) "
        f"center=({cx:.1f},{cy:.1f}) longest={max(bw, bh)} corner_a={m.corner_alpha_max}"
    )
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
