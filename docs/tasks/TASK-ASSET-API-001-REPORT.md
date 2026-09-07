# TASK-ASSET-API-001 — Admin review surfaces delivery report

- **Status**: REVIEW (DONE reserved for SOL/Codex acceptance)
- **Owner**: DeepSeek-V4-Pro (Product Owner temporary authorization, 2026-09-07)
- **Branch**: `task/asset-api-001-admin-review-surfaces`
- **Worktree**: `.worktrees/asset-api-001`
- **Base**: `3225ff4` (local `main`)
- **Implementation HEAD**: `699d741` (review-fix round; the delivery-document commit that contains this report is a separate commit, listed below)

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

## Verification

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

None within scope. The three original TASK-ASSET-FE-001 blockers remain unblocked; publication still
requires the frontend to consume the returned `approvedAssetKey` (out of scope for this task).
