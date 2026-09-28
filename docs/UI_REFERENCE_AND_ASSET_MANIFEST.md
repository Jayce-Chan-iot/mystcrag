# Mystcrag UI Reference and Runtime Asset Manifest

This document is the controlling map between the approved UI references and the runtime image assets. Reference screenshots are visual acceptance targets only. They must never be rendered as page backgrounds or cropped into fake interactive UI.

## Approved UI references

| Flow | Desktop reference | Mobile reference |
| --- | --- | --- |
| Home | `docs/ui-references/desktop-home.png` | `docs/ui-references/mobile-home.png` |
| AI questionnaire | `docs/ui-references/desktop-ai-questionnaire.png` | `docs/ui-references/mobile-ai-questionnaire.png` |
| AI results | `docs/ui-references/desktop-ai-results.png` | `docs/ui-references/mobile-ai-results.png` |
| Tarot setup | `docs/ui-references/desktop-tarot-setup.png` | `docs/ui-references/mobile-tarot-setup.png` |
| Tarot draw | `docs/ui-references/desktop-tarot-draw.png` | `docs/ui-references/mobile-tarot-draw.png` |
| Tarot result | `docs/ui-references/desktop-tarot-result.png` | `docs/ui-references/mobile-tarot-result.png` |
| DIY editor | `docs/ui-references/desktop-diy.png` | `docs/ui-references/mobile-diy-library.png`, `docs/ui-references/mobile-diy-selected.png` |
| Crystal library | `docs/ui-references/desktop-library.png` | `docs/ui-references/mobile-library.png` |
| Gallery | `docs/ui-references/desktop-gallery.png` | `docs/ui-references/mobile-gallery.png` |
| Profile | `docs/ui-references/desktop-profile.png` | `docs/ui-references/mobile-profile.png` |

The latest wording/navigation decisions override text visible in older references:

- Mobile bottom navigation and page title use `作品画廊`, not `作品`.
- Desktop top navigation includes `作品画廊` between DIY and design inspiration.
- Profile common services use `定制客服`, not `我的收藏`.

## Runtime scene assets

All paths below are relative to `apps/frontend/public`.

| Asset | Runtime path | Intended use | Rendering rule |
| --- | --- | --- | --- |
| Home hero photograph | `/home/hero-bracelet.webp` | Home hero | Use `object-fit: cover`; preserve the left text-safe region and bracelet crop. |
| AI entry scene | `/home/entry-ai.webp` | Home AI card | Full-bleed card image with its own top crop. Entire card is clickable. |
| Tarot entry scene | `/home/entry-tarot.webp` | Home Tarot card | Full-bleed card image. Entire card is clickable. |
| DIY loose-bead entry scene | `/home/entry-diy-loose-tray.webp` | Home DIY card | Project-owned generated 1200×900 WebP. Show a round creation tray with 12-18 loose, unthreaded mixed-size beads and restrained tools; never present a completed bracelet. Entire card is clickable. |
| Clear acrylic tray | `/trays/clear-acrylic.webp` | DIY workbench background | Display background only. Does not enter price, inventory, or Design JSON. |
| Bone china tray | `/trays/bone-china.webp` | DIY workbench default | Display background only. |
| Oak tray | `/trays/oak-wood.webp` | DIY workbench alternate | Display background only. |
| French linen tray | `/trays/french-linen.webp` | DIY workbench alternate | Display background only. |
| Wrist measurement guide | `/guides/wrist-measurement.webp` | AI questionnaire and Tarot setup | Open inline/popover; never use a blocking browser alert. |
| Tarot deck | `/tarot/cards/*.png` | Draw/result cards | Use the complete licensed deck already in the repository. Preserve source notice. |
| Tarot card back | `/tarot/cards/CardBack.png` | Draw fan and slots | Cards must remain individually interactive; do not replace the fan with a single screenshot. |
| Loading crystal | `/states/loading-crystal.webp` | Generation/loading state | Transparent 768×768 asset. Keep the visible object under 160 CSS px on desktop and 120 CSS px on mobile. |
| Empty design scene | `/states/empty-design.webp` | Empty gallery/design state | 960×960 scene. Crop as a quiet square/rounded-square illustration; do not stretch. |
| Demo profile avatar | `/avatars/demo-user.webp` | Local demo profile only | 640×640 fictional portrait. Crop circularly. Replace with authenticated user avatar in production. |

## Dynamic visual content

The following must be constructed from live application state and must not be generated or stored as one flattened image:

- DIY bracelet, AI recommendation bracelets, Tarot recommendation bracelets, gallery thumbnails, and export previews.
- Selected bead strip and bead count/diameter state.
- Tarot card fan, selected slots, reversed card state, result labels, price, inventory and five-day replenishment notice.
- Wrist size, fit advice, price totals, completion state and validation messages.

All bracelet projections consume the same Design JSON and Bracelet Engine layout. Product textures are single-component assets; the tray is a separate presentation layer.

## Responsive source slots

- Desktop visual acceptance viewport: 1440×900; also verify 1280×720 and 1470×760.
- Mobile visual acceptance viewport: 390×844; also verify 375×667 and 430×932.
- No page-level transform scaling, fixed design-width canvas, or browser zoom workaround.
- Use responsive layout constraints, `clamp()`, container queries/media queries, and intrinsic image ratios.
- No horizontal overflow at any acceptance viewport.

## Star Platform runtime assets (`TASK-ASSET-STAR-001`)

All paths below are relative to `apps/frontend/public`. Consumers must use `STAR_PLATFORM_ASSETS` from `apps/frontend/src/features/design/model/star-assets.ts` rather than hard-coding paths.

| Asset key | Runtime path | Size | Role | Intended use | Rendering rule |
| --- | --- | --- | --- | --- | --- |
| `heroObservatory` | `/star-platform/hero-observatory.webp` | 2048×1152 | hero | Home hero background | `object-fit: cover`; keep the left third quiet for headline; do not tint. |
| `entryAi` | `/star-platform/entry-ai.webp` | 1280×960 | entry | Home AI card | Full-bleed card image; entire card is one semantic link. |
| `entryOracle` | `/star-platform/entry-oracle.webp` | 1280×960 | entry | Home Oracle card | Full-bleed card image; blank brass discs only (no coin inscriptions). |
| `entryDiy` | `/star-platform/entry-diy.webp` | 1280×960 | entry | Home DIY card | Overhead tray with loose unthreaded beads; never a finished bracelet. |
| `entryTarot` | `/star-platform/entry-tarot.webp` | 1280×960 | entry | Home Tarot card | Blank card backs and instruments only; no occult or traditional tarot imagery. |
| `xuanPaperGrain` | `/star-platform/xuan-paper-grain.webp` | 1024×1024 | texture | Content panel surface | Decorative (empty alt); even grain; no vignette crop that shows a paper edge. |
| `engravedStarMap` | `/star-platform/engraved-star-map.webp` | 1024×1024 | texture | Dark instrument surface | Decorative (empty alt); linework only; no glyph-like scribbles. |

`STAR_PLATFORM_ASSETS` also publishes intrinsic width/height/aspectRatio, dominant surface (`obsidian-night` / `xuan-paper` / `aged-brass` / `amethyst` / `moon-silver`), and Chinese alt intent (empty only when `decorative`).

## Asset provenance

- Existing Tarot card provenance is recorded in `apps/frontend/public/tarot/cards/UPSTREAM_SOURCE.md`.
- Home scenes, trays, wrist guide, state scenes and demo avatar are project-owned generated assets.
- `/home/entry-diy-loose-tray.webp` was generated with Codex built-in image_gen on 2026-09-14 and integrated under `TASK-ASSET-004` (SHA-256: `9b8cc2febf2d523ef87e489d3271bcd6b62819b54cbf03f1f267245fff921281`). No competitor image, user data, or planning screenshot was used as runtime media.
- Star Platform kit (`/star-platform/*`) was generated on 2026-09-28 with Xiaomi MiMo `image_gen` under `TASK-ASSET-STAR-001`, then deterministically cleaned of the generator's corner disclosure overlay and encoded to WebP. Full tool/model, prompt summary, transforms, purpose, license, SHA-256 and rejection checklist are in `apps/frontend/public/star-platform/UPSTREAM_SOURCE.md`. Reviewer record: `docs/progress/2026-09-26_STAR_ASSET_REVIEW.md`.
- Star Platform SHA-256: `hero-observatory.webp` `ef00472355aac84966e7f99ecf29be13f6ba004d7f17943a8cede40ec76f9317`; `entry-ai.webp` `089c5a4d04b76f07c84b06b88cbedf93ccde4a0b8d6cbe0ff3ef0279032cbf6b`; `entry-oracle.webp` `0af10ea795e8cd7d9b3f2c84058657a305c06293e3aa1e9b2d72bcc80382dbac`; `entry-diy.webp` `8b9479bc53f1706dbaad87a93b2e91df751c535671097e287c328a998ded57c8`; `entry-tarot.webp` `d53e825660f42300bfafe365d27878c1467a0df166696ab57c27063a2ceb9039`; `xuan-paper-grain.webp` `130ea95eba83c8940f06ed1baa33ea1a7b8cf68c7e5f4f468ad501e19910d7ef`; `engraved-star-map.webp` `b38d47380281095dbfa34bcfcb4de3e28c70d3d2378f31ceadf3187cd7c9a724`.
- Reference screenshots are internal implementation/QA evidence, not runtime assets.
