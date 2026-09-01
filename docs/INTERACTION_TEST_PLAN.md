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

Status: `FINAL_DELTA_VERIFIED` (2026-08-27, SOL final delta + evidence closure repair).

Execution methods used below:

- `component`: contract tests discovered by the repository runner
  `tsx --test src/**/*.test.tsx`:
  `src/features/auth/components/auth-status.test.tsx`,
  `src/features/auth/browser/logout-form.test.tsx`,
  `src/features/auth/model/auth-actions.test.tsx`,
  `src/features/auth/model/session-status.test.tsx`.
  No DOM library and no component test framework is used. The presentational
  renderer `AuthStatusPresenter` (the single renderer consumed by `AuthStatus`)
  is tested as a real ReactElement: serialized markup (`react-dom/server`
  `renderToStaticMarkup`) proves role/aria-live/aria-label/class/text output,
  and the rendered buttons' `onClick` handlers are invoked directly, proving
  each login/logout callback fires exactly once. The real hook-to-action wiring
  is proven against the single composition boundary `AuthStatusFromSession`
  (the component `AuthStatus` hands the `useSession()` result to, with no
  top-level remapping): unauthenticated/error controls invoke ONLY login,
  authenticated control invokes ONLY logout, they are never swapped, and
  loading renders no action. The logout DOM form creation/submission is the
  single injectable helper `submitLogoutForm`, tested against a lightweight
  fake document (method=POST, action=/auth/logout, append-then-submit, submit
  once); `useSession` calls this exact helper.
- `route`: module-level contract tests for callback/session/logout/login/BFF/
  page-proxy/cookie logic against the real Auth0 Next.js SDK 4.27.0 error
  shapes (`src/features/auth/server/*.test.tsx`), including privacy-safe auth
  event wiring with distinct semantics: session missing (`missing_session` AND
  no known session cookie on the request) vs session expired/malformed
  (`missing_session` with a stale main/chunk/legacy cookie present,
  `session_expired`, and `missing_refresh_token` — the session cannot continue
  but NO provider revoke was observed) vs renewal rejected/revoked (ONLY an
  explicit provider `invalid_grant`/`access_denied` behind
  `failed_to_refresh_token`) vs Backend verification failure vs dependency
  failure vs origin rejection vs session rotation; plus fail-closed 500
  behavior for page-proxy and configuration failures.
- `browser`: HISTORICAL one-off manual run (2026-08-26) using real headless
  Chromium (playwright) against `next dev` on http://localhost:3100
  (development environment → `mystcrag_session`, Secure=false loopback HTTP).
  Authenticated state used a real SDK-encrypted session cookie produced by the
  SDK test utility `generateSessionCookie` with the server's session secret.
  No committed, executable Playwright smoke exists in this repository (see the
  record below); repeatable automation belongs to TASK-AUTH-006.

Historical manual browser smoke record (NOT a reproducible script):

This section records a one-off MANUAL browser smoke executed on 2026-08-26
against `next dev` on http://localhost:3100. The repository currently contains
NO committed, executable AUTH-005 Playwright smoke, so starting the dev server
alone does NOT reproduce these assertions. Repeatable automated desktop/mobile,
two-user and real-Auth0 flows are explicitly deferred to TASK-AUTH-006.

Manual procedure that was executed on 2026-08-26:

1. Start the dev server: `pnpm --filter @mystcrag/frontend dev`
   (serves http://localhost:3100).
2. Drive real Chromium (playwright) at viewports 375×812 (mobile) and
   1440×900 (desktop).
3. Seed the authenticated state with a real SDK-encrypted session cookie
   generated by the SDK test utility `generateSessionCookie` using the
   server's session secret (development cookie name `mystcrag_session`).
4. Assert: primary actions visible and keyboard-focusable; login/logout
   controls measured height ≥ 44px (`min-h-11`); `scrollWidth == clientWidth`
   (no horizontal overflow); long displayName truncates inside bounded widths.

- Result: all assertions passed during that one-off run of 2026-08-26.
- Evidence was transient: screenshots were not committed (per
  `docs/governance/QA_EVIDENCE_RETENTION.md`) and no fixture/script was
  retained, so this record CANNOT be independently reproduced from the current
  repository state.

Live end-to-end Auth0 authorize/callback flows require real provider
credentials and remain NOT executed; those rows are marked `route` only.

| ID | Interaction | Required behavior | Status / evidence |
| --- | --- | --- | --- |
| AUTH-001 | Page navigation triggers rolling session | SDK middleware reissues session cookie with extended idle expiry; absolute ceiling is not extended. | PASS (`route` + `browser`). BFF and /auth/session invoke the real SDK middleware touch; fail closed 500 on rolling failure; idleExpiresAt parsed from the real rolling Max-Age; ceiling tests prove 7d is never extended; actually-produced rolling Set-Cookie emits auth.session_rotation. Page-proxy SDK/config failure fails closed with stable 500 (never `NextResponse.next()`), no Set-Cookie, auth.dependency_failed. Live smoke (2026-08-26 manual record above, not reproducible from this repository): /auth/session with a valid SDK cookie returned a fresh `mystcrag_session` Set-Cookie. |
| AUTH-002 | GET /auth/login with valid returnTo | Redirects to Auth0 with Cache-Control: no-store and Pragma: no-cache. | PASS (`route`): handler tests prove returnTo forwarding, no-store/Pragma, and a single requestId shared by response and structured log. |
| AUTH-003 | GET /auth/login with malicious returnTo | returnTo is sanitized to `/`; user is redirected to Auth0 with safe fallback. | PASS (`route`): absolute URLs, `//`, backslash and encoded bypasses rejected server-side; rejection logs auth.open_redirect_rejected with the requestId and never the raw returnTo. |
| AUTH-004 | GET /auth/callback with valid code | 303 redirect to validated returnTo; session cookie is set. | PASS (`route`): success is a real 303; SDK transaction/session Set-Cookie preserved. Live IdP exchange not executed. |
| AUTH-005 | GET /auth/callback with provider error | Returns 401 UNAUTHORIZED with stable error envelope and requestId. | PASS (`route`): real SDK 4.27 shapes — missing/invalid state, issuer/session-domain rejection, session_expired, provider denial codes, grant error + invalid_grant, SDK-local `unknown_error` inside authorization_error / authorization_code_grant_error wrappers → 401 with transaction-material cleanup; no provider detail leakage. |
| AUTH-006 | GET /auth/callback with infrastructure failure | Returns 500 INTERNAL_ERROR with error envelope and requestId. | PASS (`route`): discovery_error, authorization_code_grant_request_error, invalid_configuration, transport/JWKS outage, wrapped server_error / temporarily_unavailable / invalid_client / unauthorized_client / invalid_scope / invalid_request, unknown top-level exceptions and unknown provider codes → 500; existing decrypted session never cleared. |
| AUTH-007 | GET /auth/logout | Returns 405 METHOD_NOT_ALLOWED without modifying any cookie. | PASS (`route`): unified envelope `{error:{code,message,requestId}}`, Allow: POST, Cache-Control: no-store, zero Set-Cookie. |
| AUTH-008 | POST /auth/logout with valid Origin | Clears session/transaction cookies present on the request; returns 303 See Other to the server-constructed Auth0/OIDC logout URL (never 200 inline-script HTML). | PASS (`route`): clears current name, `{name}__N` chunks, SDK legacy `appSession`/`appSession.N`, `__txn_*`; unrelated cookies untouched. |
| AUTH-009 | POST /auth/logout with missing/wrong Origin | Returns 403 FORBIDDEN. | PASS (`route`): rejection logs auth.origin_rejected (same for BFF mutations). |
| AUTH-010 | POST /auth/logout repeated | Idempotent — repeated POSTs produce the same 303 logout sequence. | PASS (`route`). |
| AUTH-011 | GET /auth/session with valid session | Returns 200 with authenticated:true, safe user projection, real idleExpiresAt and absoluteExpiresAt. | PASS (`route` + `browser`): live response carried safe projection only (no sub/tokens) and idle/absolute expiry. |
| AUTH-012 | GET /auth/session with no/expired cookie | Returns 200 with authenticated:false; expired/malformed cookies are cleared. | PASS (`route`). |
| AUTH-013 | GET /auth/session with dependency failure | Returns 500 INTERNAL_ERROR (not authenticated:false). | PASS (`route`): rolling failure AND `getConfig()` resolution failure fail closed to a stable 500 with no cookie clearing; never `NextResponse.next()`, never faked anonymity. |
| AUTH-014 | BFF /api/** with valid session | Proxies to backend with server-side Bearer token; response has Cache-Control: no-store. | PASS (`route`): accepted requests trigger SDK rolling and merge rolling Set-Cookie; Backend 401 invalidates the local session (403 preserves). |
| AUTH-015 | BFF /api/** with missing session | Returns 401 UNAUTHORIZED. | PASS (`route`): missing/invalid sessions are never rolled. |
| AUTH-016 | BFF mutation with wrong Origin | Returns 403 FORBIDDEN before any token operation. | PASS (`route`): exact Origin check precedes rolling/session/token work; rolling is never invoked on rejection. |
| AUTH-017 | Browser API client does not send Authorization | Design/Tarot API clients do not set Authorization header; BFF adds it server-side. | PASS (`route`). |
| AUTH-018 | AuthStatus component states | Shows loading, anonymous (login button), authenticated (name + logout), and error states. | PASS (`component`): the actual presentational renderer `AuthStatusPresenter` is tested as a real ReactElement — serialized markup proves role=status/alert, aria-live polite/assertive, aria-labels, display-name fallback/truncation class, touch-target (`min-h-11`) and overflow-bounding contracts; invoking the rendered buttons' onClick proves login/logout callbacks fire exactly once. The real hook-to-action wiring is proven against the single composition boundary `AuthStatusFromSession` (which `AuthStatus` hands the `useSession()` result to): unauthenticated/error controls invoke ONLY login, the authenticated control invokes ONLY logout, they are never swapped, and loading offers no action. Native `<button>` keyboard focusability is a platform guarantee. |
| AUTH-019 | Logout via top-level POST navigation | Logout uses form submission (not fetch); the browser follows the server 303 to Auth0. | PASS (`component`): the single injectable helper `submitLogoutForm` is tested against a fake document — method=POST, action=/auth/logout, body append before submit, submit exactly once; `useSession` calls this exact helper. |
| AUTH-020 | 375×812 mobile smoke | AuthStatus header controls are accessible; login/logout buttons meet minimum touch target. | PASS (`browser`, executed 2026-08-26): anonymous / authenticated / error-recovery primary actions visible and focusable, measured height 44px (min-h-11), `scrollWidth == clientWidth == 375` (no horizontal overflow), long-displayName truncation bounded. Screenshots were transient and not retained in the repository. |
| AUTH-021 | 1440×900 desktop smoke | AuthStatus displays user name and logout in the header navigation. | PASS (`browser`, executed 2026-08-26): same assertions at 1440×900; displayName rendered, logout visible/focusable, no horizontal overflow. Screenshots were transient and not retained in the repository. |

Not executed in this repair (recorded honestly, not marked PASS):

- Live Auth0 authorize → callback → session E2E with real provider credentials.
- A committed, executable Playwright smoke for AUTH-005; the 2026-08-26
  browser run above is a historical manual record only. Repeatable automated
  desktop/mobile, two-user and real-Auth0 flows belong to TASK-AUTH-006.
- Error state at 500 returned by the server (the 2026-08-26 browser run
  simulated the error state by aborting the /auth/session request; the 500
  envelope itself is covered by `route` tests).
- Real-device touch input; touch targets verified by measured CSS height only.
