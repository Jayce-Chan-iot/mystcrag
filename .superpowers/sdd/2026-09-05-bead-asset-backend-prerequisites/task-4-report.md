# Task 4 report — TASK-ASSET-BE-001

Status: NEEDS_CONTEXT (paused at controller ruling for TASK-ASSET-DB-003).

## Implemented checkpoint

- Added an independent asset-admin credential boundary using equal-byte-length `timingSafeEqual` comparison.
- Missing, duplicate, wrong, too-short, or unconfigured credentials fail closed; authentication returns only the fixed server-owned audit actor `asset-admin-local-operator`.
- Added the asset-route-local `AssetImportApiError` foundation without changing the global backend error contract.
- Added `createApp` management gating: registration prerequisites are considered only when `assetImportEnabled === true`; enabled mode requires the independent admin key and both injected asset services.
- Kept the management surface absent when the flag is false/default.

Commit: `ee145c0 feat(asset-backend): add fail-closed admin auth`

Files in checkpoint:

- `apps/backend/src/app.ts`
- `apps/backend/src/app.test.ts`
- `apps/backend/src/modules/bead-asset-import/bead-asset-import.auth.ts`
- `apps/backend/src/modules/bead-asset-import/bead-asset-import.auth.test.ts`
- `apps/backend/src/modules/bead-asset-import/bead-asset-import.errors.ts`

## Blocking prerequisite discovered

`AssetImportRepository.resolveUploadTarget()` atomically changes a source file from `PENDING`/`FAILED` to `UPLOADING` before the stream is consumed, as required by the upload ruling. The repository currently exposes no operation that releases/fails this reservation if `putStagingStream`, length/hash verification, bounded magic-byte classification, or enqueue fails. A subsequent reserve rejects `UPLOADING`, leaving the file permanently stuck and violating the API requirement that a failed file can be re-PUT without duplicating rows.

The controller ruled that this cannot be accepted and will register a separate minimal `TASK-ASSET-DB-003`. This task did not modify `packages/database` or implement an unsafe substitute. Implementation must resume after that dependency is integrated, using its exact accepted API.

## TDD evidence

- RED: `pnpm --filter @mystcrag/backend exec tsx --test src/modules/bead-asset-import/bead-asset-import.auth.test.ts` initially failed because the credential boundary was absent, then failed all 3 behavioral assertions against the explicit not-implemented scaffold.
- GREEN: the same focused auth command passed 3/3.
- RED: `pnpm --filter @mystcrag/backend exec tsx --test src/app.test.ts` passed 2 and failed 1 because enabled management did not fail closed without `assetAdminApiKey`.
- GREEN/refactor: focused app + auth tests passed 6/6 after exact feature gating and configuration validation.

## Verification run

- Baseline `pnpm --filter @mystcrag/backend test`: 176 tests, 174 passed, 2 skipped, 0 failed.
- Checkpoint `pnpm --filter @mystcrag/backend test`: 181 tests, 179 passed, 2 skipped, 0 failed.
- `pnpm --filter @mystcrag/backend lint`: passed.
- `pnpm --filter @mystcrag/backend typecheck`: passed.
- `git diff --check`: passed.

Not run because the task is intentionally paused before the service/routes exist: Backend build, database/asset-pipeline regressions, architecture tests, fresh PostgreSQL Backend E2E, and full `pnpm validate`.

## Self-review and concerns

- Credential comparison uses UTF-8 byte length, rejects duplicate header values, and never returns the secret as actor identity.
- Current checkpoint does not register any asset route and does not claim any of the 18 routes are implemented.
- `CreateAppOptions` uses temporary `unknown` service slots only to enforce the fail-closed checkpoint. Replace them with concrete application service types when route composition resumes.
- Error serialization, explicit logger redaction, bounded streaming probe, strict response projection, public delivery integrity checks, runtime ArchiveStore composition, environment docs, dependency/lockfile changes, all 18 routes, and real PostgreSQL E2E remain outstanding.
- Task registry remains `IN_PROGRESS`, not `REVIEW`, because the deliverable is incomplete.

## Continuation — 2026-09-06

Status: REVIEW.

### Takeover audit and implementation

- Preserved the inherited uncommitted implementation and reviewed every changed/new runtime, route, service, test, environment, dependency and security-document file before making changes.
- Confirmed all 18 HTTP surfaces: the 17 authenticated `/api/admin/bead-import/**` routes and public `GET /api/assets/:assetKey`. Each route parses shared strict parameter/request/response schemas; upload transport metadata is locally strict because its binary body has no JSON DTO.
- Confirmed independent `ASSET_ADMIN_API_KEY` authentication uses equal-length UTF-8 buffers with `timingSafeEqual`, maps successful requests only to `asset-admin-local-operator`, and serializes missing/duplicate/wrong credentials as transport-only `401 UNAUTHORIZED` without `ADMIN_PERMISSION_EXPIRED` or another business detail.
- Confirmed upload checks one positive, non-duplicated decimal `Content-Length` and optional one lowercase `X-Content-SHA256` before repository reservation or source reads. The service passes a stream once into `putStagingStream`, retains at most the fixed 8 MiB probe, fails closed when content kind cannot be proven (including ARW), verifies staged byte count/hash/kind, enqueues archive work, returns schema-valid `UPLOADING`, and exposes no staging/archive key.
- Confirmed every pre-enqueue failure removes a created staging object and invokes `failUploadReservation`; cleanup errors are suppressed so the specific client error remains authoritative. The database recovery API itself preserves active archive work.
- Confirmed session projection removes archive keys, storage provider, job and internal group fields; responses are parsed again against shared schemas. Actor-bearing repository mutations receive only the fixed server-side actor.
- Confirmed public delivery resolves only a Contract-parsed `approved:<sha256>` key through `findApprovedPublicAsset`, reads only the repository-returned key, rechecks actual byte length and SHA-256 against database metadata/key, validates allowed content type and exact strong quoted ETag/cache headers, and does not construct storage paths.
- Confirmed exact `MYSTCRAG_ASSET_IMPORT_ENABLED=true` controls only registration of the admin surface. During takeover audit, repaired a regression where disabled management also removed approved-public delivery: with a valid archive root, the public service remains composed without an admin key; without storage configuration, neither service is created. Runtime repository-root discovery uses `git worktree --porcelain`, realpaths each root and fails closed when discovery/verification is not provable.
- Confirmed production composition builds one archive store/repository runtime, adds database disconnect to Fastify close, owns the direct asset-pipeline dependency/lockfile entry, documents environment/security behavior, and redacts administrator/authorization/cookie/body/raw request fields from structured logs.

### TDD evidence for takeover repair

- RED: added `disabled import management retains approved public delivery when archive storage is configured` to `bead-asset-import.runtime.test.ts`; focused runtime suite failed 5 pass / 1 fail because `createAssetImportRuntime()` returned `undefined` with the management flag off.
- GREEN: changed runtime composition so a configured archive root creates `ProductAssetService` independently, while admin service/key remain exact-flag gated; focused runtime suite passed 6/6.

### Verification

- Focused backend asset suites: 27 passed, 1 intentionally environment-gated E2E skipped; backend lint, typecheck and build passed.
- Fresh PostgreSQL Backend E2E: created and retained `mystcrag_assetbe001_e2e_test_undefined`, applied all 15 migrations, then passed 1/1 real upload → archive → grouping → processing → review → curation → publication → approved-delivery scenario.
- Fresh PostgreSQL full database regression: created and retained `mystcrag_assetbe001_dbreg_test_163702_12885`, applied all 15 migrations, `pnpm db:test` passed 233/233, 0 skipped.
- Asset pipeline regression: `pnpm --filter @mystcrag/asset-pipeline test` passed 134/134.
- Architecture: `node --test tests/*.test.mjs` passed 20/20.
- Full backend suite after integration: `pnpm --filter @mystcrag/backend test` passed 204/207 with 3 expected environment-gated skips and 0 failures.
- Final `pnpm validate`: passed all lint/typecheck/test/build stages for 17 packages; architecture 20/20 passed. `git diff --check` passed before task-record/report updates and again before commit.

### Files and self-review

- New route/service/runtime/test files are under `apps/backend/src/modules/bead-asset-import/` and `apps/backend/src/modules/product-assets/`; composition changes are in `apps/backend/src/app.ts` and `apps/backend/src/index.ts`; configuration/security/dependency updates are `.env.example`, `apps/backend/package.json`, `pnpm-lock.yaml`, and `docs/SECURITY_AND_PRIVACY.md`.
- Reviewed concern: the E2E database name has an `_undefined` suffix because its first local shell helper did not export a generated suffix before URL construction. It is nevertheless a newly created, dedicated, allowed `mystcrag_*test*` database, was migrated once and retained as required; no connection string or credential was logged. The separately generated full-regression database has a unique suffix.
- No known implementation blocker remains. No source photographs were imported, no push/deploy/merge was performed, and task registry is now `REVIEW`, not `DONE`.
