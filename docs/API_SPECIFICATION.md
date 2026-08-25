# Mystcrag API Specification

## Purpose

Define communication between frontend, backend, AI and 3D engine.

## Shared design DTO contract

`@mystcrag/design-contract` now provides the canonical runtime schemas for design-related wire JSON. V1 uses camelCase, `schemaVersion: "1.0.0"`, positive design revisions, and CNY/TWD minor-unit integer money. The executable schemas are documented in `DESIGN_CONTRACT_V1.md`.

The package exports request and response schemas for Generate Design, Update Design, Price Design, Save Design, Publish Design, and Create Order From Design. Every response uses `PublicDesignV1`; commercial costs and supplier references are not public API fields. Update requests use the finite operation union rather than arbitrary JSON Patch.

The Backend registers validated HTTP boundaries for all six design/order operations. Every request is parsed with its shared request schema and every successful service value is parsed with its shared response schema. Local startup wires the repository-backed Design application service, catalog, pricing, publication, and order boundaries; it does not fabricate product data.

Errors use `{ error: { code, message, fieldErrors?, requestId } }`. Supported stable codes are `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_IMPLEMENTED`, `NOT_FOUND`, `CONFLICT`, `COMPLIANCE_BLOCKED`, `CONSENT_REQUIRED`, `INVENTORY_CHANGED`, `PRICE_CHANGED`, and `INTERNAL_ERROR`. Publish rejects public or unlisted requests without consent; order creation rejects a `REJECTED` design before service execution.

## Authentication and actor context

The controlling production contract is [AUTH_SESSION_CONTRACT.md](AUTH_SESSION_CONTRACT.md), state `CONTRACT_FROZEN_IMPLEMENTATION_PENDING`. The browser authenticates only to the Next.js Server/BFF with its host-only HttpOnly session cookie. The BFF holds every reusable credential server-side and sends a short-lived audience-specific Access Token to Fastify. Browser code must not call Fastify with a stored Bearer token.

All Design and Order routes listed below are protected. `AuthProvider` verifies Access Token signature, exact issuer, required audience, and expiry before a provider-neutral `VerifiedIdentity` is mapped by unique `(issuer, subject)` to an internal `User.id`. Only that internal id becomes request-local `actorId` and is passed to owner-scoped services. Authentication fields are not added to Design Contract DTOs, and request bodies never supply authoritative ownership.

`x-actor-id` is not an authentication mechanism. A request that supplies only `x-actor-id` receives `401 UNAUTHORIZED`, and the header cannot replace or override the subject of a valid verified credential. Missing, malformed, forged, expired, wrong-issuer, and wrong-audience credentials receive the same generic `401 UNAUTHORIZED` envelope. The response does not echo the credential or expose verifier details.

Owner-scoped routes use `403 FORBIDDEN` with a generic message when a verified actor cannot access the requested resource. Missing and differently owned resources are not distinguished at this boundary, preventing ownership disclosure.

The built-in signed-token provider is for explicitly enabled test/development use only. It requires `NODE_ENV=test|development`, `MYSTCRAG_AUTH_PROVIDER=signed-test`, `MYSTCRAG_ENABLE_SIGNED_TEST_AUTH=true`, and configured signing secret, issuer, and audience values. It is rejected in production even when the opt-in flag is present. Production startup without a supported authentication provider fails safely rather than falling back to a fixed, anonymous, header-derived, or test actor.

### Implemented Fastify verification boundary (TASK-AUTH-004)

The production Auth0 resource-server boundary is implemented in the Backend. With `MYSTCRAG_AUTH_PROVIDER=auth0`, `MYSTCRAG_AUTH_ISSUER` (an exact HTTPS issuer URL), and `MYSTCRAG_AUTH_AUDIENCE` configured, startup builds an RS256 Access Token verifier (`jose@6.2.10`) that validates signature, exact issuer, required audience, expiry with at most 60 seconds of clock skew, and a non-empty subject. Incomplete configuration (missing/non-HTTPS issuer, missing audience), an unselected provider in production, `signed-test` outside test/development opt-in, or an unknown provider name all fail startup before the listener opens; there is no fallback provider. These environment variables are Backend-owned; the BFF/frontend never reads them.

Keys are fetched from the issuer's HTTPS-only `/.well-known/jwks.json`. Connect and read timeouts are 2 seconds each within a 5-second total request budget. A successful key set is cached for at most 15 minutes, and a shorter provider `Cache-Control: max-age` directive shortens the cache further. An unknown `kid` triggers at most one bounded refresh; a failed refresh is negative-cached for 30 seconds, and concurrent verifications share the single in-flight request. While a TTL-fresh cached key set exists, verification continues during a provider outage. With no usable cached key set and JWKS unavailable, verification fails closed as `500 INTERNAL_ERROR` and is never classified as a forged credential.

On every successful verification the provider-neutral identity is mapped through the AUTH-003 `ExternalIdentityRepository` by unique `(issuer, subject)` to an internal `User.id`; that internal id — never the provider subject — becomes `request.actorContext.actorId` for owner-scoped services. Optional `email`/`email_verified`/`name` claims are forwarded only as profile hints; they never participate in lookup, merging, or authorization, and no additional UserInfo call is made. A database/mapping failure returns `500 INTERNAL_ERROR`. Backend JWT verification cannot instantly observe Auth0-side grant revocation: the boundary reliably rejects expired tokens, and a revoked grant's Access Token is rejected no later than its 15-minute expiry; no denylist, introspection polling, or server-side session store exists in the Backend.

Backend-internal failure logs record only the failure category, request id, signing `kid`, and timing. Tokens, Authorization headers, raw claims, provider profiles, and subject values are never logged.

### Browser authentication endpoints

The endpoints in this section belong to the BFF/browser session (TASK-AUTH-005) and are not yet implemented; TASK-AUTH-004 delivered only the Fastify resource-server boundary described above.

| Endpoint | Success contract | Failure and cache contract |
| --- | --- | --- |
| `GET /auth/login?returnTo=/relative-path` | `302` to Auth0 Authorization Code + PKCE (`S256`); binds single-use state, nonce, verifier and a validated same-origin relative return path in the SDK encrypted transaction cookie | Invalid return path falls back to `/`; provider/config outage uses HTTP `500` with the existing `INTERNAL_ERROR` envelope; `Cache-Control: no-store` |
| `GET /auth/callback?code=...&state=...` | Validates and consumes state/nonce/PKCE, establishes the Auth0 Next.js SDK authenticated-encrypted Cookie Session, then `303` to the stored relative path | Invalid/replayed transaction uses generic `401 UNAUTHORIZED`; provider/JWKS outage uses HTTP `500` + `INTERNAL_ERROR`; no session on failure; `no-store` |
| `POST /auth/logout` | Exact same-origin `Origin`; locally invalidates first, clears cookie, returns idempotent `303` to the server-constructed Auth0 logout URL and then the exact allowlisted application logout URL | Origin mismatch is generic `403 FORBIDDEN`; upstream outage cannot restore local session; no token appears in the URL; `no-store` |
| `GET /auth/session` | `200 { authenticated: true, user, idleExpiresAt, absoluteExpiresAt }` or `200 { authenticated: false }`; the SDK decrypts the HttpOnly Cookie Session server-side and never returns tokens/provider ids/internal actor id | Required SDK/session runtime dependency outage uses HTTP `500` + `INTERNAL_ERROR`; expired, malformed/authentication-tag-invalid, or renewal-revoked cookie is cleared as unauthenticated; `no-store` |

Every error reuses `{ error: { code, message, fieldErrors?, requestId } }`; there is no auth-specific envelope. Expired, revoked, bad-signature, wrong-issuer, and wrong-audience credentials return the same generic `401 UNAUTHORIZED`. A verified actor requesting another actor's resource receives the existing owner-safe `403 FORBIDDEN`. A JWKS/provider/session dependency outage fails closed as HTTP `500` with the existing `INTERNAL_ERROR` envelope, not as an anonymous or forged identity.

The sole FEAT-018 session mode is the Auth0 Next.js SDK authenticated-encrypted, HttpOnly, host-only Cookie Session. No Redis, persistent `SessionStore`, session database, or `AuthSession` Prisma model is part of this Feature. Active logout immediately clears the current browser cookie. Provider/admin grant revocation becomes effective by the next renewal or no later than the 15-minute Access Token expiry.

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

## Design Recommendation API

All five endpoints require verified bearer authentication and owner-scoped access. They expose the deterministic design engine (spec §4.1, ADR-6 scoring) through the Backend: no LLM call participates in candidate generation, and identical inputs produce identical candidates. Their executable DTOs live in [recommendation-api.schema.ts](../packages/design-contract/src/schemas/recommendation-api.schema.ts); every request rejects unknown fields and every successful response is parsed before it leaves Backend.

| Route | Request DTO | Response DTO | Behavior |
| --- | --- | --- | --- |
| `POST /api/design/recommend` | `RecommendDesignRequestSchema` | `RecommendDesignResponseSchema` | Resolves a `RecommendationContext` from questionnaire inputs (or accepts a pre-resolved one), compiles active `APPROVED` rules, and returns at most three engine candidates. Each candidate carries a `PublicDesignV1`, its layout strategy, `design-score-v1` sub-scores, and localized reasons. Candidates are persisted as revision-1 designs with an immutable decision-trace sidecar. |
| `POST /api/design/evaluate` | `EvaluateDesignRequestSchema` | `EvaluateDesignResponseSchema` | Re-scores a persisted actor-owned design against the current catalog and active rules. `traceStale: true` flags designs whose persisted trace predates later edits. |
| `POST /api/design/optimize` | `OptimizeDesignRequestSchema` | `OptimizeDesignResponseSchema` | Regenerates an improved layout while preserving `lockedComponentIds`. Returns the optimized design plus a finite edit-operation script (`ADD/MOVE/REMOVE/REPLACE_COMPONENT`) compatible with `POST /api/design/update`, so the client applies it through normal revisioned edits and can undo. |
| `GET /api/design/:id/trace` | no body | `DesignTraceResponseSchema` | Returns the latest immutable decision trace for an owner-scoped design: fired rule ids, layout strategy, score breakdown, and inputs hash. |
| `GET /api/materials/:id/suggest?currency=CNY&locale=zh-CN` | query only | `MaterialSuggestResponseSchema` | Ranks at most eight compatible partner materials for one catalog material using color harmony plus tag affinity. Excludes the base material itself; descending by score. |

Recommendation is idempotent for unchanged context: engine design IDs are content-addressed, so an identical re-request returns the same persisted candidates instead of duplicating designs. A content-addressed ID that collides with a design the owner has since edited falls back to a fresh ID rather than failing. Responses never expose inventory quantities, unit costs, or rule-compile internals; violations surface as stable warning codes on the candidate. Optimization results are advisory only — the client applies operations through the revisioned Update endpoint, and cultural or emotional copy remains inspiration language without medical or guaranteed-effect claims.

These flows also append collect-only knowledge usage events (spec §11, EPIC 12) to the immutable `knowledge_usage_events` table: `recommendation.served` (plus per-candidate `design.created` and per-rule `rule.fired`) after recommend, `design.evaluated` + `rule.fired` after evaluate, `design.optimized` + `rule.fired` after optimize, `design.created` after generate and Tarot candidate generation, `design.updated` after update, `design.saved` after save, and `tarot.session_saved` after a Tarot session save. Events are a write-only side effect — request and response DTOs are unchanged and no read endpoint ships with this epic.

## Material Catalog API

GET /api/catalog/materials?currency=CNY

Requires verified authentication. Returns every active, addable material product for the requested supported currency using `ListCatalogMaterialsResponseSchema`. Public fields include product identity, bilingual crystal names, color, visual, style, emotion, and compliance-safe culture tags, shape, diameter, render asset keys, authoritative unit price, and a non-negative integer `availableQuantity` that backs the library page's sellable/zero-stock states. The response also carries an `accessories` array (`CatalogAccessoryProductSchema`, max 100) with accessory identity, type, material, finish, price, and `availableQuantity`. Unit costs, supplier data, and raw inventory ledgers are never returned. DIY updates still revalidate current inventory and pricing before a new design revision is persisted.

## MCP Knowledge Tools API

The `@mystcrag/mcp-server` app (ADR-12) exposes the reviewed knowledge base and the deterministic design engine to MCP clients (task book §36/37). It is a thin projection layer — every tool delegates to `knowledge-core` / `design-engine` with zero duplicated business logic, and the Backend never routes through MCP. Two transports are supported: stdio (`pnpm --filter @mystcrag/mcp-server dev -- --transport stdio`, default) and stateless Streamable HTTP at `POST /mcp` (`--transport http --host 127.0.0.1 --port 3001`; env `MCP_TRANSPORT`/`MCP_HOST`/`MCP_PORT`). HTTP mode creates one transport+server instance per request with no session id, so the process scales horizontally. Both transports require `DATABASE_URL`.

| Tool | Input (Zod `strictObject`) | Output | Behavior |
| --- | --- | --- | --- |
| `search_knowledge` | `text?`, `knowledgeTypes?`, `knowledgeDomains?`, `subjects?`, `productionOnly?`, `limit?` (≤50) | `knowledgeVersion`, `strategy`, `hitCount`, `hits[]` | Hybrid search over APPROVED production rules. Each hit is a public rule summary (`ruleId`, `knowledgeType`, `knowledgeDomain`, `subject`, `relation`, `confidence`, `summary`) plus `score` and fired `channels`. |
| `get_rules` | `knowledgeTypes?`, `knowledgeDomains?`, `subjects?`, `limit?` (≤200) | `count`, `rules[]` | Deterministic id-ordered listing of production rules with the same public projection as search hits. |
| `get_material_compatibility` | `materialTaxonomyId` | `material`, `compatibleWith[]`, `conflictsWith[]`, `rules[]` | Aggregates `MATERIAL_COMPATIBILITY` rules for one material taxonomy id; compatible and conflicting companion lists are deduplicated and sorted, with supporting rules included. |
| `recommend_palette` | `baseColorTaxonomyId`, `paletteSize?` (2–5), `limit?` (1–10) | `baseColor`, `paletteCount`, `palettes[]` | Expands `COLOR_THEORY` harmony rules from the base color and scores each palette with the same OKLCH pair-harmony math the design engine uses. Identical to calling `recommendPalettes` in `design-engine` directly. |
| `evaluate_design` | `beads[]` (1–40, `beadProductId` + optional `role`), `wristCircumferenceMm` (100–250), `targetInnerCircumferenceMm?`, `maxBudgetMinor?`, `layoutStrategy?`, `currency` (default CNY), `locale` (default zh-CN), `emotionTags?`/`styleTags?`/`colorTags?` | `knowledgeVersion`, `productCatalogVersion`, `beadCount`, `layoutStrategy`, `scores`, `firedRuleIds`, `softRuleScore`, `violations` | Deterministically scores a bead sequence against the active catalog, published rules, and stock. Same pipeline as `POST /api/design/recommend`'s engine stage. |

Tool responses carry both a JSON `structuredContent` payload and a text rendering of the same payload. Rule summaries hide fingerprints, source references, source ids, and internal version bookkeeping (they stay server-side). Errors follow MCP semantics: invalid arguments — including unknown `beadProductId`s outside the active catalog — surface as in-band `isError` results carrying JSON-RPC `-32602`; dependency failures surface as `-32603` or the raw message, never a crash. Cultural references in results are inspiration language only; no medical or guaranteed-effect claims are produced. Tool schemas, invalid-input handling, result consistency with the direct `knowledge-core`/`design-engine` pipeline, transport behavior, and error mapping are covered by `apps/mcp-server/tests/tools.test.ts` (client over in-memory transport) and the architecture boundary tests (`tests/architecture.test.mjs`: no business-copy imports; Prisma only inside the composition root `src/runtime.ts`).

## Knowledge Admin API (Quality Phase Q3)

Ten operator endpoints under `/api/admin/knowledge` expose the review chain over HTTP with the same `KnowledgeReviewService`/`KnowledgeSourceAdminService` the CLI uses (`pnpm --filter @mystcrag/knowledge-core review:cli`), so both entrances behave identically. DTOs live in [knowledge-admin-api.schema](../packages/design-contract/src/schemas/knowledge-admin-api.schema.ts) as strict Zod objects; every successful response is parsed before it leaves Backend, and stored rows are never projected raw.

Authentication is a dedicated admin key: the `X-Admin-Key` header compared against `knowledgeAdminApiKey` (≥16 chars, from `KNOWLEDGE_ADMIN_API_KEY`) with `timingSafeEqual`. The surface fails closed — creating the app with the admin service but without a valid key throws, and requests without the exact key get `403 FORBIDDEN` on every admin route while non-admin routes stay untouched. Admin routes are not listed in `/api/modules`.

| Route | Request | Response | Behavior |
| --- | --- | --- | --- |
| `GET /overview` | — | `KnowledgeAdminOverviewResponseSchema` | Rule counts per knowledge status (repository `groupBy`, correct past the list cap), source counts per review status plus enabled count, active conflict group count, latest published version or `null`. |
| `GET /review-queue?status=&limit=` | query filter | `KnowledgeAdminReviewQueueResponseSchema` | Candidates with validation issues, per-source/document provenance evidence, and Q2 extraction evidence (`extractor`, `method`, verbatim `sentence` + offsets) when present; legacy candidates carry `extraction: null`. `limit` is 1–500. |
| `GET /conflicts` | — | `KnowledgeAdminConflictsResponseSchema` | Same-key divergent-payload groups (≥2 rules each). |
| `POST /review-pipeline/run` | — | `KnowledgeAdminPipelineResponseSchema` | Runs NEW → EXTRACTED → auto-classification → conflict marking. |
| `POST /rules/:ruleId/approve` `reject` `supersede` | path id | `KnowledgeAdminRuleActionResponseSchema` | Human verdicts; CONFLICTED candidates are moved through NEEDS_REVIEW first. |
| `POST /versions` | `KnowledgeAdminPublishVersionRequestSchema` (slug) | `KnowledgeAdminPublishVersionResponseSchema` | Publishes APPROVED rules as a knowledge version; duplicates return `409`. |
| `GET /sources?reviewStatus=` | query filter | `KnowledgeAdminSourceQueueResponseSchema` | Source queue with editorial classification, fetch health, and rate-limit policy. |
| `POST /sources/:sourceId/review` | `KnowledgeAdminReviewSourceRequestSchema` (`NEEDS_REVIEW`/`APPROVED`/`REJECTED`) | `KnowledgeAdminSourceMutationResponseSchema` | Human source verdict; illegal transitions return `409` from the repository state machine. |
| `POST /sources/:sourceId/enabled` | `KnowledgeAdminSetSourceEnabledRequestSchema` | `KnowledgeAdminSourceMutationResponseSchema` | Enables/disables a source (only APPROVED + enabled sources are ever crawled). |
| `POST /sources/:sourceId/policy` | `KnowledgeAdminUpdateSourcePolicyRequestSchema` (at least one of `allowedKnowledgeDomains`, `maxRequestsPerMinute` ≤600) | `KnowledgeAdminSourceMutationResponseSchema` | Updates the crawl policy. |

Error mapping follows the shared envelope: unknown ids → `404 NOT_FOUND`, illegal status transitions and duplicate versions → `409 CONFLICT`, request-shape violations → `400 VALIDATION_ERROR`, missing/wrong key → `403 FORBIDDEN`. Route coverage — fail-closed key handling, filter validation, verdict mapping, and error codes — is in `apps/backend/src/modules/knowledge-admin/knowledge-admin.routes.test.ts`.

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

Recommendation generation uses active catalog SKUs including zero-stock materials, authoritative prices, knowledge-backed scoring, and validated `TAROT_GUIDED` Designs. The production Tarot composition uses the catalog's latest `availableQuantity` to create public-safe fulfillment advisories instead of blocking shortages: affected product IDs receive an estimated five-day replenishment window, while raw quantities remain private. Tarot generation and editing return `RESTOCK_REQUIRED` as an advisory. Callers that explicitly inject a `TarotStockPort` opt into stricter filtering: each retained material must hold enough stock to complete the largest supported wrist on its own (`ceil(200 mm / diameter)`), and an insufficient catalog returns `INVENTORY_CHANGED`. Missing, inactive, malformed, or wrong-currency products always fail. A current-session wrist submitted by Tarot setup overrides a saved wrist preference for all three generated designs. Without that request value, a saved preference port may supply wrist and budget values; the current production adapter has no preference store, so wrist defaults to 155 mm and budget is absent rather than fabricated.

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

`/health`, `/api/modules`, the Design/catalog/order routes, the authenticated Tarot lifecycle, and the five Design Recommendation routes are registered by the current Backend startup. Repository-backed Design, publication, order, pricing, inventory, Tarot session, catalog, and recommendation services all receive the verified `actorId`; Tarot copy currently uses the deterministic bounded adapter documented in `AI_AGENT_SPEC.md`, and Design recommendation uses the deterministic `@mystcrag/design-engine` pipeline.

Persistence conflicts map to the existing stable codes: stale `expectedRevision` becomes `CONFLICT`; server price/version mismatch becomes `PRICE_CHANGED`; latest stock mismatch becomes `INVENTORY_CHANGED`; consent and compliance failures retain `CONSENT_REQUIRED` and `COMPLIANCE_BLOCKED`. Clients never submit `ownerId`, unit costs, trusted totals, or trusted inventory. Order intent is limited to design/revision identity plus `expectedTotalPriceMinor` and `expectedPricingVersion`.
