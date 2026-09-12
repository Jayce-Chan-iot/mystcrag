# Bead and Tray Asset Realism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver four seamless transparent display trays and consistently cropped photographic bead fallbacks with machine-checked geometry and provenance.

**Architecture:** Keep asset generation and validation in `scripts/ui-qa`, runtime files in the frontend `public` tree, and immutable mapping metadata in the existing visual-asset registry. All four trays share one 1024×1024 frame and explicit inner/rim ratios; all 20 bead fallbacks share one 512×512 transparent frame and a normalized visible diameter. No business contract or Bracelet Engine file changes.

**Tech Stack:** Python 3 + Pillow for deterministic post-processing/verification, WebP RGBA runtime assets, TypeScript registry/tests, Codex `imagegen` only for generating/reworking source visuals.

**Spec:** `docs/superpowers/specs/2026-09-12-diy-loose-bead-physics-visual-redesign.md`

## Global Constraints

- Register `TASK-ASSET-003`, owner `ASSET`, branch `task/asset-003-bead-tray-realism`, exact writable paths, and status `IN_PROGRESS` before changing assets.
- Do not use or copy competitor media. Record the generation/source and transformation for every runtime file.
- Tray runtime files are 1024×1024 RGBA WebP, centered, with `rimRadiusRatio: 0.44` and `innerRadiusRatio: 0.37`.
- Bead runtime files are 512×512 RGBA WebP; the non-transparent subject is centered and fills 84–86% of the frame's longest axis.
- Preserve the 20 current material filenames and the existing approved-key-first/fallback-once resolver behavior.
- Do not edit `DesignV1`, Backend, Database, Auth, Bracelet Engine, package manifests or lockfile.
- Do not push, deploy or merge to `main`; stop at a clean candidate commit for Codex review.

---

## File structure

- Create `apps/frontend/public/trays/ASSET_PROVENANCE.md`: generation/source, license/authorization statement, processing command and per-file SHA-256 evidence.
- Modify `apps/frontend/public/trays/{bone-china,clear-acrylic,french-linen,oak-wood}.webp`: transparent, identically framed tray assets.
- Modify `apps/frontend/public/beads/photographic/*.webp`: normalized alpha-bound bead fallbacks only where verification currently fails.
- Modify `scripts/ui-qa/bead_postprocess.py`: reusable alpha-bound normalization with explicit CLI parameters and no quality-changing default drift.
- Create `scripts/ui-qa/verify_diy_assets.py`: fail-closed alpha, dimensions, bounds, centering and tray-corner verification.
- Modify `apps/frontend/src/features/design/model/visual-assets.ts`: add immutable tray geometry metadata.
- Modify `apps/frontend/src/features/design/model/visual-assets.test.tsx`: assert the four exact geometry records and preserve resolver security assertions.
- Modify only the `TASK-ASSET-003` row in `docs/tasks/TASK_REGISTRY.md`.

### Task 1: Register and baseline the asset defects

**Files:**
- Modify: `docs/tasks/TASK_REGISTRY.md`
- Create: `scripts/ui-qa/verify_diy_assets.py`

**Interfaces:**
- Consumes: current four tray WebPs and 20 photographic bead WebPs.
- Produces: `verify_image(path, kind) -> AssetMeasurement` and a non-zero process exit when any invariant fails.

- [ ] **Step 1: Register the task and exact lock**

Add one registry row with owner `ASSET`, branch `task/asset-003-bead-tray-realism`, status `IN_PROGRESS`, and only the files listed by this plan. Explicitly forbid application components, contracts, engine, backend, database, Auth, dependencies, generated QA output, push and deployment.

- [ ] **Step 2: Write the failing verifier**

Create `scripts/ui-qa/verify_diy_assets.py` with these public records and checks:

```python
from dataclasses import dataclass
from pathlib import Path
from PIL import Image

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
    corners = [alpha.getpixel((0, 0)), alpha.getpixel((image.width - 1, 0)),
               alpha.getpixel((0, image.height - 1)), alpha.getpixel((image.width - 1, image.height - 1))]
    return AssetMeasurement(image.width, image.height, bbox, max(corners))
```

For trays assert 1024×1024, four corner alpha values `<= 8`, a centered non-empty alpha box and no opaque full-frame rectangle. For beads assert 512×512, corner alpha `<= 8`, alpha-box center within 4 px of `(256, 256)`, and longest alpha-box side between 430 and 440 px. Print one compact line per file and return exit 1 on any failure.

- [ ] **Step 3: Run the verifier against the current assets**

Run:

```bash
python3 scripts/ui-qa/verify_diy_assets.py
```

Expected: FAIL. Each current tray reports opaque corners/full-frame background; at least the visibly underscaled bead fallback reports an out-of-range alpha bound.

- [ ] **Step 4: Commit the red baseline**

```bash
git add docs/tasks/TASK_REGISTRY.md scripts/ui-qa/verify_diy_assets.py
git commit -m "test(assets): define diy image quality gates"
```

### Task 2: Make bead normalization deterministic

**Files:**
- Modify: `scripts/ui-qa/bead_postprocess.py`
- Test: `scripts/ui-qa/verify_diy_assets.py`

**Interfaces:**
- Consumes: one authorized source image and CLI `--target-fill`.
- Produces: one centered 512×512 RGBA WebP whose alpha bounds satisfy the verifier.

- [ ] **Step 1: Add a CLI and geometry-preserving resize**

Keep the existing corner flood-fill, but replace positional-only invocation with:

```python
parser.add_argument("source", type=Path)
parser.add_argument("target", type=Path)
parser.add_argument("--target-fill", type=float, default=0.85)
```

Resize the cropped content proportionally so its longest side equals `round(512 * target_fill)`; do not resize both axes to a square. Reject a fill outside `0.84 <= value <= 0.86`, a missing alpha box, or identical source/target paths.

- [ ] **Step 2: Reprocess only failing photographic fallbacks**

For each verifier-reported bead, use its authorized source under `scripts/ui-qa/bead-raw/` when present:

```bash
python3 scripts/ui-qa/bead_postprocess.py scripts/ui-qa/bead-raw/red-agate.jpg apps/frontend/public/beads/photographic/red-agate.webp --target-fill 0.85
```

Repeat the same command with matching filenames only for other failing bead records. Do not overwrite a passing material.

- [ ] **Step 3: Verify all 20 bead files**

```bash
python3 scripts/ui-qa/verify_diy_assets.py --beads-only
```

Expected: PASS for exactly 20 files, with dimensions, alpha bounds and centering printed.

- [ ] **Step 4: Commit bead normalization**

```bash
git add scripts/ui-qa/bead_postprocess.py apps/frontend/public/beads/photographic
git commit -m "fix(assets): normalize photographic bead bounds"
```

### Task 3: Produce four transparent tray assets

**Files:**
- Modify: `apps/frontend/public/trays/bone-china.webp`
- Modify: `apps/frontend/public/trays/clear-acrylic.webp`
- Modify: `apps/frontend/public/trays/french-linen.webp`
- Modify: `apps/frontend/public/trays/oak-wood.webp`
- Create: `apps/frontend/public/trays/ASSET_PROVENANCE.md`

**Interfaces:**
- Consumes: Product Owner-approved visual direction and Codex `imagegen`/authorized source imagery.
- Produces: four centered RGBA WebPs sharing the exact runtime frame and geometry ratios.

- [ ] **Step 1: Generate or edit the source visuals**

Invoke the Codex `imagegen` skill separately for each material with this invariant prompt:

```text
Create a photorealistic top-down circular jewelry bead tray isolated on true transparent background. Center it in a square frame. Outer rim radius is 44% of frame width; usable inner floor radius is 37%. Keep the entire rim and a restrained natural contact shadow, but no white, ivory, gray, or checkerboard background rectangle and no beads, text, logo, hands, tools, or cropped rim. Neutral soft studio light from upper left. Match framing exactly across the four outputs.
```

Append exactly one of these material lines to each separate generation request: `Material: polished warm-white bone china.`, `Material: optically clear acrylic.`, `Material: warm undyed French linen.`, or `Material: pale natural oak wood.`

Inspect every result at original detail. Reject visible square fill, haloing, asymmetrical framing, clipped shadow or different scale.

- [ ] **Step 2: Convert without flattening alpha**

Use Pillow to fit each accepted source into a 1024×1024 transparent canvas and save lossless WebP (`lossless=True`, `method=6`). Do not composite onto the app background.

- [ ] **Step 3: Record provenance and hashes**

Write `ASSET_PROVENANCE.md` with one row per filename containing: generated/authorized source, creation date, transformation command, ownership/license statement, 1024×1024 RGBA, `rimRadiusRatio=0.44`, `innerRadiusRatio=0.37`, and SHA-256 from:

```bash
shasum -a 256 apps/frontend/public/trays/*.webp
```

- [ ] **Step 4: Verify the four trays**

```bash
python3 scripts/ui-qa/verify_diy_assets.py --trays-only
```

Expected: PASS for exactly four files, transparent corners, centered alpha bounds, and no full-frame opaque patch.

- [ ] **Step 5: Commit trays and provenance**

```bash
git add apps/frontend/public/trays
git commit -m "fix(assets): replace patched tray backgrounds"
```

### Task 4: Publish tray geometry metadata

**Files:**
- Modify: `apps/frontend/src/features/design/model/visual-assets.ts`
- Modify: `apps/frontend/src/features/design/model/visual-assets.test.tsx`

**Interfaces:**
- Consumes: verified common tray geometry.
- Produces: `TrayVisual` with `rimRadiusRatio: 0.44` and `innerRadiusRatio: 0.37` for every material.

- [ ] **Step 1: Write the failing registry assertions**

Add a test that calls `getTrayVisual` for every `DISPLAY_TRAY_OPTIONS` entry and asserts:

```ts
assert.deepEqual(
  { rimRadiusRatio: visual.rimRadiusRatio, innerRadiusRatio: visual.innerRadiusRatio },
  { rimRadiusRatio: 0.44, innerRadiusRatio: 0.37 }
);
assert.ok(visual.innerRadiusRatio < visual.rimRadiusRatio);
```

Keep the existing approved-key, fallback-once and no-derived-key tests unchanged.

- [ ] **Step 2: Run the focused test and see it fail**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/model/visual-assets.test.tsx
```

Expected: FAIL because `TrayVisual` lacks the two fields.

- [ ] **Step 3: Add exact metadata**

Change the exported type and records to:

```ts
export type TrayVisual = {
  src: string;
  alt: string;
  rimRadiusRatio: 0.44;
  innerRadiusRatio: 0.37;
};
```

Every `TRAY_VISUALS` entry receives the same literal ratios.

- [ ] **Step 4: Run focused and full frontend checks**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/model/visual-assets.test.tsx
python3 scripts/ui-qa/verify_diy_assets.py
pnpm --filter @mystcrag/frontend test
pnpm --filter @mystcrag/frontend typecheck
pnpm --filter @mystcrag/frontend lint
```

Expected: all asset checks and frontend commands PASS.

- [ ] **Step 5: Commit registry metadata**

```bash
git add apps/frontend/src/features/design/model/visual-assets.ts apps/frontend/src/features/design/model/visual-assets.test.tsx
git commit -m "feat(assets): expose tray geometry metadata"
```

### Task 5: Visual, performance, and handoff gate

**Files:**
- Modify: only the `TASK-ASSET-003` acceptance text in `docs/tasks/TASK_REGISTRY.md`
- Store ignored evidence: `output/playwright/task-asset-003/`

**Interfaces:**
- Consumes: final runtime assets and metadata.
- Produces: clean review candidate with machine and screenshot evidence.

- [ ] **Step 1: Capture representative renders**

Start the existing local frontend against signed-test/local demo data and capture the DIY route at 1440×900 and 390×844 for all four trays. Store only under `output/playwright/task-asset-003/`. Inspect original-resolution images for square patches, halos, clipped shadows, equal-diameter scale mismatch and missing fallback.

- [ ] **Step 2: Check asset and bundle cost**

```bash
du -k apps/frontend/public/trays/*.webp apps/frontend/public/beads/photographic/*.webp
pnpm --filter @mystcrag/frontend build
```

Record total before/after runtime bytes in the task row. Reject any individual tray above 900 KiB or any unexplained aggregate increase above 20%.

- [ ] **Step 3: Run repository gates**

```bash
python3 scripts/ui-qa/verify_diy_assets.py
pnpm --filter @mystcrag/frontend test
pnpm --filter @mystcrag/frontend typecheck
pnpm --filter @mystcrag/frontend lint
pnpm --filter @mystcrag/frontend build
pnpm validate
git diff --check
```

Report an existing baseline failure precisely; do not claim `pnpm validate` is green unless it exits zero.

- [ ] **Step 4: Mark REVIEW and commit**

Update only `TASK-ASSET-003` with exact commits, changed files, verifier counts, viewport evidence, byte comparison, command results and no push/deploy.

```bash
git add docs/tasks/TASK_REGISTRY.md
git commit -m "docs(tasks): hand off TASK-ASSET-003"
git status --short
```

Expected: clean worktree. Stop for Codex review; do not begin `TASK-FE-003` on this branch.
