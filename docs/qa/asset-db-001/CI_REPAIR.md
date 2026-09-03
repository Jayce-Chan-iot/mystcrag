# PR #5 — AUTH CI connection repair

- Task: TASK-AUTH-CI-001; SOL, under the Product Owner's explicit one-task test-only exception (2026-09-03).
- Baseline: `ed03ba2dc05825cd6081fd6975ef5c23ca578ef2`.
- Repair branch: `task/auth-ci-001-database-connection`; forward the reviewed repair to the existing PR #5 head without force-push. Do not merge or deploy.
- Task 3 planning branch remains at `64f1be3`; no Task 3 changes are included.

## Root cause and evidence

[Original failed AUTH job](https://github.com/Jayce-Chan-iot/mystcrag/actions/runs/33716091875/job/100525464572) on PR #5: 49/54 passed; A1+A2, A3, A4, A5 and E1 failed at direct SQL assertions with `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`. The workspace validation and PostgreSQL verification jobs succeeded.

Setup/teardown in `tests/auth-e2e/fixtures/stack.mts` and CI use `AUTH006_DATABASE_ADMIN_URL`. The worker helper in `tests/auth-e2e/helpers/run-state.mts` incorrectly read `AUTH006_DATABASE_URL`, then fell back to a passwordless local URL. Backend setup received the correct connection, while worker-side database assertions did not. An isolated subprocess reproduction confirmed an explicit admin password was present but the helper returned a URL without a password.

This mismatch pre-existed the asset database diff: the PR's baseline-to-candidate diff does not modify the auth harness or CI workflow. Local passwordless PostgreSQL configurations can mask it; a successful local historical run was not evidence of compatibility with CI authentication.

## Minimal repair and regression gate

- Correct the worker helper's canonical environment variable; normalize the ambient DATABASE_URL search/hash exactly as setup does. Preserve the documented local fallback.
- Add four independent subprocess regression cases to `tests/auth-ci-database-url.test.mjs`: explicit CI credentials, canonical priority, ambient normalization and local fallback. Only synthetic URLs are supplied; no database or artifact is created by these cases.
- The existing root test discovery runs them in `pnpm test` and `pnpm validate`, including remote CI. No workflow change, dependency change, auth assertion change or retry/skip is needed.
- Keep `isolatedDatabaseUrl()` selecting this run's isolated database, never a developer database.

TDD evidence: `node --test tests/auth-ci-database-url.test.mjs` failed 3/4 before the helper repair (missing credentials, wrong priority, unstripped search/hash), exit 1. After the repair all 4/4 passed, exit 0.

## Verification

| Check | Result |
| --- | --- |
| Narrow regression | 4/4, exit 0 |
| Architecture single-file | 15/15, exit 0 |
| `pnpm validate` | lint/typecheck/test/build each 15/15 cached; root tests actually executed 20/20, exit 0 |
| Full AUTH run 1 | `rmtl31u07iboltodn9r`, 54/54, exit 0; isolated DB dropped/verified gone, ports released, artifact scan passed (220 text files) |
| Full AUTH run 2 | `rmtl34kvgrnzgabicai`, 54/54, exit 0; independent fresh stack, isolated DB dropped/verified gone, ports released, artifact scan passed (220 text files) |
| Final scope/document checks | No business/CI workflow/sanitizer diff; internal document links and `git diff --check` passed |

Full AUTH runs use the RUNBOOK command with the canonical local admin connection supplied via environment. Passwords/connection strings are deliberately omitted from this report:

```sh
pnpm exec playwright test --config tests/auth-e2e/playwright.config.mts
```

Both runtimes are built from unmodified production sources in run-scoped checkouts. Successful local E2E results do not substitute for remote CI; remote results must be checked against the pushed head SHA.

## Secondary failure: intentionally preserved security gate

The original failed run's sanitizer also rejected five `symbolic-link-in-source` entries and published nothing. The harness creates dependency links inside its run-scoped build checkout, while the sanitizer rejects all source symlinks. This is a separate diagnostic availability limitation, not the cause of the SQL failures and not evidence that credential material was uploaded.

The sanitizer and its regression tests remain unchanged; no traversal, raw upload, relaxed pattern, bypass or deletion of evidence is introduced. The RUNBOOK now records the limitation. A future redesign of the evidence root needs separate scope/review; this repair does not claim failed-run artifact publication has been restored.

## Scope and handoff

Only the registered five test/document paths change. Business runtime, schema/migrations, shared Contract, authentication test assertions, CI workflow, sanitizer and Task 3 are untouched. Original GLM handoff and SOL acceptance evidence remain unchanged. No production database is modified; only the E2E harness's newly created disposable databases are automatically removed by its verified teardown.
