# Bead Asset Import Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a local-first bead-photo import assistant at `/admin/bead-import` that archives original ARW/JPG files outside Git, groups related photos, accepts human bead names, produces conservative cut-outs and enhanced previews, saves drafts, and publishes approved assets and inventory records transactionally.

**Architecture:** A shared Zod contract defines the state machine and HTTP DTOs. PostgreSQL stores import metadata, processing jobs, drafts, approved asset bindings and inventory snapshots; local files live below `MYSTCRAG_ASSET_ARCHIVE_ROOT`. The backend streams uploads and exposes authenticated admin APIs plus an approved-only public asset route. A separate worker runs deterministic Sharp-based processing. The frontend provides a standalone four-step review flow and the existing bead renderer resolves approved asset keys while retaining static fallbacks.

**Tech Stack:** TypeScript, Zod, Fastify, Prisma/PostgreSQL, Next.js App Router, React, Sharp, Vitest, Node test runner, Playwright-compatible Python UI QA, pnpm/Turbo.

**Spec:** `docs/superpowers/specs/2026-08-31-bead-asset-import-assistant-design.md`

## Global constraints

- SOL owns planning, review, acceptance recording and archival only. SOL must not write runtime implementation.
- GLM implements database, backend, storage and the image pipeline/worker. QWEN implements the frontend flow, runtime visual resolver and frontend-oriented integration/QA. The already completed Task 1 Contract assignment to QWEN remains historical and is not a precedent for backend/database ownership.
- Before each implementation task, its executor creates the registered branch/worktree, changes the registry row to `IN_PROGRESS`, and confirms that no other task locks its writable paths.
- After each implementation commit, SOL reviews the diff and verification evidence. The executor addresses review findings before the row moves to `DONE`.
- Never commit files from `/Users/chenyanyan/Desktop/珠子图`, originals, processed photographs, QA screenshots, local databases, credentials, `.next`, `dist`, coverage or generated Prisma clients.
- Do not infer mineral identity, treatment, quality or efficacy from an image. The only identity field is the name entered or confirmed by a human.
- Do not use generative image models. Preserve product hue and texture; uncertain masks must be flagged for review.
- Every behavior change starts with a failing test. Use narrow checks while developing and `pnpm validate` before handoff.
- Use Conventional Commits. A task may not merge until its dependencies are `DONE` and SOL has recorded review acceptance.

## Delivery graph

```text
QWEN Contract
      |
GLM Database
      |
GLM Pipeline + Worker
      |
GLM Backend API
      |
QWEN Admin UI
      |
QWEN Runtime Resolver
      |
QWEN Integration QA
      |
SOL Acceptance + Archive
```

---

## Task 1: Shared import contract

**Registry:** `TASK-ASSET-CONTRACT-001`  
**Executor:** QWEN
**Branch:** `task/asset-contract-001-admin-dtos`

**Files:**

- Create: `packages/design-contract/src/schemas/bead-asset-import-api.schema.ts`
- Create: `packages/design-contract/tests/bead-asset-import-api.test.ts`
- Modify: `packages/design-contract/src/index.ts`
- Modify: `docs/API_SPECIFICATION.md`

- [ ] **Step 1: Write failing state-machine and DTO tests.**

Test strict rejection of unknown keys; valid/invalid transitions; manifest limits; relative-path traversal; allowed file kinds `ARW`, `JPEG`, `PNG`, `WEBP`; review actions; and publish requests. Include these canonical states:

```ts
const sessionStates = [
  "CREATED", "UPLOADING", "ARCHIVING", "PROCESSING",
  "NEEDS_REVIEW", "READY_TO_PUBLISH", "PUBLISHING",
  "PUBLISHED", "PARTIALLY_FAILED", "FAILED"
] as const;
```

Run: `pnpm --filter @mystcrag/design-contract test -- bead-asset-import-api.test.ts`  
Expected: FAIL because the schemas are not exported.

- [ ] **Step 2: Implement the minimum strict schemas.**

Export schemas and inferred types for:

```ts
AssetImportSessionState
AssetSourceFileKind
AssetSourceFileState
BeadImageGroupState
ProcessedAssetState
AssetProcessingJobState
CreateAssetImportSessionRequest/Response
RegisterAssetManifestRequest/Response
UploadAssetFileParams/Response
AssetImportSessionResponse
UpdateBeadImageGroupRequest/Response
ReprocessBeadImageGroupRequest/Response
PublishBeadImageGroupRequest/Response
```

Manifest entries must contain `clientFileId`, normalized relative path, byte size, last-modified timestamp and declared kind. The server response supplies upload status and stable file IDs. Publish input accepts explicit human-approved `crystalName`, product fields and `allowPublicDisplay`; it must not accept an arbitrary filesystem path or client-supplied processing result path.

- [ ] **Step 3: Document every endpoint and error code.**

Define request/response examples for manifest registration, binary file PUT, session status, grouping edits, reprocessing, draft save, publish and retry. Specify `400`, `401`, `404`, `409`, `413`, `415`, `422` and `500` semantics and idempotency behavior.

- [ ] **Step 4: Verify and commit.**

Run:

```bash
pnpm --filter @mystcrag/design-contract lint
pnpm --filter @mystcrag/design-contract typecheck
pnpm --filter @mystcrag/design-contract test
pnpm validate
```

Commit: `feat(contract): define bead asset import API`

- [ ] **SOL review gate:** Confirm the contract contains no filesystem implementation, image inference, public draft access or ambiguous transition; record approval before Task 2 starts.

---

## Task 2: Draft persistence, job leases and transactional publication

**Registry:** `TASK-ASSET-DB-001`  
**Executor:** GLM
**Branch:** `task/asset-db-001-draft-persistence`

**Files:**

- Modify: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/20260831_add_bead_asset_import/migration.sql`
- Create: `packages/database/src/repositories/asset-import.repository.ts`
- Create: `packages/database/src/repositories/asset-import.repository.unit.test.ts`
- Create: `packages/database/src/repositories/asset-import.repository.integration.test.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `docs/DATABASE_SCHEMA.md`

- [ ] **Step 1: Write failing repository unit tests.**

Cover session creation, manifest idempotency, file hash conflict, legal state transitions, retry count, group name edits, asset QC result recording, and compare-and-set job leasing.

Run: `pnpm --filter @mystcrag/database test -- asset-import.repository.unit.test.ts`  
Expected: FAIL because the repository does not exist.

- [ ] **Step 2: Add the non-destructive schema and migration.**

Add models equivalent to:

```text
AssetImportSession -> AssetSourceFile -> BeadImageGroup -> ProcessedAsset
AssetImportSession -> AssetProcessingJob
BeadImageGroup -> CrystalDraft -> MaterialProductDraft
ProcessedAsset -> ProductAssetBinding
```

Use enums for lifecycle states; unique constraints on `(sessionId, clientFileId)`, source SHA-256, stable asset key and active product binding. Store archive keys, never unrestricted absolute paths. `ProductAssetBinding` must distinguish draft/approved/retired and `allowPublicDisplay`.

Add indexes for session status, job availability/lease expiry, group review queue and asset key. Keep existing `Crystal`, `MaterialProduct` and `InventorySnapshot` semantics intact.

- [ ] **Step 3: Implement repository transitions and leases.**

Expose a narrow interface:

```ts
createSession(input)
registerManifest(sessionId, files)
recordUploadedFile(fileId, sha256, archiveKey)
claimNextJob(workerId, leaseUntil)
heartbeatJob(jobId, workerId, leaseUntil)
completeJob(jobId, result)
failJob(jobId, error, retryAt)
saveGroupDraft(groupId, input)
publishGroup(groupId, input)
```

Claim work with an atomic lease (`FOR UPDATE SKIP LOCKED` or equivalent transaction). A crashed lease becomes reclaimable. `publishGroup` must create/approve `Crystal`, create/activate `MaterialProduct`, append `InventorySnapshot`, approve the asset binding and mark the group published in one transaction. Repeating the same publish request returns the existing result; a conflicting request returns `409`.

- [ ] **Step 4: Write and run PostgreSQL integration tests.**

Test two workers cannot claim one job, expired lease recovery, transaction rollback on inventory failure, duplicate publish idempotency and approved-only lookup. Use the repository's standard disposable PostgreSQL test setup.

Run:

```bash
pnpm --filter @mystcrag/database prisma:validate
pnpm --filter @mystcrag/database test
pnpm validate
```

Commit: `feat(database): persist bead asset import drafts`

- [ ] **SOL review gate:** Inspect the SQL for data loss, check rollback/idempotency evidence, and confirm generated clients or local DB files are absent.

---

## Task 3: Deterministic image pipeline and separate local worker

**Registry:** `TASK-ASSET-WORKER-001`  
**Executor:** GLM
**Branch:** `task/asset-worker-001-local-pipeline`

**Files:**

- Create: `packages/asset-pipeline/package.json`
- Create: `packages/asset-pipeline/tsconfig.json`
- Create: `packages/asset-pipeline/src/index.ts`
- Create: `packages/asset-pipeline/src/content-type.ts`
- Create: `packages/asset-pipeline/src/hash.ts`
- Create: `packages/asset-pipeline/src/pairing.ts`
- Create: `packages/asset-pipeline/src/grouping.ts`
- Create: `packages/asset-pipeline/src/storage.ts`
- Create: `packages/asset-pipeline/src/image-processor.ts`
- Create: `packages/asset-pipeline/src/quality.ts`
- Create: `packages/asset-pipeline/tests/*.test.ts`
- Create: `apps/asset-worker/package.json`
- Create: `apps/asset-worker/tsconfig.json`
- Create: `apps/asset-worker/src/index.ts`
- Create: `apps/asset-worker/src/runtime.ts`
- Create: `apps/asset-worker/src/jobs.ts`
- Create: `apps/asset-worker/tests/worker.integration.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `turbo.json`
- Modify: `.env.example`
- Create: `docs/ASSET_PIPELINE.md`

- [ ] **Step 1: Write failing content and pairing tests.**

Use tiny generated fixtures, not user photographs. Test magic-byte detection independent of extension, ARW/TIFF recognition, SHA-256 exact dedupe, same-stem JPG/ARW pairing across different folders, JPG-only and ARW-only groups, deterministic ordering and traversal rejection.

Run: `pnpm --filter @mystcrag/asset-pipeline test`  
Expected: FAIL because the workspace does not exist.

- [ ] **Step 2: Implement storage and verified archival.**

Require `MYSTCRAG_ASSET_ARCHIVE_ROOT`; fail closed if missing or pointing inside the Git repository. Store via generated keys under `originals/<session>/<sha256>/...`, `processed/<session>/<group>/...` and `previews/...`. Write to a temporary file, fsync/close, verify size and SHA-256, then atomically rename. Never trust a submitted filename as a path.

- [ ] **Step 3: Write failing grouping tests, then implement deterministic clustering.**

Calculate a grayscale dHash, compact color histogram and capture-order metadata. Exact duplicates collapse first. Same stems pair. Remaining neighbors may group only when thresholds and capture proximity agree; borderline items become separate review groups. Store similarity evidence so the UI can explain a suggested grouping.

- [ ] **Step 4: Write failing processing/QC tests, then implement conservative transforms.**

Use Sharp to decode the best source, preserve orientation, derive an edge-connected background mask from border samples, retain interior highlights, crop with padding and create transparent 512px WebP plus 256px thumbnail without upscaling. Enhancement may apply bounded exposure/noise/sharpness adjustments but must not synthesize texture or materially shift hue.

QC must report decode failure, subject clipping, alpha coverage, edge halo, blur/effective resolution and color delta. Failed thresholds produce `NEEDS_REVIEW`, never silent approval. Include stable golden numeric assertions, not committed screenshots.

- [ ] **Step 5: Implement the lease-driven worker and resumability tests.**

The worker claims one database job, heartbeats its lease, processes idempotently and records typed results. A restart must skip hash-verified completed outputs and retry only missing/failed stages. Support `SIGTERM` without abandoning an unexpired lease indefinitely.

- [ ] **Step 6: Document local operation and verify.**

Document archive layout, backup expectations, environment variables, recovery and the prohibition on committing originals. Add workspace scripts for worker dev/test without changing unrelated scripts.

Run:

```bash
pnpm install --frozen-lockfile
pnpm --filter @mystcrag/asset-pipeline lint
pnpm --filter @mystcrag/asset-pipeline typecheck
pnpm --filter @mystcrag/asset-pipeline test
pnpm --filter @mystcrag/asset-worker test
pnpm validate
```

Commit: `feat(asset): add local bead processing worker`

- [ ] **SOL review gate:** Verify no network/generative dependency, no raw photos, no repository-local archive default, deterministic grouping evidence and restart-safe outputs.

---

## Task 4: Authenticated import API and approved asset delivery

**Registry:** `TASK-ASSET-BE-001`  
**Executor:** GLM
**Branch:** `task/asset-be-001-import-api`

**Files:**

- Create: `apps/backend/src/modules/bead-asset-import/bead-asset-import.auth.ts`
- Create: `apps/backend/src/modules/bead-asset-import/bead-asset-import.service.ts`
- Create: `apps/backend/src/modules/bead-asset-import/bead-asset-import.routes.ts`
- Create: `apps/backend/src/modules/bead-asset-import/*.test.ts`
- Create: `apps/backend/src/modules/product-assets/product-asset.routes.ts`
- Create: `apps/backend/src/modules/product-assets/product-asset.routes.test.ts`
- Modify: `apps/backend/src/app.ts`
- Modify: `apps/backend/src/index.ts`
- Modify: `apps/backend/package.json`
- Modify: `docs/SECURITY_AND_PRIVACY.md`

- [ ] **Step 1: Write failing auth and upload route tests.**

Require a distinct `ASSET_ADMIN_API_KEY` with timing-safe comparison. Test missing configuration fails closed, absent/wrong key returns `401`, credentials are never logged or returned, oversized payload returns `413`, unsupported magic bytes return `415`, traversal filenames return `400`, and retries do not duplicate rows.

- [ ] **Step 2: Implement streaming manifest and file upload.**

Add:

```text
POST /api/admin/bead-import/sessions
POST /api/admin/bead-import/sessions/:sessionId/manifest
PUT  /api/admin/bead-import/sessions/:sessionId/files/:fileId/content
GET  /api/admin/bead-import/sessions/:sessionId
POST /api/admin/bead-import/groups/:groupId/reprocess
PATCH /api/admin/bead-import/groups/:groupId
POST /api/admin/bead-import/groups/:groupId/publish
```

Stream each file to storage while hashing; do not buffer the folder or accept client paths. Validate actual content type, declared byte size and final SHA-256. Enqueue work only after verified archival. Return per-file status so 127-file imports resume at file granularity.

- [ ] **Step 3: Write failing service transition and publication tests, then implement.**

Reject illegal transitions, processing before archive verification, publish without a human name, publish with failed QC, public display without explicit approval and conflicting duplicate publish. Preserve drafts on partial failure. Reprocess accepts bounded mask/threshold settings only.

- [ ] **Step 4: Implement approved-only public delivery.**

Add `GET /api/assets/:assetKey` (or a signed redirect abstraction with the same contract). It must resolve only approved, active, `allowPublicDisplay=true` bindings; draft/retired/private assets return `404`. Add immutable cache headers/ETag for content-addressed keys and prevent directory traversal.

- [ ] **Step 5: Verify and commit.**

Run:

```bash
pnpm --filter @mystcrag/backend lint
pnpm --filter @mystcrag/backend typecheck
pnpm --filter @mystcrag/backend test
pnpm validate
```

Commit: `feat(backend): expose bead asset import API`

- [ ] **SOL review gate:** Confirm auth is independent of knowledge admin, upload is streaming and bounded, drafts are not public, logs redact secrets and publishing delegates to the database transaction.

---

## Task 5: Standalone four-step admin experience

**Registry:** `TASK-ASSET-FE-001`  
**Executor:** QWEN
**Branch:** `task/asset-fe-001-admin-flow`

**Files:**

- Create: `apps/frontend/app/admin/page.tsx`
- Create: `apps/frontend/app/admin/bead-import/login/page.tsx`
- Create: `apps/frontend/app/admin/bead-import/login/actions.ts`
- Create: `apps/frontend/app/admin/bead-import/page.tsx`
- Create: `apps/frontend/app/admin/bead-import/[sessionId]/page.tsx`
- Create: `apps/frontend/app/api/admin/bead-import/[...path]/route.ts`
- Create: `apps/frontend/src/features/admin-bead-import/admin-auth.ts`
- Create: `apps/frontend/src/features/admin-bead-import/admin-api.ts`
- Create: `apps/frontend/src/features/admin-bead-import/page-guard.ts`
- Create: `apps/frontend/src/features/admin-bead-import/components/*.tsx`
- Create: `apps/frontend/src/features/admin-bead-import/**/*.test.tsx`

- [ ] **Step 1: Write failing route guard and proxy tests.**

Mirror the proven knowledge-admin server-session pattern but use `MYSTCRAG_ASSET_ADMIN_KEY` and a separate cookie. Ensure the key stays server-side, unauthenticated visits redirect to the bead-import login, and the catch-all proxy streams binary bodies and responses without buffering or exposing the key.

- [ ] **Step 2: Implement the independent admin entry.**

`/admin` displays separate cards for knowledge management and bead asset import. `/admin/bead-import` is a standalone dashboard; it must not be nested inside the knowledge UI.

- [ ] **Step 3: Write failing reducer/model tests for the four steps.**

Cover:

```text
1 Upload folder -> 2 Review groups -> 3 Name and adjust -> 4 Compare and publish
```

Test refresh/resume, per-file retry, suggested pair split/merge, one required human bead name per group, failed QC blocking, selective reprocess, save draft and explicit publish confirmation.

- [ ] **Step 4: Implement folder upload and progress.**

Use browser folder selection/drag-and-drop where supported, preserve normalized relative paths only for manifest grouping, register the manifest first and upload each file separately with bounded concurrency and retry. Clearly display unsupported file, archive verified, processing and partial-failure states.

- [ ] **Step 5: Implement review, comparison and publication UI.**

Show source thumbnail, processed transparent result, grouping reason and QC flags. Permit merge/split, mask-threshold adjustment, reprocess, bead name/product fields, inventory quantity, draft save and final publish. Never prefill mineral/quality/treatment claims from image analysis.

- [ ] **Step 6: Add responsive behavior and accessibility tests.**

At 390px, dashboard/status/review remain readable with no horizontal overflow. Folder/mask editing may be desktop-first, but mobile must show a precise explanation and retain view/retry/publish capabilities that are safe. Ensure keyboard focus, labels, progress announcements, error summaries and contrast.

- [ ] **Step 7: Verify and commit.**

Run:

```bash
pnpm --filter @mystcrag/frontend lint
pnpm --filter @mystcrag/frontend typecheck
pnpm --filter @mystcrag/frontend test
pnpm --filter @mystcrag/frontend build
pnpm validate
```

Commit: `feat(frontend): add bead asset import admin`

- [ ] **SOL review gate:** Review desktop/mobile evidence, refresh recovery, separate entry/auth, required human naming, no secret in client output and no knowledge-admin regression.

---

## Task 6: Approved asset resolver in existing product UI

**Registry:** `TASK-ASSET-RESOLVER-001`  
**Executor:** QWEN
**Branch:** `task/asset-resolver-001-runtime-visuals`

**Files:**

- Modify: `apps/frontend/src/features/design/model/visual-assets.ts`
- Modify: `apps/frontend/src/features/design/model/visual-assets.test.tsx`
- Modify: `apps/frontend/src/features/design/components/crystal-bead-image.tsx`
- Modify: exact `CrystalBeadImage` and `getBeadVisual` consumers discovered with `rg` and added to the registry row before task claim
- Create: `apps/frontend/app/api/assets/[assetKey]/route.ts`
- Create: `apps/frontend/app/api/assets/[assetKey]/route.test.ts`

- [ ] **Step 1: Inventory call sites before claiming the task.**

Run:

```bash
rg -l 'CrystalBeadImage|getBeadVisual' apps/frontend --glob '!**/*.test.*'
```

Add every file that actually needs modification to this task's writable path cell. Do not use a broad `apps/frontend/**` grant.

- [ ] **Step 2: Write failing resolver tests.**

Test a dynamic approved asset key, URL encoding, missing key fallback, legacy material matching, rejected/draft upstream `404`, and identical resolution across editor, library, profile and export consumers.

- [ ] **Step 3: Implement one canonical resolver.**

Use a value object:

```ts
type BeadVisualIdentity = {
  materialKey: string;
  textureAssetKey?: string | null;
};
```

`getBeadVisual(identity)` returns `/api/assets/<encoded-key>` only for a valid asset-key shape; otherwise it keeps the current photographic static mapping. Add optional `textureAssetKey` to `CrystalBeadImage` and thread it through all consumers. Do not delete or rename existing fallback files.

- [ ] **Step 4: Add the same-origin proxy and parity tests.**

The Next route forwards the public request without admin credentials and preserves safe cache metadata. Validate the editor and export use the same resolved `src` for the same bead identity.

- [ ] **Step 5: Verify and commit.**

Run:

```bash
pnpm --filter @mystcrag/frontend test -- visual-assets
pnpm --filter @mystcrag/frontend test
pnpm --filter @mystcrag/frontend build
pnpm validate
```

Commit: `feat(frontend): resolve approved bead assets`

- [ ] **SOL review gate:** Confirm every renderer/export consumer uses the canonical resolver, static UI is preserved when no dynamic asset exists and draft keys cannot leak through the public route.

---

## Task 7: Integration, architecture and local acceptance gate

**Registry:** `TASK-ASSET-QA-001`  
**Executor:** QWEN  
**Branch:** `task/asset-qa-001-integration-gate`

**Files:**

- Create: `tests/bead-asset-import-architecture.test.mjs`
- Create: `scripts/ui-qa/bead_import_flow.py`
- Create: `docs/qa/BEAD_ASSET_IMPORT_ACCEPTANCE.md`

- [ ] **Step 1: Write architecture tests.**

Assert the separate frontend route exists, image processing is outside backend request handlers, the worker is not the knowledge worker, dynamic assets pass through the approved resolver, no raw image extensions/output directories are tracked, and the implementation paths correspond to completed registered tasks.

- [ ] **Step 2: Build a disposable end-to-end fixture.**

Generate small synthetic JPG/TIFF-compatible samples in a temporary directory at runtime: paired stems, cross-folder pair, duplicate hash, JPG-only, ARW-like TIFF-only and a deliberately poor background. Never copy the desktop source set into the repository.

- [ ] **Step 3: Automate the full browser flow.**

Against a disposable PostgreSQL database and temporary archive root, verify login, folder manifest/upload, restart/resume, grouping, merge/split, human naming, QC block, adjustment/reprocess, draft persistence, publish, inventory snapshot, approved product rendering and public denial for drafts. Capture temporary evidence at 1440x900 and status/review at 390x844; delete or leave it ignored after the run.

- [ ] **Step 4: Run the real local source set as manual acceptance.**

With the user's consent and without mutation, point the UI at `/Users/chenyanyan/Desktop/珠子图`. Record counts and outcomes only:

- 26 input folders / 127 files expected at discovery baseline.
- Known cross-folder JPG/ARW stems must be suggested together.
- JPG-only and ARW-only cases must remain recoverable review groups.
- Originals must hash-match their archive copies.
- No source file may be moved, renamed, overwritten or added to Git.

Do not record file contents, absolute archive secrets or photographs in the acceptance document.

- [ ] **Step 5: Run the release gate and commit.**

Run:

```bash
pnpm install --frozen-lockfile
pnpm test:architecture
pnpm validate
git status --short
git diff --check
git ls-files | rg -i '\.(arw|cr2|nef|dng)$|(^|/)(output|outputs|qa-captures)(/|$)' && exit 1 || true
```

Commit: `test(asset): verify bead import workflow`

- [ ] **SOL review gate:** Re-run the gate from a clean worktree, inspect acceptance evidence and regression risk, and either return specific findings to the responsible GLM/QWEN task or approve Task 8.

---

## Task 8: Acceptance record and archive

**Registry:** `TASK-ASSET-REVIEW-001`  
**Executor:** SOL  
**Branch:** `task/asset-review-001-acceptance-archive`

**Files:**

- Modify: `docs/tasks/TASK_REGISTRY.md`
- Modify: `docs/governance/FEATURE_REGISTRY.md`
- Modify: `docs/progress/PROJECT_STATUS.md`
- Modify: `docs/qa/BEAD_ASSET_IMPORT_ACCEPTANCE.md`

- [ ] **Step 1: Confirm all implementation tasks are reviewed and `DONE`.**

Verify their commits are reachable from the integration candidate, no dependency was bypassed, no writable-path violation occurred and each task includes its required `pnpm validate` evidence.

- [ ] **Step 2: Perform acceptance review without runtime edits.**

Re-run architecture and full validation, inspect the final diff, confirm raw-source immutability/hash evidence, validate desktop/mobile flow evidence and verify rollback/recovery documentation. If anything fails, return it to the correct GLM/QWEN task; SOL does not fix it.

- [ ] **Step 3: Record status and archive.**

Only after every gate passes, move `FEAT-026` from `PLANNED` to its approved production state, mark Task 8 `DONE`, record the accepted commit and archive superseded planning status. Do not delete source worktrees or branches without separate explicit approval.

Run:

```bash
pnpm test:architecture
pnpm validate
git diff --check
git status --short
```

Commit: `docs(asset): accept bead import assistant`

---

## Execution handoff rules

1. QWEN claims Task 1 only after this plan is reviewed and committed.
2. A task's executor changes only its registered paths. Newly discovered required paths must be added by a governance-only registry change before editing.
3. Executors paste command results and the exact commit SHA into the task handoff. “Should pass” is not evidence.
4. SOL performs review after every task; implementation proceeds only when the dependency row is `DONE`.
5. Failed review returns to the same executor and branch. SOL does not patch the runtime code.
6. Integration may use a dedicated candidate worktree, but merging/pushing/PR creation remains a separate user-authorized operation and must preserve unrelated local work.
