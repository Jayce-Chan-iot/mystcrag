# Bead Asset Backend Prerequisites Implementation Plan

> **Execution note:** use `superpowers:executing-plans`, preserve the existing dirty `asset-contract-002` worktree, and complete each task contract-first with red/green tests before integrating it into local `main`.

**Goal:** Restore the cancelled human-review/curation contract and close the storage/database interfaces required to implement the bead-asset admin API without buffering folders, inventing a second storage path, or bypassing human approval.

**Architecture:** The shared Design Contract owns HTTP DTOs and state guards. `ArchiveStore` remains the only filesystem boundary and gains a bounded streaming staging primitive. The database repository owns transactional idempotency, optimistic revisions, grouping materialization and publish eligibility. The backend then composes those authorities behind an isolated admin key and exposes approved public assets by opaque key only.

**Tech stack:** TypeScript, Zod, Fastify, Prisma/PostgreSQL, Node streams/crypto, Node test runner, pnpm/Turbo.

**Controlling specification:** `docs/superpowers/specs/2026-08-31-bead-asset-import-assistant-design.md`, `docs/API_SPECIFICATION.md`, `docs/ASSET_PIPELINE.md`, `docs/DATABASE_SCHEMA.md`, `docs/SECURITY_AND_PRIVACY.md`.

## Global constraints

- The Product Owner explicitly restored `TASK-ASSET-CONTRACT-002` and temporarily assigned the QWEN/GLM implementation work to Codex on 2026-09-05. The registry keeps the canonical module owner labels and records the temporary executor.
- Never accept or return an absolute client/server path. Never log source bytes, credentials, raw authorization headers or private storage roots.
- Human approval remains distinct from automated QC. `QC_PENDING`/`QC_FAILED` cannot publish; only an explicitly approved, current processed asset can become public.
- Every mutation with an idempotency key must return the original result on an exact retry and reject the same key with a different fingerprint.
- Database changes are additive only. No existing rows, migrations, assets or user files are deleted.
- Do not edit generated Prisma clients, build output, coverage or captured QA output.

## Task 1: Restore human-review and CrystalDraft-curation contracts

**Task:** `TASK-ASSET-CONTRACT-002`  
**Branch/worktree:** existing `task/asset-contract-002-human-review` / `.worktrees/asset-contract-002`  
**Depends on:** `TASK-ASSET-CONTRACT-001`

**Files:**

- Modify: `packages/design-contract/src/schemas/bead-asset-import-api.schema.ts`
- Modify: `packages/design-contract/src/index.ts`
- Modify: `packages/design-contract/tests/bead-asset-import-api.test.ts`
- Modify: `docs/API_SPECIFICATION.md`
- Modify only its row: `docs/tasks/TASK_REGISTRY.md`

**Required interfaces:**

- `ReviewProcessedAssetParams/Request/ResponseSchema` with an `APPROVE | REJECT` discriminated request, group revision, idempotency key, review note and mandatory human permission/authenticity/public-display decisions on approval.
- Pure guards for QC transition and human-review eligibility; automated QC can only reach `QC_PENDING` or `QC_FAILED`.
- `UpdateCrystalDraftCurationParams/Request/ResponseSchema` with optimistic revision, idempotency key, curated names/mineral/tags/price level/compliance note, completeness reporting and promotion eligibility.
- Strict unknown-key rejection and no path/credential fields.
- API table rows for `POST /api/admin/bead-import/groups/:groupId/processed-assets/:processedAssetId/review` and `PATCH /api/admin/bead-import/crystal-drafts/:crystalDraftId`.

**TDD sequence:**

1. Preserve and run the existing 422-line red-test draft; confirm failures are missing contract exports, not unrelated regressions.
2. Implement only the schemas, constants and pure guards required by the tests.
3. Export the new public contract surface and document both endpoints, status codes, idempotency and human-approval invariants.
4. Run `pnpm --filter @mystcrag/design-contract test`, lint/typecheck, architecture tests, `git diff --check`, then `pnpm validate`.

## Task 2: Add bounded streaming staging to canonical storage

**Task:** `TASK-ASSET-STORAGE-002`  
**Branch/worktree:** `task/asset-storage-002-streaming-upload` / `.worktrees/asset-storage-002`  
**Depends on:** `TASK-ASSET-WORKER-001`

**Files:**

- Modify: `packages/asset-pipeline/src/storage.ts`
- Modify: `packages/asset-pipeline/tests/storage.test.ts`
- Modify: `packages/asset-pipeline/src/index.ts`
- Modify: `docs/ASSET_PIPELINE.md`
- Modify only its row: `docs/tasks/TASK_REGISTRY.md`

**Required interface:**

`ArchiveStore.putStagingStream(sessionId, source, limits)` consumes one `AsyncIterable<Uint8Array>` with bounded bytes, hashes while writing, writes atomically inside the canonical staging root, rejects early/late length mismatches, cleans incomplete files, preserves the existing worktree/root guards, and returns only opaque storage metadata (`stagingKey`, `byteSize`, `sha256`). It must never buffer a whole folder or expose a filesystem path.

**TDD sequence:**

1. Add failing tests for chunked success, oversize, declared-length mismatch, source error, atomic cleanup, unsafe session IDs and opaque return values.
2. Implement with exclusive temporary creation, incremental SHA-256, explicit byte cap, fsync/rename/directory-fsync using existing safe storage helpers.
3. Export the method/type, document its trust boundary, and run package tests, lint/typecheck, architecture tests, `git diff --check`, then `pnpm validate`.

## Task 3: Add database orchestration and durable idempotency

**Task:** `TASK-ASSET-DB-002`  
**Branch/worktree:** `task/asset-db-002-backend-orchestration` / `.worktrees/asset-db-002`  
**Depends on:** `TASK-ASSET-CONTRACT-002`, `TASK-ASSET-DB-001`, `TASK-ASSET-WORKER-001`

**Files:**

- Modify: `packages/database/prisma/schema.prisma`
- Add: `packages/database/prisma/migrations/20260905_add_asset_backend_orchestration/migration.sql`
- Modify: `packages/database/src/repositories/asset-import.repository.ts`
- Modify: `packages/database/src/repositories/asset-import.repository.unit.test.ts`
- Modify: `packages/database/src/repositories/asset-import.repository.integration.test.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `docs/DATABASE_SCHEMA.md`
- Modify only its row: `docs/tasks/TASK_REGISTRY.md`

**Required interfaces and invariants:**

- Query/list session projections including registered file declarations, persisted groups, jobs and safe review state.
- Resolve an upload target only when `fileId` belongs to `sessionId`, is still mutable, and declared size/kind match.
- Enqueue archive/group/process/reprocess work with durable idempotency and deterministic conflict behavior.
- Materialize a completed `GROUP_SESSION` result transactionally into groups/file membership; never treat job JSON alone as approved grouping state.
- Edit group name/membership/primary selection and processed-version selection with `expectedGroupRevision` compare-and-swap.
- Persist review actor/note/permission decisions/idempotency; approval must target the current QC-passed asset, rejection must remain non-public.
- Curate `CrystalDraft` with its own optimistic revision/idempotency and completeness calculation; promotion remains explicit.
- Cancel sessions, expose publish results and preserve existing publish transaction/public-asset lookup behavior.
- Add only the minimal columns/table required for durable operation idempotency, review audit and CrystalDraft revision. Migration must be additive and safe for existing rows.

**TDD sequence:**

1. Add unit contract tests for method validation and red integration tests on a fresh migrated PostgreSQL database for G1–G5, retries/conflicts and concurrent compare-and-swap.
2. Add the migration/schema, then implement repository methods in transactions with authoritative relation checks.
3. Replace the repository-local review DTO with the restored shared Contract and document models/indexes/idempotency/audit behavior.
4. Run Prisma format/validate/generate (without committing generated output), package unit/integration tests on a fresh empty database, `pnpm db:test`, architecture tests, `git diff --check`, then `pnpm validate`.

## Task 4: Implement the bead-asset backend API

**Task:** `TASK-ASSET-BE-001`  
**Branch/worktree:** `task/asset-be-001-import-api` / `.worktrees/asset-be-001`  
**Depends on:** Tasks 1–3 above and `TASK-ASSET-WORKER-001`

**Files:**

- Add/modify: `apps/backend/src/modules/bead-asset-import/**`
- Add/modify: `apps/backend/src/modules/product-assets/**`
- Modify: `apps/backend/src/app.ts`
- Modify: `apps/backend/src/index.ts`
- Modify: `apps/backend/package.json`
- Modify: `.env.example`
- Modify: `docs/SECURITY_AND_PRIVACY.md`
- Modify only its row: `docs/tasks/TASK_REGISTRY.md`

**Required behavior:**

- Compose every route in `docs/API_SPECIFICATION.md` for session creation/list/status/cancel, manifest, streamed file upload, grouping, processing, group edits/reprocess/version selection, draft save/completeness, human review, curation, publish/result and public asset delivery.
- Protect all `/api/admin/bead-import/**` routes with a separate `ASSET_ADMIN_API_KEY`, constant-time comparison and fail-closed startup/configuration; never reuse the knowledge-admin key.
- Parse all params/query/body/response through the shared schemas. Convert repository/storage failures to the strict asset error union and correct 400/401/404/409/413/415/422/500 status without changing the global error contract.
- Stream one file through `putStagingStream`, verify declaration/length/hash/content classification, then enqueue archival. Never trust MIME/extension alone and never accept a folder path.
- Serve only `findApprovedPublicAsset(assetKey)` through `/api/assets/:assetKey` with exact content type/length, strong quoted SHA ETag and immutable cache control; private staging/raw/processed keys remain unreachable.

**TDD sequence:**

1. Build service and Fastify injection tests first for authentication, parsing, idempotency/conflict, state transitions, upload limits/content mismatch, review gates, curation, publication and opaque public delivery.
2. Implement route/service composition in small red/green increments and wire runtime dependencies/configuration.
3. Run backend tests/lint/typecheck/build, database and asset-pipeline regression suites, architecture tests, `git diff --check`, then full `pnpm validate`.

## Integration and stop conditions

- Integrate locally in dependency order only after each task is `DONE` and its own `pnpm validate` passes: Contract → Storage → Database → Backend.
- After each local integration, run the narrow dependent suites; after Backend integration run `pnpm install --frozen-lockfile && pnpm validate` from clean local `main`.
- Do not push, open/update a PR, deploy, import the user's photos or start frontend Task 5 without separate authorization.
