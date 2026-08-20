# Design QA — Size-aware Bracelet Editor

## Evidence

- Source visual truth: `/Users/chenyanyan/Pictures/Photos Library.photoslibrary/resources/derivatives/A/A93080B8-23E3-436C-87EB-9762FFDF7B84_1_105_c.jpeg`
- Browser-rendered implementation: `/Users/chenyanyan/Codex-project/玄矶水晶DIY设计网页端/artifacts/design-qa/bracelet-fit-mobile-connected-390x844.png`
- Full-view comparison input: `/Users/chenyanyan/Codex-project/玄矶水晶DIY设计网页端/artifacts/design-qa/reference-vs-implementation-mobile-connected.png`
- Focused bracelet comparison input: `/Users/chenyanyan/Codex-project/玄矶水晶DIY设计网页端/artifacts/design-qa/reference-vs-implementation-ring-focus.png`
- Route: `http://localhost:3000/diy/design-diy-private`
- Source pixels: 601 × 1306, normalized to 390 × 844 for comparison.
- Implementation pixels: 390 × 844 at a 390 × 844 Chrome CSS viewport.
- Density normalization: both artifacts were compared at identical 390 × 844 pixels; browser capture used the Chrome viewport override and the source was proportionally scaled and padded without cropping.
- State: 21 ordered ring components, current estimated circumference 16.0 cm, connected bracelet mode, completion enabled.

## Full-view comparison

The normalized full-view input places the supplied reference and the Chrome implementation together. Both preserve a white jewelry-editor surface, a large centered front-facing bracelet, visible wrist/price information, a completion action immediately below the preview, and a dense material library beginning in the same viewport.

The implementation intentionally retains Mystcrag’s existing header, catalog filters, direct-manipulation copy, and purple semantic tokens rather than copying the third-party mini-program branding or navigation chrome. These differences are product-owned content, not fidelity regressions.

## Focused-region comparison

The focused input isolates both bracelet regions. The implementation now matches the source’s key visual qualities: circular photographic beads, bright specular highlights, visible internal crystal texture, soft lower contact shadows, preserved 6/8/10 mm scale differences, and a front-facing planar ring. The connected layout allocates angular space from physical occupied length, keeping a dense bracelet legible without allowing beads to collapse into one another.

## Required fidelity surfaces

- Fonts and typography: passed. The product’s serif title and restrained Chinese sans-serif UI hierarchy remain readable at 390 px; the current wrist label wraps without obscuring price or actions.
- Spacing and layout rhythm: passed. Preview, completion toolbar, and material library remain visible in one 390 × 844 viewport with no horizontal overflow. Size-aware angular spacing remains even across mixed diameters.
- Colors and visual tokens: passed. Ivory-white surfaces, plum controls, muted text, and state-specific amber/plum validation treatments use existing semantic tokens with adequate contrast.
- Image quality and asset fidelity: passed. Beads use a real raster crystal render with circular masking, enlarged subject crop, intrinsic highlight/inclusion detail, and a circular drop shadow. No placeholder, CSS-drawn bead, or rectangular drag shadow remains.
- Copy and content: passed. Current circumference, the 13.0–20.0 cm valid range, too-small and too-large reasons, and the completion dependency are explicit without modal interruption.
- Interaction states: passed. Drag preserves scale, opacity, color filter, silhouette, and lighting; only position and cursor change. The delete target appears during drag and disappears afterward.
- Responsiveness and accessibility: passed. Chrome checks at desktop and 390 × 844 showed no document-level horizontal overflow. Completion is semantically disabled outside the valid range and the inline status is announced with `role="status"`.

## Interaction verification

- Over-limit state: 22.2 cm displayed `手串过大`, completion disabled, no modal.
- Drag deletion: dragging a bead to the visible center target removed it; subsequent keyboard removals also worked repeatedly.
- Boundary state: 20.0 cm removed the warning and enabled completion.
- Under-limit state: sequential diameter-aware updates reached 12.8 cm, displayed `珠子太少，当前 12.8cm，无法串成手串`, and disabled completion without a modal.
- Recovery state: four 8 mm beads updated the estimate through 13.6, 14.4, 15.2, and 16.0 cm; completion re-enabled automatically.
- Connected/spread control: Chrome reported `connected` and `spread` states after each toggle.
- Mobile layout: current wrist, completion action, and complete material library were visible at 390 × 844; no horizontal overflow.
- Browser console errors: none from the application page.
- Automated and repository validation: `pnpm validate` passed after the final image-scale adjustment, including lint, typecheck, 50 frontend tests, all workspace tests, and production builds.

## Comparison history

1. P1 — Equal-angle, fixed-size rendering made dense designs overlap and ignored 6/8/10 mm differences. Fix: introduced physical-length-weighted angular centers, an adaptive connected radius, and a global circumference-aware visual scale.
2. P1 — Completion remained available regardless of assembled length. Fix: introduced a real-time occupied-length calculation, inclusive 130–200 mm validation, centered non-modal guidance, and completion guards in both UI and order creation.
3. P2 — Dragging applied `scale-110`, reduced opacity, and a large drop shadow, changing the material while the user judged placement. Fix: drag now changes only position, z-index, transition, and cursor.
4. P2 — The initial photographic crop left each crystal at roughly 73% of its allocated physical diameter, creating larger gaps than the reference. Fix: enlarged the raster subject by 1.34× while preserving the circular mask and contact shadow.
5. Post-fix full-view and focused comparisons show no actionable P0/P1/P2 differences for the requested bracelet preview behavior.

## Follow-up polish

- P3: Future catalog photography can replace the shared crystal base render with material-specific inclusion patterns for tiger eye, lapis, agate, and other opaque products. The current treatment already satisfies the requested photographic volume and lighting behavior.

final result: passed

---

# Tarot draw design QA

- Source visual truth: `/Users/chenyanyan/.codex/generated_images/019f8979-5008-7d52-9fb2-8e26856b9ea7/exec-d2b280fa-b4ca-461b-b7c5-88b82b57f187.png`
- Source pixels: 1487 × 1058
- Intended implementation viewports: 1440 × 1024 desktop and 390 × 844 mobile, device scale factor 1
- State: three-card draw with two confirmed selections and the Future slot empty
- Implementation screenshot: unavailable in the selected Chrome surface

**Findings**

- Visual comparison is blocked because the Codex Chrome control connection is unavailable. Code review, interaction tests, asset hashes, responsive source assertions, and production builds are green, but those are not substitutes for a rendered same-state comparison.

**Required comparison once Chrome is available**

- Capture the desktop and mobile draw screen in the same partial-selection state.
- Compare the full view and focused fan/slot/footer regions.
- Explicitly verify typography, spacing, cream/purple tokens, real card image quality, copy, fixed actions, overflow, and the authorized purple card-back deviation from the pale reference.
- Test pointer, touch-sized controls, Enter/Space, rejected selection, reduced motion, and browser console output.

**Comparison history**

- No valid visual iteration yet; the source can be opened, but the selected Chrome surface cannot be controlled to produce the implementation capture.

final result: blocked
