# DIY Tray Asset Provenance

Owner: TASK-ASSET-003 (ASSET / Codex, authorized by the Product Owner)
Date: 2026-09-13
License: Generated for this repository from text prompts with the built-in OpenAI image generator. No competitor image, stock image, user image, or other third-party visual was used as an input.

## Source generation

All four sources were generated independently at 1254×1254 RGBA. Shared prompt constraints required a single centered, top-down circular bracelet-making tray; no beads, jewelry, text, logo, watermark, hands, props, or background scene; even soft lighting; realistic material; generous inner working area; and a fully visible outer rim.

Material additions were:

- `bone-china.webp`: warm ivory bone china, restrained glossy glaze and a thin rounded rim.
- `clear-acrylic.webp`: genuinely transparent clear acrylic, continuous translucent floor, subtle molded rim and restrained refraction.
- `french-linen.webp`: warm natural French linen over a padded circular base, fine woven texture and softly raised rim.
- `oak-wood.webp`: pale natural oak, fine radial grain, shallow carved recess and smooth rounded rim.

| Runtime file | Generated source ID | Source SHA-256 | Circular source radius |
| --- | --- | --- | --- |
| `bone-china.webp` | `exec-aa66a993-b52d-4962-ab40-d8919f14472e.png` | `619edfe07b3b3263b1eeab8138e0629de6a322514f8efb0de471f3a8ec5f415f` | 558 px |
| `clear-acrylic.webp` | `exec-6bc57033-5da4-4abd-ba25-a04f8ad740c6.png` | `c4b3c6f18cee8598fa157ae7852f2c850608b3eeda73f76431893793b06c1a7e` | 562 px |
| `french-linen.webp` | `exec-99243e07-5509-4a88-a6a5-7f2a4bb1ed6e.png` | `c6bf0f38f9578384a57494161ae58e252e20453597fe72c3f164c23241ee638f` | 570 px |
| `oak-wood.webp` | `exec-f33dab0e-db00-4d9a-ac62-15028ac326b0.png` | `53073030607410adc749569873d8ed67ec43b7c7f0026d8869b600a65143b37e` | 558 px |

The generated source files are retained by the built-in generator under `/Users/chenyanyan/.codex/generated_images/01a03351-e223-7433-a2ed-b681a541a365/` for local audit. Runtime reproduction does not depend on those files being shipped with the application.

## Deterministic post-processing

`scripts/ui-qa/tray_postprocess.py` applies these deterministic runtime transformations:

1. Clip the source to a feathered circular alpha mask, removing every pixel outside the tray silhouette.
2. Neutralize low-alpha edge chroma to prevent green, magenta, or red fringe. Acrylic also receives full-subject neutralization so transparent pixels cannot retain colored contamination.
3. Crop to non-zero alpha, scale proportionally to a 901-pixel maximum diameter, and center on a 1024×1024 transparent canvas.
4. Encode the highest WebP quality from the documented quality ladder that remains below 900 KiB.

Exact commands:

```bash
python3 scripts/ui-qa/tray_postprocess.py <bone-source> apps/frontend/public/trays/bone-china.webp --source-radius 558
python3 scripts/ui-qa/tray_postprocess.py <acrylic-source> apps/frontend/public/trays/clear-acrylic.webp --source-radius 562 --neutral
python3 scripts/ui-qa/tray_postprocess.py <linen-source> apps/frontend/public/trays/french-linen.webp --source-radius 570
python3 scripts/ui-qa/tray_postprocess.py <oak-source> apps/frontend/public/trays/oak-wood.webp --source-radius 558
```

## Runtime output evidence

| File | SHA-256 | Bytes | Alpha longest side | Corner alpha |
| --- | --- | --- | --- | --- |
| `bone-china.webp` | `0fe792d1929ff872cbc578d1718bf9d27eec32cbbfcad0f8dd7e6fae24e1d48d` | 70242 | 901 | 0 |
| `clear-acrylic.webp` | `f3a80a671e01cde40421f41fd1f04663df1e360f9474a42a541bae95c83aead1` | 238768 | 901 | 0 |
| `french-linen.webp` | `8c7752d7730e2a665f2e112e4447c6b92e1253d3a7fc4295900f1afd0a002c79` | 417736 | 901 | 0 |
| `oak-wood.webp` | `b04f86251ce9e49835edfa250278d8e25a38e098e312f8b3a800db9bfe51ad30` | 248364 | 901 | 0 |

Each output was visually inspected at original detail over white, warm-neutral, dark, and checkerboard backgrounds. The trays have a clean native-alpha circular boundary without rectangular bands, colored fringe, black specks, baked backgrounds, beads, text, or watermarks. The acrylic retains a continuous translucent working floor and reads as a tray rather than a hollow ring.

## Verification

```bash
python3 scripts/ui-qa/verify_diy_assets.py --trays-only
python3 scripts/ui-qa/verify_diy_assets.py
```

The tray gate checks dimensions, file size, normalized alpha bounds, transparent corners, disconnected alpha islands, edge color fringe, black specks, hard binary alpha blocks, and residual alpha outside the expected circular subject.
