# Mystcrag Bracelet Engine V2 Delivery Report

Date: 2026-08-18  
Branch: `codex/diy-v2-bracelet-engine`  
Result: `ENGINE_AND_EDITOR_SLICE_READY`

## Delivered

- Added dependency-free `@mystcrag/bracelet-engine`: chord-based binary-search radius solver, mixed-size angular slots/ranges, hit testing, and explicit fit vocabulary.
- Replaced equal-count drag targeting with physical slot ranges for mixed 14/3/6/8/12mm layouts.
- Shared engine angles now drive the 2.5D editor, PNG export, and Three Engine ring projection.
- Added real `REPLACE_COMPONENT` UI while preserving `componentId` and anchors.
- Added bounded Undo/Redo for add, remove, move, replace, and clear; keyboard Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z plus mobile controls.
- Changed clear to one batch Update/revision and removed redundant Price calls after successful authoritative Update responses.
- Distinguished “current design” from user wrist/target values in UI/model data.
- Added collapsed/half/expanded mobile catalog sheet; 2.5D stage remains the primary visual area.
- Added repository-wide CI, documentation routing, baseline/research/geometry/dependency records, and validated project skill `mystcrag-bracelet-engine`.

## Open-source reuse report

Adopted: Playwright CLI (Apache-2.0) for real browser operation; existing React/Next/Fastify/Prisma/Three stack retained. The new geometry core uses no registry runtime dependency.

Studied but not installed: dnd-kit, Zustand, zundo, TanStack Query, Motion, Radix, and Vaul (all MIT). Native Pointer Events and a non-modal responsive sheet were smaller for the current circular editor. Configurator references and licenses are recorded in `OSS_RESEARCH.md`; unlicensed and GPL sources were not copied.

## Verification

- `pnpm validate`: PASS, 8/8 workspace lint, typecheck, test, and build tasks.
- Bracelet Engine: 4/4 unit groups PASS, including mixed sizes, spacers, hero bead, precision, invalid geometry, slot resolution, and fit boundaries.
- Frontend: 53/53 PASS. Three Engine: 14/14 PASS. Architecture: 8/8 PASS.
- Real browser and PostgreSQL-backed API: add, replace, undo, redo, save path, mobile sheet, and desktop layout exercised.
- Network evidence after add/undo/redo: three Update calls, zero redundant Price calls.
- 390×844 and 1440×900: no horizontal overflow; fresh final page console had zero errors/warnings.
- Screenshots: local `output/playwright/diy-v2-after/mobile-390.png`, `mobile-430.png`, and `desktop-1440.png`.

## Dependencies, migration, and API

- New runtime registry dependencies: none.
- New local workspace dependency: `@mystcrag/bracelet-engine` consumed by Frontend and Three Engine.
- Database migration: none. Design revisions and immutable order snapshots are unchanged.
- API shape: unchanged. Existing multi-operation Update is now used for batch clear; successful Update pricing is treated as authoritative.

## Not delivered in this slice

- Unified accessory catalog endpoint, real SKU asset URLs/entity, and `MaterialBatch` persistence require a reviewed Design Contract/API/database migration; the existing material catalog and fallback sprites remain.
- Fully optimistic working-draft/server-state separation, fly-in Motion animation, automated axe integration, and committed visual-regression snapshots remain follow-up work. Current editing still waits for Backend confirmation before the final design state settles.
- Firefox/WebKit and physical iOS/Android device runs were not available in this environment.

These are real remaining V2 gaps; this report does not classify the entire original forty-section brief as fully complete.

## Commits

- `8ab5833 docs: establish diy v2 baseline and research`
- `e024f55 feat: add shared bracelet geometry engine`
- `fcb0b49 feat: add reversible bracelet editing and shared projections`
- `3407124 chore: add bracelet qa workflow and project skill`

## Next phase

Introduce the unified Material/Accessory catalog and asset/batch model as one reviewed Contract/API/database slice, then add optimistic server reconciliation and automated Playwright+axe visual gates.
