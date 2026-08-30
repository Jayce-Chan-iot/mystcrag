# M0 Product, Competitor and Cross-platform Audit

**Task:** TASK-AUDIT-002
**Owner:** SOL
**Audit baseline:** `main` at `2abfdfe76df3302f2c9ae88cfa749832b71e2578`
**Observed:** 2026-08-31
**Decision:** proceed with one shared-Core task; do not start multiple implementation lanes
**Auth posture:** implementation complete and frozen; production acceptance remains deferred by Product Owner

## Method and evidence limits

This audit inspected production routes, composition roots, feature components, API clients, package boundaries, persistence models and current tests. The principal source areas were `apps/frontend/app`, `apps/frontend/src`, `apps/frontend/components`, `packages/ui`, Bracelet Engine, Design Contract, Design Engine, Three Engine, AI Agent, backend modules and Database/Prisma repositories. Current governance registries were reconciled against those sources.

Current competitor pages were reviewed on 2026-08-31. Vendor pages are evidence of publicly presented capabilities, not independent proof of conversion, performance or fulfillment quality. `agent-reach` and its recommended Exa fallback were unavailable in this environment, so current source retrieval used the available Web client. No competitor artwork or protected visual language is copied.

A local mock frontend was started successfully, but both permitted desktop-browser paths blocked or timed out on the local origin. Consequently this is a code-, route-, contract- and test-grounded UX audit, not a screenshot-level visual-polish or accessibility certification. A future Web worker must capture desktop and mobile states before changing the UI.

## Executive product assessment

Mystcrag has a real, coherent 2D design loop:

```text
Home -> AI questionnaire or direct DIY -> recommendation/result -> 2D editor
     -> explicit save/revision -> immutable order snapshot
```

It is stronger than a prototype in geometry, server-authoritative price/inventory validation, identity isolation and domain contracts. It is not yet a commercial product loop because checkout, fulfillment, durable profile data, public sharing and deployment acceptance are incomplete. The most immediate product risk is not missing 3D: it is the editing session's tight coupling between a 1,275-line Web component, in-memory history and one blocking server round trip per action.

The next architecture move should preserve the working Web product while extracting a platform-neutral DIY editing-session core. That core must own deterministic draft commands, history and reconciliation semantics without owning browser navigation, storage, rendering, Auth0, pricing or inventory authority. A Web UX worker and a future Mini Program shell can then consume the same behavior through separate adapters.

## Repository reality

### Current user journey

| Stage | Production evidence | Current behavior | Product gap |
| --- | --- | --- | --- |
| Entry | App Router home and navigation | AI-guided and direct-DIY entry points exist | No funnel analytics or resume affordance |
| Discovery | questionnaire, crystal library, recommendations | structured preferences and three candidate directions | production generation is deterministic/rule-based; no conversational iteration |
| Evaluation | design result and compact bracelet previews | priced, inventory-backed design candidates | weak side-by-side decision support and continuity cues |
| Editing | `DiyEditor` + `FlatBraceletEditor` | add, move, remove, replace, undo, redo, clear, optimize, save, export | blocking mutation round trips, local-only history, large state concentration |
| Persistence | design API and revision repository | actor-owned revisions and optimistic revision checks | no resilient offline/interrupted draft journal |
| Conversion | immutable order snapshot | order snapshot can be created | no address, shipping, tax, payment, fulfillment or post-order lifecycle |
| Retention | profile, gallery, favorites | own designs/orders plus browser-local preferences | profile/address/favorites do not follow the user across devices |
| Sharing | publication repository and API boundary | backend publish/unpublish capability exists | no public feed, moderation, share link or frontend publish flow |

### Interaction and state concentration

- `apps/frontend/src/features/design/components/diy-editor.tsx` is 1,275 lines and holds more than 25 local state values. Loading, selection, filtering, mutations, undo/redo, saving, export and error presentation share one component boundary.
- Every structural edit calls the design update API immediately and disables interaction while the request is pending. Latency therefore becomes editing friction rather than a background persistence concern.
- Undo and redo use a memory-only stack capped at 50 states. Refresh, tab eviction or cross-device continuation loses that editing context.
- `sessionStorage` carries recommendation options and budget context; `localStorage` carries the completed order response, profile preferences, addresses, privacy preferences, favorites and display-tray state. Those are Web adapters or temporary placeholders, not Shared Core.
- The editor provides desktop workbench and mobile bottom-sheet structures, but the pointer-driven bead manipulation has no proven keyboard reordering path. Native confirm dialogs and dense controls need screenshot/accessibility verification.
- Canvas export and DOM download are browser-only. The exported rendering path is not the same photographic bead path as the visible editor, so export parity remains a separate visual task.

### Backend and data product blockers

- The server is correctly authoritative for price, inventory, ownership and immutable order snapshots.
- Commerce stops before address validation, payment, shipping/tax quotation, reservation, fulfillment, refunds and support transitions.
- User identity and `ExternalIdentity` are durable and correctly isolated, while profile detail, addresses, favorites, feedback and privacy preferences remain browser-local.
- Community persistence exists without the end-user discovery, sharing and moderation product surface.
- There is no `Tenant`, `Brand`, `Theme`, storefront or tenant-scoped configuration model. White Label is therefore planning-only.

## Competitor capability matrix

All sources were accessed 2026-08-31.

| Product | Guided configuration | Immediate visual feedback | Save/share/continue | Pricing/order connection | AI assistance | Relevant lesson |
| --- | --- | --- | --- | --- | --- | --- |
| [Pandora custom charm bracelet](https://us.pandora.net/en/create-a-custom-charm-bracelet/) | Four explicit shopping steps: bracelet, story charms, spacers/clips, safety chain | Product-led rather than a free spatial editor | Commerce account/cart conventions | Catalog price, stock and Add to Bag are always near the choice | None observed | Reduce choice anxiety with progressive categories and product-safe defaults |
| [Kendra Scott Color Bar](https://www.kendrascott.com/how-to-customize-your-jewelry.html) | Category -> style -> metal/stones | Constrained material selection | Omnichannel/in-store context | Custom result is tied to a makeable product | None observed | Curate the decision sequence; do not expose every degree of freedom at once |
| [Nike By You](https://www.nike.com/help/a/what-is-nike-by-you) | Builder guides the user from product parts to finish | 3D updates immediately and rotates through all angles | Member/app/Web continuity | Custom design remains part of normal shopping and fulfillment | None observed | Editing feedback must feel immediate; preview and commerce should remain one journey |
| [Zakeke configurator](https://www.zakeke.com/integrations/shopify/) and [share documentation](https://docs.zakeke.com/docs/End-user-UI/3D-Configurator-Library-Documentation/Learn/share) | Merchant-defined configuration rules | 2D/3D/AR options | Image or exact-configuration link; configurable cart/order integration | Dynamic pricing and production output are first-class | Optional ecosystem capability | Treat share, cart and production payload as the same versioned configuration |
| [Ruby Kinglet](https://www.rubykinglet.ai/) | Jewelry-specific component builders, templates and tasks | AI renders plus component-oriented workbench | Asset libraries, templates and own-style models | Claims bench-ready specifications/BOM assistance | Jewelry-specific AI tasks | AI must stay grounded in components, assets and manufacturable constraints |
| [Beadaro](https://www.beadaro.com/) | Feeling, person, budget and colors lead to several concepts | Per-bead editing after AI concepts | Community designs can be reused and refined | Public page presents real materials, transparent price and order continuation | Conversational refinement and explanations | The closest benchmark combines real inventory, explanations, natural-language refinement and manual control |

### Mystcrag gap against the benchmark

| Capability | Mystcrag now | Gap |
| --- | --- | --- |
| Immediate editing | Correct but request-bound | optimistic local feedback with durable reconciliation |
| Undo/recovery | in-memory, current tab | serializable draft history and explicit conflict/retry states |
| Price feedback | server-authoritative | preserve authority while avoiding an editor-wide blocking state |
| Save/continue | explicit server save plus browser fragments | consistent autosave/status model and cross-device resume |
| Guided choice | questionnaire and material filters | clearer progressive disclosure inside the editor |
| AI refinement | deterministic candidates and optimize action | grounded conversational revision with visible reasons and constraints |
| Sharing | backend publication method | stable configuration link, preview, privacy and moderation policy |
| 3D | experimental package, not mounted | evidence-based lifecycle decision; not a current P0 |
| Commerce | immutable snapshot | checkout and fulfillment state machine |
| Cross-platform | portable contracts and geometry, Web-only shell | shared editing behavior plus explicit Web/Mini adapters |

### Principles to absorb

1. Keep the preview responsive to intent; network persistence must not freeze the creative gesture.
2. Reveal choices progressively and keep every choice within makeable catalog constraints.
3. Show price, fit, availability, save and conflict states where the decision is made.
4. Preserve one versioned configuration across resume, share, cart, order and production.
5. Let AI explain and refine a real-material design while retaining precise manual control.
6. Design mobile editing around selection and focused sheets, not a compressed desktop inspector.

### Patterns not suitable for Mystcrag

- Do not replace bead-level control with a catalog-only charm shopping funnel.
- Do not promote photorealistic generative imagery as a manufacturable design unless it maps back to real SKUs, geometry, price and inventory.
- Do not make WebGL/3D a hard requirement; 2D must remain the reliable production editor and fallback.
- Do not copy competitor visual systems, assets or branded interaction language.
- Do not create separate Web and Mini Program business rules or identity records.

## Cross-platform architecture decision

| Boundary | Current authority | Decision |
| --- | --- | --- |
| Web shell | Next.js App Router, React components, responsive CSS | Remains Web-only |
| Shared Domain/Core | Design Contract, Design Engine, future DIY session core | Pure TypeScript; no DOM, Next, storage, Auth0 or rendering imports |
| Shared API Contract | `@mystcrag/design-contract` schemas and error envelope | Reuse across transports; keep backend authority |
| Bracelet geometry/layout | `@mystcrag/bracelet-engine` | Already reusable and canonical; do not mix session/network concerns into it |
| Platform adapters | API transport, persistence, navigation, rendering, telemetry | One adapter set per platform |
| Web identity | Auth0 Next.js BFF encrypted HttpOnly host-only cookie | Frozen Web adapter; never generalized or rewritten for Mini Program |
| Future WeChat identity | future WeChat credential verification -> canonical `User` + `ExternalIdentity` | Separate later task; no implementation in M0 |
| Web storage/navigation/rendering | `localStorage`, `sessionStorage`, Next navigation, DOM/Canvas/WebGL | Web adapter only |
| Mini Program equivalents | `wx` storage/request/navigation, Canvas/component rendering | Future Mini adapter; must not import Web shell or Auth0 session code |

The frontend's same-origin API client is a useful Web transport adapter. The DTOs it validates are portable. Design Engine and Bracelet Engine are suitable Shared Core candidates after bundle/runtime compatibility checks; Three Engine is a React/WebGL platform adapter, not Shared Core. `packages/ui` is a small React surface package, not a cross-platform design system.

## WeChat Mini Program readiness

**Assessment: 35% — contract and geometry foundations exist; shell, identity and runtime adapters do not.**

Ready foundations:

- pure TypeScript bracelet geometry, fit and hit-testing;
- validated Design Contract DTOs and error envelopes;
- backend ownership, price, inventory and revision boundaries;
- collision-safe internal `User`/`ExternalIdentity` semantics;
- deterministic Design Engine rules that can remain server-side if Mini bundle constraints are unsuitable.

Missing boundaries:

- no platform-neutral editing-session command/history/reconciliation core;
- no Mini Program request, storage, navigation, rendering or telemetry adapters;
- no WeChat identity adapter or provider-specific external identity provisioning task;
- current editor depends on React/DOM/pointer events/Canvas downloads and browser storage;
- Auth0 cookie topology is intentionally Web-specific;
- no Mini package-size, performance, privacy, device or release-test evidence.

Mini Program work must start only after the Shared Core task. It may reuse domain commands and server contracts, not Web components or Web Auth.

## AI, 3D and White Label

### AI

The production generator composes `AiRecommendationDesignAdapter` with the deterministic `RuleBasedProvider`. The product therefore has reliable recommendation intelligence, constraint enrichment and explainable structured candidates, but not a production generative-LLM experience. The next AI product step is grounded conversational refinement over real SKU, fit, price and inventory constraints—not generic image generation. It depends on a stable editing-session command contract.

### 3D

Three Engine contains a tested scene descriptor and a React/WebGL renderer, but it is not mounted in the production DIY route. It remains `EXPERIMENTAL`. Promotion would require mobile performance budgets, WebGL fallback, asset provenance, selection/edit parity, geometry parity and responsive browser evidence. It is P2 and must not block the resilient 2D editor.

### White Label

There is no tenant-aware data, brand/theme configuration, hostname-to-tenant resolution, asset isolation, catalog segmentation or operator policy. White Label is 5% planned. A later architecture spike must begin with tenancy/security and configuration ownership, not CSS theming. No tenant field should be added before product, isolation and migration decisions are approved.

## Prioritized task backlog

### P0 — blocks shared Core or commercial progression

#### TASK-CORE-001 — Cross-platform DIY Editing Session Core (first Worker)

- **Evidence:** `DiyEditor` concentrates more than 25 state values; each structural gesture waits for a server mutation; undo/redo is memory-only; storage/navigation/rendering are browser-bound.
- **User impact:** immediate edits, predictable save/conflict feedback and recoverable sessions become possible on Web; future Mini Program avoids a second rule set.
- **Architecture impact:** adds a pure command/history/reconciliation layer between Design Contract/Bracelet Engine and platform adapters; server retains price/inventory authority.
- **Dependencies:** baseline READY; `2abfdfe` integrated; Development Gate OPEN; existing Design Contract and Bracelet Engine frozen semantics.
- **Owner:** DESIGN CORE / GLM, SOL review.
- **Suggested Task ID:** `TASK-CORE-001`.
- **Suggested branch:** `task/core-001-diy-editing-session-core`.
- **Writable paths:** `packages/diy-session-core/**`, exact new package row in `docs/governance/CANONICAL_COMPONENTS.md`, exact task/feature rows, task-local tests under the new package.
- **Forbidden paths:** `apps/**`, existing `packages/bracelet-engine/**`, existing `packages/design-contract/**`, `packages/three-engine/**`, Prisma/migrations, Auth, CI, root and existing-package manifests/lockfile, `.env`/Secrets. The new package's own `package.json` is included by `packages/diy-session-core/**`.
- **Acceptance criteria:** deterministic add/move/remove/replace/clear commands; bounded undo/redo; serializable draft journal; explicit pending/confirmed/rejected/conflict states; replay/rebase behavior for authoritative server revisions; no client price/inventory fabrication; no platform imports; no Worker consumer integration.
- **Required tests:** command invariants, history bounds, serialization round trip, replay idempotence, rejected-command rollback, revision conflict/rebase, property-style random command sequences, package lint/typecheck/build/test and architecture boundary test.
- **Regression scope:** DesignV1 invariants, Bracelet Engine sequence/fit semantics, API operation compatibility and zero Auth/runtime behavior change.

#### TASK-COMMERCE-001 — Checkout and Fulfillment Contract

- **Evidence:** order creation ends at an immutable snapshot; address, tax, shipping, payment, reservation, fulfillment and refunds are absent.
- **User impact:** users cannot complete a real purchase.
- **Architecture impact:** introduces a serial commerce state-machine and provider boundaries; migration/API/UI work must follow the contract.
- **Dependencies:** Product Owner policy and payment/shipping/provider decisions; production identity acceptance before launch, not before contract design.
- **Owner:** SOL.
- **Suggested Task ID:** `TASK-COMMERCE-001`.
- **Suggested branch:** `task/commerce-001-checkout-fulfillment-contract`.
- **Writable paths:** exact commerce/API/database/security/rollback controlling documents and registry rows only.
- **Forbidden paths:** runtime, Prisma/migrations, dependencies, Auth, UI, tests.
- **Acceptance criteria:** approved order/payment/reservation/refund states, idempotency, amount authority, PII ownership, webhook verification, rollback and provider exit plan.
- **Required tests:** contract test plan, state-transition table and threat-model review defined before implementation.
- **Regression scope:** immutable design/order snapshot, price authority, actor isolation and Auth-frozen paths.

### P1 — high-value product experience

#### TASK-FE-002 — Resilient Web DIY Workbench

- **Evidence:** request-bound gestures, editor-wide busy state, manual save, memory-only recovery and dense monolithic UI.
- **User impact:** lower latency friction and abandoned designs; clearer mobile editing.
- **Architecture impact:** Web adapter consumes TASK-CORE-001; decomposes editor without moving domain rules into React.
- **Dependencies:** TASK-CORE-001 DONE and screenshot evidence captured at agreed desktop/mobile states.
- **Owner:** FRONTEND / Qwen.
- **Suggested Task ID:** `TASK-FE-002`.
- **Suggested branch:** `task/fe-002-resilient-diy-workbench`.
- **Writable paths:** exact design feature components/model/API adapter, frontend tests and approved visual evidence paths.
- **Forbidden paths:** backend, database, Bracelet/Design Contract semantics, Auth, Three Engine, unrelated UI.
- **Acceptance criteria:** immediate local gestures, nonblocking persistence indicator, retry/conflict recovery, refresh resume, keyboard-operable alternatives, focused mobile sheets and unchanged server authority.
- **Required tests:** reducer adapter tests, latency/failure/conflict tests, desktop/mobile Playwright, keyboard/accessibility checks, screenshot comparisons and full design flow regression.
- **Regression scope:** add/move/remove/replace/clear/undo/redo/save/export/order, fit, price, inventory and auth session rolling.

#### TASK-SHARE-001 — Versioned Design Share and Publication Contract

- **Evidence:** backend publication exists without public projection, share link, moderation or frontend action.
- **User impact:** designs cannot reliably travel to another person/device or seed discovery.
- **Architecture impact:** defines privacy-safe public DTO, immutable/versioned link and moderation boundary.
- **Dependencies:** privacy/moderation Product Owner decisions; identity implementation remains frozen.
- **Owner:** SOL contract, then BACKEND/FRONTEND workers.
- **Suggested Task ID:** `TASK-SHARE-001`.
- **Suggested branch:** `task/share-001-public-design-contract`.
- **Writable paths:** exact Design Contract and public API/privacy/governance docs for contract phase.
- **Forbidden paths:** Auth topology, private identity claims, runtime in contract phase, Prisma until migration task.
- **Acceptance criteria:** owner consent, revocation/unpublish, public projection allowlist, stable version link, clone attribution, moderation and enumeration resistance.
- **Required tests:** DTO privacy tests, two-user isolation, unpublished/removed behavior, share version immutability and abuse-rate plan.
- **Regression scope:** private gallery, order snapshot, actor ownership and existing publication methods.

#### TASK-AI-002 — Grounded Conversational Design Refinement

- **Evidence:** production recommendations use deterministic rules; AI optimize is an action, not a multi-turn refinement surface.
- **User impact:** users can express intent changes without losing precise bead control.
- **Architecture impact:** converts validated language intent into TASK-CORE-001 commands; all SKU/fit/price/inventory claims remain authoritative.
- **Dependencies:** TASK-CORE-001, approved provider/privacy/cost policy and evaluation set.
- **Owner:** AI / GLM with FRONTEND consumer later.
- **Suggested Task ID:** `TASK-AI-002`.
- **Suggested branch:** `task/ai-002-grounded-design-refinement`.
- **Writable paths:** AI Agent refinement schemas/providers/evals, exact backend adapter and AI controlling docs.
- **Forbidden paths:** direct browser token access, image-only manufacturing claims, pricing authority, Bracelet Engine rules, Auth.
- **Acceptance criteria:** constrained command output, explanation/provenance, refusal on unavailable materials, deterministic fallback, cost/latency budget and manual undo.
- **Required tests:** golden intent set, invalid/hallucinated SKU rejection, budget/fit/inventory grounding, provider outage fallback, prompt-injection/privacy tests.
- **Regression scope:** three-candidate generation, DesignV1 validation, knowledge traces and deterministic RuleBasedProvider.

#### TASK-DATA-002 — Durable Customer Profile Boundary

- **Evidence:** addresses, favorites, preferences and privacy settings are browser-local despite canonical identity.
- **User impact:** account data disappears across devices and cannot support checkout/support.
- **Architecture impact:** separates durable customer data from Web storage; requires PII lifecycle and deletion policy.
- **Dependencies:** profile/privacy product decisions; commerce contract for address ownership; no Auth rewrite.
- **Owner:** SOL contract, DATABASE/GLM implementation later.
- **Suggested Task ID:** `TASK-DATA-002`.
- **Suggested branch:** `task/data-002-durable-customer-profile-contract`.
- **Writable paths:** exact profile/privacy/database/API contracts for contract phase.
- **Forbidden paths:** `ExternalIdentity` semantics, Auth session topology, runtime/migrations before contract acceptance.
- **Acceptance criteria:** canonical field ownership, validation, encryption/retention/deletion, address versioning and portability defined.
- **Required tests:** two-user isolation, deletion/retention, invalid PII, cross-device contract and migration plan.
- **Regression scope:** User/ExternalIdentity provisioning, Auth deletion restrictions, existing browser fallback migration.

### P2 — defer

#### TASK-3D-001 — 3D Lifecycle and Production-readiness Decision

- **Evidence:** Three Engine is tested but unmounted and WebGL-specific.
- **User impact:** richer inspection is possible but not required for a reliable design loop.
- **Architecture impact:** either keeps the adapter experimental or promotes one bounded preview with fallback.
- **Dependencies:** product ROI decision and TASK-FE-002 stability.
- **Owner:** THREE.
- **Suggested Task ID/branch:** existing `TASK-3D-001`, `task/3d-001-production-readiness-decision`.
- **Writable paths:** Three specification, exact Three Engine/frontend wrapper evidence and lifecycle registry rows.
- **Forbidden paths:** Bracelet geometry semantics, Auth, commerce, unrelated editor rewrite.
- **Acceptance criteria:** explicit lifecycle; promotion requires fallback, performance, geometry/selection parity and asset provenance.
- **Required tests:** mobile/desktop performance, WebGL absence, parity and responsive browser checks.
- **Regression scope:** 2D editor remains production default and bundle/runtime health is unchanged when 3D is unavailable.

#### TASK-WL-001 — White Label Tenancy Architecture Spike

- **Evidence:** no tenant, brand, theme, hostname, catalog isolation or operator policy exists.
- **User impact:** none until a partner channel is approved; premature implementation adds security risk.
- **Architecture impact:** defines isolation/configuration decision before schema or theme work.
- **Dependencies:** named partner/business requirements and security review.
- **Owner:** SOL.
- **Suggested Task ID:** `TASK-WL-001`.
- **Suggested branch:** `task/wl-001-tenancy-architecture-spike`.
- **Writable paths:** new White Label architecture decision and exact governance rows only.
- **Forbidden paths:** runtime, Prisma/migrations, Auth, theme implementation, dependencies.
- **Acceptance criteria:** tenancy model, hostname resolution, config hierarchy, asset/catalog isolation, identity relationship, migration and rollback decision.
- **Required tests:** future isolation/threat-model matrix and tenant-leak regression plan.
- **Regression scope:** single-tenant behavior, User/ExternalIdentity semantics, price/catalog authority and deployment configuration.

### Deployment-only gates

- real staging/production Origins and byte-exact Auth0 allowlists;
- approved same-region session lookup benchmark;
- real Auth0 login/logout smoke and production deployment evidence;
- commerce provider, domain, privacy and operational readiness when those features are approved.

These gates do not block TASK-CORE-001, but they do block production Auth acceptance and commercial launch.

### Auth-frozen paths

All FEAT-018 runtime, identity mapping, secure-cookie topology, provider/JWKS verification, Auth0 proxy routes, session tests and Auth controlling contracts remain frozen except under a separately registered P0 security defect or resumed deployment-acceptance task. `User` and `ExternalIdentity` semantics must not change for cross-platform preparation.

## First Worker Dispatch Package

```text
TASK: TASK-CORE-001
TITLE: Cross-platform DIY Editing Session Core
RECOMMENDED WORKER: GLM
OWNER: DESIGN CORE
BRANCH: task/core-001-diy-editing-session-core
STATUS: PROPOSED — HUMAN PRODUCT OWNER MUST DISPATCH

OBJECTIVE
Create one pure TypeScript editing-session core that makes bracelet draft commands,
bounded history, serialization and server-revision reconciliation deterministic for
both the existing Web shell and a future Mini Program shell. Do not integrate a UI.

DEPENDENCIES
- Repository baseline READY
- Governance commit 2abfdfe integrated
- Development Gate OPEN
- TASK-AUDIT-002 accepted by Human Product Owner
- Existing Design Contract and Bracelet Engine semantics remain authoritative

WRITABLE PATHS
- packages/diy-session-core/**
- exact TASK-CORE-001 row in docs/tasks/TASK_REGISTRY.md
- exact new canonical component row in docs/governance/CANONICAL_COMPONENTS.md
- exact FEAT-004 note in docs/governance/FEATURE_REGISTRY.md

FORBIDDEN PATHS
- apps/**
- packages/bracelet-engine/**
- packages/design-contract/**
- packages/design-engine/**
- packages/three-engine/**
- packages/database/** and Prisma/migrations
- tests outside packages/diy-session-core/**
- root and existing-package manifests, and pnpm-lock.yaml (the new package's own package.json is allowed)
- CI/runtime configuration
- all Auth implementation/contracts/tests
- .env, Secrets and generated output

ARCHITECTURE CONSTRAINTS
- no React, Next.js, DOM, Canvas, WebGL, wx, storage, network or Auth imports
- consume existing DesignV1/update-operation shapes without redefining price/inventory
- Bracelet Engine remains geometry/layout/fit authority
- backend remains price, inventory, ownership and revision authority
- do not create a second Design schema or identity model

DELIVERABLES
- command model for add/move/remove/replace/clear
- deterministic reducer with explicit pending/confirmed/rejected/conflict state
- bounded undo/redo history
- serializable draft journal with schema/version marker
- replay, rollback and authoritative-revision rebase behavior
- public package API and architecture note
- task-local unit/property-style tests

ACCEPTANCE CRITERIA
- identical command sequences produce identical drafts and journals
- rejected commands roll back without losing later valid intent
- refresh serialization round-trip preserves draft/history/pending metadata
- duplicate confirmations are idempotent
- stale revision conflicts become explicit and rebase deterministically
- no code fabricates price, stock, ownership or authentication state
- no existing production consumer or runtime code changes
- package lint, typecheck, test and build pass
- pnpm validate, architecture tests and git diff --check pass

REQUIRED TESTS
- every command and invalid boundary
- history cap and redo invalidation
- journal schema/version round trip
- duplicate replay/idempotence
- rejection rollback and out-of-order acknowledgement
- revision conflict/rebase
- randomized valid command sequences preserve DesignV1/Bracelet invariants
- dependency scan proves zero platform/Auth imports

REGRESSION SCOPE
- DesignV1 schema compatibility
- Bracelet Engine sequence, fit and geometry invariants
- existing update-operation semantics
- no Web, backend, database, Three or Auth behavior change

HANDOFF
Return a candidate in REVIEW with exact diff, validation evidence and no consumer
integration. Do not start TASK-FE-002, Mini Program, AI or any other Feature.
```

## SOL selection rationale

Select **GLM**. The first task is Core/architecture work with deterministic state and reconciliation invariants, not a visual interaction implementation. Its file ownership is a new platform-neutral package, it unlocks both Web UX and Mini Program adapters, and it does not touch the frozen Auth boundary. Qwen becomes the appropriate next worker only after this contract/core candidate is accepted; no Qwen task is started by this audit.

## Acceptance posture

- TASK-AUDIT-002 may move to `REVIEW` after documentation validation.
- TASK-CORE-001 remains `PROPOSED`; it is not registered `IN_PROGRESS` and no branch/worktree is created.
- Exactly one first Worker is recommended: GLM.
- No Feature implementation, production deployment, Auth change or Mini Program login work is authorized by this audit.

## Validation evidence

- Internal Markdown/path validation: PASS across 98 Markdown files.
- `node --test tests/architecture.test.mjs`: PASS, 15/15.
- `pnpm validate`: PASS, 15/15 workspace packages for lint, typecheck, tests and build; root architecture/lifecycle gates also passed.
- `git diff --check`: PASS.
- Final path scope: only the ten TASK-AUDIT-002 writable controlling documents changed.
- Runtime, package, test, Prisma/migration, dependency, lockfile, CI and Auth implementation changes: NONE.
