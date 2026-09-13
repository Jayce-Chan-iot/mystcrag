# DIY Tray Asset Provenance

Owner: TASK-ASSET-003 (ASSET / Xiaomi MiMo under Codex lead and review)
Date: 2026-09-13 (review remediation)
License: Runtime assets derived only from repository baseline tray files already tracked at plan commit `a306042`. No competitor media. No third-party stock. No generative-image source.

## Authoritative input

The four source files are the pre-existing repository runtime trays at plan base `a306042`:

| Source (git `a306042`) | Original size | Mode |
| --- | --- | --- |
| `apps/frontend/public/trays/bone-china.webp` | 1100×1100 | RGB |
| `apps/frontend/public/trays/clear-acrylic.webp` | 1100×1100 | RGB |
| `apps/frontend/public/trays/french-linen.webp` | 1100×1100 | RGB |
| `apps/frontend/public/trays/oak-wood.webp` | 1100×1100 | RGB |

Extract command:

```bash
git show a306042:apps/frontend/public/trays/<name>.webp > /tmp/a306042-<name>.webp
```

## Shared runtime frame

- Canvas: 1024×1024 RGBA WebP
- `rimRadiusRatio = 0.44`, `innerRadiusRatio = 0.37`
- Outer alpha longest side normalized to `round(1024 * 0.88) = 901`
- Four corner alpha values `<= 8`
- Each file ≤ 900 KiB

## Deterministic transformation (all four materials)

1. Estimate studio background as the mean RGB of an 8-pixel border band.
2. Convert every pixel to alpha with a linear distance ramp to that background:
   - `alpha = 0` when `dist <= t0`
   - `alpha = 255` when `dist >= t1`
   - otherwise `alpha = round(255 * (dist - t0) / (t1 - t0))`
3. Acrylic only: keep light RGB and multiply alpha by `0.20` when `luma >= 225` and `dist < t1 + 10`, so the usable floor stays true-transparent instead of an opaque gray disc.
4. Gaussian blur the alpha channel only (`radius=0.55`) for a light anti-aliased edge. No texture smearing.
5. Crop to `alpha >= 8` bounding box; scale longest side to 901 (proportional); center on a transparent 1024×1024 canvas using unmasked RGBA paste (preserves semi-transparent RGB).
6. Force the outer 2-pixel border fully transparent.
7. Save WebP. Prefer `lossless=True, method=6`; fall back to `quality=95,90,85` only if the file exceeds 900 KiB.

### Per-file thresholds

| File | t0 | t1 | Acrylic floor rule |
| --- | --- | --- | --- |
| `bone-china.webp` | 10 | 22 | no |
| `clear-acrylic.webp` | 7 | 18 | yes |
| `french-linen.webp` | 12 | 28 | no |
| `oak-wood.webp` | 12 | 28 | no |

Reproduction sketch (Pillow 10.x):

```python
# border mean bg -> linear alpha ramp -> optional acrylic floor scale
# -> GaussianBlur(A, 0.55) -> crop/scale/center 901 on 1024 RGBA
# -> save WEBP lossless method=6 (or quality=95 under 900KiB)
```

## Output evidence

| File | SHA-256 | Bytes | Longest | Corner alpha |
| --- | --- | --- | --- | --- |
| `bone-china.webp` | `abce9d45c097effaf9d40ff8a9026fff552d104d97b6f1261b8d913a6469be06` | 388808 | 901 | 0 |
| `clear-acrylic.webp` | `3af679d318ec48a85a3e83c16ed9ae2b764d30f844077244478ee040d2ac12b5` | 483610 | 901 | 0 |
| `french-linen.webp` | `befa91f2377be8d8036bea7ef35d785294384220ccb4228d9aad70994133c651` | 453650 | 901 | 0 |
| `oak-wood.webp` | `f8421fe34deefbf1731c58d577be7d81be602081db45974d88ba9310383e6b59` | 674178 | 901 | 0 |

Acrylic center pixel is light RGB with low alpha (`≈ (241,234,234,37)`), confirming true transparency rather than a gray-black disc.

## Verification

```bash
python3 scripts/ui-qa/verify_diy_assets.py --trays-only
```

Expected: PASS for exactly four files, including enhanced gates for alpha islands outside the subject, edge green/magenta fringe, black specks, and hard binary alpha blocks.
