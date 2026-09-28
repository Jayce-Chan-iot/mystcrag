# OSS Research — Bracelet Engine V2

Reviewed on 2026-08-18 from repository metadata, licenses, manifests, and relevant source/documentation.

| Project | License | Decision |
| --- | --- | --- |
| clauderic/dnd-kit | MIT | Do not add now. Sensors are mature, but circular physical-slot collision still requires the engine; existing Pointer Events remain smaller. |
| pmndrs/zustand | MIT | Candidate for editor working draft; defer until its state boundary is extracted. |
| charkour/zundo | MIT | Candidate with Zustand for bounded temporal history. |
| TanStack/query | MIT | Suitable for later server-cache extraction; unnecessary for removing one redundant request. |
| Motion | MIT | Candidate for transform/opacity motion with reduced-motion support. |
| Radix Primitives | MIT | Adopt by component when accessible overlay primitives are required. |
| Vaul | MIT | Mobile sheet candidate; verify final React 19 behavior in the UI slice. |
| Microsoft Playwright | Apache-2.0 | Adopt for E2E and visual regression. |
| Deque axe-core | MPL-2.0 | Adopt as test tooling only. |
| rndaorg/open-configurator | MIT | State/pricing separation reference; no source copied. |
| gorhorvat/product-configurator-3d | no detected license | Ideas only; no reusable source. |
| jerryzhao173985/Vercel-crystal-bracelet | no detected license | Product-flow reference only; no code/assets copied. |
| SergiiSharpov/Jewelry-3D-configurator | GPL-3.0 | Architecture study only; GPL source is not copied. |

The first slice therefore uses a dependency-free pure TypeScript geometry core.

## Tarot upstream snapshot and release gate

The isolated reference snapshot records [renanbotasse/tarot](https://github.com/renanbotasse/tarot) at commit `e4d3a20265dd8a8b7e14e9ec980685fe20a79040`. It was imported as a GitHub source archive without `.git`; the committed runtime provenance record is [the asset-level `UPSTREAM_SOURCE.md`](../apps/frontend/public/tarot/cards/UPSTREAM_SOURCE.md). The original `prototypes/tarot-upstream` directory is local, external, read-only evidence in the project owner's checkout and is intentionally absent from a clean clone. The recorded commit is **not present as a verifiable Git object in this repository** (`git cat-file` cannot resolve it). Production code never imports from the prototype.

Runtime inventory:

- `apps/frontend/public/tarot/cards`: 78 Rider–Waite face PNGs plus `CardBack.png` (79 binary assets). Source and destination basenames and file hashes matched on 2026-08-20. The SHA-256 of the sorted `<file hash><two spaces><basename>` manifest is `84bb0f793a9d696e0a578822dfc2fdc757cd7d1e52d47517cead237783e8307c`.
- `packages/tarot-engine/src/card-catalog.ts`: adapted card identifiers, English names, and asset basenames; Mystcrag adds its own Chinese names, bounded keywords, design tags, reversed handling, validation, and cryptographic draw authority. No upstream page, React component, state store, style sheet, navigation, premium flow, shuffle implementation, or runtime dependency was copied into production.
- [apps/frontend/public/tarot/cards/UPSTREAM_SOURCE.md](../apps/frontend/public/tarot/cards/UPSTREAM_SOURCE.md): the committed asset-level inventory and integrity record. The draw UI currently renders the copied custom `CardBack.png`, so that file remains an explicit release blocker.

The project owner states that authorization from the upstream author has been obtained for this local integration. The supporting written record has not been archived in this repository. The upstream README says its code is MIT and the Rider–Waite faces are public domain, but the imported archive contains no independently verified license file here. These statements are provenance leads, not legal clearance.

Public or commercial release remains blocked until evidence is archived and reviewed separately for:

- upstream source code and the adapted identifiers/names/basenames;
- all 78 card-face files and their applicable jurisdictional status;
- the custom `CardBack.png` and Mystcrag's replacement card-back artwork;
- every font used or distributed (the current Tarot CSS requests system fonts and bundles no upstream font, but deployment font rights still require review);
- every upstream or newly introduced background, bracelet render, icon, photograph, or other third-party image.

Do not mark this checklist cleared solely because the owner authorized local work or because an upstream README contains a license/public-domain statement.

## Star Oracle structural and design-context references

Reviewed on 2026-09-29. The Oracle implementation uses public structural facts and an original, versioned Mystcrag visual mapping. No modern interpretation, prediction, crystal-effect claim, source code, or prose was copied into runtime content.

| Project | License/status | Exact concept consulted | Adoption boundary |
| --- | --- | --- | --- |
| [limjiechao/ts-hexagram-generator](https://github.com/limjiechao/ts-hexagram-generator) | MIT | Pure domain separation and explicit cast records | Reference only; no dependency or copied implementation |
| [Brianfit/I-Ching](https://github.com/Brianfit/I-Ching) | MIT, older | Independent comparison for the three-coin `1:3:3:1` distribution | Test concept only; no runtime dependency |
| [pro-vi/iching](https://github.com/pro-vi/iching) | MIT | Observation-oriented, non-deterministic product framing | Principle only; no text or code copied |
| [DaviRain-Su/classic_system](https://github.com/DaviRain-Su/classic_system) | MIT code; some modern content CC BY-SA 4.0 | Matrix and visualization information structure | No modern text, ShareAlike content, or code copied |
| [6tail/lunar-javascript](https://github.com/6tail/lunar-javascript) | MIT | Evaluated as a possible future seasonal-atmosphere adapter | Deferred; not installed or used by the Oracle path |

`oracle-design-rules-v1` belongs to Context Resolver rather than the mathematical engine. Its trigram-to-color/style and rhythm-to-texture choices are original soft design preferences constrained to registered taxonomy IDs. They never choose a SKU, set price or inventory, override wrist/fit/budget/product constraints, or make fortune and efficacy claims.

The mapping is a Mystcrag design convention, not a claim that one historical school is uniquely correct. It uses broad natural-image associations as an art-direction vocabulary:

| Trigram | v1 color direction | v1 style direction | Cultural/design note |
| --- | --- | --- | --- |
| Heaven | white, gray | minimal, modern | Open sky and clarity become restrained light neutrals. |
| Lake | white, blue | delicate, romantic | Reflective water becomes bright, polished softness. |
| Fire | red, orange | modern, eastern contemporary | Flame and illumination become warm visual focus. |
| Thunder | green, black | natural, eastern contemporary | Sudden growth against depth becomes grounded contrast. |
| Wind | green, teal | natural, delicate | Air moving through plants becomes layered, light rhythm. |
| Water | blue, black | ethereal, minimal | Depth and flow become cool, sparse tonal movement. |
| Mountain | brown, gray | minimal, natural | Stone and stillness become earthy, stable restraint. |
| Earth | yellow, brown | eastern contemporary, natural | Soil and receptivity become warm, supportive neutrals. |

Yin/yang ratio controls the base rhythm: visually homogeneous casts stay steady, balanced casts alternate, and intermediate ratios graduate. Three or more moving lines switch to punctuated contrast. A transformed hexagram contributes only alternative support colors: one new color for low movement and the full distinct alternative palette for high movement. Moving positions alone become accent candidates. These rules are visual metaphors, not predictions or claims about a user's life.
