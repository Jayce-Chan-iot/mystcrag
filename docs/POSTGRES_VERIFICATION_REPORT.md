# Mystcrag PostgreSQL Verification Report

Date: 2026-07-22  
Role: Database Verification Lead  
Branch: `fix/postgres-verification`  
Bug: `BUG-P3-004`  
Result: `PASSED`

## Branch and history identity

| Item | Value |
| --- | --- |
| Cleanup/reverification baseline | local `main@f182805c13ef557c3c03b081d244977296ceec18` |
| Post-merge report baseline | local `main@962849b30a2abd67ac04f2088219a92767eccbd6` |
| Original candidate HEAD | `d923f0680d8de10f2fc030a651249f48701e3a0b` |
| Old QA boundary removed | `0bb60a44c2fa110b0343a08a5c51e3b43ab2ed7b` |
| Backup reference | `backup/postgres-pre-cleanup@d923f0680d8de10f2fc030a651249f48701e3a0b` |
| Post-cleanup implementation HEAD | `70eea03f40f2a634fee48e67647acfef49d63a25` |
| Final handoff HEAD | The Conventional Commit containing this report; recorded by `git rev-parse HEAD` in the handoff evidence. |

The worktree was clean before history cleanup. The role commit was replayed with
`git rebase --onto main 0bb60a44c2fa110b0343a08a5c51e3b43ab2ed7b fix/postgres-verification`.
After the Tech Lead admitted implementation commit `70eea03` through merge commit `aa94c13`,
the report-only commit was replayed onto the post-auth `main@962849b`. The resulting branch is a
descendant of current local `main` and does not contain the old QA commit, QA reports, or
QA-owned tests in its unique history.

## Exact implementation inventory and current report diff

The implementation inventory admitted by `aa94c13` relative to its pre-merge baseline was:

```text
A .github/workflows/postgres-verification.yml
M docs/DEPLOYMENT_GUIDE.md
A docs/POSTGRES_VERIFICATION_REPORT.md
M package.json
M packages/database/package.json
A packages/database/prisma/prepare-test-database.ts
A packages/database/prisma/seed.integration.test.ts
M packages/database/src/repositories/persistence.integration.test.ts
```

After that controlled merge, the current `git diff --name-status main...HEAD` is report-only:

```text
M docs/POSTGRES_VERIFICATION_REPORT.md
```

The approved shared change is `DEC-P35-POSTGRES-TEST-COMMAND-001`: the root `db:test`
command now requires a guarded `TEST_DATABASE_URL` preparation/migration/test chain.
There is no diff under `packages/database/prisma/schema.prisma` or
`packages/database/prisma/migrations`; neither Prisma Schema nor migration SQL semantics
changed. No Design Contract, API, Backend, Frontend, AI, Three Engine, QA report, QA plan,
bug report, or QA-owned test changed.

## Environment and evidence identity

| Item | Verified value |
| --- | --- |
| PostgreSQL | `17.10 (Homebrew)`, aarch64, 64-bit |
| Execution environment | Apple Silicon macOS; temporary local PostgreSQL cluster initialized with `initdb`, bound to localhost only, and stopped after the run |
| Node / pnpm | Node `26.0.0`; pnpm `11.4.0` |
| Seed database | `mystcrag_seed_test` |
| Repository test database | Fresh `mystcrag_repository_test_local_20260722_rerun` database |
| Migration | `20260721140000_init_mystcrag_persistence_v1` |
| Live log summary | `/tmp/mystcrag-postgres-verification-rerun.log`; `POSTGRES_VERIFICATION_ENV version=17.10 (Homebrew)` and `POSTGRES_VERIFICATION_SUMMARY passed=12 failed=0 transaction=passed triggers=passed` |
| CI run identifier | Not available: this repository has no configured remote. The checked-in workflow is ready for the first GitHub run; the local live log summary above is the retained execution evidence for this handoff. |

The run used a real PostgreSQL server and the generated Prisma PostgreSQL client. No unit double or in-memory repository result is counted as live PostgreSQL evidence.

## CI PostgreSQL service

`.github/workflows/postgres-verification.yml` adds a PostgreSQL `17-alpine` service and runs the required commands in this order:

1. `pnpm db:migrate` against the empty `mystcrag_seed_test` database.
2. `pnpm db:seed`.
3. `pnpm db:seed` again, followed by `db:verify-seed`.
4. `pnpm db:test` against a newly created `mystcrag_repository_test_<run_id>_<attempt>` database.
5. `pnpm validate` without `DATABASE_URL`, so the normal workspace gate remains deterministic and the separately recorded live suite is not rerun against dirty state.

The service credential is an ephemeral CI-only value in the workflow. No cloud database credential or repository secret is committed.

`pnpm db:test` no longer calls destructive `prisma migrate reset`. It requires `TEST_DATABASE_URL`, accepts only a `mystcrag_*test*` database name, creates the database when absent, refuses a non-empty existing database, deploys the reviewed migration, and then runs the live suite.

Protection checks were executed separately and all refused operation with exit status 1:

- missing `TEST_DATABASE_URL`;
- a database name outside the `mystcrag_*test*` pattern;
- the already migrated and seeded non-empty `mystcrag_seed_test` database.

## Migration and seed results

Empty-database migration result: one migration found and applied successfully. `_prisma_migrations` contained exactly the reviewed baseline, with a non-null `finished_at` and null `rolled_back_at`.

The seed completed twice without duplicate rows. The live verifier returned:

| Seed entity | Count after second seed |
| --- | ---: |
| Users | 1 |
| Crystals | 3 |
| Material products | 6 |
| Accessory products | 2 |
| Pricing rules | 2 |
| Inventory snapshots | 8 |
| Designs | 3 |
| Design revisions | 4 |
| Publications | 1 |
| Orders | 1 |
| Order snapshots | 1 |

All seeded current-design JSON values passed read validation. The publication still referenced revision 1 while the current design was revision 2, and the seeded order retained a BIGINT `5500` total plus its one-to-one snapshot.

## Live PostgreSQL verification matrix

| # | Requirement | Live result |
| ---: | --- | --- |
| 1 | Empty database migration | Passed; the fresh database received only `20260721140000_init_mystcrag_persistence_v1`. |
| 2 | Seed | Passed twice; exact stable counts are recorded above. |
| 3 | Design revision 1 | Passed; design creation atomically stored current revision 1 and one immutable revision row. |
| 4 | Optimistic concurrency conflict | Passed; two simultaneous revision-1 updates produced exactly one revision-2 winner and one `CONFLICT`. |
| 5 | Transaction rollback | Passed; a deliberate revision uniqueness failure rolled the current-design update back to revision 1. Failed order validation also left order and snapshot counts unchanged. |
| 6 | Immutable revision | Passed; PostgreSQL trigger rejected both `UPDATE` and `DELETE`. |
| 7 | Immutable order snapshot | Passed; trigger rejected snapshot `UPDATE` and `DELETE`; the order delete trigger also rejected physical deletion. |
| 8 | Publication fixed revision | Passed; a revision-3 publication continued returning revision 3 after the current design advanced to revision 4. |
| 9 | BIGINT minor-unit adapter | Passed; `Number.MAX_SAFE_INTEGER` round-tripped and `MAX_SAFE_INTEGER + 1` was rejected as `DATA_INTEGRITY_ERROR`. |
| 10 | JSON schema read/write validation | Passed; repository write rejected an unknown field and repository read rejected deliberately malformed persisted JSON. |
| 11 | Foreign-key delete policies | Passed; live deletes of the referenced user, design, and crystal were rejected by PostgreSQL `RESTRICT` constraints. |
| 12 | Repeated seed strategy | Passed; two consecutive seed executions retained the exact expected fixture counts and fixed references. |

## Test counts and command results

| Command or suite | Result |
| --- | --- |
| `pnpm db:migrate` | Passed; 1/1 migration applied to empty seed database. |
| First `pnpm db:seed` | Passed. |
| Second `pnpm db:seed` | Passed. |
| Seed verification | 1/1 passed. |
| `pnpm db:test` | 17/17 passed: 4 mapper/error unit tests, 12 live matrix subtests, and the matrix parent test; 0 failed, 0 skipped. |
| Transaction tests | Passed: design update rollback and order/snapshot no-write rollback. |
| Trigger tests | Passed: revision update/delete, snapshot update/delete, and order delete were rejected. |
| Root architecture tests in `pnpm validate` | 7/7 passed. |
| Design Contract | 25/25 passed. |
| Backend | 11/11 passed. |
| AI Agent | 25/25 passed. |
| Three Engine | 14/14 passed. |
| Frontend | 19/19 passed. |
| Database unit gate | 4/4 passed. |
| UI | 0 tests; no failure. |
| `pnpm validate` | Passed: 7/7 lint tasks, 7/7 strict typecheck tasks, all tests, Prisma validation, and 7/7 builds including Backend and Frontend production builds. |

## Conclusion

`BUG-P3-004` has passing live PostgreSQL evidence for the database-owned scope. The baseline migration, repeated seed, optimistic concurrency, atomic rollback, immutable revision and order snapshot triggers, fixed-revision publication, BIGINT adapter, JSON validation, and foreign-key deletion policies all executed successfully on PostgreSQL 17.10.

The remaining infrastructure follow-up is to capture the first hosted workflow run identifier after this branch is pushed to a GitHub repository. That does not invalidate the local live evidence; the workflow reproduces the same commands with PostgreSQL 17 and fresh isolated databases.

## Handoff and rollback

- Focused real-database result: migration 1/1, repeated-seed verification 1/1, and database tests 17/17 passed with 0 failed and 0 skipped.
- Full repository gate: `pnpm validate` passed after the rebase and live run.
- Real versus Mock: every result in the live verification matrix used PostgreSQL 17.10 and the generated Prisma PostgreSQL client; no unit double is counted as live evidence.
- Known limitation: no remote is configured, so a hosted GitHub Actions run identifier does not yet exist.
- Rollback: revert the database-verification merge as one unit. No production or non-test database was modified, reset, or dropped.
- Merge assessment: implementation admitted by `aa94c13`; final report-only commit is `READY_FOR_TECH_LEAD_REVIEW`.
