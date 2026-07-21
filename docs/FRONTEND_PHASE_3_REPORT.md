# Mystcrag Frontend Phase 3 Report

Date: 2026-07-21

## Identity

- Agent role: Frontend Lead
- Branch name: `feature/frontend-ai-flow`
- Initial development baseline: `64957c1 feat: add versioned design persistence and order snapshots`
- Post-rebase baseline: `750b6b932e71644533f24a4b4c8786ec5b403a45 merge: adapt phase 3 workflow for local integration`
- Final validated implementation commit: `9b53037af74fda2450912112320b2eb3fd72e1d4 feat: implement ai design and diy frontend flow`

## Change scope

- Changed files:
  - `apps/frontend/app/page.tsx`, `app/layout.tsx`, `app/globals.css`
  - `apps/frontend/app/ai-design/page.tsx`
  - `apps/frontend/app/design/[id]/page.tsx`
  - `apps/frontend/app/diy/page.tsx`, `app/diy/[id]/page.tsx`
  - `apps/frontend/src/components/flow-notice.tsx`
  - `apps/frontend/src/features/questionnaire/**`
  - `apps/frontend/src/features/design/components/**`
  - `apps/frontend/src/features/design/fixtures/mock-design-options.ts`
  - `apps/frontend/src/features/design/model/design-selection.ts`
  - `apps/frontend/src/lib/api/frontend-api-error.ts`, `mock-design-api.ts`
  - `apps/frontend/src/features/design/design-contract-consumer.test.tsx`
  - `apps/frontend/src/features/design/frontend-ai-flow.test.tsx`
  - `packages/ui/src/surface.tsx`
  - `docs/FRONTEND_PHASE_3_REPORT.md`
- Changed modules: `apps/frontend`, `packages/ui`, frontend module-local tests, Frontend Phase 3 report.
- New or changed interfaces:
  - Six-step questionnaire model and `GenerateDesignRequest` mapper.
  - Schema-valid frontend Mock API for generation, result retrieval, bead replacement, revision changes, and trusted mock-price responses.
  - Shared frontend error presentation for validation, conflict, price, inventory, compliance, AI, 3D fallback, network, and empty states.
  - Responsive `BraceletPreview`, `DesignResults`, and `DiyEditor` components using `componentId` for identity and React keys.
- Shared assets changed: None. `packages/ui` is inside the Frontend-owned boundary; no Contract, API specification, database, architecture, AI, or 3D contract changed.
- Approved decision-log entries: None required.

## Implementation status

### Implemented pages

- `/`: premium Eastern-jewelry landing page with brand hero, AI and DIY entry points, bracelet visual integration point, design examples, brand belief, and cultural-compliance copy.
- `/ai-design`: six-step questionnaire covering current state, color, style, budget, wrist circumference, and optional cultural inspiration. It supports progress, validation, previous-step navigation, answer preservation, and a fixed mobile action area.
- `/design/[id]`: result page rendering exactly three schema-valid design options with name, story, palette, recommendation reason, crystal combination, style, server-mock price, disclaimer, selection state, and DIY entry.
- `/diy/[id]`: responsive DIY editor with material library, bracelet preview, selected-component detail, component list, story, compliance copy, price, revision, and bead replacement interaction.
- `/diy`: redirects to the deterministic mock design used while the real design-loading endpoint is unavailable.

### Mock API boundary

- `apps/frontend/src/lib/api/mock-design-api.ts` is the only frontend Mock API boundary.
- Generate requests are parsed by `GenerateDesignRequestSchema`; generated and fetched designs are parsed as shared public design DTOs; replacement responses are parsed by `UpdateDesignResponseSchema`.
- The UI does not calculate or trust a final price. The Mock API simulates the server boundary, recalculates the mock price and revision, and returns a schema-validated response.
- Mock data derives from Design Contract fixtures and is revalidated with `PublicDesignV1Schema`; it does not redeclare a Design type or expose cost/supplier fields.

### Real Backend integration

- Real Backend is **not connected** on this branch.
- The post-rebase Backend may expose additional orchestration work, but the frontend currently calls deterministic Mock API functions rather than HTTP success endpoints.
- Switching to the real Backend requires replacing the Mock transport calls while preserving the existing shared request/response schemas and error-code mapping.

### Three design options on the result page

- The result page always presents three independent Public DTO designs: `雨霁青`, `暮山紫`, and `月照白`.
- Each design has a stable `designId`, distinct story/style/palette/recommendation copy, a shared-schema price, a selection button, and a route into `/diy/[id]`.
- Selection is stored by public `designId`; tests verify all three options can be resolved and selected without introducing a duplicate Design interface.

### DIY bead selection and replacement state

- Selected state is stored exclusively as `selectedComponentId`; React list keys and preview identity use `componentId`.
- Clicking a bead updates `aria-pressed` and the selected-component detail. Accessories remain visible but are not incorrectly exposed as replaceable beads.
- Replacement sends the current design, selected `componentId`, chosen mock material, and expected revision to the Mock API.
- A successful replacement preserves `componentId`, updates material fields, advances revision, returns the updated server-mock price, and displays a price-changed confirmation when applicable.
- Stale revision and unavailable-material paths map to explicit conflict and inventory UI rather than silently overwriting state.

### 3D integration status

- Current state: **interactive lightweight Mock/placeholder**, not the actual Three Engine integration.
- `BraceletPreview` renders an accessible CSS bracelet using real Public DTO order and `componentId` selection. It is more than a static image but does not create a Three.js/WebGL scene.
- The UI visibly documents the lightweight preview and handles `THREE_ASSET_FALLBACK` with a reliable alternative appearance.
- Future Three Engine integration should replace the visual renderer while retaining the existing `design`, `selectedComponentId`, and `onSelect(componentId)` boundary.

### CNY and TWD formatting

- All user-visible amounts use the shared `formatMinorAmount` helper.
- CNY interprets minor units as fen and formats with two decimal places.
- TWD uses exponent zero and formats the input integer directly as whole New Taiwan dollars.
- No general `amountMinor / 100` path exists for TWD; both currencies and invalid/unsafe amounts are covered by tests.

### Error-state UI

- Explicit presentations exist for `VALIDATION_ERROR`, `CONFLICT`, `PRICE_CHANGED`, `INVENTORY_CHANGED`, `COMPLIANCE_BLOCKED`, `AI_GENERATION_FAILED`, `THREE_ASSET_FALLBACK`, `NETWORK_ERROR`, and `EMPTY_STATE`.
- Error UI includes a clear title, actionable explanation, recovery action where available, semantic `alert`/`status` roles, and non-color-only communication.

### Mobile layout

- Questionnaire actions are fixed to the bottom edge on mobile and become part of the normal flow on larger screens.
- DIY mobile order is preview first, selected-component/design detail second, and the material selection panel with replace action last.
- The material catalog scrolls horizontally inside its own panel; `min-w-0` grid constraints prevent page-level horizontal overflow.
- Desktop switches to the required material library / preview / component-and-price three-column workspace.

### Accessibility testing

- Tests cover labeled progress, fieldset/radio semantics, validation messages, `aria-invalid`, semantic headings/regions, `aria-pressed` bead selection, material `radiogroup`, alert/status roles, and keyboard-focus styles.
- Playwright verified the questionnaire controls, back navigation, result selection flow, bead selection, material selection, and replacement controls in a real browser.
- This is a basic accessibility pass, not a formal WCAG audit or assistive-technology certification.

### Production build

- `pnpm --filter @mystcrag/frontend build`: passed.
- `pnpm validate`: passed with the Next.js production build generating `/`, `/ai-design`, `/design/[id]`, `/diy`, and `/diy/[id]` successfully.
- Full validation also passed workspace lint, strict type checks, architecture tests, module tests, Prisma validation, and Backend build.

### Final post-rebase commit hash

- Rebase status: completed onto `750b6b932e71644533f24a4b4c8786ec5b403a45`.
- Final validated implementation commit: `9b53037af74fda2450912112320b2eb3fd72e1d4`.
- Commit subject: `feat: implement ai design and diy frontend flow`.

## Verification

- Focused checks and results:
  - `pnpm --filter @mystcrag/frontend typecheck`: passed.
  - `pnpm --filter @mystcrag/frontend lint`: passed.
  - `pnpm --filter @mystcrag/frontend test`: 19/19 tests passed.
  - `pnpm --filter @mystcrag/frontend build`: passed; `/`, `/ai-design`, `/design/[id]`, `/diy`, and `/diy/[id]` built successfully.
  - Playwright browser verification: completed the six-step questionnaire, returned to the prior step with answer preservation, generated three results, verified mobile and desktop DIY layouts, selected a bead by `componentId`, replaced it, observed revision 1 → 2 and server-mock price ¥550.00 → ¥554.00, and confirmed the price-changed UI.
- Tests added or updated:
  - Questionnaire flow, validation, back navigation, shared Generate DTO mapping.
  - Three-result rendering/selection and Public DTO cost exclusion.
  - CNY and TWD minor-unit formatting.
  - Compliance copy and all required exceptional-state presentations.
  - `componentId` selection, accessible bead controls, replacement identity, revision conflict, inventory change, price change, mobile ordering, and 3D fallback.
- `pnpm validate` command: `pnpm validate`
- `pnpm validate` result: passed lint, strict type checks, 7 architecture tests, all workspace tests including 19 frontend tests, Prisma validation, backend build, and Next.js production build.
- Validation commit: `9b53037af74fda2450912112320b2eb3fd72e1d4 feat: implement ai design and diy frontend flow` (post-rebase implementation commit).

## Handoff notes

- Known limitations:
  - Backend success orchestration is not available on the baseline, so production request/response schemas are exercised through deterministic frontend Mock API functions.
  - The bracelet visual is an accessible CSS/lightweight preview and explicit 3D asset fallback, not the pending Three Engine runtime integration.
  - Mock designs use one CNY catalog; TWD is supported and tested by `formatMinorAmount`, but the current questionnaire does not expose a currency selector.
- Unfinished work:
  - Replace Mock API calls with authenticated Backend endpoints after their success paths merge.
  - Replace the lightweight bracelet preview with the Three Engine scene component after its branch merges, preserving `componentId` selection callbacks and fallback behavior.
  - Persistence, order creation, payment, AR, full community, full user center, and Shopee integration remain out of scope.
- Cross-module dependencies:
  - Backend must return shared public Generate/Update DTOs and stable error codes.
  - AI must supply the three schema-valid designs through Backend orchestration.
  - Three Engine must expose the frontend integration component without changing Public DTO identity.
- Merge risks:
  - Backend and Three Engine merge order may require transport/component wiring inside `apps/frontend`; no shared contract change should be needed.
  - Mock fixture IDs are deterministic frontend-only IDs and must not be treated as persisted production IDs.
- Recommended reviewer focus:
  - Questionnaire wording, validation, fixed mobile action area, and progress semantics.
  - Public DTO boundary and absence of commercial fields.
  - DIY identity/revision/price behavior and responsive grid ordering.
  - Error recovery copy and compliance disclaimer visibility.

## Agent confirmation

- [x] I confirmed the assigned branch before development.
- [x] I changed only my owned module, owned tests, and role report, except for approved shared changes listed above.
- [x] I recorded and obtained approval for every shared Contract, API, database, architecture, AI-contract, or 3D-contract change before implementation. No such change was required.
- [x] I verified that no commercial cost, supplier, prompt, hidden reasoning, or private conversation data leaks through public boundaries.
- [x] I ran `pnpm validate` successfully on the final change.
