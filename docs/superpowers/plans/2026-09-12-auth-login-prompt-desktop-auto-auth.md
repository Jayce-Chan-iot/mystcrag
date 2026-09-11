# TASK-AUTH-009 Login Prompt and Desktop Auto Auth Implementation Plan

> **For GLM-5.3:** Execute this plan red-green-refactor in the registered worktree. Do not merge, push, deploy, or edit forbidden paths. Codex owns final review and integration.

**Goal:** Give unauthenticated consumers an actionable Auth0 login/register dialog while allowing the explicit local desktop launcher to use a short-lived server-only signed-test identity.

**Architecture:** Preserve Auth0 as the sole production browser session. Add a fail-closed development-only runtime selector at the Next.js server boundary. Reuse the existing BFF core by injecting either Auth0 SDK token/session operations or the server-only desktop token. Render one reusable authentication-required dialog for consumer `UNAUTHORIZED` states; keep all other failures inline.

**Tech Stack:** Next.js 16, React 19, TypeScript, Auth0 Next.js SDK 4.27, Node test runner through `tsx`, Tailwind CSS, macOS launchd/bash.

**Controlling spec:** `docs/superpowers/specs/2026-09-12-auth-login-prompt-desktop-auto-auth.md`

---

## Preconditions

- Work only in `/Users/chenyanyan/Codex-project/玄矶水晶DIY设计网页端/.worktrees/auth-009-desktop-auto-auth` on `task/auth-009-desktop-auto-auth-login-prompt`.
- Confirm `git status --short` is clean before implementation and HEAD contains the Codex planning commits.
- Read `README.md`, `AGENTS.md`, `docs/INDEX.md`, the controlling spec, `docs/AUTH_SESSION_CONTRACT.md`, `docs/SECURITY_AND_PRIVACY.md`, `docs/governance/CANONICAL_COMPONENTS.md`, and `docs/governance/MODULE_OWNERS.md`.
- Do not change task ownership, writable paths, package manifests, lockfile, Backend, Database, Design Contract, admin bead-import auth, or unrelated UI.

## Task 1: Freeze desktop configuration rules with red tests

**Files:**

- Modify: `apps/frontend/src/features/auth/model/auth-config.test.tsx`
- Modify: `apps/frontend/src/features/auth/model/auth-config.ts`

1. Add failing tests for the exact mode matrix: valid development + signed-test + both loopback origins + explicit flag + non-empty server Token passes; missing Token fails; Auth0 provider plus flag fails; test/staging/production plus flag fails; non-loopback app/backend origin fails; flag false preserves all existing behavior.
2. Add a source assertion that neither variable uses `NEXT_PUBLIC_`, and that the returned config never renames the desktop Token to a public value.
3. Run `pnpm exec tsx --test src/features/auth/model/auth-config.test.tsx` from `apps/frontend`; record the expected red failures.
4. Add `desktopAutoAuth` and `desktopAccessToken` to the server-only `AuthConfig`; validate the mode exactly as the controlling spec requires. Reuse a single loopback-origin helper rather than duplicating URL checks.
5. Re-run the same test until green. Do not weaken the existing production Auth0 validation.
6. Commit: `feat(auth): validate desktop auto auth mode`

## Task 2: Add a provider-selecting server runtime without changing the BFF core

**Files:**

- Create: `apps/frontend/src/features/auth/server/runtime-auth.ts`
- Create: `apps/frontend/src/features/auth/server/runtime-auth.test.tsx`
- Modify: `apps/frontend/app/api/[...path]/route.ts`
- Modify: `apps/frontend/app/auth/session/route.ts`
- Modify: `apps/frontend/app/auth/login/route.ts`
- Modify: `apps/frontend/proxy.ts`
- Modify only if required by existing abstractions: `apps/frontend/src/features/auth/server/session.ts`, `apps/frontend/src/features/auth/server/login.ts`, `apps/frontend/src/features/auth/server/proxy-page.ts`

1. Write injected-dependency red tests for a small `runtime-auth` adapter: Auth0 mode delegates unchanged; desktop mode returns the server Token and no rolling cookies, never calls Auth0, passes pages through, returns only the safe local projection, and sanitizes desktop login returnTo before a same-origin 303.
2. Prove invalid config remains a stable no-store 500 and that no response/log/projection contains the Token, issuer, subject, audience or internal ID.
3. Run `pnpm exec tsx --test src/features/auth/server/runtime-auth.test.tsx` from `apps/frontend` and record red.
4. Implement the smallest server-only adapter. Keep `handleBffRequest` unchanged unless a demonstrated test requires a narrow change; inject desktop implementations through its existing `BffDeps`.
5. Wire the catch-all BFF, session route, login route and page proxy. Route allowlisting, Origin checks and Auth0 failure semantics remain unchanged.
6. Add/update narrow existing auth tests only when needed, then run all auth tests. If the shell does not expand `**`, use the package full test command; a glob error is not a code failure.
7. Commit: `feat(auth): add server only desktop identity adapter`

## Task 3: Build the reusable authentication-required dialog

**Files:**

- Create: `apps/frontend/src/features/auth/browser/auth-required-dialog.tsx`
- Create: `apps/frontend/src/features/auth/browser/auth-required-dialog.test.tsx`
- Modify: `apps/frontend/src/components/flow-notice.tsx`
- Modify: `apps/frontend/src/lib/api/frontend-api-error.ts`
- Modify: `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`

1. Write red tests for the approved Chinese copy, one dialog only, `role=dialog`, `aria-modal=true`, labelled title/description, 44px actions, safe login href built by existing auth action helpers, and a dismiss action.
2. Isolate DOM behavior behind injectable/pure helpers so the Node runner can prove Escape, initial focus, focus restoration and focus wrapping without a new dependency.
3. Implement `AuthRequiredDialog` in the incumbent atelier visual system. No new font, palette, dependency, global provider, animation framework or page redesign.
4. Change `FlowNotice` so only `UNAUTHORIZED` renders the dialog. Update the old “开发会话” copy to ordinary user-facing authentication copy; all other codes remain inline.
5. Re-run affected tests green. After UI is complete run the Impeccable detector once:
   `node /Users/chenyanyan/.codex/skills/impeccable/scripts/detect.mjs --json apps/frontend/src/features/auth/browser/auth-required-dialog.tsx apps/frontend/src/components/flow-notice.tsx apps/frontend/src/features/tarot/components/tarot-setup.tsx`
   Fix material findings in one bounded batch and confirm only once if edits were needed.
6. Commit: `feat(frontend): prompt unauthenticated users to sign in`

## Task 4: Route Tarot setup 401 to the dialog

**Files:**

- Modify: `apps/frontend/src/features/tarot/tarot-setup.test.tsx`
- Modify: `apps/frontend/src/features/tarot/components/tarot-setup.tsx`

1. Replace the broad “all errors are inline non-modal” assumption with two red cases: ordinary failures remain inline and `UNAUTHORIZED` opens the shared dialog.
2. Preserve `FrontendApiError.code` in Tarot state; never infer auth from message text.
3. On 401, stop submitting and render the dialog. Dismissal keeps inputs and restores focus to “进入抽牌”; a later retry may reopen it. Other errors keep the existing inline message.
4. Run `pnpm exec tsx --test src/features/tarot/tarot-setup.test.tsx` from `apps/frontend` until green.
5. Commit: `fix(tarot): present login action on unauthorized setup`

## Task 5: Update contracts and the local launcher

**Files:**

- Modify: `docs/AUTH_SESSION_CONTRACT.md`
- Modify: `docs/SECURITY_AND_PRIVACY.md`
- Modify: `docs/LOCAL_DEMO_GUIDE.md`
- Modify: `docs/INDEX.md`
- Modify exact row only: `docs/governance/FEATURE_REGISTRY.md`
- External modify: `/Users/chenyanyan/Desktop/玄矶系统.command`
- External modify: `/Users/chenyanyan/Library/LaunchAgents/com.mystcrag.frontend.plist`

1. Distinguish the sole production Auth0 browser session from the server-only desktop adapter. Document its exact matrix, safe projection, Auth0 signup tenant prerequisite, Token custody and maximum eight-hour launcher lifetime.
2. Add this spec/plan to `docs/INDEX.md`; update only FEAT-018's note without declaring production acceptance.
3. In the launcher, set canonical app/callback/logout/issuer/audience values before signing; generate `exp=now+28800`; export `MYSTCRAG_DESKTOP_AUTO_AUTH=true` and `MYSTCRAG_DESKTOP_ACCESS_TOKEN`; remove every generated/exported `NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN`.
4. Keep runtime env mode 0600. Make the Frontend plist source runtime env without fake Auth0 or `.invalid` overrides. Do not modify backend/asset-worker plists unless a concrete failure proves it necessary.
5. Do not point the script at the task worktree and do not restart current launchd services. Codex restarts main after review/integration.
6. Validate without printing secrets: `bash -n '/Users/chenyanyan/Desktop/玄矶系统.command'` and `plutil -lint '/Users/chenyanyan/Library/LaunchAgents/com.mystcrag.frontend.plist'`. Static checks may print variable names, expiry arithmetic and file mode only.
7. Commit repository docs only: `docs(auth): document login prompt and desktop identity`

## Task 6: Full verification and handoff

1. Run `pnpm --filter @mystcrag/frontend test`, `typecheck`, `lint`, `build`, the narrow Auth/frontend architecture test, `pnpm validate`, and `git diff --check main...HEAD`.
2. Use a separate local test process—not launchd—to prove valid desktop session/BFF success with zero Auth0 call; missing/expired/wrong-audience Token failure without leaks; Auth0 401 dialog and validated login route; desktop and 390px keyboard/Escape/dismiss behavior with no unexpected console errors.
3. Inspect `git diff --name-status main...HEAD` against the writable paths. Preserve every unrelated file/output.
4. Update only TASK-AUTH-009 status to `REVIEW` with actual commit IDs/results. Never write `DONE`; Codex owns acceptance.
5. Handoff must contain final commit, changed files, red/green evidence, complete command results, browser evidence paths, external file validation, limitations, and confirmation of no push/deploy/main merge. Do not paste full logs/source.

## Definition of Done

- Every acceptance criterion in the spec has direct test or browser evidence.
- Auth0 production behavior is unchanged and desktop mode is unreachable outside explicit loopback development.
- No browser-visible Token or `NEXT_PUBLIC_*` credential exists.
- Admin bead-import auth remains independent.
- Worktree is clean after final conventional commit and TASK-AUTH-009 is `REVIEW`, awaiting Codex.
