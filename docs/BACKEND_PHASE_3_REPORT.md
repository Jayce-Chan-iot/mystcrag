# Mystcrag Backend Phase 3 Report

Date: 2026-07-21

## Identity

- Agent role: Backend Lead
- Branch name: `feature/backend-design-api`
- Baseline commit: `64957c1c90a893a4f8a4c0ffdf372200c8df466e`
- Final implementation commit: `5d10c322643d3982deaa179563077913080943b8` (`feat: implement design backend vertical slice`)

## Change scope

Changed files in the implementation commit:

- `apps/backend/src/app.ts`
- `apps/backend/src/index.ts`
- `apps/backend/src/modules/design/design-api.service.ts`
- `apps/backend/src/modules/design/design.controller.ts`
- `apps/backend/src/modules/design/design.routes.ts`
- `apps/backend/src/modules/design/design.routes.test.ts`
- `apps/backend/src/modules/design/design.service.ts`
- `apps/backend/src/modules/design/index.ts`
- `packages/database/src/repositories/design.repository.ts`
- `packages/database/src/repositories/order.repository.ts`
- `packages/database/src/repositories/persistence.integration.test.ts`
- `packages/database/src/repositories/product.repository.ts`
- `packages/database/src/repositories/publication.repository.ts`
- `docs/BACKEND_PHASE_3_REPORT.md`

Changed modules:

- Backend HTTP routing, request-context identity resolution, error mapping, application orchestration, runtime composition, and module-local tests.
- Database design, product catalog, publication, and order repositories plus their integration test.

New or changed interfaces:

- `DesignApiService`: HTTP-facing application operations for generate, update, price, save, get, revisions, publish, and create order.
- `DesignGenerationAdapter`: provider boundary accepting validated generation intent and returning untrusted `unknown` candidate data.
- `DesignApplicationDependencies`: repository-port composition used by production repositories and deterministic test doubles.
- `CatalogProduct`: server-only catalog DTO containing SKU and product metadata without commercial cost.
- `PublishDesignOptions`: explicit consent, visibility, remix, and creator-display settings stored against a fixed revision.
- `DesignRepository.saveDesign`: owner- and revision-conditional save-state transition.

Shared assets changed: None. `packages/design-contract`, shared architecture/API specifications, root manifests, and root tests were not changed.

Approved decision-log entries: None required because the implementation stayed within the existing approved Design Contract V1, API DTO, persistence schema, and Backend/Database ownership boundaries.

## Implemented API

- `POST /api/design/generate`
- `POST /api/design/update`
- `POST /api/design/price`
- `POST /api/design/save`
- `GET /api/design/:id`
- `GET /api/design/:id/revisions`
- `POST /api/design/publish`
- `POST /api/orders/from-design`

Every POST request uses the existing `@mystcrag/design-contract` request schema, and every successful POST response is revalidated with its existing response schema. GET endpoints return owner-scoped public projections and never return repository or Prisma models.

## Repository changes

- `DesignRepository.saveDesign` conditionally marks an owner-scoped current revision as `SAVED` and returns `CONFLICT` for a stale revision.
- `ProductRepository` now exposes server-side catalog product DTOs with SKU, product metadata, currency, active state, and trusted minor-unit price. Prisma rows and cost values remain private.
- `PublicationRepository.publishDesign` accepts validated publication settings, stores a fixed revision reference, and returns a public projection with production notes removed.
- `OrderRepository.createOrderFromDesign` now rejects a non-current revision with `CONFLICT` before pricing, inventory, and snapshot creation.
- Existing design update/revision creation and order/snapshot creation remain single repository transactions.

## Service changes

- Added `DesignApplicationService` as the HTTP orchestration boundary over repository ports.
- Added a deterministic Mock AI adapter. Its `unknown` output is parsed as a restricted creative candidate, then rebuilt with server IDs, timestamps, catalog product data, trusted prices, derived production data, compliance defaults, and provenance before `DesignV1Schema` validation and persistence.
- Implemented all five finite update operations with component identity checks, continuous main-ring position rebuilding, price recalculation, inventory validation, final contract validation, optimistic concurrency, and revision append.
- Price recalculation discards client totals and unit prices, uses the catalog, validates inventory, and emits `PRICE_CHANGED` or `INVENTORY_CHANGED` warnings.
- Save derives `actorId` from request context, ignores an injected top-level `ownerId`, verifies the complete current revision, and returns a public-safe DTO.
- Publish enforces consent, non-private visibility, `PASSED` compliance, ownership, fixed revision, and public projection privacy.
- Order creation rechecks the current revision, compliance, trusted price/version, and latest inventory before creating an immutable snapshot.
- Production startup composes the application service with Prisma repositories only in the approved repository-backed service boundary.

## Tests

Backend coverage includes:

1. Design generation.
2. Automatic immutable revision 1 creation.
3. Finite design update and position rebuilding.
4. Revision conflict.
5. Invalid request DTO.
6. Forged client unit and total price.
7. Injected `ownerId` ignored in favor of actor context.
8. Unauthorized publication.
9. Rejected-design publication.
10. Rejected-design ordering.
11. Price change.
12. Inventory change.
13. Immutable order snapshot after later design mutation.
14. Failed update transaction rollback behavior.
15. Invalid component identity.
16. Owner-scoped GET current design and revision history.

Focused results:

- `pnpm --filter @mystcrag/backend typecheck`: passed.
- `pnpm --filter @mystcrag/backend test`: 11 passed.
- `pnpm --filter @mystcrag/database typecheck`: passed.
- `pnpm --filter @mystcrag/database db:test`: 4 passed, 1 PostgreSQL integration test skipped because `DATABASE_URL` was not configured.
- `node --test tests/architecture.test.mjs`: 7 passed.

## Validation

- `pnpm validate` command: `pnpm validate`
- Result: passed after repository-boundary imports were confined to the approved `design.service.ts` composition file.
- Validation commit: `5d10c322643d3982deaa179563077913080943b8`.
- Gate coverage: workspace lint, strict TypeScript, 7 architecture tests, all workspace unit tests, Prisma schema validation, Backend production build, and Frontend production build.
- Earlier gate evidence: the first full run failed only the repository-boundary architecture test because new application files imported database types directly. The imports were replaced with Backend-owned ports and structural error mapping; the focused architecture suite and two subsequent full `pnpm validate` runs passed.

## Known limitations

- The default generation adapter is deterministic and makes no real LLM call.
- `x-actor-id` is the Phase 3 request-context seam, not production authentication. A verified authentication plugin must populate the same actor boundary before deployment.
- Live PostgreSQL migration, trigger, and transaction execution was not available without `DATABASE_URL`; the checked-in integration suite remains the executable database evidence.
- Catalog SKU is used only inside the trusted server catalog boundary because Design Contract V1 has no public SKU field.
- Inventory validation does not reserve stock. Payment, Shopee, tax, shipping integrations, promotions, and exchange-rate conversion remain out of scope.

## Unfinished work

- Replace the request-header actor seam with verified authentication middleware while preserving the same actor-context service boundary.
- Run the PostgreSQL integration test against the reviewed baseline migration on a host with `DATABASE_URL` configured and retain trigger/rollback evidence.
- Replace `MockDesignGenerationAdapter` with the separately owned AI provider integration after its output is available through the same untrusted-candidate boundary.
- Add inventory reservation/idempotency before enabling payment or external commerce workflows.

## Cross-module dependencies

- Uses `@mystcrag/design-contract` V1 request/response schemas, `DesignV1`, public projection, and order snapshot projection without changing the shared contract.
- Uses `@mystcrag/database` repositories and domain DTOs; Backend does not call Prisma directly.
- AI recommendation can replace `MockDesignGenerationAdapter` through the provider boundary without changing the HTTP or persistence contract.
- Frontend must supply the existing shared DTOs and authenticated request context.

## Merge risks and reviewer focus

- Review update ordering for mixed inline and anchored components.
- Review the publication projection override against the fixed immutable revision.
- Review the current-revision requirement for order creation and its `CONFLICT` mapping.
- Parallel uncommitted AI and Three Engine changes were present in the shared worktree during validation; they were not staged or included in the Backend commit.
- No database schema or migration changed. The Backend commit therefore does not require a new migration, but it does require the existing `20260721140000_init_mystcrag_persistence_v1` baseline.

## Agent confirmation

- [x] I confirmed the assigned branch before development.
- [x] I changed only my owned module, owned tests, and role report.
- [x] No shared Contract, API, architecture, AI-contract, or 3D-contract file was changed.
- [x] No commercial cost, supplier, prompt, hidden reasoning, or private conversation data leaks through public boundaries.
- [x] I ran `pnpm validate` successfully on the final change.
