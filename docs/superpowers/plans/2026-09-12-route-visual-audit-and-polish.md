# Route Visual Audit and Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit every active frontend route and then remove crowding, hierarchy, consistency, responsiveness and accessibility defects in bounded route-family batches without changing product behavior.

**Architecture:** First create screenshot-and-metric evidence with no runtime edits. The audit applies the repository's approved ivory/violet atelier direction and Taste principles to consumer/editorial routes, while dense DIY/admin workflows use the same visual system with Impeccable's information-hierarchy and operational-density rules. Each accepted audit finding becomes a separate registered frontend task with an exact route-family lock.

**Tech Stack:** Next.js 16, React 19, Tailwind/global CSS already in the repository, Python Playwright capture tooling, Chromium/Firefox/WebKit, axe-compatible accessibility inspection where already available; no new UI framework.

**Spec:** `docs/superpowers/specs/2026-09-12-diy-loose-bead-physics-visual-redesign.md`

## Global Constraints

- The audit task changes only capture tooling, audit documents, task registration and ignored evidence; it does not change runtime UI.
- Capture before judging. Every issue names a route, viewport, state, screenshot and measurable impact.
- Preserve all routes, copy truth, workflows, API calls, Auth, price, inventory, compliance, save/order behavior and canonical renderers.
- Consumer pages use Taste's anti-template principles: clear focal hierarchy, restrained surfaces, purposeful whitespace, authentic material imagery and minimal competing accents.
- DIY and admin pages retain operational density but remove duplication, clipping, accidental whitespace, weak grouping and inaccessible controls; do not turn data tools into landing pages.
- Minimum touch target is 44 px; color and motion are never the only state indicator.
- Acceptance viewports are 1440×900 and 390×844, with secondary checks at 1280×720 and 375×667.
- Supported engines are Chromium, Firefox and WebKit. No page may require WebGL.
- Route LCP remains at or below 2.5 s, INP at or below 200 ms and CLS at or below 0.1 under the recorded local/staging conditions.
- No blind global CSS rewrite, invented business data, competitor asset copying, dependency upgrade, push or deployment.

---

## File structure

### Audit task (`TASK-UX-AUDIT-001`)

- Modify `scripts/ui-qa/capture_current.py`: deterministic route/state capture and JSON metrics.
- Create `docs/ui-audit/2026-09-12-route-visual-audit.md`: evidence-backed findings and severity.
- Create `docs/ui-audit/2026-09-12-route-polish-backlog.md`: exact proposed task batches and acceptance.
- Modify only `TASK-UX-AUDIT-001` in `docs/tasks/TASK_REGISTRY.md`.
- Store screenshots/metrics under ignored `output/playwright/task-ux-audit-001/`.

### Later frontend batches

- `TASK-FE-POLISH-001`: app shell, home, AI questionnaire/results and Tarot route family.
- `TASK-FE-POLISH-002`: crystal library, gallery and profile route family.
- `TASK-FE-POLISH-003`: knowledge-admin shell and its dashboard/review/source/run/atlas/graph pages.
- `TASK-FE-POLISH-004`: bead-import admin login/dashboard/workflow route family.

The audit report must narrow the exact writable component/test paths for each batch before any batch is registered. Page files that only compose a feature component are included only when the finding proves the page composition itself is defective.

### Task 1: Register the read-only visual audit

**Files:**
- Modify: `docs/tasks/TASK_REGISTRY.md`
- Modify: `scripts/ui-qa/capture_current.py`

**Interfaces:**
- Consumes: a running local system using the existing signed-test/development session and seeded data.
- Produces: PNG screenshots plus `metrics.json` keyed by route, state, viewport and browser.

- [ ] **Step 1: Register the audit lock**

Register `TASK-UX-AUDIT-001`, owner `SOL / design audit`, branch `task/ux-audit-001-route-visual-audit`, status `IN_PROGRESS`, the four exact writable paths above, and ignored evidence. Forbid all `apps/**`, `packages/**`, tests, public assets, schema/data, dependencies, Auth behavior, push/deploy/main merge.

- [ ] **Step 2: Write the capture manifest**

Replace the fixed route loop in `capture_current.py` with records of this shape:

```python
ROUTES = [
    {"id": "home", "path": "/", "family": "consumer"},
    {"id": "ai-design", "path": "/ai-design", "family": "consumer"},
    {"id": "tarot-setup", "path": "/tarot/setup", "family": "consumer"},
    {"id": "crystal-library", "path": "/crystal-library", "family": "catalog"},
    {"id": "gallery", "path": "/gallery", "family": "catalog"},
    {"id": "profile", "path": "/profile", "family": "catalog"},
    {"id": "diy-entry", "path": "/diy", "family": "workbench"},
    {"id": "admin-entry", "path": "/admin", "family": "admin"},
    {"id": "bead-import-login", "path": "/admin/bead-import/login", "family": "admin"},
    {"id": "knowledge-login", "path": "/admin/knowledge/login", "family": "admin"},
]
```

Discover dynamic DIY/design, Tarot draw/result, bead-import session and knowledge-atlas detail URLs by following the visible seeded link or reading the existing local test fixture/API response. Never hard-code a production ID or write data during capture.

- [ ] **Step 3: Record objective metrics**

For each page write:

```python
metrics = page.evaluate("""() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  scrollHeight: document.documentElement.scrollHeight,
  viewportHeight: window.innerHeight,
  interactiveBelowFold: [...document.querySelectorAll('button,a,input,select,textarea')]
    .filter((node) => node.getBoundingClientRect().top >= window.innerHeight).length,
  smallTargets: [...document.querySelectorAll('button,a,input,select,textarea')]
    .filter((node) => { const r = node.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length
}))""")
```

Also collect page errors, console errors, failed requests, `performance.getEntriesByType("navigation")`, and layout-shift observations when supported. Redact tokens, cookies, local paths and response bodies before writing JSON.

- [ ] **Step 4: Prove capture tooling on two routes**

```bash
python3 scripts/ui-qa/capture_current.py output/playwright/task-ux-audit-001/smoke --routes home,bead-import-login --browsers chromium --viewports 1440x900,390x844
```

Expected: four PNGs, one redacted `metrics.json`, zero horizontal-overflow values below zero or missing route records, and no repository-root screenshot.

- [ ] **Step 5: Commit capture tooling**

```bash
git add docs/tasks/TASK_REGISTRY.md scripts/ui-qa/capture_current.py
git commit -m "test(ui): make route audit capture reproducible"
```

### Task 2: Capture every route and important state

**Files:**
- Store ignored evidence: `output/playwright/task-ux-audit-001/before/`

**Interfaces:**
- Consumes: capture tool and authenticated local fixtures.
- Produces: complete before-state matrix with screenshots and metrics.

- [ ] **Step 1: Capture the route matrix**

Run Chromium for all routes/states at all four viewports, then Firefox and WebKit at the two acceptance viewports. Include:

- home;
- AI questionnaire initial, wrist step, validation and results;
- Tarot setup, draw and result;
- DIY entry, loaded loose tray, connected mode, conflict/error and mobile catalog;
- library populated/search-empty/error;
- gallery populated/empty/error;
- profile signed-in/order-empty/order-populated;
- admin entry and both login pages;
- bead-import dashboard, upload, processing, draft/group editing, failure and completion;
- knowledge dashboard, review, sources, runs, atlas list/detail and graph.

- [ ] **Step 2: Validate evidence completeness**

Run a manifest check in `capture_current.py --verify-only` that fails unless every required route/state has both PNG and metrics records, every acceptance viewport is present, filenames contain no user/database/token identifier, and `scrollWidth - clientWidth <= 1` unless the report explicitly marks the page as a P0 overflow defect.

- [ ] **Step 3: Inspect screenshots before writing findings**

Use original-resolution screenshots. For each state inspect focal hierarchy, visual density, alignment, whitespace, typography, control grouping, duplicate information, material prominence, empty/error clarity, focus visibility, 44 px targets, clipping, browser differences and primary-action reachability.

### Task 3: Write the evidence-backed audit

**Files:**
- Create: `docs/ui-audit/2026-09-12-route-visual-audit.md`

**Interfaces:**
- Consumes: complete before screenshots and metrics.
- Produces: severity-ranked findings with no implementation changes.

- [ ] **Step 1: Use the correct design lenses**

Read and apply `design-taste-frontend` to home, questionnaire/results, Tarot, library, gallery and profile. Apply the shared Taste visual language plus `impeccable` Operate-mode hierarchy to DIY and admin. Do not apply landing-page whitespace to tables, review queues or multi-step asset workflows.

- [ ] **Step 2: Record every finding in one exact schema**

Every finding uses an ID such as `P1-001` and contains these literal fields: `Route/state`, `Evidence`, `Viewports/browsers`, `Measurement`, `Problem`, `User impact`, `Proposed owner/path family`, `Acceptance`, and `Must preserve`. Evidence paths name the real captured PNG rather than a wildcard. Measurements use numbers or the explicit value `not captured`.

No issue may be justified only by personal preference. Mark missing runtime data or inaccessible states as an evidence limitation, not a visual pass.

- [ ] **Step 3: Rank instead of flattening**

P0 means blocked task, hidden primary action, destructive ambiguity, unreadable content or horizontal overflow. P1 means repeated crowding/hierarchy/consistency problem. P2 means cosmetic polish with no workflow impact. Deduplicate root causes shared across routes but list every affected route.

### Task 4: Turn findings into exact polish batches

**Files:**
- Create: `docs/ui-audit/2026-09-12-route-polish-backlog.md`

**Interfaces:**
- Consumes: accepted audit findings.
- Produces: four bounded, dependency-ordered implementation task definitions.

- [ ] **Step 1: Define `TASK-FE-POLISH-001`**

Scope only the shared consumer shell, `apps/frontend/app/page.tsx`, questionnaire feature, design results and Tarot components/styles/tests proven by the audit. Acceptance covers the corresponding route states at four viewports without changing generation/draw semantics.

- [ ] **Step 2: Define `TASK-FE-POLISH-002`**

Scope only library, gallery and profile components/model tests proven by the audit. Preserve filters, asset resolver, public/private state, order snapshots and Auth prompts.

- [ ] **Step 3: Define `TASK-FE-POLISH-003`**

Scope only `apps/frontend/src/features/admin-knowledge/**`, the matching admin knowledge page/layout files and module-local tests proven by the audit. Preserve admin authorization, review decisions, graphs, source/runs data and API DTOs.

- [ ] **Step 4: Define `TASK-FE-POLISH-004`**

Scope only `apps/frontend/src/features/admin-bead-import/components/**`, `control-styles.ts`, matching admin page/layout files and module-local tests proven by the audit. Preserve upload/processing/QC/manual approval/publish boundaries and the separate admin entry.

For each batch list exact files, forbidden paths, each finding ID, before evidence, required tests, accepted browsers/viewports, performance budget and rollback commit. No task may own the entire frontend tree.

- [ ] **Step 5: Commit and hand off the audit**

```bash
git add docs/ui-audit/2026-09-12-route-visual-audit.md docs/ui-audit/2026-09-12-route-polish-backlog.md docs/tasks/TASK_REGISTRY.md
git commit -m "docs(ui): audit active route visual quality"
git diff --check
git status --short
```

Mark `TASK-UX-AUDIT-001` REVIEW with exact capture counts, evidence limitations and no runtime change. Stop for Product Owner/Codex acceptance before registering a polish batch.

## Execution boundary after the audit

This plan ends with an evidence-backed backlog because exact runtime paths and assertions cannot be known before the screenshots and state captures exist. After Codex accepts `TASK-UX-AUDIT-001`, SOL writes four separate no-placeholder implementation plans, one for each accepted polish batch. Each later plan must include its literal file list, failing test code, commands, before evidence, performance numbers, commit message and final cross-browser comparison. The batches execute serially in the dependency order recorded by the audit; none may claim the whole frontend tree.
