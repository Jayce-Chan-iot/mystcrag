# Consumer Login, Registration and Desktop Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the authentication-required dialog lead ordinary users into real Auth0 login/registration, identify stale desktop demo credentials before showing a no-op link, and prove unverified-email first login maps safely to the existing user database.

**Architecture:** Preserve Auth0 Universal Login as the only consumer credential store and preserve the existing BFF/session and `(issuer, subject)` identity architecture. Add a small shared browser session client so the dialog can distinguish ordinary Auth0 mode from the existing non-sensitive desktop capability `logoutAvailable:false`; keep tenant configuration, frontend recovery UI, and database verification in separately owned tasks.

**Tech Stack:** Next.js 16 App Router, React 19, Auth0 Next.js SDK 4.27, TypeScript, Node test runner, Playwright, Fastify injection tests, Prisma 7, PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-09-13-consumer-login-registration-recovery.md`

## Global Constraints

- Codex registers `TASK-AUTH-010`, `TASK-AUTH-OPS-001`, and `TASK-AUTH-DB-QA-001` separately before implementation; each receives one owner, branch/worktree, exact writable paths, and `IN_PROGRESS` status. Parallel executors never edit the shared task registry.
- Land the frontend mode/recovery contract before operations acceptance; database/backend work is verification-only unless a new focused red test proves an implementation defect.
- Auth0 Universal Login and its encrypted HttpOnly SDK cookie remain the only production consumer login/session path.
- Never add a local consumer password form/table, password hash, verification code, authorization code, PKCE verifier, Access Token, Refresh Token, provider subject, or internal actor ID to browser HTML, URL, React state, general user fields, or logs.
- Do not reuse the management-console `admin/admin` account or its minimum-password rule for consumers.
- Desktop signed-test identity remains development-only and server-held. The browser may receive only the existing non-sensitive `logoutAvailable:false` capability.
- `returnTo` remains pathname + query + hash and continues through the existing server validator. Never weaken absolute-URL, double-slash, backslash, or encoded bypass rejection.
- “暂不登录”, Escape, and backdrop dismissal only close the modal and restore focus; they never call a business retry, resubmit, clear input, call `router.back()`, or navigate.
- Do not add dependencies or change package manifests/lockfile. Do not push, deploy, or merge to `main`; stop at review commits with independently rerunnable evidence.

---

## File Structure

- Create `apps/frontend/src/features/auth/browser/session-client.ts`: shared typed `/auth/session` fetch and desktop-capability classification input.
- Modify `apps/frontend/src/features/auth/hooks/use-session.ts`: consume and re-export the shared session types/client without changing the hook's public result.
- Modify `apps/frontend/src/features/auth/browser/auth-required-dialog.tsx`: hydration-safe mode check, real Auth0 link, desktop recovery copy, and unchanged dismissal/focus contract.
- Modify `apps/frontend/src/features/auth/browser/auth-required-dialog.test.tsx`: pure classification, markup, privacy, and source-wiring regression tests.
- Modify `apps/frontend/src/features/auth/browser/flow-notice-auth-dismiss.test.tsx`: ensure business retry and navigation remain disconnected from dismiss.
- Modify `docs/AUTH_SESSION_CONTRACT.md`: document the mode-aware prompt while preserving session and identity trust boundaries.
- Modify `docs/LOCAL_DEMO_GUIDE.md`: exact desktop stale-token recovery steps.
- Create `docs/qa/AUTH0_CONSUMER_ACCESS_ACCEPTANCE.md`: tenant configuration checklist and non-secret acceptance evidence.
- Modify for focused verification coverage: `packages/database/src/repositories/identity.repository.integration.test.ts` and `apps/backend/src/auth/authenticated-actor.integration.test.ts`.

### Task 1: Add a shared safe browser session snapshot

**Files:**
- Create: `apps/frontend/src/features/auth/browser/session-client.ts`
- Modify: `apps/frontend/src/features/auth/hooks/use-session.ts`
- Modify: `apps/frontend/src/features/auth/browser/auth-required-dialog.test.tsx`

**Interfaces:**
- Produces: `SessionState`, `SessionSnapshot`, `fetchSessionSnapshot(fetcher?: typeof fetch): Promise<SessionSnapshot>`, and `resolveAuthPromptMode(snapshot): "auth0" | "desktop-recovery"`.
- Consumes: `/auth/session` JSON containing only `authenticated`, safe user hints, expiry strings, and optional `logoutAvailable`.

- [ ] **Step 1: Verify the Codex-owned AUTH/FRONTEND registration**

Confirm Codex has registered `TASK-AUTH-010`, owner `MiMo / FRONTEND`, branch `task/auth-010-consumer-login-recovery`, status `IN_PROGRESS`. Writable paths are limited to the browser/session/dialog files and tests named by Tasks 1-3 plus `docs/AUTH_SESSION_CONTRACT.md`. Do not start if the row differs, and do not edit `TASK_REGISTRY.md` from the executor worktree.

- [ ] **Step 2: Write the failing pure classification tests**

Add these imports and cases to `auth-required-dialog.test.tsx`:

```ts
import { resolveAuthPromptMode } from "./session-client";

test("only the explicit desktop session capability selects desktop recovery", () => {
  assert.equal(resolveAuthPromptMode({ status: "authenticated", session: {
    authenticated: true,
    user: { displayName: "本地演示用户" },
    logoutAvailable: false
  }}), "desktop-recovery");
  assert.equal(resolveAuthPromptMode({ status: "unauthenticated", session: {
    authenticated: false
  }}), "auth0");
  assert.equal(resolveAuthPromptMode({ status: "authenticated", session: {
    authenticated: true,
    user: { displayName: "普通用户" }
  }}), "auth0");
});
```

Also assert the dialog source does not read the display name to infer mode and contains no token/issuer/subject matching.

- [ ] **Step 3: Run the focused test and confirm red**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/auth/browser/auth-required-dialog.test.tsx
```

Expected: FAIL because `session-client.ts` and `resolveAuthPromptMode` do not exist.

- [ ] **Step 4: Implement the shared client and preserve hook compatibility**

Create `session-client.ts` with these exact public shapes:

```ts
import { classifySessionResponse, type SessionStatus } from "../model/session-status";

export type SessionState = {
  authenticated: boolean;
  user?: { displayName?: string; email?: string; emailVerified?: boolean };
  logoutAvailable?: boolean;
  idleExpiresAt?: string;
  absoluteExpiresAt?: string;
};

export type SessionSnapshot = {
  status: SessionStatus;
  session: SessionState | null;
};

export async function fetchSessionSnapshot(
  fetcher: typeof fetch = fetch
): Promise<SessionSnapshot> {
  const response = await fetcher("/auth/session", {
    cache: "no-store",
    credentials: "same-origin"
  });
  if (!response.ok) throw new Error(`Session request failed: ${response.status}`);
  const session = await response.json() as SessionState;
  return { status: classifySessionResponse(session), session };
}

export function resolveAuthPromptMode(
  snapshot: SessionSnapshot
): "auth0" | "desktop-recovery" {
  return snapshot.status === "authenticated" &&
    snapshot.session?.authenticated === true &&
    snapshot.session.logoutAvailable === false
    ? "desktop-recovery"
    : "auth0";
}
```

In `use-session.ts`, remove its private duplicate type/fetch function, import `fetchSessionSnapshot` and `SessionState`, and re-export `SessionState`. Keep the hook return shape, status reducer, login, logout, refresh, and current-location behavior unchanged.

- [ ] **Step 5: Run auth and frontend tests**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/auth/browser/auth-required-dialog.test.tsx src/features/auth/components/auth-status.test.tsx
pnpm --filter @mystcrag/frontend typecheck
```

Expected: PASS with no changed `useSession()` consumer contract.

- [ ] **Step 6: Commit the shared client**

```bash
git add apps/frontend/src/features/auth/browser/session-client.ts apps/frontend/src/features/auth/hooks/use-session.ts apps/frontend/src/features/auth/browser/auth-required-dialog.test.tsx
git commit -m "refactor(auth): share safe browser session snapshot"
```

### Task 2: Make the dialog mode-aware without breaking dismissal

**Files:**
- Modify: `apps/frontend/src/features/auth/browser/auth-required-dialog.tsx`
- Modify: `apps/frontend/src/features/auth/browser/auth-required-dialog.test.tsx`
- Modify: `apps/frontend/src/features/auth/browser/flow-notice-auth-dismiss.test.tsx`

**Interfaces:**
- Consumes: `fetchSessionSnapshot()` and `resolveAuthPromptMode()` from Task 1, plus existing `buildLoginHref(window.location)`.
- Produces: `AuthPromptMode = "checking" | "auth0" | "desktop-recovery"`; Auth0 mode renders the real login link and desktop recovery mode renders instructions with no `/auth/login` link.

- [ ] **Step 1: Write failing rendering and wiring tests**

Extend the dialog tests to require these exported copy records:

```ts
export const DESKTOP_RECOVERY_COPY = {
  title: "本地演示身份需要刷新",
  message: "请保持此页面打开，重新运行桌面的玄矶系统启动脚本。服务重新启动后，再次执行刚才的操作。",
  primaryAction: "我知道了",
  secondaryAction: "暂不处理"
} as const;
```

Add source assertions that:

```ts
assert.match(source, /fetchSessionSnapshot\(\)/);
assert.match(source, /resolveAuthPromptMode\(/);
assert.match(source, /promptMode === "desktop-recovery"/);
assert.doesNotMatch(source, /router\.back|history\.back|location\.reload/);
```

Render the dialog with a test-only `initialPromptMode="desktop-recovery"` and assert that the markup contains the recovery copy, contains no `href="/auth/login`, and contains neither `Bearer` nor token/issuer/subject fields. Keep all existing focus, Escape, backdrop, and 44px assertions.

- [ ] **Step 2: Run focused tests and confirm red**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/auth/browser/auth-required-dialog.test.tsx src/features/auth/browser/flow-notice-auth-dismiss.test.tsx
```

Expected: FAIL because recovery copy, prompt mode, and session resolution are absent.

- [ ] **Step 3: Add the mode state and fail-safe resolution**

Add:

```ts
export type AuthPromptMode = "checking" | "auth0" | "desktop-recovery";

const [promptMode, setPromptMode] = React.useState<AuthPromptMode>(
  initialPromptMode ?? "checking"
);

React.useEffect(() => {
  if (initialPromptMode !== undefined) return;
  let active = true;
  fetchSessionSnapshot()
    .then((snapshot) => { if (active) setPromptMode(resolveAuthPromptMode(snapshot)); })
    .catch(() => { if (active) setPromptMode("auth0"); });
  return () => { active = false; };
}, [initialPromptMode]);
```

Expose `initialPromptMode?: AuthPromptMode` only as a deterministic render/testing input; no production caller supplies it. Use one callback ref accepting `HTMLElement | null` for the anchor/button alternatives, and focus that node whenever `promptMode` changes so the resolved primary action receives focus. A session-check failure falls back to Auth0, where `/auth/login` retains the server-side fail-closed configuration behavior.

- [ ] **Step 4: Render three explicit action states**

Keep the modal shell and shared `dismiss()` primitive. Render:

- `checking`: approved title plus “正在检查登录方式…”, a focusable 44px primary button with `aria-disabled="true"` and no click handler, and the unchanged dismiss button;
- `auth0`: the existing hydration-safe `<Link href={href}>登录 / 注册</Link>`;
- `desktop-recovery`: the exact recovery copy, no login link, and a purple `<button type="button" onClick={dismiss}>我知道了</button>`.

In all modes the secondary action, Escape, and backdrop call only `dismiss()`. The desktop button also only dismisses after the instruction is visible; it must not restart processes, navigate, reload, or touch secrets.

- [ ] **Step 5: Preserve and strengthen the dismissal regression**

In `flow-notice-auth-dismiss.test.tsx`, retain the behavioral proof that `FlowNotice` passes `onDismissAuthRequired`, never `onAction`, to the dialog. Add source checks that neither `flow-notice.tsx` nor `auth-required-dialog.tsx` contains `router.back` or `history.back`; keep the existing `dismissDialog` behavior test as the proof that dismissal invokes only close, focus restoration, and `onDismiss`.

- [ ] **Step 6: Run focused and full frontend gates**

```bash
pnpm --filter @mystcrag/frontend exec tsx --test src/features/auth/browser/auth-required-dialog.test.tsx src/features/auth/browser/flow-notice-auth-dismiss.test.tsx src/features/auth/components/auth-status.test.tsx
pnpm --filter @mystcrag/frontend test
pnpm --filter @mystcrag/frontend typecheck
pnpm --filter @mystcrag/frontend lint
pnpm --filter @mystcrag/frontend build
git diff --check
```

Expected: all pass.

- [ ] **Step 7: Commit the frontend behavior**

```bash
git add apps/frontend/src/features/auth/browser/auth-required-dialog.tsx apps/frontend/src/features/auth/browser/auth-required-dialog.test.tsx apps/frontend/src/features/auth/browser/flow-notice-auth-dismiss.test.tsx
git commit -m "fix(auth): recover stale desktop identity prompts"
```

### Task 3: Update the controlling auth contract and browser acceptance

**Files:**
- Modify: `docs/AUTH_SESSION_CONTRACT.md`
- Modify only when a defect is found: the `TASK-AUTH-010` files from Tasks 1-2

**Interfaces:**
- Consumes: candidate mode-aware dialog behavior.
- Produces: contract text and browser evidence for Auth0, desktop recovery, return location, state retention, focus, and privacy.

- [ ] **Step 1: Update the contract in the same change**

Document that `/auth/session` continues exposing no runtime mode string or secret; `logoutAvailable:false` is the sole non-sensitive desktop capability. State that a protected API 401 triggers a `/auth/session` snapshot: ordinary/unknown mode presents Auth0 login, while authenticated desktop projection presents launcher-restart guidance. Record that this changes prompt projection only and does not alter `/auth/login`, BFF token forwarding, or identity mapping.

- [ ] **Step 2: Verify ordinary Auth0 navigation in a real browser**

With desktop auto-auth disabled and an unauthenticated cookie jar, open a protected flow with pathname, query, and hash. Trigger `UNAUTHORIZED`, wait for the mode check, click “登录 / 注册”, and verify the browser visits `/auth/login?returnTo=<encoded current relative address>` and then receives an Auth0 `/authorize` redirect. Verify the Auth0 page exposes both login and signup. Do not record credentials, cookies, authorization codes, state, nonce, or full redirect URLs in screenshots/logs.

- [ ] **Step 3: Verify non-navigation dismissal**

Enter recognizable unsaved form text, record `location.href`, scroll position, and input value in the Playwright process, dismiss through button, Escape, and backdrop on three separate modal openings, and assert all values are unchanged. Trigger another 401 and confirm the modal mounts again. Verify focus returns to the initiating control.

- [ ] **Step 4: Verify desktop mismatch recovery**

Run the documented desktop mode, confirm `/auth/session` returns `authenticated:true` and `logoutAvailable:false`, then intentionally use a separately issued invalid/expired test token only in the server process so a protected request returns 401. Confirm the dialog shows the recovery copy and no login anchor; inspect DOM and captured network URLs for absence of token, issuer, subject, actor ID, password, and desktop secret. Keep the browser page open, restart through the launcher, retry the protected action, and confirm recovery without losing the route or previously entered client state.

- [ ] **Step 5: Run final frontend and repository gates**

```bash
pnpm --filter @mystcrag/frontend test
pnpm --filter @mystcrag/frontend typecheck
pnpm --filter @mystcrag/frontend lint
pnpm --filter @mystcrag/frontend build
pnpm validate
git diff --check
git status --short
```

Expected: frontend gates pass. If repository validation still fails only on the known retired `apps/backend/src/modules/community` architecture scan, quote that single baseline failure in the task row; any new failure blocks review.

- [ ] **Step 6: Commit the contract and hand off**

```bash
git add docs/AUTH_SESSION_CONTRACT.md
git commit -m "docs(auth): define mode-aware login recovery"
```

Return exact commits, browser cases, and command results to Codex. Codex sets `TASK-AUTH-010` to `REVIEW`; stop without editing the registry.

### Task 4: Configure Auth0 database signup and record non-secret evidence

**Files:**
- Modify: `docs/LOCAL_DEMO_GUIDE.md`
- Create: `docs/qa/AUTH0_CONSUMER_ACCESS_ACCEPTANCE.md`

**Interfaces:**
- Consumes: the Auth0 tenant already named by the deployed environment and its existing application/database connection.
- Produces: tenant-side signup behavior and a redacted acceptance record; it produces no repository secret or local password storage.

- [ ] **Step 1: Verify the Codex-owned operations registration**

Confirm Codex has registered `TASK-AUTH-OPS-001`, owner `DeepSeek V4 Pro / AUTH OPERATIONS`, branch `task/auth-ops-001-consumer-access`, status `IN_PROGRESS`, with writable paths limited to `docs/LOCAL_DEMO_GUIDE.md` and the acceptance document. Auth0 tenant settings are the explicitly named external mutation. Do not edit the shared registry.

- [ ] **Step 2: Record the pre-change tenant state**

In the acceptance document record only tenant/environment label, application name, database connection name, reviewer, UTC timestamp, and these boolean/configuration observations: database connection enabled for the application; signups enabled/disabled; identifier type; password policy name; email verification on signup; OTP/passwordless connections; exact allowed callback/logout/web-origin hostnames with paths but no client secret. If tenant access is unavailable, set the registry task `BLOCKED` with that reason and stop—do not claim configuration.

- [ ] **Step 3: Apply the approved tenant settings**

In the Auth0 Dashboard, enable the existing database connection for the application, turn `Disable Sign Ups` off, use email + password identifiers, turn `Verify email on sign up` off for the MVP environment, and leave SMS/voice/email OTP/passwordless connections disabled. Preserve Auth0's configured password policy; do not reduce it to the admin-console length rule. Verify allowed callbacks, logout URLs, and web origins are exact environment-specific allowlists.

- [ ] **Step 4: Document the desktop recovery runbook**

In `docs/LOCAL_DEMO_GUIDE.md`, retain the existing server-only token generation rules and add an exact recovery section: keep the affected browser tab open; stop the launcher-owned local services using the launcher's normal stop path; rerun the desktop `玄矶系统` launcher so it generates a new token of at most eight hours and applies the same token to Backend and frontend server processes; wait for both health checks; return to the still-open relative URL; retry the protected action. State that refresh/login clicks cannot repair a mismatched server-held token, no browser/client token generation is permitted, and unsaved in-memory state survives only while the original tab remains open.

- [ ] **Step 5: Execute the signup/login acceptance**

From a private browser context, start at a protected Mystcrag URL with query/hash, use “登录 / 注册”, create one clearly labeled test user with a unique test email, and confirm no email/phone OTP gate appears. Confirm return to the original relative location and that `/auth/session` exposes only safe display/email/emailVerified fields and expiry metadata. Log out with the real POST flow, log in again, and confirm success. Delete the test Auth0 user after database identity evidence is captured only if the environment's test-data policy explicitly permits deletion; otherwise mark it as retained test data.

- [ ] **Step 6: Complete redacted evidence and hand off**

Record pass/fail for each setting and flow plus the Auth0 user ID only as a one-way SHA-256 digest. Never include email, password, cookie, token, authorization URL query, client secret, or raw subject. Commit:

```bash
git add docs/LOCAL_DEMO_GUIDE.md docs/qa/AUTH0_CONSUMER_ACCESS_ACCEPTANCE.md
git commit -m "docs(auth): record consumer signup acceptance"
```

Return the commit and redacted live-tenant evidence to Codex. Codex sets `TASK-AUTH-OPS-001` to `REVIEW` and compares the evidence to the live tenant or an authorized redacted export before `DONE`.

### Task 5: Prove unverified-email identity provisioning on a fresh database

**Files:**
- Modify: `packages/database/src/repositories/identity.repository.integration.test.ts`
- Modify: `apps/backend/src/auth/authenticated-actor.integration.test.ts`

**Interfaces:**
- Consumes: verified claims `{ issuer, subject, email, emailVerified:false, displayName }`.
- Produces: one stable internal `User.id`, one unique `ExternalIdentity(issuer, subject)`, persisted `emailVerified:false`, and no password/token persistence.

- [ ] **Step 1: Verify the Codex-owned database/backend registration**

Confirm Codex has registered `TASK-AUTH-DB-QA-001`, owner `DeepSeek V4 Pro / BACKEND`, branch `task/auth-db-qa-001-unverified-provisioning`, status `IN_PROGRESS`, with only the two exact integration-test files writable. Forbid registry edits, repository/provider runtime code, Prisma schema/migrations, production data, seed data, consumer password fields, unrelated APIs, push, deployment, and main merge.

- [ ] **Step 2: Add the focused repository assertion before implementation changes**

In the existing identity persistence matrix add a subtest that provisions an identity with `emailVerified:false`, then asserts:

```ts
assert.equal(mapping.created, true);
assert.equal(mapping.emailVerified, false);
const identity = await prisma.externalIdentity.findUniqueOrThrow({
  where: { issuer_subject: { issuer: ISSUER_A, subject } }
});
const user = await prisma.user.findUniqueOrThrow({ where: { id: mapping.actorId } });
assert.equal(identity.userId, user.id);
assert.equal(identity.emailVerified, false);
assert.equal(user.email, null);
```

Query PostgreSQL `information_schema.columns` for both tables and assert there is no column whose lowercase name contains `password`, `token`, `verification_code`, `authorization_code`, or `pkce`.

- [ ] **Step 3: Add the focused Backend mapping assertion**

In `authenticated-actor.integration.test.ts`, add a verifier that returns claims with `emailVerified:false`; authenticate twice and assert both requests resolve to the same internal actor, the stored identity remains false, and no 401/403 is produced solely because verification is false.

- [ ] **Step 4: Run on a new isolated database**

Create the dedicated local test database `mystcrag_auth010_test_20260913`, then run:

```bash
TEST_DATABASE_URL="postgresql://localhost:5432/mystcrag_auth010_test_20260913" pnpm db:test
DATABASE_URL="postgresql://localhost:5432/mystcrag_auth010_test_20260913" pnpm --filter @mystcrag/backend exec tsx --test src/auth/authenticated-actor.integration.test.ts
```

Expected: all database tests and the Backend auth integration file pass. Preserve the test database until Codex review unless the project owner explicitly authorizes deletion.

- [ ] **Step 5: Enforce the verification-only gate**

If the new tests pass against the existing implementation, do not edit `identity.repository.ts`, `authenticated-actor-provider.ts`, Prisma schema, or migrations. Commit test evidence only:

```bash
git add packages/database/src/repositories/identity.repository.integration.test.ts apps/backend/src/auth/authenticated-actor.integration.test.ts
git commit -m "test(auth): verify unverified identity provisioning"
```

If a focused assertion fails, preserve the exact failure and stop. Report `BLOCKED` to Codex so Codex can register a new single-owner remediation task with the exact failed runtime path and acceptance assertion; do not expand this QA task's writable paths or modify runtime code in the verification branch.

- [ ] **Step 6: Run final cross-module gates and hand off**

```bash
pnpm --filter @mystcrag/database test
pnpm --filter @mystcrag/database typecheck
pnpm --filter @mystcrag/backend test
pnpm --filter @mystcrag/backend typecheck
pnpm validate
git diff --check
git status --short
```

Expected: module gates pass. Separately record the existing stale community architecture scan if it is still the only `pnpm validate` failure. Return the database name, migration count, test counts, commit, and confirmation that no schema, migration, repository, or provider runtime change occurred; Codex sets `TASK-AUTH-DB-QA-001` to `REVIEW`.

## Plan Self-Review Result

- Spec coverage: ordinary Auth0 login/signup, no-verification MVP operations, safe return location, pure dismissal, desktop mismatch recovery, first-login provisioning, repeated-login stability, privacy, and cross-module verification each have a named task and acceptance evidence.
- Type consistency: `SessionState` moves unchanged to `session-client.ts` and is re-exported by `use-session.ts`; `SessionSnapshot` is the sole input to `resolveAuthPromptMode`; desktop classification uses only `logoutAvailable:false`.
- Architecture consistency: no second credential store/session is created, `/auth/login` server behavior and open-redirect validation remain unchanged, and the Database/Backend verification task cannot modify runtime code; a failing regression requires a separately registered remediation task.
- Operational honesty: tenant configuration cannot be marked complete without live non-secret evidence; missing tenant access becomes `BLOCKED`, never an inferred pass.
