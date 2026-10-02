# Full-route density and interaction QA

Date: 2026-08-23

## Visual source and comparison

- Approved homepage composition: `/var/folders/3p/m0k1zjwn22gdsdbv83g0z6nr0000gn/T/codex-clipboard-5fe5d527-1721-4b2a-8a20-88bf72d91b85.png`
- Current 1280 × 720 Chrome capture: `qa-home-1280x720.png`
- Side-by-side normalized comparison: `qa-home-comparison-2026-08-23.png`
- Tarot setup: `qa-tarot-setup-1280x720.png`
- Tarot result: `qa-tarot-result-1280x720.png`
- AI result: `qa-ai-results-1280x720.png`
- DIY desktop/mobile: `qa-diy-1280x720.png`, `qa-diy-mobile-390x844.png`

The reference is a 640 × 512 composition image rather than a declared browser viewport. The comparison therefore normalizes both images to 720 px high without stretching. The implementation preserves the reference hierarchy: brand navigation, photographic hero, then three photographic creation paths in AI / Tarot / DIY order.

## Visible implementation checks

- At 1280 × 720, the homepage hero and all three creation cards occupy one screen. Each card is one full-size link; the arrow remains only the visual affordance.
- At 1470 × 420 and 1280 × 720, Tarot setup exposes the theme, optional question, design wrist, both spreads, advisory and primary action without horizontal overflow.
- The Tarot draw uses two rows of cards on short desktop screens; all three slots and the reveal action remain visible.
- Tarot result presents the three revealed cards and all three bracelet recommendations side by side. Every recommendation inherited the tested 16.5 cm design wrist and the primary DIY action is visible.
- AI questionnaire and AI result use the same short-screen density contract; six-step navigation and all three result cards retain a visible next action.
- DIY remains a true single-screen workbench at 1280 × 720 and 1470 × 420. The tray uses a 224 px minimum at extreme short height instead of collapsing to an unusable thumbnail.
- At 390 × 844 there is no horizontal overflow on the homepage, Tarot setup/result or DIY. Tarot setup and result retain fixed, safe-area-aware primary actions.

## Interaction checks

- Clicking the center of the homepage Tarot photograph navigates to `/tarot/setup`, proving the whole card is clickable.
- Entering 16.5 cm in Tarot setup, selecting three cards, revealing the result and generating recommendations completes successfully.
- All three Tarot recommendations display 16.5 cm and can proceed to DIY.
- The full six-step AI questionnaire completes and opens its three-scheme result page.
- Entering DIY from an AI scheme shows tray selection, product library, current materials, diameter controls, price, save and complete actions.

## Automated acceptance

- Focused frontend contract and flow tests cover full-card links, mobile primary-action visibility, the 800 px laptop density breakpoint and the DIY tray minimum.
- Tarot contract/backend tests cover the 130–200 mm request range and request-over-saved wrist precedence.
- Final workspace validation and launcher self-check are recorded in the task handoff.

final result: passed

## Star Platform visual gate (TASK-QA-STAR-001, 2026-10-02)

The full Star Platform redesign gate is recorded in
`docs/progress/2026-09-26_STAR_PLATFORM_UI_QA_REPORT.md`. It runs the repeatable
`scripts/ui-qa/capture_star_platform.py` (85 screenshots over 17 route-states × 5
viewports) and the `--validate` matrix (73 checks).

System states: loading, error, empty, offline and 404 all render through the one
`SystemState` primitive with a real next action, correct live-region roles and no
placeholder skeleton copy.

Gate result: final re-verification on the FE-STAR-005-composed candidate
(`8272c1f`) is **73 checks, 73 PASS, 0 FAIL**, with 85/85 screenshots captured and
no dev error overlay. The initial pre-remediation run (`c3967e4`) was
**64 PASS / 9 FAIL**; the nine failures were the page-family deviations DEV-1 (AA
contrast on accent micro-copy), DEV-2 (`/profile` 200 % overflow) and DEV-3
(`/gallery` React key dev overlay), now closed by the accepted `TASK-FE-STAR-005`
remediation this candidate fast-forwards onto. Verified PASS on every route:
320 px reflow, 200 % text resize (`zoom-200:profile` overflowX 0), AA contrast
(all `contrast-aa:*` rows ≥ 4.5), reduced motion, keyboard traversal with visible
focus, keyboard-only Oracle cast, 44 px mobile targets, no CTA clipping, no
overlay interception, untinted crystal imagery, and exactly one Oracle create
POST per activation.

Result: **passed** — the shared system-state contract, the legacy-drift cleanup
and the page-family DEV-1/2/3 remediations are all complete and re-verified.
