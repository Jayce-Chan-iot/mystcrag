# Mystcrag API Specification

## Purpose

Define communication between frontend, backend, AI and 3D engine.

## Shared design DTO contract

`@mystcrag/design-contract` now provides the canonical runtime schemas for design-related wire JSON. V1 uses camelCase, `schemaVersion: "1.0.0"`, positive design revisions, and CNY/TWD minor-unit integer money. The executable schemas are documented in `DESIGN_CONTRACT_V1.md`.

The package exports request and response schemas for Generate Design, Update Design, Price Design, Save Design, Publish Design, and Create Order From Design. Every response uses `PublicDesignV1`; commercial costs and supplier references are not public API fields. Update requests use the finite operation union rather than arbitrary JSON Patch.

The Backend registers validated HTTP boundaries for all six design/order operations. Every request is parsed with its shared request schema and every successful service value is parsed with its shared response schema. Local startup wires the repository-backed Design application service, catalog, pricing, publication, and order boundaries; it does not fabricate product data.

Errors use `{ error: { code, message, fieldErrors?, requestId } }`. Supported stable codes are `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_IMPLEMENTED`, `NOT_FOUND`, `CONFLICT`, `COMPLIANCE_BLOCKED`, `CONSENT_REQUIRED`, `INVENTORY_CHANGED`, `PRICE_CHANGED`, and `INTERNAL_ERROR`. Publish rejects public or unlisted requests without consent; order creation rejects a `REJECTED` design before service execution.

## Authentication and actor context

The controlling production contract is [AUTH_SESSION_CONTRACT.md](AUTH_SESSION_CONTRACT.md), state `IMPLEMENTATION_COMPLETE_ACCEPTANCE_PENDING`. The browser authenticates only to the Next.js Server/BFF with its host-only HttpOnly session cookie. The BFF holds every reusable credential server-side and sends a short-lived audience-specific Access Token to Fastify. Browser code must not call Fastify with a stored Bearer token.

All Design and Order routes listed below are protected. `AuthProvider` verifies Access Token signature, exact issuer, required audience, and expiry before a provider-neutral `VerifiedIdentity` is mapped by unique `(issuer, subject)` to an internal `User.id`. Only that internal id becomes request-local `actorId` and is passed to owner-scoped services. Authentication fields are not added to Design Contract DTOs, and request bodies never supply authoritative ownership.

`x-actor-id` is not an authentication mechanism. A request that supplies only `x-actor-id` receives `401 UNAUTHORIZED`, and the header cannot replace or override the subject of a valid verified credential. Missing, malformed, forged, expired, wrong-issuer, and wrong-audience credentials receive the same generic `401 UNAUTHORIZED` envelope. The response does not echo the credential or expose verifier details.

Owner-scoped routes use `403 FORBIDDEN` with a generic message when a verified actor cannot access the requested resource. Missing and differently owned resources are not distinguished at this boundary, preventing ownership disclosure.

The built-in signed-token provider is for explicitly enabled test/development use only. It requires `NODE_ENV=test|development`, `MYSTCRAG_AUTH_PROVIDER=signed-test`, `MYSTCRAG_ENABLE_SIGNED_TEST_AUTH=true`, and configured signing secret, issuer, and audience values. It is rejected in production even when the opt-in flag is present. Production startup without a supported authentication provider fails safely rather than falling back to a fixed, anonymous, header-derived, or test actor.

### Implemented Fastify verification boundary (TASK-AUTH-004)

The production Auth0 resource-server boundary is implemented in the Backend. With `MYSTCRAG_AUTH_PROVIDER=auth0`, `MYSTCRAG_AUTH_ISSUER`, and `MYSTCRAG_AUTH_AUDIENCE` configured, startup builds an RS256 Access Token verifier (`jose@6.2.10`) that validates signature, exact issuer, required audience, expiry with at most 60 seconds of clock skew, and a non-empty subject. The issuer must be the exact canonical HTTPS form (`https://<host>/` with a trailing slash, no path, query, fragment, or embedded credentials), and the host must be an exact DNS hostname: wildcard hosts (`*` anywhere in the host), every IPv4 literal (including `0.0.0.0` and `127.0.0.0/8`), every IPv6 literal (including `::1` and IPv4-mapped forms), and `localhost` (including trailing-dot and case variants) are rejected in every environment. Custom Auth0 DNS domains such as `https://login.mystcrag.example/` are accepted. The JWKS URL is derived as the exact string `${issuer}.well-known/jwks.json` without silent rewriting. Incomplete configuration (missing/non-canonical/non-DNS issuer, missing audience), an unselected provider in production, `signed-test` outside test/development opt-in, or an unknown provider name all fail startup before the listener opens; there is no fallback provider. These values are server-boundary configuration shared by the Backend verifier and the Next.js BFF where applicable; browser code never reads them and they have no `NEXT_PUBLIC_*` authority.

Keys are fetched from the issuer's HTTPS-only `/.well-known/jwks.json`. Connect and read timeouts are 2 seconds each within a 5-second total request budget, and every transport timer and the abort signal are cleaned up after success, failure, or abort. A successful key set is cached for at most 15 minutes, and a shorter provider `Cache-Control: max-age` directive shortens the cache further; only TTL-fresh cached keys may verify, and an expired cache is never served during a provider outage. An unknown `kid` triggers at most one bounded refresh: after a successful refresh that still lacks the kid, a global 30-second negative cooldown — recorded independently of the positive key-set TTL, so it also holds when the provider sends `max-age=0` or the positive cache has already expired — suppresses further unknown-kid refreshes; within the cooldown an unknown kid is rejected as `401` without contacting the provider, whether the kid repeats or is random, and no attacker-supplied kid set is ever stored. A kid that existed in the latest key set but whose positive cache has expired forces a fresh refresh instead of reusing the expired key, so expired keys never verify anything. Cooldown expiry allows one new bounded refresh so rotated keys are discovered. A failed refresh is negative-cached for 30 seconds, and concurrent verifications share the single in-flight request. A provider key set that is malformed or contains duplicate kids is `500 INTERNAL_ERROR` provider unavailability, never a forged-credential verdict. With no usable cached key set and JWKS unavailable, verification fails closed as `500 INTERNAL_ERROR` and is never classified as a forged credential.

Authentication is layered as `AccessTokenVerifier` (token verification only — `Auth0AccessTokenVerifier` and the signed-test verifier) composed by `AuthenticatedActorProvider` (`AccessTokenVerifier` → AUTH-003 `ExternalIdentityRepository` → internal `User.id` → `ActorContext`). `createAuthenticationPreHandler` and every registered route accept only the composed `AuthProvider` interface; a bare verifier cannot produce an actor context and there is no subject-as-actor path. On every successful verification the provider-neutral identity is mapped by unique `(issuer, subject)` to an internal `User.id`; that internal id — never the provider subject — becomes `request.actorContext.actorId` for owner-scoped services. Optional `email`/`email_verified`/`name` claims are trimmed, control-character-stripped, length-bounded, and otherwise safely omitted as profile hints; they never participate in lookup, merging, or authorization, and no additional UserInfo call is made. A database/mapping failure returns `500 INTERNAL_ERROR`. Backend JWT verification cannot instantly observe Auth0-side grant revocation: the boundary reliably rejects expired tokens, and a revoked grant's Access Token is rejected no later than its 15-minute expiry; no denylist, introspection polling, or server-side session store exists in the Backend.

Error classification: `CredentialRejectedError` (malformed token, wrong algorithm, bad signature, expired, wrong issuer/audience, empty subject, unknown key, invalid kid format) maps to generic `401 UNAUTHORIZED`; provider/JWKS unavailability, duplicate or unusable key material, and identity-mapping failures map to `500 INTERNAL_ERROR`; any unrecognized internal exception also fails closed as `500 INTERNAL_ERROR` rather than being disguised as an invalid credential. Backend-internal failure logs record only the failure category, request id, a charset- and length-validated signing `kid`, and timing. Tokens, Authorization headers, raw claims, provider profiles, subject values, and unvalidated header kids are never logged.

### Browser authentication endpoints

The endpoints in this section are implemented by the Next.js BFF/browser-session boundary delivered by TASK-AUTH-005 and repaired by TASK-AUTH-008. TASK-AUTH-004 delivered the complementary Fastify resource-server boundary described above.

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

## Bead Asset Import Admin API

Contract-first surface for the bead asset import assistant (`/admin/bead-import`, spec [docs/superpowers/specs/2026-08-31-bead-asset-import-assistant-design.md](superpowers/specs/2026-08-31-bead-asset-import-assistant-design.md)). All DTOs are strict Zod objects in [bead-asset-import-api.schema](../packages/design-contract/src/schemas/bead-asset-import-api.schema.ts): every request rejects unknown keys, and clients never submit absolute filesystem paths, private archive keys, processed-result paths, or server storage keys — manifest paths are normalized relative paths, every stored `archiveKey` is server-generated, and only content-addressed `approved:<sha256>` keys ever appear in public responses. This section defines the contract; routes are implemented by TASK-ASSET-BE-001 with a dedicated `ASSET_ADMIN_API_KEY` (timing-safe comparison, independent of the knowledge admin key). Images are never used to infer mineral identity, quality, treatment, or efficacy — the only identity input is the human-confirmed bead name.

Session lifecycle uses exactly these states (`AssetImportSessionStateSchema`): `CREATED → UPLOADING → ARCHIVING → PROCESSING → NEEDS_REVIEW → READY_TO_PUBLISH → PUBLISHING → PUBLISHED`, with `PARTIALLY_FAILED` reachable from `ARCHIVING`, `PROCESSING`, and `PUBLISHING` (recoverable back into `PROCESSING`/`NEEDS_REVIEW` or down to `FAILED`). Every non-terminal state can also move to `CANCELLED`; `PUBLISHED`, `FAILED`, and `CANCELLED` are terminal. Legal moves are enumerated in `ASSET_IMPORT_SESSION_TRANSITIONS`; any other move is `409`.

Recovery checkpoints are a separate ordered enum (`AssetImportCheckpointSchema`): `ARCHIVED → GROUPED → LABELED → PROCESSED → REVIEWED → PUBLISHED`. Session responses expose `lastVerifiedCheckpoint` (nullable until the first checkpoint verifies); after a crash, cancellation, or restart the backend resumes from the last verified checkpoint instead of restarting the import.

| Route | Request DTO | Response DTO | Behavior |
| --- | --- | --- | --- |
| `POST /api/admin/bead-import/sessions` | `CreateAssetImportSessionRequestSchema` (`idempotencyKey` only) | `CreateAssetImportSessionResponseSchema` (`state` literal `CREATED`) | Creates a session. No client-supplied `sessionId` or filesystem root is accepted. |
| `GET /api/admin/bead-import/sessions` | `ListAssetImportSessionsQuerySchema` (query: optional `state` filter, `limit` 1–100, `cursor`) | `ListAssetImportSessionsResponseSchema` | Lists session summaries including `lastVerifiedCheckpoint` and progress counts; terminal sessions (including `CANCELLED`) stay listable. `nextCursor` is `null` on the last page. |
| `POST /api/admin/bead-import/sessions/:sessionId/cancel` | `CancelAssetImportSessionRequestSchema` | `CancelAssetImportSessionResponseSchema` (`state` literal `CANCELLED`) | Cancels from any non-terminal state; already-terminal sessions are `409`. Cancellation never deletes user source files. |
| `POST /api/admin/bead-import/sessions/:sessionId/manifest` | `RegisterAssetManifestRequestSchema` | `RegisterAssetManifestResponseSchema` | Registers the file inventory before any bytes move. Each entry carries `clientFileId`, normalized `relativePath`, `byteSize`, `lastModifiedMs`, and declared `kind` (`ARW`/`JPEG`/`PNG`/`WEBP`). Enforces ≤500 files, ≤256 MiB per file, ≤8 GiB per session (`ASSET_MANIFEST_LIMITS`), unique `clientFileId`/`relativePath`, extension↔kind agreement, and `registeredFileCount === files.length`. |
| `PUT /api/admin/bead-import/sessions/:sessionId/files/:fileId/content` | `UploadAssetFileParamsSchema` (`contentLengthBytes` > 0, binary body) | `UploadAssetFileResponseSchema` | Streams one registered file, verifies declared length, content magic bytes, and final SHA-256, then reports the server-assigned `archiveKey`. The client supplies no path; the response never echoes local paths. |
| `GET /api/admin/bead-import/sessions/:sessionId` | no body | `AssetImportSessionResponseSchema` | Polls progress: counts, bytes, `lastVerifiedCheckpoint`, per-file state (`PENDING`/`UPLOADING`/`ARCHIVED`/`FAILED`/`SKIPPED_DUPLICATE`), and group review state. Short-polling only in V1. |
| `POST /api/admin/bead-import/sessions/:sessionId/grouping/start` | `StartAssetImportGroupingRequestSchema` | `StartAssetImportGroupingResponseSchema` (`state` literal `PROCESSING`) | Starts deterministic grouping over fully archived files (`ARCHIVING → PROCESSING`) and returns `queuedJobCount`. Sessions with files that are not archive-verified are `409`. |
| `POST /api/admin/bead-import/sessions/:sessionId/processing/start` | `StartAssetImportProcessingRequestSchema` | `StartAssetImportProcessingResponseSchema` (`state` literal `PROCESSING`) | Starts cut-out processing for confirmed, named groups (`NEEDS_REVIEW → PROCESSING`) and returns `queuedJobCount`. |
| `PATCH /api/admin/bead-import/groups/:groupId` | `UpdateBeadImageGroupRequestSchema` | `UpdateBeadImageGroupResponseSchema` | Review actions: `SET_NAME`, `MERGE_GROUPS`, `SPLIT_GROUP`, `MOVE_FILES`, `SET_PRIMARY`, `IGNORE_FILES`. Every action requires `expectedGroupRevision`; responses return the incremented `revision`. `SET_PRIMARY` carries only `primaryFileId` — authoritative membership is checked server-side from `groupId` + `expectedGroupRevision`, never from a client-supplied member list. |
| `POST /api/admin/bead-import/groups/:groupId/reprocess` | `ReprocessBeadImageGroupRequestSchema` | `ReprocessBeadImageGroupResponseSchema` | Queues a new processing version. Only bounded settings are accepted (`maskThreshold` 0–1, `edgeFeatherPx` 0–8); no model choice, no output path. |
| `POST /api/admin/bead-import/groups/:groupId/processed-version` | `SelectProcessedVersionRequestSchema` | `SelectProcessedVersionResponseSchema` | Explicitly selects the current processed version for review/publication. New versions never delete old ones; the selection is an explicit reference guarded by `expectedGroupRevision`. |
| `POST /api/admin/bead-import/groups/:groupId/draft` | `SaveBeadProductDraftRequestSchema` | `SaveBeadProductDraftResponseSchema` | Explicit partial product-draft save: at least one product field plus `expectedGroupRevision`. Accepts the full permission vocabulary including `UNKNOWN` and `PROHIBITED` — such drafts persist locally as review-only records. A draft may reference an existing `crystalId` or a `crystalDraftId`, never both. |
| `GET /api/admin/bead-import/groups/:groupId/draft-completeness` | no body | `CheckBeadProductDraftCompletenessResponseSchema` | Reports `complete` and `missingFields` against the publish-required field list (`DRAFT_COMPLETENESS_FIELDS`); `complete` is true exactly when `missingFields` is empty. |
| `POST /api/admin/bead-import/groups/:groupId/publish` | `PublishBeadImageGroupRequestSchema` | `PublishBeadImageGroupResponseSchema` (`state` literal `PUBLISHED`, `publishedAssetKeys` ≥1 approved keys) | Transactional publication of one reviewed group into the formal catalog. |
| `GET /api/admin/bead-import/groups/:groupId/publish-result` | no body | `GetBeadImageGroupPublishResultResponseSchema` | Re-reads the persisted publication result for refresh/recovery. |
| `GET /api/assets/:assetKey` | `ResolveApprovedAssetParamsSchema` | `ResolveApprovedAssetResponseSchema` | Approved-only public delivery (see below). Draft, retired, unpublished, or private assets resolve to `404`. |

Draft save is an explicit boundary (`POST /groups/:groupId/draft`), not the `SET_NAME` review action: `SET_NAME` only records the human bead name during review, while draft save persists product fields across review steps. Drafts never appear in public catalog queries, AI recommendation, or inventory; publication is the only path to the live catalog, and it requires the complete publish request.

Publish example (all fields strict; unknown keys rejected):

```json
{
  "idempotencyKey": "publish-group-1",
  "expectedGroupRevision": 3,
  "crystalId": "crystal-amethyst",
  "crystalName": "紫水晶",
  "crystalNameConfirmedByOperator": true,
  "displayName": "紫水晶 8mm 圆珠",
  "sku": "BEAD-AMETHYST-8",
  "materialKey": "amethyst-round-8",
  "shape": "ROUND",
  "diameterMm": 8,
  "qualityStatement": "天然紫水晶，肉眼可见少量棉絮，无注胶",
  "qualitySource": "到货批次人工目检（2026-08-30）",
  "textureAssetKey": "approved:a3f5…(64 hex)",
  "currency": "CNY",
  "unitPriceMinor": 12800,
  "costMinor": 4000,
  "availableQuantity": 12,
  "allowPublicDisplay": true,
  "allowAiRecommendation": false,
  "allowAiTraining": false,
  "allowCommercialUse": true,
  "rightsHolder": "玄矶工作室",
  "usagePermission": "GRANTED",
  "isAuthenticPhotograph": true
}
```

Publication must resolve exactly one crystal reference. Instead of `crystalId`, a request may promote a human-completed crystal draft by supplying `"crystalDraftId": "draft-amethyst"` together with `"crystalDraftPromotionConfirmed": true`; both references, neither reference, or an unconfirmed promotion are `400`. `crystalNameConfirmedByOperator` must be `true`; `textureAssetKey` (and the optional `modelAssetKey`) must be approved public keys; `usagePermission` allows only `OWNED` or `GRANTED`. `allowAiRecommendation` is the AI-recommendation availability decision and is separate from `allowAiTraining` consent — both, plus `allowCommercialUse`, `allowPublicDisplay`, and `isAuthenticPhotograph`, are mandatory booleans. Example response (also served by `GET /groups/:groupId/publish-result`):

```json
{
  "groupId": "group-1",
  "state": "PUBLISHED",
  "materialProductId": "product-1",
  "crystalId": "crystal-amethyst",
  "inventorySnapshotId": "inventory-1",
  "publishedAt": "2026-09-01T09:30:00+08:00",
  "publishedAssetKeys": ["approved:a3f5…(64 hex)"]
}
```

Session list example (`GET /api/admin/bead-import/sessions?state=NEEDS_REVIEW&limit=20`):

```json
{
  "sessions": [
    {
      "sessionId": "session-1",
      "state": "NEEDS_REVIEW",
      "lastVerifiedCheckpoint": "GROUPED",
      "declaredFileCount": 127,
      "archivedFileCount": 127,
      "failedFileCount": 0,
      "groupCount": 64,
      "createdAt": "2026-09-01T09:00:00+08:00",
      "updatedAt": "2026-09-01T09:20:00+08:00"
    }
  ],
  "nextCursor": null
}
```

Cancel example (`POST /sessions/:sessionId/cancel`) and response:

```json
{ "idempotencyKey": "cancel-session-1" }
```

```json
{ "sessionId": "session-1", "state": "CANCELLED", "cancelledAt": "2026-09-01T09:25:00+08:00" }
```

Grouping/processing start responses (`POST /sessions/:sessionId/grouping/start` or `/processing/start`):

```json
{ "idempotencyKey": "grouping-session-1" }
```

```json
{ "sessionId": "session-1", "state": "PROCESSING", "queuedJobCount": 4, "startedAt": "2026-09-01T09:10:00+08:00" }
```

Processed-version selection (`POST /groups/:groupId/processed-version`) and response:

```json
{ "expectedGroupRevision": 4, "processingVersion": 2 }
```

```json
{ "groupId": "group-1", "state": "PROCESSED", "selectedProcessingVersion": 2, "updatedAt": "2026-09-01T09:15:00+08:00" }
```

Draft save example (`POST /groups/:groupId/draft`; any non-empty subset of product fields):

```json
{ "expectedGroupRevision": 2, "crystalName": "紫水晶", "usagePermission": "UNKNOWN" }
```

```json
{ "groupId": "group-1", "state": "NAMED", "revision": 3, "draftSavedAt": "2026-09-01T09:12:00+08:00" }
```

Draft completeness example (`GET /groups/:groupId/draft-completeness`):

```json
{
  "groupId": "group-1",
  "state": "NAMED",
  "complete": false,
  "missingFields": ["QUALITY_STATEMENT", "TEXTURE_ASSET_KEY", "AI_TRAINING_DECISION"],
  "checkedAt": "2026-09-01T09:16:00+08:00"
}
```

Manifest registration example:

```json
{
  "idempotencyKey": "manifest-batch-1",
  "files": [
    { "clientFileId": "file-001", "relativePath": "01/DSC0001.JPG", "byteSize": 1048576, "lastModifiedMs": 1756600000000, "kind": "JPEG" },
    { "clientFileId": "file-002", "relativePath": "01/DSC0001.ARW", "byteSize": 25165824, "lastModifiedMs": 1756600000000, "kind": "ARW" }
  ]
}
```

Binary upload response example (`ARCHIVED` requires verified `sha256`, server `archiveKey`, and `archivedAt`):

```json
{
  "fileId": "file-1",
  "uploadStatus": "ARCHIVED",
  "byteSize": 1048576,
  "sha256": "a3f5…(64 hex)",
  "archiveKey": "imports/session-1/raw/a3f5.webp",
  "archivedAt": "2026-09-01T09:00:00+08:00"
}
```

Approved asset delivery (`GET /api/assets/:assetKey`) resolves only approved, active, `allowPublicDisplay=true` bindings. Approved keys are stable and content-addressed (`approved:<sha256>`, `ApprovedAssetKeySchema`) and are deliberately unlike private archive keys (`imports/...`), which never parse as approved keys and never appear in public responses. Responses are immutable for a given key: the ETag is the content hash and `cacheControl` is `public, max-age=31536000, immutable`. Draft, retired, unpublished, or private assets resolve to `404`. Example response:

```json
{
  "assetKey": "approved:a3f5…(64 hex)",
  "contentType": "image/webp",
  "byteSize": 65536,
  "sha256": "a3f5…(64 hex)",
  "etag": "\"a3f5…(64 hex)\"",
  "cacheControl": "public, max-age=31536000, immutable"
}
```

### Typed error contract

Asset-import failures serialize inside the repository's shared `{ "error": { code, message, requestId } }` outer envelope, extended with stable detail fields (`AssetImportErrorEnvelopeSchema`):

```json
{
  "error": {
    "code": "STORAGE_FULL",
    "message": "档案根目录剩余空间不足，归档已暂停",
    "retryable": true,
    "recoveryAction": "RESUME_FROM_CHECKPOINT",
    "requestId": "req-1"
  }
}
```

Stable codes (`AssetImportErrorCodeSchema`) cover the spec §11 failure categories, and `ASSET_IMPORT_ERROR_CATALOG` fixes each code's `retryable` flag and `recoveryAction`, so client recovery logic can rely on them:

| Code | Spec §11 category | retryable | recoveryAction |
| --- | --- | --- | --- |
| `UNSUPPORTED_FILE_KIND` | unsupported / corrupt files | false | `REUPLOAD_FILE` |
| `CORRUPT_FILE_CONTENT` | unsupported / corrupt files | false | `REUPLOAD_FILE` |
| `STORAGE_FULL` | storage exhaustion / verification failure | true | `RESUME_FROM_CHECKPOINT` |
| `ARCHIVE_VERIFICATION_FAILED` | storage exhaustion / verification failure | true | `REUPLOAD_FILE` |
| `ARCHIVE_CONFLICT` | archive / job lease conflicts | true | `RESUME_FROM_CHECKPOINT` |
| `JOB_LEASE_CONFLICT` | archive / job lease conflicts | true | `RESUME_FROM_CHECKPOINT` |
| `SEGMENTATION_FAILED` | segmentation failure / insufficient quality | true | `REPROCESS_GROUP` |
| `QUALITY_INSUFFICIENT` | segmentation failure / insufficient quality | false | `REPROCESS_GROUP` |
| `ADMIN_PERMISSION_EXPIRED` | expired admin permission | true | `RENEW_ADMIN_PERMISSION` |
| `DRAFT_INCOMPLETE` | incomplete draft fields / missing references | false | `COMPLETE_DRAFT_FIELDS` |
| `MISSING_REFERENCE` | incomplete draft fields / missing references | false | `COMPLETE_DRAFT_FIELDS` |
| `SKU_CONFLICT` | publication conflicts | false | `RESOLVE_SKU_CONFLICT` |
| `INVENTORY_VERSION_CONFLICT` | publication conflicts | true | `RETRY_WITH_FRESH_INVENTORY` |
| `PUBLISH_TRANSACTION_FAILED` | publication transaction failure | true | `RETRY_REQUEST` |

HTTP mapping keeps the shared envelope codes:

| Status | Code | When |
| --- | --- | --- |
| `400` | `VALIDATION_ERROR` | Strict-shape violations, unknown keys, hostile paths (absolute, `..`, backslash, drive letter), extension↔kind mismatch, non-positive sizes or revisions, and publish-shape violations: permission outside `OWNED`/`GRANTED`, missing/duplicated crystal reference, unconfirmed draft promotion, missing consent booleans, non-approved asset keys. |
| `401` | `UNAUTHORIZED` | Missing or invalid `ASSET_ADMIN_API_KEY`. The key is never echoed or logged. |
| `404` | `NOT_FOUND` | Unknown `sessionId`, `fileId`, `groupId`, job, or approved asset. Draft/retired/private assets requested through the public asset route also resolve to `404`. |
| `409` | `CONFLICT` | Illegal session transition (including cancelling a terminal session), stale `expectedGroupRevision`, duplicate idempotency key with a different payload, SHA-256 conflict against an archived file, conflicting duplicate publish. |
| `413` | `PAYLOAD_TOO_LARGE` | Declared or streamed bytes exceed the per-file or session limit. |
| `415` | `UNSUPPORTED_MEDIA_TYPE` | Declared kind or detected magic bytes outside ARW/JPEG/PNG/WEBP. |
| `422` | `UNPROCESSABLE_ENTITY` | Well-formed but business-invalid requests: publish of a QC-failed or unapproved group, publish of an incomplete draft (`DRAFT_INCOMPLETE`/`MISSING_REFERENCE`), processing requested before archive verification. |
| `500` | `INTERNAL_ERROR` | Unexpected failure. Safe to retry with the same idempotency key; no second session, archive copy, processing version, or SKU is created by the retry. |

### Idempotency and repeated operations

- **Session creation:** one `idempotencyKey` maps to one session; an exact retry returns the existing session instead of creating another.
- **Manifest registration:** same key and identical file list returns the existing stable `fileId`s; the same key with different files is `409`. Re-registering never duplicates file records — `(sessionId, clientFileId)` is unique.
- **File upload (incl. failure retry):** re-PUTting a `PENDING`/`FAILED` `fileId` resumes that file; retry is the failure-recovery path and never archives a second original. Re-uploading an `ARCHIVED` file with a matching SHA-256 succeeds without side effects; different content for the same `fileId` is `409`.
- **Session status / list / completeness / publish result:** read-only and safe to poll or re-read.
- **Cancellation:** one `idempotencyKey` cancels once; an exact retry returns the existing `CANCELLED` state. Cancelling a session that already reached any terminal state is `409`. Cancellation never deletes source files, archive copies, or drafts.
- **Grouping/processing starts:** one `idempotencyKey` yields one start; an exact retry returns the current queued state instead of enqueueing duplicate jobs.
- **Group edits:** optimistic concurrency via `expectedGroupRevision`; an accepted action increments the revision, so a stale retry is `409` and the client re-reads the group. Accepted edits never lose member files or the human primary-image choice. `SET_PRIMARY` membership is validated server-side, never from client-supplied lists.
- **Draft save:** guarded by `expectedGroupRevision`; partial fields merge into the existing draft and the revision increments, so a stale retry is `409`. Drafts with `UNKNOWN`/`PROHIBITED` permissions stay local.
- **Processed-version selection:** guarded by `expectedGroupRevision`; selecting an existing version again is an update, not a new version.
- **Reprocess:** one `idempotencyKey` yields one job and one new processing version; an exact retry returns the existing `jobId`/`processingVersion`. Retries never silently create extra versions.
- **Publish:** one `idempotencyKey` publishes once. An exact retry returns the existing publication result (same `materialProductId`, inventory snapshot, and asset bindings); the same key with a different payload is `409`. Publication creates/approves the crystal, activates the product, appends the inventory snapshot, and binds approved assets in one transaction — any failure rolls everything back and the group remains a draft.


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
