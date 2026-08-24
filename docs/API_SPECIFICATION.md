# Mystcrag API Specification

## Purpose

Define communication between frontend, backend, AI and 3D engine.

## Shared design DTO contract

`@mystcrag/design-contract` now provides the canonical runtime schemas for design-related wire JSON. V1 uses camelCase, `schemaVersion: "1.0.0"`, positive design revisions, and CNY/TWD minor-unit integer money. The executable schemas are documented in `DESIGN_CONTRACT_V1.md`.

The package exports request and response schemas for Generate Design, Update Design, Price Design, Save Design, Publish Design, and Create Order From Design. Every response uses `PublicDesignV1`; commercial costs and supplier references are not public API fields. Update requests use the finite operation union rather than arbitrary JSON Patch.

The Backend registers validated HTTP boundaries for all six design/order operations. Every request is parsed with its shared request schema and every successful service value is parsed with its shared response schema. Local startup wires the repository-backed Design application service, catalog, pricing, publication, and order boundaries; it does not fabricate product data.

Errors use `{ error: { code, message, fieldErrors?, requestId } }`. Supported stable codes are `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_IMPLEMENTED`, `NOT_FOUND`, `CONFLICT`, `COMPLIANCE_BLOCKED`, `CONSENT_REQUIRED`, `INVENTORY_CHANGED`, `PRICE_CHANGED`, and `INTERNAL_ERROR`. Publish rejects public or unlisted requests without consent; order creation rejects a `REJECTED` design before service execution.

## Authentication and actor context

All Design and Order routes listed below are protected. Clients send `Authorization: Bearer <credential>`; an `AuthProvider` verifies the credential signature, exact issuer, required audience, and expiry before the Backend creates a request-local `ActorContext`. Controllers obtain `actorId` only from that verified context and pass it to owner-scoped services. Authentication fields are not added to Design Contract DTOs, and request bodies never supply authoritative ownership.

`x-actor-id` is not an authentication mechanism. A request that supplies only `x-actor-id` receives `401 UNAUTHORIZED`, and the header cannot replace or override the subject of a valid verified credential. Missing, malformed, forged, expired, wrong-issuer, and wrong-audience credentials receive the same generic `401 UNAUTHORIZED` envelope. The response does not echo the credential or expose verifier details.

Owner-scoped routes use `403 FORBIDDEN` with a generic message when a verified actor cannot access the requested resource. Missing and differently owned resources are not distinguished at this boundary, preventing ownership disclosure.

The built-in signed-token provider is for explicitly enabled test/development use only. It requires `NODE_ENV=test|development`, `MYSTCRAG_AUTH_PROVIDER=signed-test`, `MYSTCRAG_ENABLE_SIGNED_TEST_AUTH=true`, and configured signing secret, issuer, and audience values. It is rejected in production even when the opt-in flag is present. Production startup without a supported authentication provider fails safely rather than falling back to a fixed, anonymous, header-derived, or test actor.

## Service endpoints

GET /health

Return backend process readiness. This endpoint does not imply database or external provider readiness.

GET /api/modules

Return registered backend module metadata for initialization diagnostics. This is not a public product API and may be removed after module routing is implemented.

Tarot appears in this response only when its authenticated routes are registered.

## User API

POST /api/users

Create user profile.

## AI Design API

POST /api/design/generate

Requires verified authentication. Uses `GenerateDesignRequestSchema` and `GenerateDesignResponseSchema`. It never returns an independent `threeConfig` copy.

POST /api/design/update

Requires verified authentication and owner access. Uses `UpdateDesignRequestSchema` and `UpdateDesignResponseSchema`.

The request accepts multiple finite operations in one array. They are applied in order and persisted as one optimistic-revision transaction. Clear/reset-style editor actions must batch their removals instead of issuing one HTTP request per component. The successful Update response already contains authoritative pricing; routine editor mutations do not immediately repeat the Price endpoint.

POST /api/design/price

Requires verified authentication. Uses `PriceDesignRequestSchema` and `PriceDesignResponseSchema`. The mapper retains product IDs and currency as pricing intent but discards all client-supplied unit and total prices before orchestration.

GET /api/design/:id

Requires verified authentication and returns the actor-owned current `PublicDesignV1`.

GET /api/design/:id/revisions

Requires verified authentication and returns the actor-owned immutable revision history using public projections.

GET /api/designs

Requires verified authentication. Returns the actor's non-archived designs using `ListMyDesignsResponseSchema`: up to 200 `{ design: PublicDesignV1, status, updatedAt }` entries ordered for gallery/profile listings. `status` is the persistence status (`DRAFT`, `GENERATED`, `SAVED`, `ARCHIVED`). Owner scoping is enforced by the repository; the endpoint never accepts actor identity from the request.

## Material Catalog API

GET /api/catalog/materials?currency=CNY

Requires verified authentication. Returns every active, addable material product for the requested supported currency using `ListCatalogMaterialsResponseSchema`. Public fields include product identity, bilingual crystal names, color, visual, style, emotion, and compliance-safe culture tags, shape, diameter, render asset keys, authoritative unit price, and a non-negative integer `availableQuantity` that backs the library page's sellable/zero-stock states. The response also carries an `accessories` array (`CatalogAccessoryProductSchema`, max 100) with accessory identity, type, material, finish, price, and `availableQuantity`. Unit costs, supplier data, and raw inventory ledgers are never returned. DIY updates still revalidate current inventory and pricing before a new design revision is persisted.

## Design Save API

POST /api/design/save

Requires verified authentication and owner access. Uses `SaveDesignRequestSchema` and `SaveDesignResponseSchema`.

## Design Delete and Clone API

POST /api/design/delete

Requires verified authentication and owner access. Uses `DeleteDesignRequestSchema` and `DeleteDesignResponseSchema`. Accepts `designId` plus the current `expectedRevision`; a stale revision returns `CONFLICT`. The service performs an owner-scoped soft delete (persistence status `ARCHIVED`), so the design stops appearing in `GET /api/designs` and community listings while revisions remain auditable. The response returns `requestId`, `designId`, and `deletedAt`; it never echoes design content.

POST /api/design/clone

Requires verified authentication and owner access. Uses `CloneDesignRequestSchema` and `CloneDesignResponseSchema`. Accepts the source `designId` plus its current `expectedRevision`; a stale revision returns `CONFLICT`. The service creates a fresh actor-owned `PublicDesignV1` at revision 1 from the source snapshot, appending the ` · 副本` copy suffix to the design name when it fits the 200-character limit. Pricing and compliance are re-derived server-side; cloned designs start private and unsaved in the sense of publication.

## Tarot Guidance API

All six endpoints require verified bearer authentication and owner-scoped access. Missing and differently owned sessions both map to the generic `FORBIDDEN` response at the HTTP boundary. Their executable DTOs live in the [strict Tarot contract source](../packages/design-contract/src/schemas/tarot.schema.ts); every request rejects unknown fields and every successful response is parsed before it leaves Backend.

| Route | Request DTO | Response DTO | Behavior |
| --- | --- | --- | --- |
| `POST /api/tarot/sessions` | `CreateTarotSessionRequestSchema` | `CreateTarotSessionResponseSchema` | Creates revision 1 in `DRAWING`, privately shuffles all 78 cards, and returns only slots plus card-back metadata. This is the only operation gated by `MYSTCRAG_TAROT_ENABLED === "true"`; disabled creation returns `501 NOT_IMPLEMENTED`. |
| `POST /api/tarot/sessions/:id/select` | `SelectTarotCardRequestSchema` | `SelectTarotCardResponseSchema` | Accepts only the next canonical slot, a unique displayed position, `expectedRevision`, and an idempotency `operationId`. A new selection keeps card identity and orientation server-only; an exact accepted retry returns the current strict public lifecycle projection. |
| `POST /api/tarot/sessions/:id/reveal` | `RevealTarotSessionRequestSchema` | `RevealTarotSessionResponseSchema` | Requires every slot, changes `DRAWING` to `DRAWN`, and returns all revealed cards in slot order. An exact reveal retry returns the current strict revealed projection even after recommendation or save advances the session. |
| `POST /api/tarot/sessions/:id/recommendations` | `GenerateTarotRecommendationsRequestSchema` | `GenerateTarotRecommendationsResponseSchema` | Requires `DRAWN`; accepts an optional current-session `wristCircumferenceMm` from 130–200 mm, writes interpretation, color/material display data, and exactly three catalog-backed, priced `PublicDesignV1` recommendations, then changes to `RECOMMENDED`. |
| `GET /api/tarot/sessions/:id` | no body | `GetTarotSessionResponseSchema` | Restores the owner-scoped public projection and canonical card-back metadata for refresh/recovery. Its response `requestId` is server-derived. |
| `POST /api/tarot/sessions/:id/save` | `SaveTarotSessionRequestSchema` | `SaveTarotSessionResponseSchema` | Requires `RECOMMENDED`, optionally records one linked `selectedDesignId`, and changes to `SAVED`. Existing Design Save APIs continue to own bracelet revisions. |

The public lifecycle is `DRAWING -> DRAWN -> RECOMMENDED -> SAVED`; `ABANDONED` is a reserved persisted status and has no public transition endpoint in this release. A redraw creates a new `DRAWING` session with `parentSessionId`; it does not mutate the completed parent. Every accepted state mutation increments the positive revision once and requires the current `expectedRevision`. Stale revisions, duplicate positions, wrong slot order, and invalid transitions return `CONFLICT`.

Selection retry identity is `operationId`: the exact accepted slot and displayed position return the authoritative current session without another revision increment, including after reveal, recommendation, or save; reuse with different input is a conflict. Reveal accepts only the original consumed reveal revision (or the refreshed current `DRAWN` revision) and returns the authoritative current revealed session, including after recommendation or save. Recommendation retries reuse a persisted Design only when the complete normalized priced candidate authority is identical. Tarot Design IDs are derived from that authority, so an unchanged retry is idempotent while current catalog, price, pricing-version, or generated-candidate changes produce a new validated Design ID; an unlinked stale partial candidate is never attached to the final three ranks and cannot strand the session. An exact Save retry with the same selected Design accepts the bounded prior/current revision and returns the existing `SAVED` state without incrementing again; clients reconcile an ambiguous save with `GET` instead of assuming success.

Recommendation generation uses active catalog SKUs including zero-stock materials, authoritative prices, and validated `TAROT_GUIDED` Designs. Availability does not cap a Tarot candidate sequence; shortages produce a public-safe fulfillment advisory with affected product IDs and an estimated five-day replenishment window, while raw quantities remain private. Tarot generation and editing return `RESTOCK_REQUIRED` as an advisory rather than blocking. Missing, inactive, malformed, or wrong-currency products still fail. A current-session wrist submitted by Tarot setup overrides a saved wrist preference for all three generated designs. Without that request value, a saved preference port may supply wrist and budget values; the current production adapter has no preference store, so wrist defaults to 155 mm and budget is absent rather than fabricated.

`POST /api/orders/from-design` permits a shortage only for a persisted `TAROT_GUIDED` design. Its immutable snapshot records requested, reserved, and backorder quantities per product. Any shortage returns `orderStatus: AWAITING_RESTOCK` and `estimatedRestockDays: 5`; non-Tarot shortages continue to return `INVENTORY_CHANGED`.

Questions are optional and `saveQuestion` defaults to `false`. That default request keeps the raw question in memory for the current request only: it is absent from request logs, provider input, persistence, public DTOs, and browser storage. `saveQuestion: true` requires a non-empty question and a configured exact 32-byte base64 `MYSTCRAG_TAROT_QUESTION_ENCRYPTION_KEY`. Missing configuration returns the stable inline-compatible `VALIDATION_ERROR` before catalog access, Design generation, or persistence; no plaintext or ad-hoc reversible encoding is written. Valid opt-in writes only a randomized AES-256-GCM v2 envelope and `questionSavedAt`, atomically with the recommendation snapshot and three links. Ciphertext, the keyed identity, private deck order, prompts, costs, and inventory quantities never appear in public responses. Recommendation results are immutable: adding or changing saved-question intent afterward requires a new session.

## Community API

GET /api/community/designs

Return popular designs.

POST /api/design/publish

Requires verified authentication and owner access. Uses `PublishDesignRequestSchema` and `PublishDesignResponseSchema`, with a consent guard before service execution.

## Order API

POST /api/orders/from-design

Requires verified authentication and owner access. Uses `CreateOrderFromDesignRequestSchema` and `CreateOrderFromDesignResponseSchema`, with a compliance guard before service execution. The operation is idempotent for one authenticated user and one design revision: retries, refreshes, and concurrent submissions return the existing immutable order snapshot instead of creating another order.

GET /api/orders

Requires verified authentication. Returns the actor's orders using `ListMyOrdersResponseSchema`: up to 100 `{ orderId, status, currency, totalAmountMinor, createdAt, design, fulfillment }` entries, newest first, for the profile order list. `status` uses the summary enum (`PENDING`, `AWAITING_RESTOCK`, `CONFIRMED`, `IN_PRODUCTION`, `SHIPPED`, `COMPLETED`, `CANCELLED`); `design` is the immutable `PublicDesignV1` snapshot captured at order time and `fulfillment` is the public `OrderFulfillmentSnapshotV1`. Costs and supplier data never appear.

## Current service status

`/health`, `/api/modules`, the Design/catalog/order routes, and the authenticated Tarot lifecycle are registered by the current Backend startup. Repository-backed Design, publication, order, pricing, inventory, Tarot session, and catalog services all receive the verified `actorId`; Tarot copy currently uses the deterministic bounded adapter documented in `AI_AGENT_SPEC.md`.

Persistence conflicts map to the existing stable codes: stale `expectedRevision` becomes `CONFLICT`; server price/version mismatch becomes `PRICE_CHANGED`; latest stock mismatch becomes `INVENTORY_CHANGED`; consent and compliance failures retain `CONSENT_REQUIRED` and `COMPLIANCE_BLOCKED`. Clients never submit `ownerId`, unit costs, trusted totals, or trusted inventory. Order intent is limited to design/revision identity plus `expectedTotalPriceMinor` and `expectedPricingVersion`.
