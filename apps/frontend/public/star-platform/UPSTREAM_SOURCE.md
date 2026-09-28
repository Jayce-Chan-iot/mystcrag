# Star Platform Visual Kit — Upstream Source and Provenance

Owner: `TASK-ASSET-STAR-001` (Xiaomi MiMo V2.6 Pro under Codex supervision)
Generation date: 2026-09-28
Branch: `task/asset-star-001-visual-kit`
License / ownership: Project-owned original generation. No competitor image, stock photo, user photo, planning screenshot, or third-party site asset was used as input or output. Runtime rights remain with the Mystcrag project.

## Tool and model

| Field | Value |
| --- | --- |
| Tool | Xiaomi MiMo `image_gen` (MiMo Desktop built-in image generation) |
| Model | Xiaomi MiMo image generation service (session default) |
| Quality | `high` for hero and four entry scenes; `medium` for two seamless textures |
| Native source format | PNG (RGBA) |
| Delivery format | WebP (RGB, quality 95, method 6) via Pillow (`MIMO_PYTHON`) |
| Prompt language | English structured prompts (imagegen skill template) |
| Visual direction authority | `docs/superpowers/specs/2026-09-26-star-oracle-crystal-design.md` §9 and Full UI Redesign plan Task 1 / Global Constraints |

## Direction summary (final prompt constraints)

Shared negative constraints on every prompt: no UI chrome; no letters/numbers/Chinese characters/pseudo-glyphs; no logos; no watermarks in subject; no talisman scribbles; no Western occult symbols; no medical symbols; no fortune/efficacy motifs; no neon; no glassmorphism; no particle storms; no cheap gold gradients; crystals/beads physically credible (round beads, visible drill holes); mineral colors natural and untinted.

Shared palette: obsidian / ink-indigo night, warm xuan paper, aged brass (matte patina, not e-commerce gold), amethyst violet accent, moon silver. Motifs: Song-dynasty star-map linework, armillary rings, jade bi disc, engraved scales, black lacquer. Mood: quiet, precise, museum-catalogue still life.

| Runtime file | Final prompt summary | Intended route / use | Dominant surface |
| --- | --- | --- | --- |
| `hero-observatory.webp` | Observatory still life: brass armillary with engraved rings, jade bi disc, one uncolored crystal bracelet (clear quartz / amethyst / moonstone, visible holes and cord), engraved constellation field; left third kept quiet for headline | Home hero background | obsidian-night |
| `entry-ai.webp` | Xuan-paper desk with engraved measurement scales, 5–7 loose natural crystal beads (unthreaded), thin brass ring-gauge fragment, faint star linework | Home AI questionnaire entry card | xuan-paper |
| `entry-oracle.webp` | Three blank aged-brass discs (square perforation, no inscriptions) and a pale jade bi disc on ink-indigo lacquer with engraved star-track arcs | Home Oracle entry card | aged-brass |
| `entry-diy.webp` | Overhead round black-lacquer tray on xuan paper; 12–18 loose unthreaded mixed-size natural crystal beads; restrained brass tweezers/pick; paper scale marks; never a finished bracelet | Home DIY entry card | xuan-paper |
| `entry-tarot.webp` | Three blank moon-silver card backs on black lacquer; brass straightedge; small jade disc with amethyst accent; no traditional tarot imagery and no occult symbols | Home Tarot entry card | moon-silver |
| `xuan-paper-grain.webp` | Flat even warm xuan paper fiber grain; tileable surface; no subject | Content panel texture (decorative) | xuan-paper |
| `engraved-star-map.webp` | Flat Song-style engraved star-map linework (arcs, star points, concentric scale rings) on obsidian ground; no glyphs | Dark instrument surface texture (decorative) | obsidian-night |

## Local transformations

1. Sources saved as PNG in session working directory by `image_gen`, then copied to ignored evidence `output/playwright/task-asset-star-001/sources/` under `TASK-ASSET-STAR-001`.
2. Dimensions verified with Pillow: hero 2048×1152; entries 1280×960; textures 1024×1024 (all multiples of 16 at generation; hero ≥ 1920×1080; entries ≥ 1200×900).
3. Platform disclosure overlay (「AI生成」 + Xiaomi MiMo wordmark) that the generator stamps in the bottom-right corner is **not** artistic content and must not ship as product branding. Deterministic numpy clone-repair replaced only that corner plate (flush to right/bottom edges; source pixels cloned from the adjacent same-material region — above for brass/paper, left for dark lacquer/paper). No other pixels were recolored, tinted, or restyled.
4. RGB composite (sources were opaque), then WebP encode at quality 95 / method 6. No chroma subsample tricks, no sharpening, no color LUT, no product recolor.
5. SHA-256 computed on delivered WebP bytes.

## Delivered assets

| Runtime file | Size | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `hero-observatory.webp` | 2048×1152 | 256208 | `ef00472355aac84966e7f99ecf29be13f6ba004d7f17943a8cede40ec76f9317` |
| `entry-ai.webp` | 1280×960 | 128200 | `089c5a4d04b76f07c84b06b88cbedf93ccde4a0b8d6cbe0ff3ef0279032cbf6b` |
| `entry-oracle.webp` | 1280×960 | 168748 | `0af10ea795e8cd7d9b3f2c84058657a305c06293e3aa1e9b2d72bcc80382dbac` |
| `entry-diy.webp` | 1280×960 | 274166 | `8b9479bc53f1706dbaad87a93b2e91df751c535671097e287c328a998ded57c8` |
| `entry-tarot.webp` | 1280×960 | 136648 | `d53e825660f42300bfafe365d27878c1467a0df166696ab57c27063a2ceb9039` |
| `xuan-paper-grain.webp` | 1024×1024 | 128778 | `130ea95eba83c8940f06ed1baa33ea1a7b8cf68c7e5f4f468ad501e19910d7ef` |
| `engraved-star-map.webp` | 1024×1024 | 349504 | `b38d47380281095dbfa34bcfcb4de3e28c70d3d2378f31ceadf3187cd7c9a724` |

## Typed consumer contract

Downstream UI must consume `STAR_PLATFORM_ASSETS` from `apps/frontend/src/features/design/model/star-assets.ts` (stable public URLs, intrinsic size/aspect, dominant surface, Chinese alt intent). Do not hard-code paths in page components.

## Prohibited content — rejection checklist (applied at review)

Rejected / must never ship (checked at original resolution):

- UI text, interface chrome, captions, logos, watermarks as design content
- Pseudo-Chinese characters, fake seal script, talisman / fu-lu scribbles
- Hexagrams, trigrams, bagua diagrams used as occult props
- Western occult symbols (pentagram, sigils, sun/moon faces, traditional tarot pips)
- Medical symbols (caduceus, red cross, meridian charts)
- Fortune / efficacy / fate implications (wealth, protection, healing, “destined” cues)
- Neon, glassmorphism, particle storms, bloom, cheap gold gradients
- Tinted or dyed crystal / bead materials; structurally impossible jewelry
- Competitor screenshots, reference UI captures, or unlicensed third-party art

## Evidence retention

Per `docs/governance/QA_EVIDENCE_RETENTION.md`: canonical contact sheet and original-resolution inspection artifacts live only under ignored `output/playwright/task-asset-star-001/`. Transient source PNGs and duplicate captures are not committed. Reviewer conclusions are recorded in `docs/progress/2026-09-26_STAR_ASSET_REVIEW.md`.
