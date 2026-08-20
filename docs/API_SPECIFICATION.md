# Mystcrag API Specification

## Purpose

Define communication between frontend, backend, AI and 3D engine.

## Shared design DTO contract

`@mystcrag/design-contract` now provides the canonical runtime schemas for design-related wire JSON. V1 uses camelCase, `schemaVersion: "1.0.0"`, positive design revisions, and CNY/TWD minor-unit integer money. The executable schemas are documented in `DESIGN_CONTRACT_V1.md`.

The package exports request and response schemas for Generate Design, Update Design, Price Design, Save Design, Publish Design, and Create Order From Design. Every response uses `PublicDesignV1`; commercial costs and supplier references are not public API fields. Update requests use the finite operation union rather than arbitrary JSON Patch.

Phase 2B registers development-level HTTP boundaries for all six design operations. Every request is parsed with its shared request schema and every successful service value is parsed with its shared response schema. Business orchestration remains a stub, so a valid request currently returns the stable `NOT_IMPLEMENTED` domain error instead of fabricated product data.

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

## Material Catalog API

GET /api/catalog/materials?currency=CNY

Requires verified authentication. Returns every active, addable material product for the requested supported currency using `ListCatalogMaterialsResponseSchema`. Public fields include product identity, bilingual crystal names, color tags, shape, diameter, render asset keys, and authoritative unit price. Unit costs, supplier data, and raw inventory quantities are never returned. DIY updates still revalidate current inventory and pricing before a new design revision is persisted.

## Design Save API

POST /api/design/save

Requires verified authentication and owner access. Uses `SaveDesignRequestSchema` and `SaveDesignResponseSchema`.

## Tarot Guidance API

All Tarot endpoints require verified bearer authentication and owner-scoped access. Missing and differently owned sessions both map to the generic `FORBIDDEN` response at the HTTP boundary.

POST /api/tarot/sessions

Creates and privately shuffles a complete Tarot session using `CreateTarotSessionRequestSchema`. Only this operation is gated by `MYSTCRAG_TAROT_ENABLED === "true"`; when disabled it returns the stable `NOT_IMPLEMENTED` error envelope. Existing sessions remain accessible.

POST /api/tarot/sessions/:id/select

Accepts the next canonical slot, displayed position, optimistic revision, and idempotency operation ID through `SelectTarotCardRequestSchema`. The browser never supplies card identity or orientation.

POST /api/tarot/sessions/:id/reveal

Reveals a complete selection through `RevealTarotSessionRequestSchema`. Bounded retries return the existing reveal without incrementing revision.

POST /api/tarot/sessions/:id/recommendations

Generates exactly three catalog-backed `TAROT_GUIDED` designs through `GenerateTarotRecommendationsRequestSchema`. Retries reuse deterministic owner-scoped designs and return the existing linked recommendations. Raw questions are ephemeral when `saveQuestion` is false; `saveQuestion: true` fails validation until encrypted question storage is available.

GET /api/tarot/sessions/:id

Returns the validated public restore projection without private deck state, question ciphertext, or other server-only fields.

POST /api/tarot/sessions/:id/save

Marks a recommended Tarot session saved and may record one of its linked design IDs. Bracelet persistence remains owned by the existing Design APIs.

## Community API

GET /api/community/designs

Return popular designs.

POST /api/design/publish

Requires verified authentication and owner access. Uses `PublishDesignRequestSchema` and `PublishDesignResponseSchema`, with a consent guard before service execution.

## Order API

POST /api/orders/from-design

Requires verified authentication and owner access. Uses `CreateOrderFromDesignRequestSchema` and `CreateOrderFromDesignResponseSchema`, with a compliance guard before service execution. The operation is idempotent for one authenticated user and one design revision: retries, refreshes, and concurrent submissions return the existing immutable order snapshot instead of creating another order.

## Phase 2C service status

`/health`, `/api/modules`, and the six validated design/order routes remain registered as development stubs. Phase 2C adds repository-backed `DesignService`, `PublicationService`, `OrderService`, `PricingService`, and `InventoryService` with explicit `actorId`, but does not connect them to public HTTP success paths before authentication exists.

Persistence conflicts map to the existing stable codes: stale `expectedRevision` becomes `CONFLICT`; server price/version mismatch becomes `PRICE_CHANGED`; latest stock mismatch becomes `INVENTORY_CHANGED`; consent and compliance failures retain `CONSENT_REQUIRED` and `COMPLIANCE_BLOCKED`. Clients never submit `ownerId`, unit costs, trusted totals, or trusted inventory. Order intent is limited to design/revision identity plus `expectedTotalPriceMinor` and `expectedPricingVersion`.
