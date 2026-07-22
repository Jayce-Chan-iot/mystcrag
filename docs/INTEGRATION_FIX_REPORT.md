# Mystcrag MVP Browser Integration Fix Handoff

Date: 2026-07-22

## Identity

- Agent role: Integration Lead
- Branch name: `fix/mvp-browser-integration`
- remoteStatus: `NOT_CONFIGURED`
- integrationBaseline: `LOCAL_MAIN`
- Baseline commit: `0bb60a44c2fa110b0343a08a5c51e3b43ab2ed7b` (`test: add phase 3 integration and e2e gate`)
- Pre-rebase commit: None; the fix branch was created directly from the QA integration HEAD.
- Post-rebase commit: None; no rebase or history rewrite was performed.
- Final commit: reported in the final handoff message because a commit cannot embed its own hash.

## Change scope

Fixed:

- `BUG-P3-001`: the browser now uses the real Backend design lifecycle instead of the Frontend Mock transport.
- `BUG-P3-003`: questionnaire answers and budget are sent in `GenerateDesignRequest`; results load the persisted `designId` and show Backend price plus budget status.
- `BUG-P3-006`: mobile navigation, DIY back action, result/DIY actions, and interactive bead controls meet the 44 px project target.
- `BUG-P3-007`: App Router icon metadata, `/icon.svg`, and a compatible `/favicon.ico` response are present.

No Backend business file, database schema, Design Contract, AI Agent, Three Engine, shared API specification, root manifest, or lockfile was changed. No Decision Log approval was required.

## Exact changed-file inventory

Expected final file count: 22.

```text
M apps/frontend/app/design/[id]/page.tsx
M apps/frontend/app/diy/page.tsx
A apps/frontend/app/favicon.ico/route.ts
A apps/frontend/app/icon.svg
M apps/frontend/app/layout.tsx
M apps/frontend/next.config.ts
M apps/frontend/src/components/flow-notice.tsx
A apps/frontend/src/components/development-mode-badge.tsx
M apps/frontend/src/features/design/components/bracelet-preview.tsx
M apps/frontend/src/features/design/components/design-results.tsx
M apps/frontend/src/features/design/components/diy-editor.tsx
M apps/frontend/src/features/design/frontend-ai-flow.test.tsx
M apps/frontend/src/features/questionnaire/components/questionnaire-wizard.tsx
A apps/frontend/src/lib/api/api-runtime.ts
A apps/frontend/src/lib/api/design-api.test.tsx
A apps/frontend/src/lib/api/design-api.ts
A apps/frontend/src/lib/api/design-session.ts
M apps/frontend/src/lib/api/frontend-api-error.ts
M apps/frontend/src/lib/api/mock-design-api.ts
A docs/INTEGRATION_FIX_REPORT.md
M tests/phase3-integration.test.mjs
M tests/phase3-mvp-flow.test.ts
```

## Implemented lifecycle

```text
Questionnaire answers
  -> GenerateDesignRequestSchema
  -> POST /api/design/generate
  -> persisted PublicDesignV1 + designId
  -> GET /api/design/:id after navigation or refresh
  -> REPLACE_COMPONENT + expectedRevision
  -> POST /api/design/update
  -> server revision + server price + warnings
  -> POST /api/design/save
  -> POST /api/orders/from-design
  -> immutable OrderDesignSnapshotV1 preview (no payment)
```

- `QuestionnaireWizard` sends state/emotion, color, style, cultural preference, wrist circumference, currency, exclusions, consent, and the canonical `minBudgetMinor`/`maxBudgetMinor` fields.
- `DesignResults` never calls `mockGetDesignOptions`; it reloads the owner-scoped persisted design by `designId` and displays `NO_BUDGET`, `UNDER_BUDGET`, `WITHIN_BUDGET`, or explicit `OVER_BUDGET` state.
- `DiyEditor` reloads on mount, so refresh no longer resets to a fixed fixture. It sends only the finite `REPLACE_COMPONENT` operation and the latest server revision.
- Replacement transport preserves the last server amount only to satisfy the shared schema before orchestration. Frontend does not calculate a trusted total; Backend catalog repricing supplies the accepted component prices and total.
- Update success adopts the response design wholesale. The UI does not increment revision locally and does not calculate a trusted price.
- Save has a visible action and validates `SaveDesignResponse` including `savedAt`.
- Order creation sends the latest revision, pricing version, and expected server total, validates `CreateOrderFromDesignResponse`, and renders the immutable snapshot revision and price. Payment is not connected.

## Mock boundary

- Default mode: real same-origin `/api` requests, proxied by Next.js rewrites to `MYSTCRAG_BACKEND_ORIGIN` or `NEXT_PUBLIC_API_BASE_URL`.
- Development Mock mode: enabled only when `NODE_ENV !== "production"` and `NEXT_PUBLIC_MYSTCRAG_MOCK_API=true`.
- Production mode ignores the Mock flag and cannot silently fall back to Mock after a network or schema failure.
- A fixed “开发模式 · Mock API” badge is shown whenever explicit Mock mode is active.
- Mock order success is deliberately not fabricated.
- The existing actor seam is sent as `x-actor-id`; non-production defaults to the seeded `user-phase-2c-demo`. Production requires `NEXT_PUBLIC_MYSTCRAG_ACTOR_ID` until authentication replaces this seam.

## Error and authority handling

- `CONFLICT`: shown explicitly; action reloads the latest owner-scoped design.
- `PRICE_CHANGED`: shown when Backend warns or its accepted total differs from the previous server total.
- `INVENTORY_CHANGED`: shown explicitly and does not mutate local design state.
- Invalid successful responses are rejected as `INTERNAL_ERROR` after runtime schema validation.
- `NOT_FOUND`, `CONSENT_REQUIRED`, and `INTERNAL_ERROR` have explicit user-facing states.
- Client owner IDs, inventory, costs, server timestamps, publication fields, and order IDs are never synthesized.

## Test evidence

Focused automated results before the final workspace gate:

- Frontend: 30/30 passed.
- Backend lifecycle: 11/11 passed.
- Root architecture/integration: 12/12 passed.
- Frontend lint: passed.
- Frontend strict TypeScript: passed.
- Frontend production build: passed; dynamic design/DIY routes and App Router icon route built successfully.

Acceptance coverage:

1. Questionnaire request includes real answers: `real generate request sends complete questionnaire answers and budget to Backend`.
2. Budget reaches Backend: request body asserts `minBudgetMinor` and `maxBudgetMinor`.
3. Results no longer load fixed Mock data: production source-boundary test rejects Mock imports in page components.
4. Real generate API: `/api/design/generate` request and schema-valid response test plus browser HTTP evidence.
5. Real update API: `/api/design/update` and finite `REPLACE_COMPONENT` request test plus browser HTTP evidence.
6. Revision is server-owned: update test accepts the response revision verbatim; browser moved from Revision 1 to Revision 2.
7. Price is server-owned: update test accepts the response total verbatim; browser moved from ¥38.00 to ¥34.00 after Backend repricing.
8. Save API: `/api/design/save` request and `savedAt` response test plus browser HTTP evidence.
9. Order API: `/api/orders/from-design` request and immutable snapshot validation plus browser HTTP evidence.
10. Refresh persistence: GET-by-design-ID test and a fresh browser navigation recovered the same PostgreSQL-backed design.
11. `CONFLICT` UI: stable error-envelope test and explicit reload action.
12. `PRICE_CHANGED` UI: warning/server-total comparison test and browser-visible price notice.
13. `INVENTORY_CHANGED` UI: stable error-envelope test and non-mutating error state.
14. Production has no Mock fallback: `resolveMockMode` production/development matrix test.
15. 44 px targets: source acceptance test checks Tailwind `min-h-11` on mobile navigation and DIY return/actions; bead hit targets also use `min-h-11 min-w-11`.
16. Favicon: App Router metadata/source test; production HTTP checks returned 200 for both `/icon.svg` and `/favicon.ico`.

## Real browser and PostgreSQL evidence

Playwright CLI ran against a production Next.js build, a real Fastify Backend process, and an isolated PostgreSQL 17 cluster with the reviewed migration and idempotent seed.

- Migration `20260721140000_init_mystcrag_persistence_v1`: applied successfully.
- Generate: HTTP 200; persisted a new owner-scoped design at Revision 1.
- Result refresh/GET: HTTP 200; returned the same design from PostgreSQL.
- Update/reprice: HTTP 200; returned Revision 2 and Backend total ¥34.00 after replacing the first bead; previous total was ¥38.00.
- Save: HTTP 200; UI displayed the Backend `savedAt` value.
- Create order: HTTP 200; UI displayed the immutable snapshot at Revision 2 and ¥34.00.
- Icon checks: `/icon.svg` HTTP 200; `/favicon.ico` HTTP 200.
- Mock badge was absent in the production build, confirming the real transport path.

The isolated PostgreSQL process was stopped after evidence collection. No repository database, migration, or seed file was changed.

## Verification

- Focused checks and results: listed above.
- Tests added or updated: Frontend transport/authority tests, questionnaire budget assertion, QA production-boundary checks, 44 px target check, and favicon check.
- `pnpm validate` command: `pnpm validate`
- `pnpm validate` result: PASSED — 7/7 lint, 7/7 strict TypeScript, 12/12 root tests, all workspace tests, Prisma validation, Backend build, and Frontend production build.
- Validation commit: working tree before final commit.

## Known limitations and risks

- `x-actor-id` remains the documented integration seam and is not production authentication.
- Backend generation still uses its deterministic `MockDesignGenerationAdapter`; the browser transport and persistence are real, but no real LLM is enabled.
- Replacement choices are derived from products already present in the current public design because no public catalog endpoint exists. A later reviewed catalog API is needed for the full sellable material library.
- Budget metadata is retained in same-tab `sessionStorage`; the persisted design remains available after refresh, while a new browser context may show “未设置预算上限.”
- The current seed-scale generator can return a design below the selected minimum budget; the UI shows `UNDER_BUDGET`. Designs above the maximum are explicitly marked `OVER_BUDGET`.
- Order creation produces a real pending immutable snapshot but does not implement payment, reservation, shipping, tax, or idempotency.
- The existing lightweight bracelet preview remains outside this bug scope; Three Engine UI integration is tracked separately.
- Next.js rewrites bind the Backend origin at build/start configuration time; deployments must supply the correct environment value.

## Handoff notes

- Cross-module dependencies: existing Design Contract V1 DTOs, existing Backend lifecycle routes, PostgreSQL migration/seed, and the existing actor seam.
- Merge risks: deployment environment values, authentication replacement, and keeping production Mock mode disabled.
- Recommended reviewer focus: no Mock imports in production page components, request/response runtime validation, server revision/price adoption, snapshot rendering, and `x-actor-id` deployment restrictions.
- Recommended merge readiness: `READY_FOR_MERGE_REVIEW`.

## Agent confirmation

- [x] I confirmed `fix/mvp-browser-integration` in an isolated worktree before development.
- [x] I changed only Frontend, integration/QA tests, and this role report; no business Backend or shared protocol file changed.
- [x] No Design Contract, API specification, database schema, architecture, AI contract, or 3D contract change required Decision Log approval.
- [x] No commercial cost, supplier, prompt, hidden reasoning, or private conversation data enters the public browser flow.
- [x] I ran `pnpm validate` successfully on the final report content.
