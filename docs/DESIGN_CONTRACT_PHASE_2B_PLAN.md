# Design Contract Phase 2B Migration Plan

Date: 2026-07-21

## 1. Current consumer types

- AI Agent exposes a provider-independent `Agent<Input, Output>` contract plus grouped `BeadDesign` and `BraceletDesignOutput` types. The grouped types cannot preserve final component order and have no runtime provider-output validation.
- Three Engine exposes grouped `BraceletBeadConfiguration`, `BraceletConfiguration`, and an initialization-only `BraceletSceneDescriptor` that embeds the legacy configuration.
- Backend exposes only health/module diagnostics. Product DTO validation, stable domain errors, and design/order routes do not exist.
- Frontend contains route scaffolds and shared presentation primitives but no design domain model, API adapter, amount formatter, or contract-consuming component.

## 2. Consumer adaptation

- AI Agent: keep the generic agent interface; move legacy declarations to a deprecated compatibility path; validate provider `unknown` with a strict AI candidate schema; require server-owned identity, time, catalog, price, production, community, and provenance enrichment before validating `DesignV1`.
- Three Engine: keep deprecated grouped contracts; introduce a pure-data scene descriptor and a deterministic one-way adapter from validated `DesignV1`; never import Three.js runtime classes into the adapter.
- Backend: add generic request/response schema validators, a stable error envelope, and six development stub routes. Requests and responses use shared DTO schemas; unimplemented orchestration returns `NOT_IMPLEMENTED`, while consent and compliance guards fail before the stub service.
- Frontend: import only the public contract and fixture projection; add public model helpers, currency-aware minor-unit formatting, and four minimal semantic components. Component identity uses `componentId`.

## 3. Expected files

- `packages/ai-agent/src/{contracts,schemas,adapters}` plus package tests and compatibility exports.
- `packages/three-engine/src/{runtime,adapters}` plus package tests and compatibility exports.
- `apps/backend/src/{contracts,validation,modules/design,modules/order}` plus route tests and app registration.
- `apps/frontend/src/features/design` and `apps/frontend/src/lib/api` plus component/model tests.
- Workspace manifests, root architecture tests, and the controlling API, AI, Three Engine, architecture, and coding documents.

No file under `packages/database` will change.

## 4. Compatibility strategy

- Existing `BeadDesign`, `BraceletDesignOutput`, `BraceletBeadConfiguration`, and `BraceletConfiguration` exports remain available with `@deprecated` documentation.
- New adapters do not import or emit deprecated grouped types.
- Legacy adapters are isolated and tested; new code imports `DesignV1` and shared DTOs directly.
- Backend stubs do not invent successful product data. They validate input and return stable domain errors until real orchestration exists.
- Frontend imports neither the internal commercial subpath nor database types.

## 5. Test plan

- AI: strict candidate validation, forbidden server fields, catalog mismatch, compliance normalization, continuous order, non-object/extra input, valid DesignV1 output, and legacy compatibility.
- Three Engine: order, anchors, diameter geometry, stable IDs/revision, asset warnings, determinism, immutability, plain-data output, and production-sequence agreement.
- Backend: invalid requests/responses, cost/owner rejection, price distrust, request ID preservation, stable stubs, consent/compliance guards, and unchanged health diagnostics.
- Frontend: public fixture validation, component IDs/keys, anchored relation, compliance/private state, cost absence, and separate CNY/TWD formatting.
- Architecture: package dependency directions, forbidden frontend/internal/database imports, no new duplicated design protocols, deprecated-path isolation, and no Prisma response imports.

## 6. Out of scope

- Prisma schema or migration changes, PostgreSQL, persistence adapters, or real repositories.
- Real LLM providers, production prompts, natural-language compliance models, or AI retries/observability.
- Production Three.js materials, shaders, assets, renderer lifecycle, physics, or final camera design.
- Authentication, ownership lookup, catalog/inventory services, live pricing, real save/publish/order execution, or exchange-rate conversion.
- Full DIY interactions, final visual design, accessibility sign-off, or production UI flows.
- Removal of deprecated types.
