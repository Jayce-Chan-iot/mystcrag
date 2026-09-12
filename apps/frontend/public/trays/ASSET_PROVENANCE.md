# DIY Tray Asset Provenance

Owner: TASK-ASSET-003 (ASSET / Xiaomi MiMo under Codex lead)
Date: 2026-09-13
License: Generated for Mystcrag product runtime use. No competitor media copied.

Shared runtime frame and geometry:

- Canvas: 1024×1024 RGBA WebP
- `rimRadiusRatio = 0.44`
- `innerRadiusRatio = 0.37`
- Centered non-empty alpha bounds; four corner alpha values `<= 8`
- Outer subject diameter normalized to ≈ 0.88 × frame width (880 px target, measured longest side 901 px)

Generation invariant (all four materials):

> Photorealistic top-down circular jewelry bead tray isolated on a solid chroma-key background; outer rim radius 44% of frame width; usable inner floor radius 37%; entire rim retained; restrained contact shadow only; no beads, text, logo, hands, tools, or cropped rim; neutral soft studio light from upper left.

Post-process (shared):

1. Chroma-key exterior background via corner flood-fill.
2. Neutralize residual chroma-tinted contact shadow into dark gray alpha.
3. Wipe residual AI watermark pixels outside the tray disc.
4. Crop to alpha bounds, scale longest side to `round(1024 * 0.88)`, center on a transparent 1024×1024 canvas.
5. Save WebP (`quality≈90`, `method=6`), each file ≤ 900 KiB.

| File | Source | Material line | Transformation | SHA-256 | Bytes |
| --- | --- | --- | --- | --- | --- |
| `bone-china.webp` | MiMo `image_gen` 2026-09-13, magenta chroma-key source | Material: polished warm-white bone china. | flood-key magenta → neutralize shadow → center/scale → WebP q90 | `e292c5d3d63978a79f2ded9b2966376242ab01301b26c714af80dfb7880d19be` | 82646 |
| `clear-acrylic.webp` | MiMo `image_gen` 2026-09-13, green chroma-key source | Material: optically clear acrylic with substantial wall thickness and specular rim. | flood-key green → map transmitting body to neutral partial alpha → watermark wipe → center/scale → WebP q90 | `69587cf796219469370eb49bdc2d7420d507af47a46447f247f12fb3d1c16f69` | 338632 |
| `french-linen.webp` | MiMo `image_gen` 2026-09-13, magenta chroma-key source | Material: warm undyed French linen. | flood-key magenta → neutralize shadow → center/scale → WebP q90 | `8edc97299bbd73f81b910cabbaeb85d72adcd8222edc8633838d98932b0911db` | 311692 |
| `oak-wood.webp` | MiMo `image_gen` 2026-09-13, magenta chroma-key source | Material: pale natural oak wood. | flood-key magenta → neutralize shadow → center/scale → WebP q90 | `18cde5c5daf8ce8bf3486eb8dfa07b86ee6a6735e9061ed0127bd3d5a82c730a` | 217786 |

Verification:

```bash
python3 scripts/ui-qa/verify_diy_assets.py --trays-only
```

Expected: PASS for exactly four files (1024×1024, corner alpha `<= 8`, centered alpha box, longest side 901).
