# Design Detail Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With the accepted `TASK-FE-STAR-001` and `TASK-FE-STAR-003` results combined, make the `/design/[id]` selected-design region show design identity, authoritative price, wear/fit, privacy and compliance, the current revision and save state, and the order state as real, scannable, text-bearing content — without a second renderer, without a new Backend API, and without inventing a state the reads cannot prove.

**Architecture:** One route (`/design/[id]`) renders one client component (`DesignResults`) that already owns the AI comparison grid and the sticky selection bar. This plan adds a single composed read seam (`loadDesignDetailReads`) behind that component, two pure state derivations (`deriveDesignSaveState`, `deriveDesignOrderState`) over the existing `listDesigns()`/`listOrders()` owner-scoped lists plus the existing durable local record reader `loadCompletedOrder(designId, revision)`, and one hook-free `DesignDetailPanel` that composes the canonical `DesignSummary`, `WearFitSummary` and `ComplianceNotice` with a `@mystcrag/ui` `StatusPanel` pair. Server reads stay authoritative; a read that cannot prove a state renders an explicit unknown, never a guess. No mutation entry point is added to this region: saving and completion stay the single authority of `DiyEditor`, and the region only hands off the authoritative `designId`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Tailwind CSS 4 utilities over `--star-*` tokens, `@mystcrag/design-contract` frozen `PublicDesignV1`/order DTOs, `@mystcrag/bracelet-engine` through `apps/frontend/src/features/design/model/bracelet-fit.ts`, `@mystcrag/ui` `StatusPanel`, Node built-in test runner with `tsx --test` and `renderToStaticMarkup`.

**Spec:** `docs/superpowers/specs/2026-09-26-star-oracle-crystal-design.md`, `docs/UI_DESIGN_SYSTEM.md` (AI result selection contract, viewport density contract), `docs/INTERACTION_TEST_PLAN.md` (state invariants 4/5/9/10, INT-P0-012/013/014, INT-P1-002/003/004/005/008), `docs/API_SPECIFICATION.md` (Design Save API, Order API, `GET /api/orders` limit of 100, `ListMyDesignsResponse` limit of 200), `docs/governance/CANONICAL_COMPONENTS.md`, `docs/governance/FEATURE_REGISTRY.md` (`FEAT-003`, `FEAT-009`, `FEAT-012`), `docs/tasks/TASK_REGISTRY.md` row `TASK-FE-STAR-004`.

## Global Constraints

- Registered task: `TASK-FE-STAR-004`, owner `Qoder CN / Qwen3.8-Flash`, branch `task/fe-star-004-design-detail-integration`, worktree `.codex/worktrees/fe-star-004-design-detail/玄矶水晶DIY设计网页端`, starting point `eeb49c3` (accepted `TASK-FE-STAR-001`).
- Writable paths are exactly the registry row's set: `docs/tasks/TASK_REGISTRY.md`, this plan, `apps/frontend/app/design/[id]/page.tsx`, `apps/frontend/src/features/design/components/design-results.tsx`, `apps/frontend/src/features/design/components/design-summary.tsx`, `apps/frontend/src/features/design/components/wear-fit-summary.tsx`, `apps/frontend/src/features/design/components/compliance-notice.tsx`, `apps/frontend/src/lib/api/design-api.ts`, `apps/frontend/src/lib/api/design-session.ts`, `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`, `apps/frontend/src/features/design/star-content-contract.test.tsx`, and the new `apps/frontend/src/features/design/design-detail-integration.test.tsx`.
- Forbidden: Backend, Prisma, `packages/**` (including every Design Contract DTO), root config, `pnpm-lock.yaml` and any `package.json`, `apps/frontend/next-env.d.ts`, other task rows, generated output, new Backend APIs, push, deploy, `main` merge. `next build` rewrites `apps/frontend/next-env.d.ts`; restore it byte-for-byte after every build (SHA-256 `7b550dda…12651`) and never stage it.
- Combine `TASK-FE-STAR-003` first. Its accepted implementation-gate chain is `a31f017` → `528ede0` → `5163931` → `12a663a`, and that task is still `REVIEW`. At the bare starting point `eeb49c3` the merge was conflict-free, but this task's own registry row now sits next to the `TASK-FE-STAR-003` row: at registration commit `b62fd01`, `git merge-tree --write-tree HEAD 12a663a` reports exactly one conflicted path, `docs/tasks/TASK_REGISTRY.md`, and all twelve runtime, model, test and stylesheet paths merge cleanly. Resolve that single conflict by keeping the `TASK-FE-STAR-001` `DONE` row verbatim, keeping the newest `TASK-FE-STAR-003` `REVIEW` evidence row verbatim, and keeping the `TASK-FE-STAR-004` row. Never restate, shorten or reorder another task's evidence, and never accept `--ours`/`--theirs` wholesale on this file.
- Reuse, do not fork. `DesignSummary` is the canonical identity/privacy renderer, `WearFitSummary` the sole measurement-label owner, `ComplianceNotice` the sole compliance renderer, `StatusPanel` the canonical status surface, `BraceletPreview` the compact view. A new identity block, fit block, compliance block, or status shell is a plan violation.
- `wear-fit-summary.tsx` and `compliance-notice.tsx` are writable but are expected to stay unchanged. Touch them only if a real RED proves a gap, and record that RED in the acceptance note.
- Never fabricate a state. A design list read that failed, a mock-mode list that is empty by design, or an order list that hit its documented cap must render as an explicit unknown. `docs/INTERACTION_TEST_PLAN.md` state invariant 4 (`Frontend code never invents a successful revision, price, save time, or order`) governs every assertion in this plan.
- `expectedRevision` stays threaded from the authoritative loaded design revision. This region adds no save or completion mutation, so it adds no new revision source; Task 8 pins that the existing mutation builders keep deriving it and that the region performs no mutation at all.
- Star platform visual rules hold: opaque `--star-*` surfaces only, no `backdrop-blur`, no `backdrop-filter: blur`, no violet AI gradients, no tinting of photographic crystal imagery, no `zoom`, no body transform, every interactive floor 44×44 (`min-height: 2.75rem` / `h-11 w-11`), `prefers-reduced-motion` respected.
- Copy rules: no medical, efficacy, guaranteed-wealth, guaranteed-fortune or deterministic-fortune claims (banned vocabulary includes `转运`, `招财`, `发财`, `保平安`, `辟邪`, `开光`, `加持`, `治愈`, `疗愈`, `命定`, `注定`, `一定`, `必定`, `大师`, `功效`, `疗效`), no em-dash filler (`—`, `——`), status always carried by text as well as any colour or `data-*` mark.
- Every commit stages only the exact `Files` paths of the task being completed. Run the narrowest relevant check while developing; run the Task 9 handoff gate before moving the registry row to `REVIEW`.

## Review Focus

- Truthfulness over completeness. Tasks 3, 4 and 7 own this check: every unreadable, capped or mock-shortcut input must render an explicit unknown, and no assertion may accept a saved or ordered label in those branches. `docs/INTERACTION_TEST_PLAN.md` state invariant 4 is the standard being applied, so a reviewer should try to make the region claim `设计库确认` or `已下单` from an empty or failed read.
- Single authority for each concern. Tasks 2, 6 and 7 own this check: `DesignSummary` stays the only identity and privacy renderer, `WearFitSummary` the only measurement-label owner (Task 7 asserts `腕围`, `目标内周长` and `结构余量` never appear in `design-results.tsx`), `ComplianceNotice` the only compliance renderer, and `StatusPanel` the only status shell. A duplicated `<dl>` of measurements or a hand-rolled status box in the region is a finding.
- Revision honesty. Task 8 owns this check. The reviewer should confirm the temporary mutation in Step 4 really turned the guard red, and that `design-api.ts` is byte-clean in the final tree.
- Combination losslessness. Task 1 owns this check: the merged tree must contain every `TASK-FE-STAR-003` path unchanged in intent, the `TASK-FE-STAR-001` `DONE` row untouched, and no other task row rewritten.
- Route behavior preserved. Task 5 owns the riskiest refactor of this plan (replacing two states with one reads state). Review the comparison grid, budget status, over-budget acknowledgement, default selection, sticky hand-off and the `UNAUTHORIZED`/`NETWORK_ERROR` notice path against the pre-refactor behavior; the `frontend-ai-flow` suite is the guard, and a reviewer should confirm none of its assertions were weakened.
- Visual contract. Task 7 owns the opaque-surface, no-frosted-glass and banned-copy checks for the new region. Note that `apps/frontend/app/styles/star-content.css` is not writable here, so all new styling must be Tailwind utilities over existing `--star-*` tokens; a reviewer should reject any plan deviation that edits that stylesheet.
- Scope honesty at handoff. `wear-fit-summary.tsx`, `compliance-notice.tsx`, `design-api.ts`, `design-session.ts` and `app/design/[id]/page.tsx` are expected to be unchanged. Any diff in them requires the RED that forced it, recorded in the acceptance note.

## File Structure

| File | Responsibility after this plan |
| --- | --- |
| `apps/frontend/src/features/design/components/design-summary.tsx` | Canonical identity and privacy block: name, story, `designId`, source mode, current revision, updated time, visibility. Exports `formatDesignUtcMinute`. |
| `apps/frontend/src/features/design/components/design-results.tsx` | Route composition. Adds the pure detail-read types, `loadDesignDetailReads`, `deriveDesignSaveState`, `deriveDesignOrderState`, the label/tone helpers, and the hook-free `DesignDetailPanel`. Keeps the comparison grid, budget status and sticky hand-off. |
| `apps/frontend/src/features/design/design-detail-integration.test.tsx` | New focused suite: identity rendering, save/order derivations, read composition, panel mounting, mutation threading contract. |
| `apps/frontend/src/features/design/star-content-contract.test.tsx` | `TASK-FE-STAR-003` suite, extended with the design-detail region under the content grammar bans. |
| `apps/frontend/src/features/design/frontend-ai-flow.test.tsx` | Existing star contracts for the results surface; extended only where the sticky bar loses the duplicated compliance block. |
| `apps/frontend/app/design/[id]/page.tsx` | Unchanged beyond the `TASK-FE-STAR-003` `data-star-surface="content"` wrapper; listed as writable only if the region needs a stable route hook. |
| `apps/frontend/src/lib/api/design-api.ts`, `apps/frontend/src/lib/api/design-session.ts` | Read-only sources for this region. Expected unchanged; Task 8 temporarily edits `design-api.ts` only to prove a guard has teeth and reverts it in the same task. |

---

### Task 1: Combine the accepted FE-STAR-003 candidate

**Governance task:** `TASK-FE-STAR-004`, branch `task/fe-star-004-design-detail-integration`

**Files:**
- Resolve: `docs/tasks/TASK_REGISTRY.md` (the one conflicted path; the `TASK-FE-STAR-004` row already exists and must survive)
- Merge input: `task/fe-star-003-content-account-pages` at `12a663a`

- [ ] **Step 1: Confirm the starting point and the dependency chain**

```bash
git log --oneline -3
git merge-base --is-ancestor eeb49c3 HEAD && echo "FE-STAR-001 baseline is an ancestor"
git log --oneline eeb49c3..12a663a
```

Expected: HEAD is `b62fd01 docs(tasks): register FE-STAR-004 design detail integration plan` with parent `eeb49c3 docs(tasks): accept star platform guided flows rework`; the ancestor check prints `FE-STAR-001 baseline is an ancestor`; the chain lists exactly `a31f017`, `528ede0`, `5163931`, `12a663a`.

- [ ] **Step 2: Confirm the expected conflict surface before touching the worktree**

```bash
git merge-tree --write-tree HEAD 12a663a
git merge-base HEAD 12a663a
```

Expected: exit status 1 with exactly one conflicted path, `docs/tasks/TASK_REGISTRY.md`, listed in all three stages (base `65e32b2…`, ours `4c9f645…`, theirs `5bb1311…`). `git merge-base` prints `edbf56072b0785bbf1afaed4e16da95e6c840b88`, an ancestor of HEAD, so the merge only adds `TASK-FE-STAR-003` work. No other path conflicts: this task's registry row sits two lines from the `TASK-FE-STAR-003` row, so the row block is the single overlap.

- [ ] **Step 3: Merge and resolve the registry row block**

```bash
git merge --no-ff 12a663a -m "chore(task): combine accepted FE-STAR-003 candidate for FE-STAR-004"
```

Expected: `Auto-merging docs/tasks/TASK_REGISTRY.md` then `CONFLICT (content)`, and every other path merges silently. Resolve only the row block so all four `TASK-FE-STAR-00x` rows survive, taking the `TASK-FE-STAR-001` `DONE` row and the new `TASK-FE-STAR-004` row from ours and the `TASK-FE-STAR-003` `REVIEW` row from theirs. Never accept `--ours` or `--theirs` for the whole file, and never retype another row's evidence. Verify mechanically before staging:

```bash
grep -c "^<<<<<<<\|^=======\|^>>>>>>>" docs/tasks/TASK_REGISTRY.md
grep -c "^| TASK-FE-STAR-00" docs/tasks/TASK_REGISTRY.md
grep -c "^| TASK-FE-STAR-003 | Qoder CN / Qwen3.8-Flash (round-2 handoff from the expired MiMo session)" docs/tasks/TASK_REGISTRY.md
grep -c "^| TASK-FE-STAR-001 | Qoder CN / Qwen3.8-Flash | \`task/fe-star-001-guided-flows\` | DONE" docs/tasks/TASK_REGISTRY.md
grep -c "^| TASK-FE-STAR-004 | Qoder CN / Qwen3.8-Flash | \`task/fe-star-004-design-detail-integration\` | IN_PROGRESS" docs/tasks/TASK_REGISTRY.md
```

Expected: `0`, `4`, `1`, `1`, `1`. Then:

```bash
git add docs/tasks/TASK_REGISTRY.md
git commit --no-edit
```

- [ ] **Step 4: Verify the combination is lossless**

```bash
git diff --name-only eeb49c3..HEAD | sort
git diff --name-only 12a663a..HEAD | grep -E "gallery|profile|library|star-content" || echo "FE-STAR-003 paths preserved"
git status --short
```

Expected: the first command lists 14 paths, the 13 changed by `TASK-FE-STAR-003` (including `docs/tasks/TASK_REGISTRY.md`) plus this plan file, and nothing else. The second prints `FE-STAR-003 paths preserved`, proving the resolution did not drop any of that task's files. The third is empty.

- [ ] **Step 5: Run the combined baseline gate**

```bash
cd apps/frontend && npx tsx --test "src/features/design/star-content-contract.test.tsx" "src/features/design/frontend-ai-flow.test.tsx" && npx tsc --noEmit
cd /Users/chenyanyan/.codex/worktrees/fe-star-004-design-detail/玄矶水晶DIY设计网页端 && node --test tests/architecture.test.mjs
```

Expected: both suites fully pass with zero failures, typecheck exit 0, architecture `23/23 pass`. `frontend-ai-flow.test.tsx` holds 41 tests at `eeb49c3`; record the observed `star-content-contract` count from this run rather than assuming it, because it arrives with the `TASK-FE-STAR-003` merge. Record the merge SHA; every later task builds on it.

- [ ] **Step 6: Confirm the worktree is clean and nothing was staged from the pre-existing local files**

```bash
git status --short
```

Expected: no output. Never `git add -A`; the merge commit already contains everything.

---

### Task 2: Make DesignSummary carry design identity and privacy facts

**Files:**
- Modify: `apps/frontend/src/features/design/components/design-summary.tsx`
- Test: `apps/frontend/src/features/design/design-detail-integration.test.tsx` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/features/design/design-detail-integration.test.tsx`:

```tsx
import assert from "node:assert/strict";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { DesignSummary, formatDesignUtcMinute } from "./components/design-summary";
import { mockPublicDesign } from "./fixtures/mock-public-design";

test("design summary exposes identity, revision, source and update time as text", () => {
  const markup = renderToStaticMarkup(<DesignSummary design={mockPublicDesign} />);

  assert.match(markup, /Rain After Blue/);
  assert.match(markup, /design-ai-standard/);
  assert.match(markup, /AI 生成/);
  assert.match(markup, /v1/);
  assert.match(markup, /2026-07-21 06:05 UTC/);
  assert.match(markup, /data-design-summary-facts="true"/);
});

test("design summary reports privacy visibility as text and never implies a public design", () => {
  const markup = renderToStaticMarkup(<DesignSummary design={mockPublicDesign} />);

  assert.match(markup, /Private（仅自己可见）/);
  assert.doesNotMatch(markup, /Public|Unlisted|Published/);
});

test("update time formats in UTC without a local timezone leak", () => {
  assert.equal(formatDesignUtcMinute("2026-07-21T06:05:00.000Z"), "2026-07-21 06:05 UTC");
  assert.equal(formatDesignUtcMinute("2026-12-31T23:59:59.999Z"), "2026-12-31 23:59 UTC");
  assert.equal(formatDesignUtcMinute("not-a-date"), "时间不可确认");
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx
```

Expected: FAIL at load time with `SyntaxError: The requested module './components/design-summary' does not provide an export named 'formatDesignUtcMinute'`. That single failure is the RED for all three tests; the identity fields do not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Replace `apps/frontend/src/features/design/components/design-summary.tsx` entirely:

```tsx
import type { CommunityV1, DesignMode, PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";

const designModeLabels: Record<DesignMode, string> = {
  AI_GENERATED: "AI 生成",
  DIY_CREATED: "DIY 创作",
  AI_ASSISTED: "AI 辅助",
  TEMPLATE_REMIX: "模板改写",
  TAROT_GUIDED: "塔罗灵感",
  ORACLE_GUIDED: "星台问卦"
};

// `Visibility` has no standalone type export in Design Contract; the community
// projection carries the only authoritative union.
const visibilityLabels: Record<CommunityV1["visibility"], string> = {
  PRIVATE: "Private（仅自己可见）",
  UNLISTED: "Unlisted（凭链接可见）",
  PUBLIC: "Public（已进入列表）"
};

export function formatDesignUtcMinute(isoDateTime: string): string {
  const parsed = new Date(isoDateTime);
  if (Number.isNaN(parsed.getTime())) return "时间不可确认";
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}` +
    ` ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())} UTC`
  );
}

export function DesignSummary({ design }: { design: PublicDesignV1 }) {
  const facts = [
    { label: "设计编号", value: design.designId },
    { label: "来源", value: designModeLabels[design.designMode] },
    { label: "当前版本", value: `v${design.revision}` },
    { label: "更新时间", value: formatDesignUtcMinute(design.updatedAt) },
    { label: "可见性", value: visibilityLabels[design.community.visibility] }
  ];

  return (
    <section aria-labelledby="design-summary-heading" data-star-design-summary="true">
      <h2 id="design-summary-heading">{design.designName}</h2>
      <p>{design.story.designStory}</p>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-design-summary-facts="true">
        {facts.map((fact) => (
          <div className="flex items-baseline justify-between gap-3" data-design-summary-fact={fact.label} key={fact.label}>
            <dt className="text-xs text-[var(--muted)]">{fact.label}</dt>
            <dd className="break-all text-right text-sm text-[var(--foreground)]" data-status-mark="true">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx
```

Expected: PASS, 3/3.

- [ ] **Step 5: Run the non-writable consumer contracts**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-contract-consumer.test.tsx src/features/design/frontend-ai-flow.test.tsx
```

Expected: PASS. `design-contract-consumer.test.tsx` pins `Rain After Blue`, `Private` and the absence of `Published`; `frontend-ai-flow.test.tsx` pins `data-star-design-summary`, the disclaimer vocabulary ban and the em-dash ban in this file's source.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/features/design/components/design-summary.tsx apps/frontend/src/features/design/design-detail-integration.test.tsx
git commit -m "feat(design): expose identity and privacy facts in design summary"
```

---

### Task 3: Derive the authoritative save state without inventing it

**Files:**
- Modify: `apps/frontend/src/features/design/components/design-results.tsx`
- Test: `apps/frontend/src/features/design/design-detail-integration.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `apps/frontend/src/features/design/design-detail-integration.test.tsx`, extending the existing `./components/design-results` import with `deriveDesignSaveState` and `type DesignDetailReads`, and adding `import type { PublicDesignV1 } from "@mystcrag/design-contract";`:

```tsx
import { deriveDesignSaveState, type DesignDetailReads } from "./components/design-results";
import type { PublicDesignV1 } from "@mystcrag/design-contract";

function readsWith(overrides: Partial<DesignDetailReads> = {}): DesignDetailReads {
  return {
    designs: [],
    budget: null,
    savedDesigns: [],
    orders: [],
    savedDesignsRead: "OK",
    ordersRead: "OK",
    ...overrides
  };
}

function savedEntry(design: PublicDesignV1, status: "DRAFT" | "GENERATED" | "SAVED" | "ARCHIVED", revision = design.revision) {
  return { status, design: { designId: design.designId, revision } };
}

test("save state reports the design library status for the current revision", () => {
  const state = deriveDesignSaveState(mockPublicDesign, readsWith({ savedDesigns: [savedEntry(mockPublicDesign, "SAVED")] }));

  assert.deepEqual(state, { kind: "CONFIRMED", status: "SAVED", serverRevision: 1 });
});

test("save state reports an unsaved recommendation instead of a false saved label", () => {
  assert.deepEqual(deriveDesignSaveState(mockPublicDesign, readsWith()), { kind: "NOT_SAVED" });
});

test("save state distinguishes a newer library revision from the page revision", () => {
  const state = deriveDesignSaveState(mockPublicDesign, readsWith({ savedDesigns: [savedEntry(mockPublicDesign, "SAVED", 4)] }));

  assert.deepEqual(state, { kind: "STALE_VIEW", status: "SAVED", serverRevision: 4 });
});

test("save state stays unknown when the library read failed or mock mode is active", () => {
  assert.deepEqual(deriveDesignSaveState(mockPublicDesign, readsWith({ savedDesignsRead: "FAILED" })), { kind: "UNKNOWN", reason: "FAILED" });
  assert.deepEqual(deriveDesignSaveState(mockPublicDesign, readsWith({ savedDesignsRead: "MOCK", savedDesigns: [] })), { kind: "UNKNOWN", reason: "MOCK" });
});

test("save state refuses to claim unsaved when the library list hit its 200 entry cap", () => {
  const capped = Array.from({ length: 200 }, (_, index) => ({
    status: "SAVED" as const,
    design: { designId: `other-${index}`, revision: 1 }
  }));

  assert.deepEqual(deriveDesignSaveState(mockPublicDesign, readsWith({ savedDesigns: capped })), { kind: "UNKNOWN", reason: "LIMIT" });
});
```

`savedEntry` keeps the helper honest for the matching cases; the cap case builds foreign ids so `find` really misses.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx
```

Expected: FAIL at load with `does not provide an export named 'deriveDesignSaveState'`.

- [ ] **Step 3: Write the minimal implementation**

In `apps/frontend/src/features/design/components/design-results.tsx`, extend the existing `@mystcrag/design-contract` type import to `DesignPersistenceStatus`, `OrderSummaryStatus` and `PublicDesignV1`, then add below the existing `BudgetStatus` block:

```tsx
export type DetailReadStatus = "OK" | "FAILED" | "MOCK";

export type SavedDesignEntry = {
  status: DesignPersistenceStatus;
  design: { designId: string; revision: number };
};

export type OrderSummaryEntry = {
  orderId: string;
  status: OrderSummaryStatus;
  createdAt: string;
  design: { designId: string; revision: number };
};

export type DesignDetailReads = {
  designs: PublicDesignV1[];
  budget: DesignBudgetContext | null;
  savedDesigns: SavedDesignEntry[];
  orders: OrderSummaryEntry[];
  savedDesignsRead: DetailReadStatus;
  ordersRead: DetailReadStatus;
};

export type DesignSaveState =
  | { kind: "CONFIRMED"; status: DesignPersistenceStatus; serverRevision: number }
  | { kind: "STALE_VIEW"; status: DesignPersistenceStatus; serverRevision: number }
  | { kind: "NOT_SAVED" }
  | { kind: "UNKNOWN"; reason: "FAILED" | "MOCK" | "LIMIT" };

export const DESIGN_LIST_LIMIT = 200;

function unknownDetailReadReason(status: Exclude<DetailReadStatus, "OK">): "FAILED" | "MOCK" {
  return status === "MOCK" ? "MOCK" : "FAILED";
}

export function deriveDesignSaveState(design: PublicDesignV1, reads: DesignDetailReads): DesignSaveState {
  if (reads.savedDesignsRead !== "OK") {
    return { kind: "UNKNOWN", reason: unknownDetailReadReason(reads.savedDesignsRead) };
  }
  const entry = reads.savedDesigns.find((item) => item.design.designId === design.designId);
  if (!entry) {
    if (reads.savedDesigns.length >= DESIGN_LIST_LIMIT) return { kind: "UNKNOWN", reason: "LIMIT" };
    return { kind: "NOT_SAVED" };
  }
  if (entry.design.revision === design.revision) {
    return { kind: "CONFIRMED", status: entry.status, serverRevision: entry.design.revision };
  }
  return { kind: "STALE_VIEW", status: entry.status, serverRevision: entry.design.revision };
}

const persistenceLabels: Record<DesignPersistenceStatus, string> = {
  DRAFT: "草稿",
  GENERATED: "刚生成",
  SAVED: "已保存",
  ARCHIVED: "已归档"
};

export function designSaveStateLabel(state: DesignSaveState): string {
  if (state.kind === "CONFIRMED") {
    return `设计库确认：${persistenceLabels[state.status]} · v${state.serverRevision}`;
  }
  if (state.kind === "STALE_VIEW") {
    return `本页版本落后于设计库：设计库为 v${state.serverRevision}（${persistenceLabels[state.status]}）`;
  }
  if (state.kind === "NOT_SAVED") return "尚未保存到设计库";
  if (state.reason === "MOCK") return "本地演示模式，不读取设计库状态";
  if (state.reason === "LIMIT") return "设计库列表只返回最近 200 条，无法确认";
  return "暂时无法确认保存状态";
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx
```

Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/design/components/design-results.tsx apps/frontend/src/features/design/design-detail-integration.test.tsx
git commit -m "feat(design): derive the authoritative design save state"
```

---

### Task 4: Derive order state from listOrders plus the durable local record

**Files:**
- Modify: `apps/frontend/src/features/design/components/design-results.tsx`
- Test: `apps/frontend/src/features/design/design-detail-integration.test.tsx`

- [ ] **Step 1: Write the failing test**

Append, extending the `./components/design-results` import with `deriveDesignOrderState` and adding the `LocalOrderRecord` type import:

```tsx
test("order state reports the current revision order with its server status", () => {
  const state = deriveDesignOrderState(mockPublicDesign, readsWith({
    orders: [{ orderId: "order-9", status: "IN_PRODUCTION", createdAt: "2026-07-22T01:00:00.000Z", design: { designId: "design-ai-standard", revision: 1 } }]
  }));

  assert.deepEqual(state, {
    kind: "ORDERED",
    orderId: "order-9",
    status: "IN_PRODUCTION",
    orderedRevision: 1,
    createdAt: "2026-07-22T01:00:00.000Z",
    source: "SERVER"
  });
});

test("order state keeps an older revision order separate from the current revision", () => {
  const state = deriveDesignOrderState(mockPublicDesign, readsWith({
    orders: [
      { orderId: "order-2", status: "COMPLETED", createdAt: "2026-07-20T01:00:00.000Z", design: { designId: "design-ai-standard", revision: 1 } },
      { orderId: "order-7", status: "CONFIRMED", createdAt: "2026-07-21T01:00:00.000Z", design: { designId: "design-ai-standard", revision: 1 } }
    ]
  }));

  assert.equal(state.kind, "ORDERED");
  assert.equal(state.orderedRevision, 1);
  assert.equal(state.orderId, "order-7");
  assert.equal(designOrderStateLabel(state, 3), "v1 已下单（已确认），当前 v3 未下单");
});

test("order state falls back to the durable local record keyed by the current revision", () => {
  const local: LocalOrderRecord = {
    orderId: "order-local-1",
    orderStatus: "PENDING",
    createdAt: "2026-07-21T07:00:00.000Z",
    design: { designId: "design-ai-standard", revision: 1 }
  };
  const state = deriveDesignOrderState(mockPublicDesign, readsWith(), () => local);

  assert.equal(state.kind, "ORDERED");
  assert.equal(state.source, "LOCAL");
  assert.equal(designOrderStateLabel(state, 1), "本机已记录该版本下单（待确认），等待设计库列表确认");
});

test("order state never claims a local order for a different revision", () => {
  const seen: Array<[string, number]> = [];
  const state = deriveDesignOrderState(mockPublicDesign, readsWith(), (designId, revision) => {
    seen.push([designId, revision]);
    return null;
  });

  assert.deepEqual(state, { kind: "NOT_ORDERED" });
  assert.deepEqual(seen, [["design-ai-standard", 1]]);
});

test("order state stays unknown on read failure, mock mode, and the 100 entry cap", () => {
  assert.deepEqual(deriveDesignOrderState(mockPublicDesign, readsWith({ ordersRead: "FAILED" }), () => null), { kind: "UNKNOWN", reason: "FAILED" });
  assert.deepEqual(deriveDesignOrderState(mockPublicDesign, readsWith({ ordersRead: "MOCK" }), () => null), { kind: "UNKNOWN", reason: "MOCK" });
  const capped = Array.from({ length: 100 }, (_, index) => ({
    orderId: `order-${index}`,
    status: "COMPLETED" as const,
    createdAt: "2026-07-20T01:00:00.000Z",
    design: { designId: `other-${index}`, revision: 1 }
  }));
  assert.deepEqual(deriveDesignOrderState(mockPublicDesign, readsWith({ orders: capped }), () => null), { kind: "UNKNOWN", reason: "LIMIT" });
});
```

Also add `designOrderStateLabel` to the `./components/design-results` import list.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx
```

Expected: FAIL at load with `does not provide an export named 'deriveDesignOrderState'`.

- [ ] **Step 3: Write the minimal implementation**

Add below `deriveDesignSaveState` in `apps/frontend/src/features/design/components/design-results.tsx`, and add `loadCompletedOrder` to the existing `../../../lib/api/design-session` import:

```tsx
export const ORDER_LIST_LIMIT = 100;

export type LocalOrderRecord = {
  orderId: string;
  orderStatus: OrderSummaryStatus;
  createdAt: string;
  design: { designId: string; revision: number };
};

export type DesignOrderState =
  | { kind: "ORDERED"; orderId: string; status: OrderSummaryStatus; orderedRevision: number; createdAt: string; source: "SERVER" | "LOCAL" }
  | { kind: "NOT_ORDERED" }
  | { kind: "UNKNOWN"; reason: "FAILED" | "MOCK" | "LIMIT" };

export function deriveDesignOrderState(
  design: PublicDesignV1,
  reads: DesignDetailReads,
  readLocalOrder: (designId: string, revision: number) => LocalOrderRecord | null = loadCompletedOrder
): DesignOrderState {
  if (reads.ordersRead === "MOCK") return { kind: "UNKNOWN", reason: "MOCK" };

  const match = reads.orders
    .filter((order) => order.design.designId === design.designId)
    .sort((left, right) => right.design.revision - left.design.revision)[0];
  if (match) {
    return {
      kind: "ORDERED",
      orderId: match.orderId,
      status: match.status,
      orderedRevision: match.design.revision,
      createdAt: match.createdAt,
      source: "SERVER"
    };
  }

  const local = readLocalOrder(design.designId, design.revision);
  if (local) {
    return {
      kind: "ORDERED",
      orderId: local.orderId,
      status: local.orderStatus,
      orderedRevision: local.design.revision,
      createdAt: local.createdAt,
      source: "LOCAL"
    };
  }

  if (reads.ordersRead === "FAILED") return { kind: "UNKNOWN", reason: "FAILED" };
  if (reads.orders.length >= ORDER_LIST_LIMIT) return { kind: "UNKNOWN", reason: "LIMIT" };
  return { kind: "NOT_ORDERED" };
}

const orderStatusLabels: Record<OrderSummaryStatus, string> = {
  PENDING: "待确认",
  AWAITING_RESTOCK: "等待补货",
  CONFIRMED: "已确认",
  IN_PRODUCTION: "制作中",
  SHIPPED: "已发货",
  COMPLETED: "已完成",
  CANCELLED: "已取消"
};

export function designOrderStateLabel(state: DesignOrderState, currentRevision: number): string {
  if (state.kind === "ORDERED") {
    if (state.orderedRevision !== currentRevision) {
      return `v${state.orderedRevision} 已下单（${orderStatusLabels[state.status]}），当前 v${currentRevision} 未下单`;
    }
    if (state.source === "LOCAL") {
      return `本机已记录该版本下单（${orderStatusLabels[state.status]}），等待设计库列表确认`;
    }
    return `已下单（${orderStatusLabels[state.status]}）`;
  }
  if (state.kind === "NOT_ORDERED") return "当前版本未下单";
  if (state.reason === "MOCK") return "本地演示模式，不读取订单状态";
  if (state.reason === "LIMIT") return "最近 100 笔订单中未找到，无法确认下单状态";
  return "暂时无法确认下单状态";
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx
```

Expected: PASS, 13/13.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/design/components/design-results.tsx apps/frontend/src/features/design/design-detail-integration.test.tsx
git commit -m "feat(design): derive order state from the owner order list and local record"
```

---

### Task 5: Compose every detail read behind one testable seam

**Files:**
- Modify: `apps/frontend/src/features/design/components/design-results.tsx`
- Test: `apps/frontend/src/features/design/design-detail-integration.test.tsx`

- [ ] **Step 1: Write the failing test**

Append, extending the `./components/design-results` import with `loadDesignDetailReads` and `type DesignDetailReadApi`, and adding `mockDesignOptions`:

```tsx
import { mockDesignOptions } from "./fixtures/mock-design-options";

function fakeApi(overrides: Partial<DesignDetailReadApi> = {}) {
  const calls = { get: 0, listDesigns: 0, listOrders: 0 };
  const api: DesignDetailReadApi = {
    get: async (designId) => {
      calls.get += 1;
      const match = mockDesignOptions.find((design) => design.designId === designId);
      if (!match) throw new Error(`missing ${designId}`);
      return match;
    },
    listDesigns: async () => {
      calls.listDesigns += 1;
      return { designs: [{ design: mockPublicDesign, status: "SAVED", updatedAt: "2026-07-21T06:05:00.000Z" }] };
    },
    listOrders: async () => {
      calls.listOrders += 1;
      return { orders: [] };
    },
    ...overrides
  };
  return { api, calls };
}

test("detail reads load every option and report the library and order lists", async () => {
  const { api, calls } = fakeApi();
  const reads = await loadDesignDetailReads("rain-after-blue", api, {
    mockApiEnabled: false,
    optionIds: ["rain-after-blue", "mountain-violet"]
  });

  assert.equal(calls.get, 2);
  assert.equal(reads.designs.length, 2);
  assert.equal(reads.savedDesignsRead, "OK");
  assert.equal(reads.ordersRead, "OK");
  assert.equal(reads.savedDesigns[0]?.status, "SAVED");
});

test("a failed library or order list read degrades to unknown instead of throwing", async () => {
  const { api } = fakeApi({
    listDesigns: async () => {
      throw new Error("401");
    },
    listOrders: async () => {
      throw new Error("500");
    }
  });
  const reads = await loadDesignDetailReads("rain-after-blue", api, {
    mockApiEnabled: false,
    optionIds: ["rain-after-blue"]
  });

  assert.equal(reads.savedDesignsRead, "FAILED");
  assert.equal(reads.ordersRead, "FAILED");
  assert.deepEqual(reads.savedDesigns, []);
  assert.deepEqual(reads.orders, []);
});

test("a failed design read still rejects so the route keeps its canonical error notice", async () => {
  const { api } = fakeApi();

  await assert.rejects(() => loadDesignDetailReads("missing-design", api, {
    mockApiEnabled: false,
    optionIds: ["missing-design"]
  }));
});

test("mock mode reads no library or order list because an empty mock list proves nothing", async () => {
  const { api, calls } = fakeApi();
  const reads = await loadDesignDetailReads("rain-after-blue", api, {
    mockApiEnabled: true,
    optionIds: ["rain-after-blue"]
  });

  assert.equal(calls.listDesigns, 0);
  assert.equal(calls.listOrders, 0);
  assert.equal(reads.savedDesignsRead, "MOCK");
  assert.equal(reads.ordersRead, "MOCK");
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx
```

Expected: FAIL at load with `does not provide an export named 'loadDesignDetailReads'`.

- [ ] **Step 3: Write the seam**

Add to `apps/frontend/src/features/design/components/design-results.tsx`, extending the `@mystcrag/design-contract` specifier with `ListMyDesignsResponse` and `ListMyOrdersResponse`, adding `import { isMockApiEnabled } from "../../../lib/api/api-runtime";`, and extending the existing `../../../lib/api/design-session` import with `loadDesignBudgetContext` and `loadGeneratedDesignOptions` (both already present, so only the seam body is new):

```tsx
export type DesignDetailReadApi = {
  get: (designId: string) => Promise<PublicDesignV1>;
  listDesigns: () => Promise<ListMyDesignsResponse>;
  listOrders: () => Promise<ListMyOrdersResponse>;
};

export async function loadDesignDetailReads(
  designId: string,
  api: DesignDetailReadApi = designApi,
  options: { mockApiEnabled?: boolean; optionIds?: string[] } = {}
): Promise<DesignDetailReads> {
  const mockApiEnabled = options.mockApiEnabled ?? isMockApiEnabled;
  const optionIds = options.optionIds ?? loadGeneratedDesignOptions(designId);
  const designs = await Promise.all(optionIds.map((optionId) => api.get(optionId)));
  const budget = loadDesignBudgetContext(designId);

  if (mockApiEnabled) {
    return { designs, budget, savedDesigns: [], orders: [], savedDesignsRead: "MOCK", ordersRead: "MOCK" };
  }

  const [savedResult, ordersResult] = await Promise.allSettled([api.listDesigns(), api.listOrders()]);
  return {
    designs,
    budget,
    savedDesigns: savedResult.status === "fulfilled" ? savedResult.value.designs : [],
    orders: ordersResult.status === "fulfilled" ? ordersResult.value.orders : [],
    savedDesignsRead: savedResult.status === "fulfilled" ? "OK" : "FAILED",
    ordersRead: ordersResult.status === "fulfilled" ? "OK" : "FAILED"
  };
}
```

Add `import { designApi } from "../../../lib/api/design-api";` if the file only imports named members today; the current line already imports `designApi`, so no new specifier is needed.

- [ ] **Step 4: Run the focused test to verify it passes**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx
```

Expected: PASS, 17/17.

- [ ] **Step 5: Rewire the component onto the seam**

In `DesignResults`, replace the two states `designs` and `budget` with one reads state, and replace the effect body. The block from `const [designs, setDesigns]` through the closing of `useEffect` becomes:

```tsx
  const [reads, setReads] = useState<DesignDetailReads | null>(null);
  const [selectedDesignId, setSelectedDesignId] = useState("");
  const [acceptedOverBudgetIds, setAcceptedOverBudgetIds] = useState<string[]>([]);
  const [errorCode, setErrorCode] = useState<FrontendErrorCode | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void loadDesignDetailReads(designId).then((next) => {
      if (!active) return;
      setReads(next);
      setSelectedDesignId((current) =>
        next.designs.some((design) => design.designId === current) ? current : next.designs[0]?.designId ?? ""
      );
      setErrorCode(null);
    }).catch((error: unknown) => {
      if (active) setErrorCode(toFrontendApiError(error).code);
    });
    return () => { active = false; };
  }, [attempt, designId]);

  const designs = reads?.designs ?? [];
  const budget = reads?.budget ?? null;
```

Keep `selectedDesign`, `optionCountLabel` and every later block byte-for-byte.

- [ ] **Step 6: Run the behaviour-preserving suite**

```bash
cd apps/frontend && npx tsx --test src/features/design/frontend-ai-flow.test.tsx src/features/design/design-detail-integration.test.tsx && npx tsc --noEmit
```

Expected: PASS with 41/41 and 17/17, typecheck exit 0. The budget, selection, over-budget acceptance and `UNAUTHORIZED` notice behavior is unchanged.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/features/design/components/design-results.tsx apps/frontend/src/features/design/design-detail-integration.test.tsx
git commit -m "refactor(design): compose design detail reads behind one seam"
```

---

### Task 6: Mount identity, authoritative price, wear/fit, privacy and compliance

**Files:**
- Modify: `apps/frontend/src/features/design/components/design-results.tsx`
- Test: `apps/frontend/src/features/design/design-detail-integration.test.tsx`

- [ ] **Step 1: Write the failing test**

Append, adding `DesignDetailPanel` to the `./components/design-results` import:

```tsx
test("the design detail region mounts identity, price provenance, fit, privacy and compliance", () => {
  const markup = renderToStaticMarkup(<DesignDetailPanel design={mockPublicDesign} />);

  assert.match(markup, /data-design-detail-region="true"/);
  assert.match(markup, /Rain After Blue/);
  assert.match(markup, /design-ai-standard/);
  assert.match(markup, /Private（仅自己可见）/);
  assert.match(markup, /权威总价/);
  assert.match(markup, /¥55\.00/);
  assert.match(markup, /cny-retail-2026-07-v1/);
  assert.match(markup, /计算于 2026-07-21 06:05 UTC/);
  assert.match(markup, /data-wear-fit-summary="true"/);
  assert.match(markup, /腕围/);
  assert.match(markup, /data-compliance-status="PASSED"/);
  assert.match(markup, /文化意象仅作为设计灵感/);
});

test("the design detail region never duplicates a second fit, compliance or identity renderer", () => {
  const markup = renderToStaticMarkup(<DesignDetailPanel design={mockPublicDesign} />);

  assert.equal((markup.match(/data-wear-fit-summary="true"/g) ?? []).length, 1);
  assert.equal((markup.match(/data-compliance-status/g) ?? []).length, 1);
  assert.equal((markup.match(/data-star-design-summary="true"/g) ?? []).length, 1);
});

test("the design detail region renders no forbidden claim", () => {
  const markup = renderToStaticMarkup(<DesignDetailPanel design={mockPublicDesign} />);

  for (const banned of [/转运/, /招财/, /保平安/, /辟邪/, /治愈/, /疗愈/, /命定/, /注定/, /一定/, /必定/, /大师/, /功效/, /疗效/]) {
    assert.doesNotMatch(markup, banned, `visible copy must not claim ${String(banned.source)}`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx
```

Expected: FAIL at load with `does not provide an export named 'DesignDetailPanel'`.

- [ ] **Step 3: Write the panel**

Add these imports to `apps/frontend/src/features/design/components/design-results.tsx`: `DesignSummary` from `./design-summary`, `formatDesignUtcMinute` from `./design-summary`, `WearFitSummary` from `./wear-fit-summary`, `evaluateBraceletFit` from `../model/bracelet-fit`. `BraceletPreview` and `ComplianceNotice` are already imported. Add below the label helpers:

```tsx
export type DesignDetailPanelProps = {
  design: PublicDesignV1;
};

export function DesignDetailPanel({ design }: DesignDetailPanelProps) {
  return (
    <section
      aria-label="设计详情"
      className="mt-6 rounded-[1.5rem] border border-[var(--border)] bg-[var(--star-paper)] p-5"
      data-design-detail-region="true"
    >
      <DesignSummary design={design} />

      <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-t border-[var(--border)] pt-4">
        <p>
          <span className="block text-xs text-[var(--muted)]">权威总价</span>
          <strong className="mt-1 block font-serif text-2xl text-[var(--foreground)]">
            {formatMinorAmount({ amountMinor: design.pricing.totalPriceMinor, currency: design.currency, locale: design.locale })}
          </strong>
        </p>
        <p className="text-right text-xs text-[var(--muted)]" data-design-price-provenance="true" data-status-mark="true">
          价格版本 {design.pricing.pricingVersion}
          <br />
          计算于 {formatDesignUtcMinute(design.pricing.priceCalculatedAt)}
        </p>
      </div>

      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <WearFitSummary fit={evaluateBraceletFit(design)} />
      </div>

      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <ComplianceNotice design={design} />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Mount it and remove the duplicated compliance block**

In `DesignResults`, the sticky action bar currently renders `<ComplianceNotice design={selectedDesign} />`. Replace the whole `{selectedDesign ? ( ... ) : null}` block with a detail region plus the slimmed hand-off bar:

```tsx
      {selectedDesign ? (
        <DesignDetailPanel design={selectedDesign} />
      ) : null}

      {selectedDesign ? (
        <div className="sticky bottom-4 z-40 mt-5 flex flex-wrap items-center justify-between gap-4 rounded-[1.4rem] border border-[var(--border)] bg-[var(--star-paper)] p-4 shadow-[0_20px_60px_rgb(57_45_67/0.16)]" data-results-action-bar="true">
          <div>
            <p className="text-xs text-[var(--muted)]">当前选择</p>
            <div className="mt-1 flex items-baseline justify-between gap-3 lg:block">
              <strong className="block font-serif text-xl">{selectedDesign.designName}</strong>
              <span className="block text-sm text-[var(--success)]">{formatMinorAmount({ amountMinor: selectedDesign.pricing.totalPriceMinor, currency: selectedDesign.currency, locale: selectedDesign.locale })}</span>
            </div>
          </div>
          <Link className="inline-flex min-h-14 items-center justify-center rounded-xl bg-[var(--accent-deep)] px-7 text-center text-base font-medium text-white shadow-[0_12px_28px_rgb(73_53_95/0.24)] transition hover:-translate-y-0.5 hover:bg-[var(--accent)]" href={`/diy/${encodeURIComponent(selectedDesign.designId)}`}>进入 DIY 调整</Link>
        </div>
      ) : null}
```

The action bar tag keeps `bg-[var(--star-paper)]` and stays free of `bg-white/<alpha>` and `backdrop-blur`, which is exactly what the non-writable `frontend-ai-flow.test.tsx` opaque-bar contract asserts.

- [ ] **Step 5: Run the focused and star contracts**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx src/features/design/frontend-ai-flow.test.tsx src/features/design/design-contract-consumer.test.tsx
```

Expected: PASS, 20/20 in the new suite, 41/41 in `frontend-ai-flow`, `design-contract-consumer` green.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/features/design/components/design-results.tsx apps/frontend/src/features/design/design-detail-integration.test.tsx
git commit -m "feat(design): mount the selected design detail region on the results route"
```

---

### Task 7: Add the save and order status panels under content grammar

**Files:**
- Modify: `apps/frontend/src/features/design/components/design-results.tsx`
- Modify: `apps/frontend/src/features/design/star-content-contract.test.tsx`
- Test: `apps/frontend/src/features/design/design-detail-integration.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `design-detail-integration.test.tsx`. `DesignDetailPanel` gains a required `reads` prop in Step 3, so the three Task 6 render calls in this file also become `<DesignDetailPanel design={mockPublicDesign} reads={readsWith()} />` in this step. Those three calls stay green throughout because `tsx` ignores an unknown prop before Step 3 and the identity/price/fit assertions do not depend on it.

```tsx
test("the save status panel states the library confirmation as text", () => {
  const markup = renderToStaticMarkup(
    <DesignDetailPanel design={mockPublicDesign} reads={readsWith({ savedDesigns: [savedEntry(mockPublicDesign, "SAVED")] })} />
  );

  assert.match(markup, /data-design-save-state="CONFIRMED"/);
  assert.match(markup, /设计库确认：已保存 · v1/);
  assert.match(markup, /当前版本 v1/);
  assert.match(markup, /保存状态/);
  assert.match(markup, /data-star-status-panel="success"/);
});

test("the order status panel reports the ordered revision, status text and order id", () => {
  const markup = renderToStaticMarkup(
    <DesignDetailPanel design={mockPublicDesign} reads={readsWith({
      orders: [{ orderId: "order-7", status: "AWAITING_RESTOCK", createdAt: "2026-07-21T01:00:00.000Z", design: { designId: "design-ai-standard", revision: 1 } }]
    })} />
  );

  assert.match(markup, /data-design-order-state="ORDERED"/);
  assert.match(markup, /data-order-status="AWAITING_RESTOCK"/);
  assert.match(markup, /已下单（等待补货）/);
  assert.match(markup, /下单状态/);
  assert.match(markup, /订单号 order-7/);
});

test("unknown reads render an explicit unknown panel, never a saved or ordered label", () => {
  const markup = renderToStaticMarkup(
    <DesignDetailPanel design={mockPublicDesign} reads={readsWith({ savedDesignsRead: "MOCK", ordersRead: "FAILED" })} />
  );

  assert.match(markup, /data-design-save-state="UNKNOWN"/);
  assert.match(markup, /本地演示模式，不读取设计库状态/);
  assert.match(markup, /data-design-order-state="UNKNOWN"/);
  assert.match(markup, /data-order-status="NONE"/);
  assert.match(markup, /暂时无法确认下单状态/);
  assert.doesNotMatch(markup, /设计库确认|已下单（|尚未保存到设计库/);
});

test("the detail region renders no status until both list reads have settled", () => {
  const markup = renderToStaticMarkup(<DesignDetailPanel design={mockPublicDesign} reads={null} />);

  assert.match(markup, /data-design-detail-region="true"/);
  assert.match(markup, /data-design-detail-state="pending"/);
  assert.match(markup, /正在确认保存与下单状态/);
  assert.doesNotMatch(markup, /data-design-save-state|data-design-order-state/);
});
```

Append to `apps/frontend/src/features/design/star-content-contract.test.tsx`:

```tsx
const DESIGN_DETAIL_SOURCE = "../../../src/features/design/components/design-results.tsx";

test("the design detail region obeys the star content grammar", () => {
  // The file already owns a `source(rel)` helper, so bind the text to `detail`.
  const detail = source(DESIGN_DETAIL_SOURCE);
  const regionTag = detail.match(/<section\b[^>]*data-design-detail-region="true"[^>]*>/)?.[0];
  assert.ok(regionTag, "the design detail region must stay present");

  assert.match(regionTag, /bg-\[var\(--star-paper\)\]/);
  assert.doesNotMatch(regionTag, /bg-white\/\d+/, "no translucent white fill on the detail region");
  assert.doesNotMatch(regionTag, /backdrop-blur/, "no frosted glass on the detail region");
  assert.doesNotMatch(detail, /backdrop-filter:\s*blur/i);
  assert.doesNotMatch(detail, /——|—(?!>)/, "detail copy must not use em-dash filler");
  assert.doesNotMatch(detail, /转运|招财|发财|保平安|辟邪|开光|加持|治愈|疗愈|命定|注定|一定|必定|大师|功效|疗效/);
  assert.match(detail, /data-status-mark=/, "status must stay text-bearing");
  assert.match(detail, /data-design-detail-state="pending"/, "the unsettled state stays visible");
});

test("the design detail region reuses canonical renderers instead of forking them", () => {
  const detail = source(DESIGN_DETAIL_SOURCE);

  assert.match(detail, /<DesignSummary design=\{design\} \/>/);
  assert.match(detail, /<WearFitSummary fit=\{evaluateBraceletFit\(design\)\} \/>/);
  assert.match(detail, /<ComplianceNotice design=\{design\} \/>/);
  assert.match(detail, /<StatusPanel/);
  assert.doesNotMatch(detail, /腕围|目标内周长|结构余量/, "measurement labels stay owned by WearFitSummary");
});
```

The 44px floor for this region is already pinned by the non-writable `frontend-ai-flow.test.tsx` (`[data-star-surface="design-results"] button { min-height: 2.75rem }` plus the `h-11 w-11` selection control), so Task 7 does not re-assert it with a weaker copy of the same regex.

- [ ] **Step 2: Run both suites to verify they fail**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx src/features/design/star-content-contract.test.tsx
```

Expected: FAIL. The four new panel tests fail on the missing `data-design-save-state`, `data-design-order-state` and `data-design-detail-state` marks (the Task 6 panel renders no status area at all), and both new content-grammar tests fail on `the design detail region must stay present` plus the absent `<StatusPanel` usage.

- [ ] **Step 3: Write the status panels and gate them on settled reads**

Add `import { StatusPanel, type StatusPanelTone } from "@mystcrag/ui";` to `apps/frontend/src/features/design/components/design-results.tsx`, then replace `DesignDetailPanelProps` and the `DesignDetailPanel` body. The identity, price, wear/fit and compliance blocks from Task 6 stay byte-for-byte inside the same `<section>`; only the props type and the trailing conditional change:

```tsx
export type DesignDetailPanelProps = {
  design: PublicDesignV1;
  reads: DesignDetailReads | null;
};

export function designSaveStateTone(state: DesignSaveState): StatusPanelTone {
  if (state.kind === "CONFIRMED") return "success";
  if (state.kind === "STALE_VIEW") return "warning";
  return "info";
}

export function designOrderStateTone(state: DesignOrderState): StatusPanelTone {
  if (state.kind !== "ORDERED") return "info";
  if (state.status === "CANCELLED") return "danger";
  if (state.status === "AWAITING_RESTOCK") return "warning";
  return "success";
}

export function DesignDetailPanel({ design, reads }: DesignDetailPanelProps) {
  const saveState = reads ? deriveDesignSaveState(design, reads) : null;
  const orderState = reads ? deriveDesignOrderState(design, reads) : null;

  return (
    <section
      aria-label="设计详情"
      className="mt-6 rounded-[1.5rem] border border-[var(--border)] bg-[var(--star-paper)] p-5"
      data-design-detail-region="true"
    >
      {/* Task 6 blocks: DesignSummary, authoritative price plus provenance, WearFitSummary, ComplianceNotice */}

      {saveState && orderState ? (
        <div className="mt-4 grid gap-4 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
          <StatusPanel
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
            role="region"
            title="保存状态"
            tone={designSaveStateTone(saveState)}
          >
            <p className="text-sm text-[var(--foreground)]" data-design-save-state={saveState.kind} data-status-mark="true">
              {designSaveStateLabel(saveState)}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">当前版本 v{design.revision}</p>
          </StatusPanel>

          <StatusPanel
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
            role="region"
            title="下单状态"
            tone={designOrderStateTone(orderState)}
          >
            <p
              className="text-sm text-[var(--foreground)]"
              data-design-order-state={orderState.kind}
              data-order-status={orderState.kind === "ORDERED" ? orderState.status : "NONE"}
              data-status-mark="true"
            >
              {designOrderStateLabel(orderState, design.revision)}
            </p>
            {orderState.kind === "ORDERED" ? (
              <p className="mt-1 break-all text-xs text-[var(--muted)]">订单号 {orderState.orderId}</p>
            ) : null}
          </StatusPanel>
        </div>
      ) : (
        <p aria-live="polite" className="mt-4 text-sm text-[var(--muted)]" data-design-detail-state="pending" role="status">
          正在确认保存与下单状态
        </p>
      )}
    </section>
  );
}
```

The comment line marks the Task 6 blocks: do not retype them, and do not move them out of the `<section>`. The pending branch stays inside the same element so `[data-star-surface="design-results"]` and `[data-star-surface="content"]` scoping, and the 44px floor that depends on it, hold while the reads are in flight.

- [ ] **Step 4: Update the mount site**

In `DesignResults`, change the Task 6 call to pass the settled reads:

```tsx
      {selectedDesign ? (
        <DesignDetailPanel design={selectedDesign} reads={reads} />
      ) : null}
```

- [ ] **Step 5: Run both suites to verify they pass**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx src/features/design/star-content-contract.test.tsx src/features/design/frontend-ai-flow.test.tsx src/features/design/design-contract-consumer.test.tsx && npx tsc --noEmit
```

Expected: all PASS and typecheck exit 0. Record the observed test counts for the acceptance note instead of quoting a number this plan cannot know before the run.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/features/design/components/design-results.tsx apps/frontend/src/features/design/design-detail-integration.test.tsx apps/frontend/src/features/design/star-content-contract.test.tsx
git commit -m "feat(design): show save and order status on the design detail region"
```

---

### Task 8: Prove expectedRevision stays threaded through every mutation

**Files:**
- Test: `apps/frontend/src/features/design/design-detail-integration.test.tsx`
- Temporarily modify then revert: `apps/frontend/src/lib/api/design-api.ts`

- [ ] **Step 1: Write the threading contract test**

Append, adding `import { readFileSync } from "node:fs";` to the test file's `node:` import block:

```tsx
import { createDesignApiClient, createMoveRequest } from "../../lib/api/design-api";

// A revision above the fixture's 1 so a hard-coded expectedRevision cannot pass by luck.
const currentDesign: PublicDesignV1 = { ...mockPublicDesign, revision: 4 };

type CapturedCall = { path: string; body: Record<string, unknown> };

// Every call is recorded and then answered with a stable 500 so the assertions
// read the real transport body instead of a hand-built success envelope.
function captureFetcher(captured: CapturedCall[]) {
  return (async (path: string | URL | Request, init?: RequestInit) => {
    captured.push({
      path: String(path),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
    });
    return new Response(JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "captured" } }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
}

test("update and order mutations thread the loaded design revision", async () => {
  const captured: CapturedCall[] = [];
  const client = createDesignApiClient({ useMock: false, fetcher: captureFetcher(captured) });

  await assert.rejects(() => client.update(createMoveRequest(currentDesign, currentDesign.beads[0]!.componentId, 1)));
  await assert.rejects(() => client.createOrder(currentDesign));

  const update = captured.find((call) => call.path === "/api/design/update");
  const order = captured.find((call) => call.path === "/api/orders/from-design");
  assert.ok(update && order, "both mutation routes must be called");
  assert.equal(update.body.expectedRevision, 4);
  assert.equal(order.body.expectedRevision, 4);
  assert.equal(order.body.expectedPricingVersion, "cny-retail-2026-07-v1");
  assert.equal(order.body.expectedTotalPriceMinor, 5500);
  assert.equal((order.body.design as { revision: number }).revision, 4);
});

test("delete and clone pass the caller revision straight through to the body", async () => {
  const captured: CapturedCall[] = [];
  const client = createDesignApiClient({ useMock: false, fetcher: captureFetcher(captured) });

  await assert.rejects(() => client.deleteDesign("design-ai-standard", 4));
  await assert.rejects(() => client.cloneDesign("design-ai-standard", 4));

  assert.equal(captured[0]?.body.expectedRevision, 4);
  assert.equal(captured[1]?.body.expectedRevision, 4);
});

test("a REJECTED design is blocked by the frozen contract before any request leaves", async () => {
  let calls = 0;
  const client = createDesignApiClient({
    useMock: false,
    fetcher: (async () => {
      calls += 1;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch
  });

  await assert.rejects(() => client.createOrder({
    ...mockPublicDesign,
    compliance: { ...mockPublicDesign.compliance, complianceStatus: "REJECTED" }
  }));
  assert.equal(calls, 0);
});

test("the design detail region performs no mutation and hands off the authoritative id only", () => {
  const detailSource = readFileSync(new URL("./components/design-results.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(detailSource, /designApi\.(save|createOrder|update|deleteDesign|cloneDesign|price)\(/);
  assert.doesNotMatch(detailSource, /\bfetch\(/);
  assert.match(detailSource, /href=\{`\/diy\/\$\{encodeURIComponent\(selectedDesign\.designId\)\}`\}/);
  assert.match(detailSource, /<DesignDetailPanel design=\{selectedDesign\} reads=\{reads\} \/>/);
});
```

- [ ] **Step 2: Run the test to verify the outcome**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx
```

Expected: the last test is the RED. `DesignDetailPanel` is mounted without the `reads` prop name in the call, or the region still contains a mutation call, so the assertion fails with `The input did not match the regular expression /<DesignDetailPanel design=\{selectedDesign\} reads=\{reads\} \/>/`. The first three tests are revision guards: they are green on arrival because `design-api.ts` already derives `expectedRevision` from the loaded design, which is exactly why Step 4 proves they have teeth.

- [ ] **Step 3: Reconcile the mount site**

If Step 2 failed on the mount assertion, adjust the call in `apps/frontend/src/features/design/components/design-results.tsx` to `<DesignDetailPanel design={selectedDesign} reads={reads} />`. If it failed on a mutation pattern, remove that mutation from the region; saving and completion stay owned by `DiyEditor`. Re-run until PASS.

- [ ] **Step 4: Prove the revision guards have teeth by mutation**

Temporarily edit the writable `apps/frontend/src/lib/api/design-api.ts`, run the suite, and revert in the same step:

```bash
python3 - <<'PY'
import pathlib
path = pathlib.Path("apps/frontend/src/lib/api/design-api.ts")
text = path.read_text()
assert text.count("expectedRevision: design.revision,") == 1, text.count("expectedRevision: design.revision,")
path.write_text(text.replace("expectedRevision: design.revision,", "expectedRevision: 1,"))
PY
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx
git checkout -- apps/frontend/src/lib/api/design-api.ts
git status --short
```

Expected: the mutation makes `update and order mutations thread the loaded design revision` FAIL on `assert.equal(order.body.expectedRevision, 4)` with `1 !== 4`; note the exact failing test name and message for the acceptance note. After the revert, `git status --short` is empty and the suite passes again. A guard that cannot fail is deleted, not kept.

- [ ] **Step 5: Confirm no forbidden path reached a commit**

```bash
git diff --stat
```

Expected: empty. The temporary `design-api.ts` edit never leaves the worktree.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/features/design/design-detail-integration.test.tsx
git commit -m "test(design): pin revision threading and mutation-free detail region"
```

---

### Task 9: Handoff gates and registry state

**Files:**
- Modify: `docs/tasks/TASK_REGISTRY.md` (only the `TASK-FE-STAR-004` row acceptance note)

- [ ] **Step 1: Focused suites**

```bash
cd apps/frontend && npx tsx --test src/features/design/design-detail-integration.test.tsx src/features/design/frontend-ai-flow.test.tsx src/features/design/star-content-contract.test.tsx src/features/design/design-contract-consumer.test.tsx src/features/design/wear-fit-summary.test.tsx src/features/design/atelier-ui-contract.test.tsx src/features/design/accessibility-contract.test.tsx src/lib/api/design-api.test.tsx
```

Expected: every test passes; record the exact counts.

- [ ] **Step 2: Full frontend suite with a quoted recursive glob**

```bash
cd apps/frontend && npx tsx --test "src/**/*.test.tsx"
```

Expected: zero failed. Pre-existing `src/features/auth/server/oidc-review-regressions.test.tsx` cancellations in this worktree are recorded as pre-existing, not hidden, and are not caused by this task's paths.

- [ ] **Step 3: Typecheck, lint and production build**

```bash
cd apps/frontend && npx tsc --noEmit && npx eslint . --max-warnings=0 && npx next build
```

Expected: all exit 0, the build lists `/design/[id]`, and the output contains no `Parsing CSS source code failed` and no `global is not recognized as a valid pseudo-class` warning.

- [ ] **Step 4: Restore the build-touched generated file and run the architecture gate**

```bash
git checkout -- apps/frontend/next-env.d.ts 2>/dev/null || true
shasum -a 256 apps/frontend/next-env.d.ts
node --test tests/architecture.test.mjs
```

Expected: SHA-256 starts `7b550dda` and ends `12651`; architecture `23/23 pass`.

- [ ] **Step 5: Diff hygiene**

```bash
git diff --check eeb49c3..HEAD
git status --short
git diff --name-only eeb49c3..HEAD
```

Expected: `git diff --check` silent, worktree clean, and the changed path list is exactly the registry row, this plan, and the registered runtime/test files. Anything outside the writable set stops the handoff and is reported instead of committed.

- [ ] **Step 6: Move the row to REVIEW and commit**

Update only the `TASK-FE-STAR-004` row with the combination SHA, per-command evidence counts, the mutation-proof failure name from Task 8 Step 4, and any blocked item. The row states `REVIEW`, never `DONE`; acceptance is the independent reviewer's.

```bash
git add docs/tasks/TASK_REGISTRY.md
git commit -m "docs(tasks): record design detail integration evidence for FE-STAR-004"
```

## Blockers and escalation

- No Backend or Design Contract change is authorized. If a required state cannot be expressed with `listDesigns()`, `listOrders()` and `loadCompletedOrder()`, stop that item, keep the region on an explicit unknown, and report the exact missing field plus the owning task (`BACKEND` or `CONTRACT`) instead of deriving a guess or adding a route.
- If `TASK-FE-STAR-002` or `TASK-FE-STAR-003` moves to `IN_PROGRESS` on `wear-fit-summary.tsx`, `design-results.tsx`, `frontend-ai-flow.test.tsx`, `design/[id]/page.tsx` or `star-content-contract.test.tsx`, stop before editing that shared path and report the lock; the remaining tasks continue.
- Any need to touch `apps/frontend/app/styles/star-content.css`, `packages/ui/**`, a `package.json` or `pnpm-lock.yaml` is out of scope: report it, do not stage it.
