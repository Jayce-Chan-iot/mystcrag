# Mystcrag 2.5D MVP Interaction Test Plan

Date: 2026-08-17
Status: `APPROVED_BASELINE`

## Objective

Prove that a desktop or mobile user can enter through AI design or direct DIY,
edit a front-facing 2.5D bracelet without corrupting component identity or
order, receive Backend-authoritative circumference, revision and price state,
save and reload the design, and create exactly one immutable `PENDING` order
snapshot from a valid completion action.

The main QA question is not whether a control is clickable. Every state-changing
test must verify the visible UI, the returned public DTO, the persisted design,
and the restored state after reload when persistence applies.

## Release states

- `READY`: all P0 cases pass on desktop and mobile, P1 failures cause no data
  corruption, forced validation passes, and no BLOCKER, CRITICAL, or core-flow
  MAJOR remains open.
- `READY_WITH_WARNINGS`: all P0 cases pass and only documented non-core MINOR
  issues remain.
- `NOT_READY`: any P0 case fails, data is lost or corrupted, price/revision is
  accepted from the client, completion is blocked solely by advisory fit, or duplicate
  orders can be created from one completion intent.

## State invariants

These invariants must hold after every operation:

1. `componentId` is the stable identity of an existing component.
2. Main-ring `positionIndex` values are unique and contiguous from zero.
3. Presentation-only state never changes the design DTO or revision.
4. Frontend code never invents a successful revision, price, save time, or order.
5. Failed requests leave the last confirmed design usable and recoverable.
6. Every finite positive assembled circumference can complete; 130–200 mm is an advisory range only.
7. An anchored accessory never references a missing bead.
8. At least one bead remains after remove or clear operations.
9. Save/reload restores component identity, order, material, price, and revision.
10. One successful completion intent creates at most one order snapshot.

## P0 interaction matrix

| ID | Interaction | Required assertions |
| --- | --- | --- |
| INT-P0-001 | Select a bead | Exactly the intended `componentId` becomes selected; design and revision do not change. |
| INT-P0-002 | Add after selection | Exactly one new component is inserted after the selected bead with a unique ID and contiguous order. |
| INT-P0-003 | Add without selection | Exactly one new component is appended; no existing identity changes. |
| INT-P0-004 | Move by drag | Only production order changes; identity, material, diameter, and unit price remain stable. |
| INT-P0-005 | Cancel drag | Releasing inside the display tray but away from the ring leaves the design unchanged. |
| INT-P0-006 | Remove outside tray | Releasing beyond the visible circular tray removes exactly the dragged bead; order, selection, circumference, and price reconcile. |
| INT-P0-007 | Protect accessory anchor | A bead referenced by an anchored accessory cannot be removed without a valid anchor transition. |
| INT-P0-008 | Protect final bead | Remove and clear never produce a zero-bead bracelet. |
| INT-P0-009 | Connected/spread toggle | Layout changes, but DTO, order, price, revision, and selection identity remain unchanged. |
| INT-P0-010 | Circumference lower advisory | 129 mm remains classified below the suggested range and can complete; 130 mm can complete without that advisory. |
| INT-P0-011 | Circumference upper advisory | 200 mm can complete without an upper advisory; 201 mm remains classified above the suggested range and can complete. |
| INT-P0-012 | Authoritative update | Update uses `expectedRevision`; UI accepts only Backend revision and price. |
| INT-P0-013 | Save and reload | Reload restores the last saved identity, order, materials, total, and revision. |
| INT-P0-014 | Complete valid design | Current revision and price generate a `PENDING` immutable order snapshot. |
| INT-P0-015 | Prevent duplicate completion | Repeated click/tap while pending or after success cannot create a second order. |
| INT-P0-016 | AI entry | Questionnaire generates three distinct options and selected design reaches the same DIY invariants. |
| INT-P0-017 | Direct DIY entry | Direct entry bypasses the questionnaire and loads an editable persisted base design. |
| INT-P0-018 | Display tray preference | Switching among the four tray materials survives reload for that Design, appears in PNG export, and never changes DTO revision, pricing, or order products. |
| INT-P0-019 | Current-bead diameter control | Selecting a current bead and choosing a sellable diameter variant preserves `componentId` while Backend-authoritative circumference, revision, and price update. |

## P1 failure and concurrency matrix

| ID | Scenario | Required behavior |
| --- | --- | --- |
| INT-P1-001 | Rapid repeated catalog clicks | No accidental duplicate beyond the number of confirmed operations; pending state is explicit. |
| INT-P1-002 | Out-of-order responses | An older response cannot overwrite a newer confirmed revision. |
| INT-P1-003 | Stale revision | Backend returns `CONFLICT`; current persisted design remains intact and reloadable. |
| INT-P1-004 | Inventory change | Backend returns `INVENTORY_CHANGED`; UI does not claim success. |
| INT-P1-005 | Price change | Backend-authoritative price is shown; client does not retain a forged or stale total. |
| INT-P1-006 | Token missing or expired | Protected operation fails explicitly and never falls back to Mock. |
| INT-P1-007 | Network loss during update | Last confirmed design stays operable; retry cannot double-apply the operation. |
| INT-P1-008 | Save interrupted | UI does not show saved state without Backend `savedAt`; retry remains possible. |
| INT-P1-009 | Order request interrupted | Retry does not create duplicate snapshots for the same completion intent. |
| INT-P1-010 | Catalog item becomes inactive | Operation is rejected without corrupting the current ring. |

## Input-surface parity

### Desktop

Run the core matrix at 1024×700, 1280×720, 1366×768, 1440×900,
1920×1080, and 2560×1440 CSS pixels. Validate mouse drag plus keyboard
selection, arrow-key movement, Delete/Backspace removal, visible focus, and no
inaccessible side-rail or shelf state.

### Mobile

Run the core matrix at 360×800, 375×667, 390×844, and 430×932 CSS
pixels with device pixel ratios 2 and 3 where supported. Validate tap selection,
touch drag, catalog horizontal scrolling, page scrolling, virtual-keyboard
recovery, outside-tray removal hit behavior, and safe access to the completion action.

CSS viewport dimensions are layout coordinates, not output-image resolution.
High-DPR captures are used to inspect bead edges and hit regions, but visual
fidelity is secondary to state correctness in this plan.

## Evidence requirements

Every P0 browser case records:

- device/viewport and input method;
- initial design ID and revision;
- operation and target `componentId`;
- request/response result;
- resulting ordered component IDs;
- resulting circumference and total price;
- persisted state after reload when relevant;
- screenshot only when it materially explains a state or failure;
- trace/video for failures, race conditions, or drag/touch defects.

## Execution order

1. Run focused unit and component tests for order, circumference and request
   generation.
2. Run Backend route and repository tests for finite updates and concurrency.
3. Run desktop browser P0 cases against real Backend and isolated PostgreSQL.
4. Run mobile browser P0 cases with touch input against the same boundaries.
5. Run P1 failure injection and concurrency cases.
6. Repeat the complete P0 journey five times without flaky failure.
7. Run `pnpm validate --force`, classify defects, and issue the release state.

## Out of scope for this gate

- orbit-controlled or perspective 3D editing;
- AR try-on;
- payment, shipping, tax, and production inventory reservation;
- community publishing and social interaction;
- large-scale external image acquisition;
- commercial production authentication;
- a paid or network LLM provider.
# Tarot backorder acceptance

- A zero-stock active bead remains eligible for all three Tarot recommendation directions.
- Affected recommendation cards and the restored DIY editor show an inline five-day replenishment estimate without a modal.
- Completion remains enabled and creates an `AWAITING_RESTOCK` order with an immutable fulfillment snapshot.
- A non-Tarot design with the same shortage remains blocked by `INVENTORY_CHANGED`.
- Desktop and mobile layouts keep the advisory readable without hiding the primary action.

## AUTH-005 Authentication interaction matrix

Status: `IMPLEMENTED` — not yet feature-PASS; pending full integration verification.

| ID | Interaction | Required behavior |
| --- | --- | --- |
| AUTH-001 | Page navigation triggers rolling session | SDK middleware reissues session cookie with extended idle expiry; absolute ceiling is not extended. |
| AUTH-002 | GET /auth/login with valid returnTo | Redirects to Auth0 with Cache-Control: no-store and Pragma: no-cache. |
| AUTH-003 | GET /auth/login with malicious returnTo | returnTo is sanitized to `/`; user is redirected to Auth0 with safe fallback. |
| AUTH-004 | GET /auth/callback with valid code | 303 redirect to validated returnTo; session cookie is set. |
| AUTH-005 | GET /auth/callback with provider error | Returns 401 UNAUTHORIZED with stable error envelope and requestId. |
| AUTH-006 | GET /auth/callback with infrastructure failure | Returns 500 INTERNAL_ERROR with error envelope and requestId. |
| AUTH-007 | GET /auth/logout | Returns 405 METHOD_NOT_ALLOWED without modifying any cookie. |
| AUTH-008 | POST /auth/logout with valid Origin | Clears session/transaction cookies present on the request; returns 303 See Other to the server-constructed Auth0/OIDC logout URL (never 200 inline-script HTML). |
| AUTH-009 | POST /auth/logout with missing/wrong Origin | Returns 403 FORBIDDEN. |
| AUTH-010 | POST /auth/logout repeated | Idempotent — repeated POSTs produce the same 303 logout sequence. |
| AUTH-011 | GET /auth/session with valid session | Returns 200 with authenticated:true, safe user projection, real idleExpiresAt and absoluteExpiresAt. |
| AUTH-012 | GET /auth/session with no/expired cookie | Returns 200 with authenticated:false; expired/malformed cookies are cleared. |
| AUTH-013 | GET /auth/session with dependency failure | Returns 500 INTERNAL_ERROR (not authenticated:false). |
| AUTH-014 | BFF /api/** with valid session | Proxies to backend with server-side Bearer token; response has Cache-Control: no-store. |
| AUTH-015 | BFF /api/** with missing session | Returns 401 UNAUTHORIZED. |
| AUTH-016 | BFF mutation with wrong Origin | Returns 403 FORBIDDEN before any token operation. |
| AUTH-017 | Browser API client does not send Authorization | Design/Tarot API clients do not set Authorization header; BFF adds it server-side. |
| AUTH-018 | AuthStatus component states | Shows loading, anonymous (login button), authenticated (name + logout), and error states. |
| AUTH-019 | Logout via top-level POST navigation | Logout uses form submission (not fetch); the browser follows the server 303 to Auth0. |
| AUTH-020 | 375×812 mobile smoke | AuthStatus header controls are accessible; login/logout buttons meet minimum touch target. |
| AUTH-021 | 1440×900 desktop smoke | AuthStatus displays user name and logout in the header navigation. |
