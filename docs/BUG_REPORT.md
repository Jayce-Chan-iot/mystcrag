# Mystcrag Phase 3.5 QA Bug Report

Date: 2026-07-22
Branch: `test/mvp-integration-rerun`
Final baseline: `2fa2a0a1346c9b5564deb5c6acf59d5589635de4`

## Open non-blocking issue

### BUG-QA-004 — Three environment blur requests more samples than supported

- Severity: **MINOR**
- Owner: Three Engine
- Status: `OPEN_NON_BLOCKING`
- Reproduction: load the real WebGL DIY scene in headed Chromium.
- Actual: console warns that `sigmaRadians 0.12` requests 59 samples while the maximum is 20; rendering continues with clipping.
- Expected: environment configuration stays within renderer limits without warnings.
- Impact: no observed functional, performance-gate, or visual failure. Final desktop and mobile scenes rendered with 3 draw calls.
- Evidence: raw console log in the ignored local Playwright evidence and screenshots in `output/playwright/qa-rerun/`.

## Closed and independently verified

### BUG-QA-001 — Fresh frozen install omitted Prisma Client generation

- Former severity: **BLOCKER**
- Status: `CLOSED_VERIFIED`
- Fix baseline: final `main` includes the workspace generation gate and Unicode-path follow-up.
- Closure evidence: a new detached worktree had no `packages/database/generated/client/client.ts`; `pnpm install --frozen-lockfile` ran `pnpm db:generate` and created it; `pnpm build --force` and `pnpm validate --force` then passed unaided.
- Note: Prisma 7 generates TypeScript (`client.ts`), so the earlier `client.js` existence probe was corrected for the final verification.

### BUG-QA-002 — Compiled Backend could not start with workspace package runtime

- Former severity: **BLOCKER**
- Status: `CLOSED_VERIFIED`
- Fix baseline: final `main` bundles a runnable `apps/backend/dist/index.js` and provides an artifact smoke check.
- Closure evidence: `smoke:start` reported `artifact=dist/index.js`, health `ok`, and clean shutdown. The same compiled bundle then started on port 4402, connected to a fresh migrated/seeded PostgreSQL database, served health, Generate/Get/Update/Save/Order, and shut down on signal.

### BUG-QA-003 — Legal exclusion collapsed two recommendations into the same bracelet

- Former severity: **MAJOR — core-flow blocking**
- Status: `CLOSED_VERIFIED`
- Fix baseline: final `main` keeps recommendations distinct under a sparse allowed catalog.
- Closure scenario: quiet, mist blue, eastern contemporary, entry budget, 155 mm wrist, landscape inspiration, consent enabled, and `海蓝宝` excluded.
- Closure evidence: three HTTP 200 persisted designs contained no aquamarine and their ordered `beadProductId@diameterMm` sequences had set size 3. Totals were Rain `10800`, Moonlit `10800`, and Silver `10200`; their production rhythms were also pairwise distinct.
- Evidence: `output/playwright/qa-rerun/desktop-final-distinct-results.png` plus owner-scoped live GET bodies inspected during the rerun.

## Release defect summary

- Open BLOCKER: 0
- Open CRITICAL: 0
- Open core-flow MAJOR: 0
- Open MINOR: 1 (`BUG-QA-004`, non-blocking)

The remaining warning does not prevent release admission under the documented gate.
