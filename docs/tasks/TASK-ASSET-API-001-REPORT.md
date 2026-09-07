# TASK-ASSET-API-001 — Admin review surfaces delivery report

- **Status**: REVIEW (DONE reserved for SOL/Codex acceptance)
- **Owner**: DeepSeek-V4-Pro (Product Owner temporary authorization, 2026-09-07)
- **Branch**: `task/asset-api-001-admin-review-surfaces`
- **Worktree**: `.worktrees/asset-api-001`
- **Base**: `3225ff4` (local `main`)
- **Final HEAD**: `3511bf7`

## Four interface gaps — result

1. **Admin binary read of unpublished source/processed images** — DONE.
   - `GET /api/admin/bead-import/files/:fileId/content` and
     `GET /api/admin/bead-import/processed-assets/:processedAssetId/content?rendition=main|thumbnail`.
   - Reuses the `ASSET_ADMIN_API_KEY` boundary; resolves `archiveKey`/`storageKey` server-side only;
     `ARW` returns `415` with asset code `SOURCE_PREVIEW_UNAVAILABLE`; the thumbnail filename is derived
     from the authoritative main key, never from a client path; responses carry a strong quoted SHA-256
     `ETag` and `Cache-Control: private, no-store`; main bytes are SHA-verified via `verifiedRead`.
2. **Dedicated Crystal search** — DONE.
   - `GET /api/admin/bead-import/crystals?q=&limit=&cursor=` with strict `ListCrystalsQuery/Response` DTOs,
     case-insensitive match over `nameCn`/`nameEn`/`mineralName`, deterministic ordering and bounded paging.
3. **Authoritative `approvedAssetKey`** — DONE.
   - `ReviewProcessedAssetResponse.approvedAssetKey` and `AssetImportProcessedAssetView.approvedAssetKey`;
     `APPROVE` returns the persisted `approved:<outputSha256>` (idempotent replays return the identical key);
     `REJECT` returns `null`; non-`APPROVED` states never expose a key.
4. **Refresh-stable draft hydration** — DONE.
   - `AssetImportSessionGroupView.productDraft` (all saved business fields) and the eight CrystalDraft
     curation fields (`nameCn`/`nameEn`/`mineralName`/`colorTags`/`visualTags`/`styleTags`/`priceLevel`/
     `complianceNote`); unfilled fields hydrate as `null` (database placeholders such as `UNSPECIFIED` and
     `Pending manual curation.` are converted at the boundary); BigInt amounts use bounded `toSafeNumber`.

## Verification

| Command | Result |
| --- | --- |
| `pnpm --filter @mystcrag/design-contract test` | 154/154 |
| `pnpm --filter @mystcrag/design-contract lint` / `typecheck` | pass |
| `pnpm --filter @mystcrag/database test` (unit) | 139/139 |
| `pnpm --filter @mystcrag/database db:test` (fresh PostgreSQL) | 237/237 |
| `pnpm --filter @mystcrag/database lint` / `typecheck` | pass |
| `pnpm --filter @mystcrag/backend test` | 214 pass + 3 env-gated skips |
| `pnpm --filter @mystcrag/backend lint` / `typecheck` | pass |
| Backend E2E (fresh PostgreSQL) | 1/1 |
| `node --test tests/architecture.test.mjs` | 15/15 |
| `pnpm validate` | 17/17 |
| `git diff --check` | clean |

PostgreSQL test databases: `mystcrag_assetapi001_test_20260907` (integration),
`mystcrag_assetapi001_e2e_test_20260907` (E2E).

## Diff scope

Contract schema + tests; database repository + integration tests; backend bead-asset-import module
(service, routes, tests, E2E); `docs/API_SPECIFICATION.md`; the exact `TASK-ASSET-API-001` registry row.
No frontend change, no Prisma migration, no generated output, no push/merge/deploy.

## Unresolved

None within scope. The three original TASK-ASSET-FE-001 blockers are now unblocked; publication still
requires the frontend to consume the returned `approvedAssetKey` (out of scope for this task).
