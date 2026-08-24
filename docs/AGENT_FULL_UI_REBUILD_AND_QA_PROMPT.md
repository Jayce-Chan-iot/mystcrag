# Prompt: Mystcrag full UI rebuild and acceptance

Copy everything inside the following block into the other Agent.

```text
You are the Principal Product Engineer, Frontend Interaction Lead, Visual QA Lead and Release QA owner for Mystcrag (玄矶). Work directly in:

/Users/chenyanyan/Codex-project/玄矶水晶DIY设计网页端/.worktrees/tarot-guided-integration

Your task is to faithfully implement every approved desktop and mobile UI reference, preserve the real application flows, and finish only after code, interaction, responsive and visual acceptance all pass.

FIRST READ, IN THIS ORDER
1. AGENTS.md
2. README.md
3. docs/INDEX.md
4. docs/PROJECT_CONTEXT.md
5. docs/CODING_STANDARD.md
6. docs/UI_DESIGN_SYSTEM.md
7. docs/UI_REFERENCE_AND_ASSET_MANIFEST.md
8. docs/INTERACTION_TEST_PLAN.md
9. docs/USER_ACCEPTANCE_CHECKLIST.md
10. docs/BRACELET_GEOMETRY.md
11. docs/DESIGN_CONTRACT_V1.md
12. docs/API_SPECIFICATION.md

Use the installed `design-taste-frontend`, `impeccable`, `product-design:image-to-code`, `superpowers:systematic-debugging`, `superpowers:test-driven-development`, and `mystcrag-bracelet-engine` skills when their trigger conditions apply. Follow each SKILL.md completely. Do not install substitutes.

NON-NEGOTIABLE VISUAL SOURCE OF TRUTH
The approved screenshots are in `docs/ui-references/` and mapped in `docs/UI_REFERENCE_AND_ASSET_MANIFEST.md`. Match them as closely as implementation permits at the exact acceptance viewports. Do not reinterpret the design language. Do not use screenshots as page backgrounds. Do not fake controls with images, CSS art or decorative placeholders. Build semantic, responsive, interactive components and use the runtime scene assets from `apps/frontend/public`.

LATEST TEXT/NAV OVERRIDES
- Mobile bottom navigation and page title: `作品画廊`.
- Desktop top navigation includes `作品画廊` between DIY and design inspiration.
- Profile common service replaces `我的收藏` with `定制客服`.
- Home module cards are entirely clickable, not only the arrow/button.

PAGES AND ROUTES TO COMPLETE
- `/`: desktop and mobile home.
- `/ai-design`: AI questionnaire; DIY must not route through this questionnaire.
- `/design/[id]`: three AI recommendation results and selection.
- `/tarot/setup`: theme dropdown plus custom question, spread selection and wrist size/measurement help.
- `/tarot/draw/[sessionId]`: interactive card draw.
- `/tarot/result/[sessionId]`: reading, color/material guidance and three selectable bracelet recommendations.
- `/diy` and `/diy/[id]`: direct DIY and design-based DIY editor.
- `/crystal-library`: product library.
- `/gallery`: works gallery.
- `/profile`: profile and common services.
- Also complete loading, empty, advisory, error and completion states used by these routes.

HOME REQUIREMENTS
- Use the approved top-to-bottom desktop composition, not a left/right page split.
- Keep the hero and all three entry cards visible without unnecessary scrolling at 1440×900 and 1280×720.
- Use `/home/hero-bracelet.webp`, `/home/entry-ai.webp`, `/home/entry-tarot.webp`, `/home/entry-diy.webp` with the intended crops.
- Each card has one clear label, one short description and a full-card hit area.
- AI entry opens the questionnaire; Tarot opens Tarot setup; DIY goes directly to the DIY workbench.

AI FLOW REQUIREMENTS
- Questionnaire uses the approved six-step visual system and includes the wrist measurement guide at `/guides/wrist-measurement.webp`.
- Prevent mobile controls from becoming untappable; all tap targets are at least 44×44 CSS px.
- Results show all three options in one glance where the approved reference does, with one selected state and a visible next CTA.
- Bracelet images are live projections from Design JSON, not flattened recommendation screenshots.

TAROT REQUIREMENTS
- Setup supports both a theme dropdown and an optional custom question.
- Wrist size belongs in Tarot setup and opens the same measurement guide.
- Mobile draw lays the deck out as two clean rows (4×2 visible cards in the approved mobile state), with full card edges and comfortable gaps; no clipping or giant fan overflow.
- Cards are individually selectable. Three-card mode uses past/present/future slots, selected count and a clearly enabled result CTA after three valid selections.
- Draw state survives the normal transition into result; no return to an optional-question dead end.
- Result shows three cards, upright/reversed states, reading copy, color/material guidance and three bracelet recommendations.
- Inventory quantity 0 is allowed in Tarot recommendations. Show a non-blocking note: `该材料需等待商家补货，预计补货周期约 5 天。` Do not silently substitute it and do not block selection solely because inventory is zero.
- Maintain entertainment/reflection language. Never make deterministic fortune, medical or guaranteed-effect claims.

DIY WORKBENCH REQUIREMENTS
- Primary view is 2.5D, strict top-down, with a central display tray. No mandatory 3D scene.
- Tray choices: transparent acrylic, ivory bone china, oak wood, French linen. Tray choice is presentation-only and must not affect price, inventory, Design JSON or order snapshot.
- Desktop matches `desktop-diy.png`; mobile has two intentional views matching `mobile-diy-library.png` and `mobile-diy-selected.png` so the selected list does not crowd the default screen.
- Mobile default prioritizes bracelet/tray and product library. A clear `已选` control opens the selected-bead view/sheet. Preserve the user's scroll position when switching back.
- Clicking a library item adds one bead. Dragging a bead reorders it.
- A bead is deleted by dragging it outside the display tray. The deletion target appears only during a drag. When not dragging, it is hidden.
- During drag, the bead keeps its original circular shape, texture, opacity and color; no square browser ghost, tint or shape mutation.
- Deletion works repeatedly, not only once. Price and selected counts update immediately without a large modal.
- `收缩成串` toggles between assembled and spread layouts and remains reversible.
- Wrist/fit is advisory. Never block completion only because wrist size or assembled length is outside a suggested range. Show inline advice, not a blocking modal.
- Saving, completion and export are distinct actions and preserve Design JSON/component IDs. The primary completion CTA is always visible.
- Use Bracelet Engine output for editor, results, gallery thumbnails and export; do not duplicate angle math in components.

LIBRARY, GALLERY AND PROFILE
- Library supports Crystal, Natural Stone and Accessories top-level categories and preserves search/filter/sort behavior.
- Gallery is reachable through desktop top navigation and mobile `作品画廊` tab. Empty state uses `/states/empty-design.webp`; loading uses `/states/loading-crystal.webp`.
- Profile uses `/avatars/demo-user.webp` only for local demo fallback. Production prefers the authenticated avatar.
- Profile common services includes `定制客服`; do not relabel it as favorites.

RESPONSIVE AND DENSITY RULES
- Acceptance viewports: desktop 1440×900, 1280×720, 1470×760; mobile 390×844, 375×667, 430×932.
- No browser zoom dependency, page-level `transform: scale`, fixed 1920px canvas, or oversized min-width.
- No horizontal overflow. Do not require scrolling before the primary task/CTA is discoverable.
- At 1440×900 and 390×844, a new user must identify the primary action within 3 seconds.
- Respect safe areas on mobile and avoid bottom-nav/CTA overlap.
- Images use correct intrinsic ratio and `object-fit`; never stretch trays, wrists, cards or scene photos.
- Ensure text remains readable at 100% browser zoom.

IMPLEMENTATION PROCESS
1. Audit the current branch and record current dirty files. Preserve existing user/Agent work and do not reset or overwrite unrelated changes.
2. Build a page/reference matrix from `docs/UI_REFERENCE_AND_ASSET_MANIFEST.md`.
3. Measure reference geometry: viewport, header height, columns/rows, image aspect ratios, spacing, type scale, border radius and fixed/sticky regions.
4. Add or repair shared tokens/components first, then implement route by route.
5. Use real API contracts and seeded data. Do not switch the demonstration to a mock-only mode.
6. For behavior changes, write a failing test first. For geometry changes, change/test `packages/bracelet-engine` first.
7. Update controlling documentation with any architecture/API/interaction contract change.
8. Run narrow tests after every route, then complete validation.

VISUAL ACCEPTANCE METHOD
For every desktop/mobile reference state:
1. Render the app at the exact reference viewport with 100% zoom.
2. Capture a fresh screenshot into the planned QA artifact directory, not the repository root.
3. Put reference and implementation screenshot side by side at identical dimensions; also create an alpha-overlay or pixel diff.
4. Check crop, layout bounds, baseline, typography, spacing, borders, radii, shadows, colors, tray size and CTA visibility.
5. Fix visible mismatch and repeat. A screenshot by itself is not acceptance.
6. Target no major structural mismatch, no clipping/overflow, and a visual-diff threshold agreed in the test harness (use <= 3% changed pixels for stable non-photographic regions; mask only genuinely dynamic timestamps/IDs).

INTERACTION ACCEPTANCE
Test with a real browser and real backend:
- Home: all three full-card hit areas navigate correctly.
- AI: complete every questionnaire step on desktop/mobile, generate three options, select each option, enter DIY.
- DIY: add at least 5 beads, reorder 3 times, delete at least 3 beads sequentially by dragging outside the tray, resize bead diameter, toggle assembled/spread twice, switch all four trays, save, complete and export.
- Tarot: select theme, enter custom question, use wrist help, draw three cards, reach result, select each recommendation, enter DIY; repeat once with a zero-stock recommendation and verify five-day notice.
- Library: search, category, filter, sort and add/favorite behaviors.
- Gallery/Profile: gallery entry/navigation, empty/populated states, custom-service entry, profile fallback avatar.
- Verify back/refresh/retry paths and repeated use. Run each P0 journey at least 3 consecutive times.
- At every route check console errors, failed network calls, focus order, keyboard access, 44px touch targets, horizontal overflow and sticky-control overlap.

REQUIRED COMMANDS BEFORE CLAIMING COMPLETION
- Run the narrowest affected package/component tests while developing.
- Run frontend tests and browser interaction tests described by the repository.
- Run `pnpm validate` from the worktree root.
- Start the production-mode local stack using the documented commands, not mock mode.
- Verify the existing desktop launcher script still starts the backend/frontend and opens the app. Do not replace or break the launcher.

HANDOFF FORMAT
Do not say “complete” until all required commands and journeys pass. Return:
1. Exact files changed.
2. Route/reference matrix with desktop/mobile PASS/FAIL.
3. Interaction test matrix with evidence and screenshot paths.
4. Commands run and exact results.
5. Remaining known issues, each with severity and reproduction steps.
6. Confirmation that the desktop launcher works.

If any acceptance item fails, continue fixing. Do not downgrade it to a known issue unless an external dependency genuinely blocks progress and you can prove the blocker.
```
