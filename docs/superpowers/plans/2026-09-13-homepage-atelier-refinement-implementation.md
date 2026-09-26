# Homepage Atelier Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the clipped, joined homepage composition with an approved framed atelier layout and a production-quality DIY loose-bead tray image while preserving all routes, feature flags, copy, and server-component behavior.

**Architecture:** Deliver the new runtime photograph through a separate ASSET task, then consume it through a narrowly scoped FRONTEND task. Keep `app/page.tsx` as a React Server Component and implement motion entirely in CSS; verify the static contract first, then use real-browser screenshots at the three acceptance viewports.

**Tech Stack:** Next.js 16 App Router, React 19 Server Components, `next/image`, CSS media queries, Node test runner, Playwright visual inspection, WebP runtime assets.

**Spec:** `docs/superpowers/specs/2026-09-13-homepage-atelier-refinement.md`

## Global Constraints

- Before any executor starts, Codex registers every implementation task in `docs/tasks/TASK_REGISTRY.md` with exactly one owner, branch, worktree, writable path set, and `IN_PROGRESS` status. Parallel executors must not edit the shared registry; Codex records review status after handoff.
- Use `TASK-ASSET-004` for the production image and `TASK-FE-004` for the homepage consumer; the asset task lands before the frontend task.
- Do not change the existing brand, navigation, routes, factual copy, Tarot feature flag, global design tokens, authentication, Backend, Database, Bracelet Engine, package manifests, or lockfile.
- Keep the desktop navigation at or below 72px and the homepage content centered with at least 32px side clearance; mobile side clearance is at least 16px.
- Use a 24px radius system for the hero and creation cards; three-card gaps are 20-24px and mobile gaps are at least 16px.
- Card hover/focus motion is `scale(1.025) translateY(-4px)` over 220-280ms using `cubic-bezier(0.16, 1, 0.3, 1)`; reduced-motion removes transform and transition.
- Do not add an animation dependency, client state, scroll listener, infinite animation, parallax, page-level scaling, or layout-changing width/height animation.
- The new DIY image is project-owned or otherwise explicitly authorized, contains no competitor media, person, text, watermark, user data, or finished circular bracelet, and is recorded in the runtime asset manifest.
- Do not commit generated QA screenshots or temporary image-generation output. Do not push, deploy, or merge to `main`; stop at clean review commits.

---

## File Structure

- Create `apps/frontend/public/home/entry-diy-loose-tray.webp`: dedicated 1200×900 production scene with a loose-bead design tray.
- Modify `docs/UI_REFERENCE_AND_ASSET_MANIFEST.md`: runtime path, intended use, visual constraints, and project-owned provenance statement.
- Modify `apps/frontend/app/page.tsx`: point only the DIY creation path to the new asset and accurate alt text.
- Modify `apps/frontend/app/atelier.css`: framed hero, separated cards, responsive layout, transform-only feedback, and reduced-motion behavior.
- Modify `apps/frontend/src/features/design/atelier-ui-contract.test.tsx`: source-level regression contract for layout, asset semantics, responsiveness, and motion.

### Task 1: Produce the dedicated DIY loose-bead scene

**Files:**
- Create: `apps/frontend/public/home/entry-diy-loose-tray.webp`
- Modify: `docs/UI_REFERENCE_AND_ASSET_MANIFEST.md`

**Interfaces:**
- Consumes: the approved visual requirements in the spec and the existing 4:3 homepage entry-image slot.
- Produces: `/home/entry-diy-loose-tray.webp`, exactly 1200×900 WebP, suitable for `next/image` with no alpha requirement and no embedded metadata needed at runtime.

- [ ] **Step 1: Verify the Codex-owned task registration and lock**

Confirm Codex has registered `TASK-ASSET-004`, owner `MiMo / ASSET`, branch `task/asset-004-home-diy-entry`, status `IN_PROGRESS`, with writable paths limited to the new WebP and the manifest. Do not start if that exact row/branch/path set is absent, and do not edit `TASK_REGISTRY.md` from the executor worktree.

- [ ] **Step 2: Prove the runtime asset is absent**

Run:

```bash
test ! -e apps/frontend/public/home/entry-diy-loose-tray.webp
```

Expected: exit 0. If the file already exists, stop and compare its task ownership and provenance before proceeding; do not overwrite another task's asset.

- [ ] **Step 3: Generate the production source under the image-generation skill**

Use this exact scene brief, without including the planning preview as an input image:

```text
Photorealistic luxury jewelry-workbench editorial photograph, top-down view, landscape 4:3. A large round warm-ivory bone-china bead design tray occupies the right-center of a quiet warm-white work surface. Inside the tray, naturally scatter 12 to 18 loose unthreaded crystal beads; they must not form a circle, bracelet, necklace, or finished product. Mix transparent clear, moonstone white, pale lavender, ice blue, and two restrained deep-violet beads, visibly varying among 6 mm, 8 mm, and 10 mm. Add one fine beading needle, a short relaxed segment of clear elastic cord, and a small jewelry tweezer near the tray edge. Leave calm negative space, use soft upper-left studio light, realistic refraction and subtle contact shadows. No hands, text, logo, watermark, packaging, clutter, gemstones outside the palette, or cropped tray rim. The result must immediately read as DIY bracelet creation in progress, not completed jewelry display.
```

Inspect at original resolution. Reject any result with a circular bead arrangement, a threaded bracelet, deformed beads/tools, illegible pseudo-text, clipped tray, or square background patch.

- [ ] **Step 4: Convert and verify the production file**

Convert the accepted project-owned source to 1200×900 WebP with embedded profile/EXIF removed, preserving aspect ratio and using a centered crop only if no tray rim or tool is lost. Then run:

```bash
file apps/frontend/public/home/entry-diy-loose-tray.webp
sips -g pixelWidth -g pixelHeight apps/frontend/public/home/entry-diy-loose-tray.webp
shasum -a 256 apps/frontend/public/home/entry-diy-loose-tray.webp
```

Expected: WebP, width 1200, height 900, and one stable SHA-256. Visually inspect the final WebP, not just the source.

- [ ] **Step 5: Update the runtime manifest**

Replace the current DIY entry row with:

```markdown
| DIY loose-bead entry scene | `/home/entry-diy-loose-tray.webp` | Home DIY card | Project-owned generated 1200×900 WebP. Show a round creation tray with 12-18 loose, unthreaded mixed-size beads and restrained tools; never present a completed bracelet. Entire card is clickable. |
```

Under `## Asset provenance`, state that this scene was project-owned generated media created for `TASK-ASSET-004`, include its creation date and SHA-256, and state that no competitor image, user data, or planning screenshot was used as runtime media.

- [ ] **Step 6: Commit the independently reviewable asset**

```bash
git add apps/frontend/public/home/entry-diy-loose-tray.webp docs/UI_REFERENCE_AND_ASSET_MANIFEST.md
git commit -m "feat(assets): add homepage loose-bead diy scene"
```

Return the commit, source/hash evidence, and visual inspection notes to Codex. Codex changes `TASK-ASSET-004` to `REVIEW`; the executor does not edit the shared registry or mark the task `DONE`.

### Task 2: Define the homepage layout and motion regression contract

**Files:**
- Modify: `apps/frontend/src/features/design/atelier-ui-contract.test.tsx`

**Interfaces:**
- Consumes: `/home/entry-diy-loose-tray.webp` from `TASK-ASSET-004`.
- Produces: source-level assertions that fail against the current glued, fixed-viewport layout and pass only for the approved semantic asset and CSS invariants.

- [ ] **Step 1: Verify the Codex-owned FRONTEND registration and lock**

After Codex accepts the asset task, confirm Codex has registered `TASK-FE-004`, owner `MiMo / FRONTEND`, branch `task/fe-004-home-atelier-refinement`, status `IN_PROGRESS`, with writable paths limited to `app/page.tsx`, `app/atelier.css`, and `atelier-ui-contract.test.tsx`. Do not edit the registry from this worktree.

- [ ] **Step 2: Replace the obsolete fixed-viewport test with the new contract**

In `atelier-ui-contract.test.tsx`, keep the route/surface tests and replace the current test named `the desktop homepage keeps the hero above three creation paths in the first viewport` with:

```ts
test("the homepage uses framed media, separated creation cards and motion-safe feedback", () => {
  const home = source("../../../app/page.tsx");
  const css = source("../../../app/atelier.css");

  assert.match(home, /image:\s*"\/home\/entry-diy-loose-tray\.webp"/);
  assert.match(home, /尚未穿线的散珠/);
  assert.match(home, /className="home-reference-hero-media"/);
  assert.doesNotMatch(home, /image:\s*"\/home\/entry-diy\.webp"/);
  assert.match(css, /\.home-reference-shell\s*\{[^}]*padding:\s*clamp\(/s);
  assert.doesNotMatch(css, /\.home-reference-shell\s*\{[^}]*height:\s*calc\(100dvh/s);
  assert.match(css, /\.home-reference-hero\s*\{[^}]*border-radius:\s*1\.5rem/s);
  assert.match(css, /\.home-reference-paths\s*\{[^}]*gap:\s*clamp\([^;]*1\.5rem/s);
  assert.match(css, /\.home-reference-card-link\s*\{[^}]*border-radius:\s*1\.5rem/s);
  assert.match(css, /\.home-reference-card-link:is\(:hover,\s*:focus-visible\)[^{]*\{[^}]*transform:\s*translateY\(-4px\)\s+scale\(1\.025\)/s);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.home-reference-card-link[^}]*transition:\s*none/s);
  assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.home-reference-paths\s*\{[^}]*grid-template-columns:\s*1fr/s);
});
```

- [ ] **Step 3: Run the focused test and confirm red**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/atelier-ui-contract.test.tsx
```

Expected: FAIL on the new asset path and framed/gapped layout assertions. A syntax or import failure is not an acceptable red state.

- [ ] **Step 4: Commit the red contract**

```bash
git add apps/frontend/src/features/design/atelier-ui-contract.test.tsx
git commit -m "test(frontend): define refined homepage contract"
```

### Task 3: Implement the framed responsive homepage

**Files:**
- Modify: `apps/frontend/app/page.tsx`
- Modify: `apps/frontend/app/atelier.css`
- Test: `apps/frontend/src/features/design/atelier-ui-contract.test.tsx`

**Interfaces:**
- Consumes: the new runtime asset and the existing `CreationPath` server-rendered array.
- Produces: an RSC homepage whose card count remains driven by `isTarotFeatureEnabled()` and whose interaction is CSS-only.

- [ ] **Step 1: Point the DIY path at the approved asset**

Change the DIY entry fields to:

```ts
image: "/home/entry-diy-loose-tray.webp",
imageAlt: "象牙白圆形创作盘中自然散放着尚未穿线的水晶珠子与穿线工具"
```

Wrap the hero `Image` in `<div className="home-reference-hero-media">` so copy and photography occupy explicit grid regions. Set the hero image `sizes` to `(max-width: 767px) calc(100vw - 2rem), (max-width: 1536px) calc(60vw - 2.4rem), 55rem`; set each entry image `sizes` to `(max-width: 767px) calc(100vw - 2rem), (max-width: 1536px) calc((100vw - 8rem) / 2), 44rem`. The desktop card value intentionally covers the wider Tarot-disabled two-card case. Do not add `"use client"`, state, effects, or event handlers to `page.tsx`.

- [ ] **Step 2: Replace the homepage-only layout rules**

In the homepage section of `atelier.css`, implement these exact controlling values while retaining the existing color variables and copy typography:

```css
[data-atelier-surface="home"] {
  min-height: calc(100dvh - 3.8125rem);
  background: #f7f4ee;
}

.home-reference-shell {
  display: grid;
  gap: clamp(1rem, 1.65vw, 1.5rem);
  width: min(100%, 92rem);
  margin-inline: auto;
  padding: clamp(1rem, 2.25vw, 2rem);
}

.home-reference-hero {
  position: relative;
  display: grid;
  grid-template-columns: minmax(20rem, 2fr) minmax(0, 3fr);
  min-height: clamp(25rem, 48vw, 39rem);
  overflow: hidden;
  border: 1px solid var(--atelier-line);
  border-radius: 1.5rem;
  background: var(--atelier-paper);
  box-shadow: var(--atelier-shadow);
}

.home-reference-paths {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  gap: clamp(1.25rem, 1.65vw, 1.5rem);
}

.home-reference-paths article {
  min-width: 0;
}

.home-reference-card-link {
  display: grid;
  grid-template-rows: minmax(14rem, 1.55fr) minmax(8rem, auto);
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--atelier-line);
  border-radius: 1.5rem;
  background: rgb(255 253 248 / 0.96);
  box-shadow: 0 14px 40px rgb(49 38 54 / 0.055);
  color: inherit;
  text-decoration: none;
  transform: translateY(0) scale(1);
  transform-origin: center;
  transition: transform 250ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 250ms ease;
}

.home-reference-card-link:is(:hover, :focus-visible) {
  transform: translateY(-4px) scale(1.025);
}

.home-reference-card-link:active {
  transform: translateY(-1px) scale(0.99);
}
```

Remove the shell's fixed viewport height, joined outer side borders, card separator borders, and path overflow clipping. Make `.home-reference-hero-copy` a normal-flow grid child rather than an absolutely translated overlay. Give `.home-reference-hero-media` `position: relative; min-height: 25rem;` and render its image with `object-fit: contain; object-position: center;`; use the existing warm background and restrained gradient inside the media region. The entire bracelet must remain visible, including the uppermost and lowermost beads.

- [ ] **Step 3: Add the mobile and reduced-motion overrides**

Within the existing media-query structure, ensure:

```css
@media (max-width: 767px) {
  .home-reference-shell { padding: 1rem; }
  .home-reference-hero { grid-template-columns: 1fr; min-height: auto; }
  .home-reference-hero-media { min-height: min(19rem, 76vw); }
  .home-reference-paths { grid-template-columns: 1fr; gap: 1rem; }
  .home-reference-card-link { grid-template-rows: minmax(13rem, 44vw) auto; }
}

@media (prefers-reduced-motion: reduce) {
  .home-reference-card-link,
  .home-reference-entry-image img {
    transition: none;
  }
  .home-reference-card-link:is(:hover, :focus-visible, :active) {
    transform: none;
  }
}
```

Keep the focus outline visible outside the link; do not use a negative outline offset or ancestor clipping that hides it.

- [ ] **Step 4: Run focused and frontend checks**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/design/atelier-ui-contract.test.tsx
pnpm --filter @mystcrag/frontend test
pnpm --filter @mystcrag/frontend typecheck
pnpm --filter @mystcrag/frontend lint
pnpm --filter @mystcrag/frontend build
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit the implementation**

```bash
git add apps/frontend/app/page.tsx apps/frontend/app/atelier.css
git commit -m "feat(frontend): refine homepage atelier layout"
```

### Task 4: Perform real-browser visual and interaction acceptance

**Files:**
- Modify only when a defect is found: `apps/frontend/app/page.tsx`
- Modify only when a defect is found: `apps/frontend/app/atelier.css`
- Modify only when a missing invariant is found: `apps/frontend/src/features/design/atelier-ui-contract.test.tsx`

**Interfaces:**
- Consumes: the candidate homepage build.
- Produces: review evidence recorded in the task row; screenshots remain uncommitted in an ignored temporary output directory.

- [ ] **Step 1: Start the normal local stack and capture exact viewports**

Use the repository's documented launcher or frontend dev command, then use Playwright at 1440×900, 1920×1080, and 390×844. At each width inspect the top, middle, and bottom of the page, including a full-page capture. Save temporary images under `output/playwright/task-fe-004/` and do not add them to Git.

- [ ] **Step 2: Verify visual invariants manually**

At both desktop widths confirm the bracelet is not cut at the top, the hero ends inside its own rounded frame, card gaps measure 20-24px, all visible cards share a 24px radius, no text is truncated, and Tarot-off yields two balanced cards without a ghost column. At 390×844 confirm one column, at least 16px side/gap spacing, no horizontal overflow, complete image subjects, and 44px link targets.

- [ ] **Step 3: Verify pointer, keyboard, touch, and reduced-motion behavior**

Hover and unhover every card; focus each with Tab; activate each route with keyboard; emulate touch and confirm no sticky hover blocks navigation. Emulate `prefers-reduced-motion: reduce` and confirm there is no lift/scale while focus and arrow feedback remain visible. Confirm the whole card is one link and the arrow remains decorative.

- [ ] **Step 4: Run the frontend detector and final gates**

```bash
node /Users/chenyanyan/.codex/skills/impeccable/scripts/detect.mjs apps/frontend/app/page.tsx apps/frontend/app/atelier.css
pnpm --filter @mystcrag/frontend test
pnpm --filter @mystcrag/frontend typecheck
pnpm --filter @mystcrag/frontend lint
pnpm --filter @mystcrag/frontend build
pnpm validate
git diff --check
git status --short
```

Expected: frontend checks and diff checks pass. If `pnpm validate` still reports only the independently known retired `apps/backend/src/modules/community` architecture scan, record it verbatim as an existing repository baseline and do not modify it under `TASK-FE-004`; any additional failure blocks review.

- [ ] **Step 5: Commit any evidence-driven correction and hand off**

If browser QA required code changes, first add a failing regression assertion, then commit the correction:

```bash
git add apps/frontend/app/page.tsx apps/frontend/app/atelier.css apps/frontend/src/features/design/atelier-ui-contract.test.tsx
git commit -m "fix(frontend): close homepage visual regressions"
```

Return commit hashes, exact commands/results, viewport results, Tarot-on/off evidence, reduced-motion evidence, and the known validation baseline to Codex. Codex updates `TASK-FE-004` to `REVIEW`; stop without editing the registry.

## Plan Self-Review Result

- Spec coverage: hero crop, rounded framing, card separation, DIY loose-bead semantics, Tarot-off behavior, pointer/keyboard/touch/reduced-motion, responsiveness, performance, asset ownership, and test/build gates are each assigned to a task.
- Type consistency: no new runtime type or cross-module contract is introduced; `CreationPath.image` and `imageAlt` remain strings and the page remains an RSC.
- Scope consistency: ASSET and FRONTEND writable paths do not overlap except the task registry, which each task edits only in its own row; authentication and all other pages remain forbidden.
