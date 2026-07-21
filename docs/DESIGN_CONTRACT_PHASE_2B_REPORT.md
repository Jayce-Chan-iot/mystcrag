# Design Contract Phase 2B Report

Date: 2026-07-21

## 1. Consumer integration status

- AI Agent validates provider `unknown`, enriches only with server-owned data, and emits a schema-valid `DesignV1`.
- Three Engine converts `DesignV1` into an internal, serializable scene descriptor without creating another wire protocol.
- Backend registers six schema-validated HTTP stub routes with stable error envelopes and injected service seams.
- Frontend consumes `PublicDesignV1`, shared DTOs, enums, and contract fixtures without importing server-only models.
- Database and Prisma files are unchanged.

## 2. New adapters

- AI: `aiCandidateToDesignV1`, `designV1ToAgentOutput`, and the isolated `legacyDesignToAiCandidate` bridge.
- Three Engine: `componentToRenderItem` and `designV1ToSceneDescriptor`.
- Backend: request/response validators, price-request-to-server-intent mapper, domain-error mapper, and stub controller.
- Frontend: generate-response parser, public component view-model mapping, and currency-aware amount formatter.

## 3. Retained deprecated types

- AI compatibility path: `BeadDesign`, `BraceletDesignOutput`.
- Three Engine compatibility path: `BraceletBeadConfiguration`, `BraceletConfiguration`, and the initialization `BraceletGenerator` interface.

They remain exported for compatibility, are annotated `@deprecated`, and are not used by new production adapters except the explicitly named legacy bridge.

## 4. Backend stub routes

- `POST /api/design/generate`
- `POST /api/design/update`
- `POST /api/design/price`
- `POST /api/design/save`
- `POST /api/design/publish`
- `POST /api/orders/from-design`

All requests and potential success responses pass shared Zod schemas. The default service returns `NOT_IMPLEMENTED`; publish and order demonstrate consent and compliance guards. Price mapping discards client price values before calling the service. No database is connected.

## 5. Frontend contract consumption

The frontend validates API payloads and mock data at its boundary, then passes `PublicDesignV1` directly to minimal summary, component-list, price, and compliance components. `componentId` is the stable React identity, while `positionIndex` only controls display order. CNY amounts convert fen to yuan; TWD amounts remain integer dollars. Private designs are not presented as published, and anchored accessories display their relation.

## 6. Test coverage

- AI covers valid enrichment, malformed and extra provider fields, catalog failures, forbidden price/cost/visibility attempts, restricted claims, sequence validation, final schema validation, and legacy conversion.
- Three Engine covers ordering, anchors, size offsets, IDs, revision, asset warnings, immutability, determinism, serialization, and production-sequence parity.
- Backend covers all stable stubs, request/response validation, request IDs, cost/owner rejection, client-price distrust, consent/compliance guards, and unchanged health behavior.
- Frontend covers public rendering, cost absence, both currencies, stable component identity, compliance/private states, anchor display, unknown currencies, API parsing, and public fixture validation.
- Root architecture tests enforce dependency and commercial-data boundaries plus legacy isolation.

## 7. Deferred functionality

Real LLM providers and prompts, production compliance models, catalog and inventory integrations, persisted designs, authorization, real pricing, publish/order execution, production Three.js assets and materials, final UI flows, and exchange-rate conversion are not implemented.

## 8. Risks before Phase 2C database migration

- Persistence mapping must distinguish public `DesignV1` data from `InternalCommercialDesignV1`; costs and supplier references need a server-only storage boundary.
- Revision, idempotency, ownership, and optimistic-conflict behavior need explicit transaction rules before repositories are written.
- Catalog snapshots, price versions, inventory substitutions, and immutable order snapshots need retention policies.
- Legacy fixture migration exists, but there is still no production data to backfill. A real backfill must not be designed or run until production data exists and an audit/rollback plan is approved.
- JSON storage versus normalized component tables, indexed query needs, and schema-version upgrade policy still require a database decision.

## 9. Recommended next-stage split

1. Approve persistence invariants, ownership rules, transaction boundaries, and the public/internal storage split.
2. Design and review Prisma changes and migration tests without wiring product routes.
3. Implement repository adapters and contract-to-persistence mappers behind the existing service seams.
4. Add catalog pricing and inventory services with version/conflict behavior.
5. Add authentication/authorization, then enable save, publish, and order workflows incrementally.
