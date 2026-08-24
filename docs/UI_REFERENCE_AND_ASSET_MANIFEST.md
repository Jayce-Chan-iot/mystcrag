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
| DIY entry scene | `/home/entry-diy.webp` | Home DIY card | Full-bleed card image. Entire card is clickable. |
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

## Asset provenance

- Existing Tarot card provenance is recorded in `apps/frontend/public/tarot/cards/UPSTREAM_SOURCE.md`.
- Home scenes, trays, wrist guide, state scenes and demo avatar are project-owned generated assets.
- Reference screenshots are internal implementation/QA evidence, not runtime assets.
