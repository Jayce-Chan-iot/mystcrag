# Star Platform Asset Review

**Task:** `TASK-ASSET-STAR-001`
**Branch:** `task/asset-star-001-visual-kit`
**Reviewer:** Codex (independent original-resolution inspection; Xiaomi MiMo V2.6 Pro original generation)
**Date:** 2026-09-29
**Evidence root (ignored):** `output/playwright/task-asset-star-001/`

## Outcome

The seven licensed Star Platform rasters and the provenance document are delivered. Codex rejected the first submission because four deterministic disclosure-overlay repairs left visible rectangular seams. Those four scenes were regenerated from the project-owned originals and re-inspected at original resolution; the final WebPs have no visible patch boundary. Automated `star-assets.test.tsx` asserts file presence, WebP magic, minimum dimensions, typed intrinsic sizes, Chinese alt intent, SHA-256 agreement with provenance, and this report / manifest coverage. Automated tests do **not** claim to detect text or symbol content inside pixels; that gate is this manual review.

## Canonical contact sheet

Exactly one canonical contact sheet is recorded:

- Path: `output/playwright/task-asset-star-001/sources/canonical-contact-sheet.png`
- Layout: 2×4 grid of the seven delivered WebP thumbnails plus one empty reserved cell; file names and intrinsic sizes are mapped in the table below
- Purpose: single review artifact for Codex / QA citation; not a runtime asset and not committed

## Original-resolution inspection

| Asset | Native size | Min gate | Subjects checked | Result |
| --- | --- | --- | --- | --- |
| `hero-observatory` | 2048×1152 | ≥ 1920×1080 | Armillary rings with scale engraving only; jade bi disc; one bracelet with round beads, visible holes, continuous cord; left third quiet; mineral colors natural | PASS |
| `entry-ai` | 1280×960 | ≥ 1200×900 | Xuan paper + engraved scales; 5–7 loose unthreaded beads; brass gauge fragment; no UI | PASS |
| `entry-oracle` | 1280×960 | ≥ 1200×900 | Three blank brass discs (no inscriptions); jade bi disc; star-track arcs; no hexagram/bagua | PASS |
| `entry-diy` | 1280×960 | ≥ 1200×900 | Round lacquer tray; 12–18 loose unthreaded mixed-size beads with drill holes; restrained tools; never a finished bracelet | PASS |
| `entry-tarot` | 1280×960 | ≥ 1200×900 | Blank moon-silver card backs; brass straightedge; jade disc; no traditional tarot or occult imagery | PASS |
| `xuan-paper-grain` | 1024×1024 | ≥ 1024×1024 | Even warm xuan fiber grain; no subject, edge, or vignette | PASS |
| `engraved-star-map` | 1024×1024 | ≥ 1024×1024 | Constellation arcs, star points, concentric scale rings; no glyphs | PASS |

## Rejection checklist (applied; nothing from this list is present in delivered pixels)

- [x] No UI text, captions, logos, or design watermarks
- [x] No pseudo-Chinese characters / seal-script fakes / talisman scribbles
- [x] No hexagram, trigram, or bagua occult diagrams
- [x] No Western occult symbols (pentagram, sigils, sun/moon faces, tarot pips)
- [x] No medical symbols
- [x] No fortune / efficacy / fate cues
- [x] No neon, glassmorphism, particle storms, cheap gold gradients
- [x] Crystals/beads structurally credible; materials not dye-tinted
- [x] No competitor / reference / unlicensed art

## Transformations

1. Xiaomi MiMo generated the original PNG kit; sources are retained only as ignored task evidence.
2. Codex inspected the delivered WebPs at original resolution and rejected visible rectangular clone-repair seams in hero / AI / Oracle / DIY.
3. OpenAI image-to-image generation reconstructed the affected lower-right regions from the project-owned originals, with explicit no-text / no-logo / no-watermark / no-seam constraints.
4. `cwebp` performed only contract-size resize and WebP RGB encode (quality 95, method 6); no LUT, recolor or synthetic sharpening was added.
5. Codex re-inspected the final files at original resolution and SHA-256 was recomputed on delivered bytes.

## Provenance fields (also in `UPSTREAM_SOURCE.md`)

| Field | Value |
| --- | --- |
| Generation date | 2026-09-28 |
| Tool / model | Xiaomi MiMo `image_gen` original kit; OpenAI image generation repair for hero / AI / Oracle / DIY |
| Prompt summary | Obsidian/ink-indigo + xuan paper + aged brass + amethyst + moon silver; Song star-map / armillary / jade bi / scales; quiet precision; explicit rejects (see checklist) |
| Transform | Image-to-image seam repair for four rejected scenes + contract-size WebP encode (above) |
| Use | Home hero / four entry cards / two decorative textures |
| License | Project-owned generation; no third-party input media |
| Digests | Per-file SHA-256 in `UPSTREAM_SOURCE.md` |

## Deliverables in the task path set

- `apps/frontend/public/star-platform/*.{webp,UPSTREAM_SOURCE.md}`
- `apps/frontend/src/features/design/model/star-assets.ts` (`STAR_PLATFORM_ASSETS`)
- `apps/frontend/src/features/design/model/star-assets.test.tsx`
- `docs/UI_REFERENCE_AND_ASSET_MANIFEST.md` (Star Platform section + provenance)
- `docs/progress/2026-09-26_STAR_ASSET_REVIEW.md` (this file)

No application component, stylesheet, backend, package, manifest, or lockfile path was modified.
