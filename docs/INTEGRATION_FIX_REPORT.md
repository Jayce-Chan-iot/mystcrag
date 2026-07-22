# Mystcrag Phase 3.5 Browser Integration Fix Report

Date: 2026-07-22

## Identity and history

- Role: Browser Integration Lead
- Branch: `fix/mvp-browser-integration`
- Worktree: `/private/tmp/mystcrag-mvp-browser-integration`
- Original candidate: `1402ab1b963cfcab32fbb1d90a71cbb26fcf6774`
- Backup reference: `backup/browser-pre-cleanup` -> `1402ab1b963cfcab32fbb1d90a71cbb26fcf6774`
- Old QA boundary: `0bb60a44c2fa110b0343a08a5c51e3b43ab2ed7b`
- First post-auth rebase result: `ac59d50b8fa33c39c9e3e0084c877d6d2332c777`
- Final approved main baseline: `6561b4a`
- Post-final-baseline role commit: `b3a0638065e6a616bfe732682cec9d29e611f4b5`
- AI/auth/browser implementation commit: `38793610e969d1d56362125071083532ec5368eb`
- Persisted-price verification correction: `60c6d65baa0ca18f3e5d173d70fc02f33cac3676`
- Report commit: the commit containing this document

The history cleanup rebased only the Browser role commit across `0bb60a4`. Conflicting QA-owned `tests/phase3-integration.test.mjs` and `tests/phase3-mvp-flow.test.ts` changes were deleted from the rebase result. No QA report or QA-owned test is present in `main...HEAD`.

## Scope and approved decisions

Primary fixes: `BUG-P3-001`, `BUG-P3-003`, `BUG-P3-006`, and `BUG-P3-007`.

The work stays in Browser-owned Frontend code and the approved Backend design-generation composition. It does not modify auth internals, AI internals, Design Contract, Prisma Schema, migration semantics, database repositories, Three Engine internals, or QA evidence.

Approved decisions used:

- `P35-001`: Phase 3.5 ownership and gate rules.
- `DEC-P35-AUTH-BOUNDARY-001`: verified Bearer credential and ActorContext boundary.
- `DEC-P35-BACKEND-AI-LINK-001`: Backend composition may consume the existing rule-based AI package; the generated lockfile change is only the Backend workspace link.

## Exact `main...HEAD` inventory

```text
M apps/backend/package.json
A apps/backend/src/modules/design/ai-recommendation-design.adapter.test.ts
A apps/backend/src/modules/design/ai-recommendation-design.adapter.ts
M apps/backend/src/modules/design/design-api.service.ts
M apps/backend/src/modules/design/design.routes.test.ts
M apps/backend/src/modules/design/design.service.ts
M apps/frontend/app/design/[id]/page.tsx
M apps/frontend/app/diy/page.tsx
A apps/frontend/app/favicon.ico/route.ts
A apps/frontend/app/icon.svg
M apps/frontend/app/layout.tsx
M apps/frontend/next.config.ts
A apps/frontend/src/components/development-mode-badge.tsx
M apps/frontend/src/components/flow-notice.tsx
M apps/frontend/src/features/design/components/bracelet-preview.tsx
M apps/frontend/src/features/design/components/design-results.tsx
M apps/frontend/src/features/design/components/diy-editor.tsx
M apps/frontend/src/features/design/frontend-ai-flow.test.tsx
M apps/frontend/src/features/questionnaire/components/questionnaire-wizard.tsx
M apps/frontend/src/features/questionnaire/model/questionnaire.ts
A apps/frontend/src/lib/api/api-runtime.ts
A apps/frontend/src/lib/api/design-api.test.tsx
A apps/frontend/src/lib/api/design-api.ts
A apps/frontend/src/lib/api/design-session.ts
M apps/frontend/src/lib/api/frontend-api-error.ts
M apps/frontend/src/lib/api/mock-design-api.ts
A docs/INTEGRATION_FIX_REPORT.md
M pnpm-lock.yaml
```

## Verified authentication consumption

Frontend transport sends `Authorization: Bearer <credential>`. The browser neither sends nor derives an actor identity; ownership comes only from Backend-verified ActorContext. The explicit browser credential source is `NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN`. A missing credential fails locally as `UNAUTHORIZED` before network traffic.

For the current local development/test provider, the credential must be an explicitly generated short-lived signed test token whose issuer, audience, expiry, and signature match Backend configuration. The Backend provider itself remains environment-gated to development/test and fails startup safely in production. There is no production fixed-user fallback.

Frontend Mock mode is enabled only when both conditions are true: runtime build is not production and `NEXT_PUBLIC_MYSTCRAG_MOCK_API=true`. Production ignores the flag. Mock mode is visibly labeled and refuses to fabricate order success.

## Questionnaire and three real options

The questionnaire sends the shared `GenerateDesignRequest` without a second DTO. It preserves:

- current state/emotion tags;
- color preference;
- style and cultural preference;
- wrist circumference;
- CNY currency and min/max budget;
- explicit catalog product exclusions;
- personalization consent.

One completed questionnaire derives three legal requests that retain every original answer and add one deterministic creative direction each. Each request reaches the real Backend Generate route. The Backend calls the existing `RuleBasedProvider`, validates its three candidates, selects the requested direction, maps only to active non-excluded Backend catalog products, then owns inventory checks, component/design IDs, price, timestamps, revision, provenance, and persistence.

The three candidates are proven distinct in design name, 12-bead product sequence, Design DNA source, story, reasons, and structured cultural inspiration. Provenance accurately records `rule-based` metadata; the fixed Mock metadata is available only through the explicitly injected test/development adapter.

All three persisted design IDs are retained in same-tab session context. The result route reloads every option through authenticated owner-scoped `GET /api/design/:id`; it never reloads fixed Mock choices. A direct or later single-design visit still loads that persisted design without fabricating missing options.

## Browser lifecycle

Implemented real routes:

1. `POST /api/design/generate` three times for three server-persisted AI options.
2. `GET /api/design/:id` for results, DIY entry, conflict recovery, and refresh recovery.
3. `POST /api/design/update` using only the finite `REPLACE_COMPONENT` operation and Backend revision.
4. `POST /api/design/price` after update; price and warnings are accepted only from Backend.
5. `POST /api/design/save`, retaining Backend `savedAt` and confirmed design.
6. `POST /api/orders/from-design`, retaining the immutable confirmed revision and price snapshot.

The UI adopts revision and price only from validated public response schemas. It never sends owner ID, trusted inventory, unit cost, supplier information, or a trusted replacement total.

## Budget and commercial states

Every result shows Backend price and an explicit `UNDER_BUDGET`, `WITHIN_BUDGET`, `NO_BUDGET`, or `OVER_BUDGET` state. An over-budget option cannot be selected until the user checks the explicit acceptance control. The acceptance is retained for the selected persisted design, and order creation checks it again. No over-budget design is silently presented as compliant.

Stable states handled without silently overwriting Frontend state:

- `CONFLICT`: display and authenticated reload of the latest design.
- `PRICE_CHANGED`: display the Backend-confirmed new price.
- `INVENTORY_CHANGED`: keep the prior design and request a new material choice.
- `COMPLIANCE_BLOCKED`: stop generation/order progression and direct the user to adjust input.
- `UNAUTHORIZED` / `FORBIDDEN`: explicit verified-session/ownership guidance.

## Accessibility, icon, and Three handoff

Header, return, option, material, save, and order controls use a minimum 44 CSS pixel block size. The App Router exposes `/icon.svg`, metadata references it, and `/favicon.ico` has a non-404 route.

The Browser branch preserves the interface for the subsequent Three owner:

```text
Backend-confirmed PublicDesignV1
selectedComponentId
onSelect(componentId)
finite REPLACE_COMPONENT request
```

This branch does not implement the Three scene. `diy-editor.tsx` and the two-line touch-target adjustment in `bracelet-preview.tsx` are coordination hotspots; the Three branch must retain authenticated lifecycle, save/order, budget, and commercial-error behavior while replacing the preview mount.

## Tests and validation

Focused final evidence:

- Backend: 16/16 passed, including AI composition diversity and all protected route/application tests.
- Frontend: 34/34 passed, including complete questionnaire transport, three legal requests, Bearer header/no actor header, missing-credential fail-safe, Generate/Get/Update/Price/Save/Order DTOs, refresh, budget status, all four required commercial errors, and production Mock prohibition.
- Backend and Frontend strict typechecks passed.
- `pnpm validate`: passed on the final implementation tree.
  - lint: 7/7 workspaces;
  - typecheck: 7/7 workspaces;
  - architecture: 7/7;
  - Backend: 16/16;
  - Frontend: 34/34;
  - AI: 25/25;
  - Design Contract: 25/25;
  - Three Engine: 14/14;
  - Database unit: 4/4;
  - Prisma validation, Backend build, and Frontend production build passed.

### Live production-transport and PostgreSQL evidence

A fresh temporary PostgreSQL 17 cluster was initialized on `127.0.0.1:55432`, the reviewed baseline migration SQL was applied, and the seed completed. Backend ran with the explicitly enabled signed-test provider and a one-hour Bearer credential; the optimized Next production build ran on `127.0.0.1:3000` and proxied all `/api/*` requests to Backend. The temporary Backend, Next server, and PostgreSQL instance were stopped after the run.

Observed through the production Next proxy:

- Generate returned three persisted IDs: `design-bdb285c1-8fcd-4391-9636-a908a94faad4`, `design-da1626ca-3bd1-414e-b4b3-9998acfd7f00`, and `design-f4d18061-62c6-416f-b9b9-68686f4016e5`.
- Names were `Rain After Blue`, `Moonlit Tide`, and `Silver Mist`; all had distinct twelve-product sequences and totals `10,800`, `12,800`, and `13,200` CNY minor units.
- Every response recorded `modelProvider: rule-based`, structured cultural inspiration, Revision 1, and excluded `product-quartz-round-10` from its sequence.
- Owner-scoped Get returned the selected design. Replace changed its first product, Revision `1 -> 2`, and total `10,800 -> 11,200`.
- Price returned Revision 2, total `11,200`, pricing version `cny-retail-2026-07-v1`, and no warning.
- The first live Save attempt exposed that adopting a non-persisted `/price` timestamp causes `CONFLICT`. The Frontend was corrected to use Price as an authoritative check while retaining the persisted Update response. After correction, Save returned HTTP 200 with Revision 2 and Backend `savedAt`.
- A new Get recovered the same Revision 2/product/price after refresh-equivalent reload.
- Create Order returned `PENDING` order `cmrvo4mm30004nt8mf4cva2lf` with an immutable Revision 2, total `11,200` snapshot.

The in-app browser runtime reported no available browser instance, so this role does **not** claim a new click-driven UI E2E. The live evidence above is real production Next HTTP transport plus real PostgreSQL, not a Mock, but final click/accessibility verification remains assigned to the controlled QA rerun.

## Real versus Mock evidence and remaining boundaries

- Real in the production code path: authenticated HTTP transport, Backend rule-based AI composition, Backend catalog mapping, inventory/price/revision authority, persistence-backed Get/Update/Save, and order snapshot route.
- Deterministic but not a paid LLM: `RuleBasedProvider`; no network model or secret is claimed.
- Focused automated tests use HTTP and repository doubles where appropriate. A separate live production-transport/PostgreSQL run is recorded above; final click-driven browser proof remains a QA responsibility because no browser instance was available to this role.
- The Frontend access token is currently a build-visible short-lived development/test credential. A production login/session provider, rotation, and refresh UX remain outside this approved auth fix and production startup remains fail-safe without one.
- Same-tab session storage retains the three-option list, budget context, and explicit over-budget acceptance. Each persisted design itself remains recoverable by authenticated ID after refresh.
- Payment, reservation, shipping, tax, and idempotency remain outside MVP order-snapshot scope.

## Rollback and merge risks

The branch is independently reversible as one controlled merge. The generated lockfile change is only `@mystcrag/backend -> @mystcrag/ai-agent: link:../../packages/ai-agent`. Main merge risk is the documented `apps/frontend` overlap with the Three integration branch; no protocol resolution is needed because both sides use `PublicDesignV1` and `componentId`.
