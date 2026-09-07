# TASK-ASSET-API-001 — Admin review surfaces delivery report

- **Status**: REVIEW (DONE reserved for SOL/Codex acceptance)
- **Owner**: GLM (2026-09-07 authorized by the Product Owner to take over the final review fix from DeepSeek-V4-Pro)
- **Branch**: `task/asset-api-001-admin-review-surfaces`
- **Worktree**: `.worktrees/asset-api-001`
- **Base**: `3225ff4` (local `main`)
- **Implementation HEAD**: `96c433f` (final review-fix round; delivery-document commits are separate)

## Commit classification

- **Business implementation commits** — the four interface gaps:
  - `70ad292` — chore(asset-api): register admin review surfaces task
  - `8412492` — feat(contract): add bead import admin review surfaces
  - `a5d7fc7` — feat(database): expose bead import admin review data
  - `6125171` — feat(database): resolve admin binary read locations
  - `99518aa` — feat(backend): add bead import admin review APIs
  - `3511bf7` — docs(asset-api): mark admin review surfaces task ready for review
- **Review-fix commit** — the three Important findings from the review round:
  - `699d741` — fix(asset-api): stream binary reads, paginate crystal search, batch duplicate check
- **Final review-fix commit** — the remaining Important finding (admin binary-read TOCTOU):
  - `96c433f` — fix(asset-api): close binary-read TOCTOU with one verified descriptor
- **Delivery-document commit** — this report and the `TASK_REGISTRY.md` row only:
  - the commit that introduces this file (not the implementation HEAD)

## Four interface gaps — result

1. **Admin binary read of unpublished source/processed images** — DONE.
   - `GET /api/admin/bead-import/files/:fileId/content` and
     `GET /api/admin/bead-import/processed-assets/:processedAssetId/content?rendition=main|thumbnail`.
   - Reuses the `ASSET_ADMIN_API_KEY` boundary; resolves `archiveKey`/`storageKey` server-side only;
     `ARW` returns `415` with asset code `SOURCE_PREVIEW_UNAVAILABLE`; responses carry a strong quoted
     SHA-256 `ETag` and `Cache-Control: private, no-store`.
2. **Dedicated Crystal search** — DONE.
   - `GET /api/admin/bead-import/crystals?q=&limit=&cursor=` with strict `ListCrystalsQuery/Response` DTOs.
3. **Authoritative `approvedAssetKey`** — DONE.
   - `ReviewProcessedAssetResponse.approvedAssetKey` and `AssetImportProcessedAssetView.approvedAssetKey`.
4. **Refresh-stable draft hydration** — DONE.
   - `AssetImportSessionGroupView.productDraft` and the eight CrystalDraft curation fields.

## Review-fix round — three Important findings

1. **Streaming admin image reads** (memory).
   - `ArchiveStore` gained `openRead(archiveKey)` and `readDigest(archiveKey, expectedSha256?)`, both
     reading through a single `O_NOFOLLOW` descriptor in fixed 64 KiB chunks after the same no-symlink
     key walk — a 256 MiB source is never buffered whole, and no second full-size `Buffer` is produced.
   - `readSourceFile`/`readProcessedAsset` now verify the SHA-256 via `readDigest` before opening the
     response stream, so integrity is proven before any byte is sent; the thumbnail etag is derived from
     its own streamed digest. `handleBinary` streams the `Readable` with `Content-Length` set, keeping the
     strong `ETag`, `Content-Type`, `Cache-Control: private, no-store`, the ARW `415` and redacted errors.
   - Tests prove the response is streamed in chunks and that the legacy `read`/`verifiedRead` full-buffer
     paths are never called (they throw if invoked), without any process-memory assertions.

2. **Database-level Crystal search pagination**.
   - `searchCrystals` now `select`s only `crystalId/nameCn/nameEn/mineralName`, orders by `(nameCn ASC,
     id ASC)` in the database, and pages with a keyset `where` over at most `limit + 1` rows — the full
     match set is never fetched into Node.js. A cursor that is missing, or that exists but is not part of
     the current result set, is rejected with a clear `NOT_FOUND`.

3. **No per-draft Crystal full scan on session refresh**.
   - `toCrystalDraftProjection` is now synchronous over a `ReadonlySet<string>` of existing Crystal names,
     and `getSession`/`updateCrystalDraft`/publication promotion load that set once via `loadCrystalNameSet`
     (a single `crystal.findMany({ select: { nameCn, nameEn } })`). `promotionEligible`, `missingFields` and
     placeholder→null semantics are unchanged. A unit test asserts exactly one Crystal query for a session
     with multiple drafts.

## Final review-fix round — binary-read TOCTOU (`96c433f`)

GLM took over from DeepSeek-V4-Pro with Product Owner authorization. The worktree was handed over with
uncommitted in-progress changes for exactly this finding inside the task's authorized paths; they were
reviewed, hardened and completed rather than discarded. Failing tests were demonstrated before the
implementation: with the new tests against the old implementation, asset-pipeline failed 7 and backend
failed 2.

1. **The finding**: `readDigest()` verified one open while `openRead()` re-opened by path, so a plain-file
   replacement between the two opens served an ETag/Content-Length from the first inode with a body from
   the second. `O_NOFOLLOW` only blocked symlinks, not replacement.
2. **The fix**: `ArchiveStore.openVerifiedRead(archiveKey, expectedSha256?)` is the only binary-read entry
   point on the admin path; the composed `readDigest()+openRead()` pair was removed entirely (the backend
   `Store` type no longer admits either). It opens the key once with `O_NOFOLLOW` after the same
   no-symlink ancestor walk, checks the file type and size against that handle, streams SHA-256 over the
   identical descriptor in fixed 64 KiB positional reads, and verifies against the database-persisted
   digest (source/main) before any response header can be written — on mismatch the handle is closed and
   the request fails with no stream and no headers. The thumbnail computes its digest over the same
   single handle and uses it as the strong ETag. The response stream is a dedicated `Readable` that
   owns that one `FileHandle`: positional reads from byte zero of the same descriptor, fixed chunk bound,
   no whole-file buffering and no second full-size Buffer, and an explicit `handle.close()` in `_destroy`
   on normal completion, client abort (`destroy()`), and mid-stream read failure — never garbage
   collection. Stream, `byteSize` and `sha256` are therefore bound to one inode and one handle; a path
   replaced mid-request cannot substitute bytes. ETag, Content-Length, `Cache-Control: private, no-store`,
   the ARW `415 SOURCE_PREVIEW_UNAVAILABLE`, and redacted errors are unchanged.
3. **Regression coverage** (asset-pipeline + backend): the body still comes from the originally opened
   inode when the path is unlinked and replaced after verification; exactly one descriptor is opened per
   read; the handle closes on normal completion, on `stream.destroy()` after the first chunk, on digest
   mismatch, and on a mid-stream read failure (file truncated under the open handle → `READ_FAILED`,
   never a silently short body); a mismatched digest yields no stream; chunks stay within the 64 KiB
   bound; the backend mocks throw if the legacy `read`/`verifiedRead` full-buffer paths are ever called,
   and the source/main ETag, thumbnail-derives-own-ETag, and single-`openVerifiedRead`-call contracts
   are asserted.

## Verification (final round)

| Command | Result |
| --- | --- |
| `pnpm --filter @mystcrag/asset-pipeline test` | 142/142 |
| `pnpm --filter @mystcrag/backend test` | 214 pass + 3 env-gated skips |
| `pnpm --filter @mystcrag/backend test` (with E2E env) | 215 pass + 2 env-gated skips |
| Backend E2E (fresh PostgreSQL, run standalone) | 1/1 |
| `pnpm --filter @mystcrag/database test` | 140/140 |
| `node --test tests/architecture.test.mjs` | 15/15 |
| `pnpm validate` | 17/17 |
| `git diff --check main...HEAD` | clean |

PostgreSQL test database (final round): `mystcrag_assetapi001_glmfix_test_20260907`, freshly created,
15 migrations applied. The earlier rounds' databases (`…_review2_…`) are untouched. No other database
was created, reset, or modified.

## Verification (earlier rounds)

| Command | Result |
| --- | --- |
| `pnpm --filter @mystcrag/asset-pipeline test` | 137/137 |
| `pnpm --filter @mystcrag/design-contract test` | 154/154 |
| `pnpm --filter @mystcrag/database test` (unit) | 140/140 |
| `pnpm --filter @mystcrag/database db:test` (fresh PostgreSQL) | 239/239 |
| `pnpm --filter @mystcrag/backend test` | 214 pass + 3 env-gated skips |
| Backend E2E (fresh PostgreSQL) | 1/1 |
| `node --test tests/architecture.test.mjs` | 15/15 |
| `pnpm validate` | 17/17 |
| `git diff --check main...HEAD` | clean |

PostgreSQL test databases (this review round): `mystcrag_assetapi001_review2_test_20260907`
(integration) and `mystcrag_assetapi001_review2_e2e_test_20260907` (E2E).

## Diff scope

Contract schema + tests; database repository + unit/integration tests; backend bead-asset-import module
(service, routes, tests, E2E); `packages/asset-pipeline/src/storage.ts` + `tests/storage.test.ts`;
`docs/API_SPECIFICATION.md`; the exact `TASK-ASSET-API-001` registry row and this report. No frontend
change, no Prisma migration, no generated output, no push/merge/deploy.

## Unresolved

None within scope. All four review-round Important findings (streaming reads, search pagination,
per-draft scan, binary-read TOCTOU) are closed; the three original TASK-ASSET-FE-001 blockers remain
unblocked. Publication still requires the frontend to consume the returned `approvedAssetKey` (out of
scope for this task).
