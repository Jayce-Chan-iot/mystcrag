# Mystcrag Full UI and Tray Workbench Design

## Approved direction

Mystcrag adopts the contemporary jewelry atelier visual system selected in the second full-site concept. The AI questionnaire and Tarot draw retain the clearer structure from the first concept. The DIY editor uses a top-down 2.5D bracelet resting on a replaceable circular display tray.

This work preserves every route, workflow, price, inventory, order, compliance, and authentication contract. It replaces the presentation layer and adds one local display preference; it does not add commerce or deterministic-fortune behavior.

## Global visual system

- Use cool ivory, mineral gray, near-black ink, polished silver detail, and deep violet as the single action accent.
- Let real crystal and Tarot photography carry material color. Amber is reserved for advisories such as replenishment timing.
- Use whitespace and thin rules before containers. Functional containers use an 8-12px radius; buttons are not uniformly pill-shaped.
- Keep the navigation on one desktop line and use a compact mobile navigation treatment.
- All active routes share the same typography, spacing, focus, loading, empty, error, advisory, and completion patterns.
- The primary bracelet view remains flat and top-down. Beads retain their source color, circular silhouette, translucency, inclusions, highlight, and soft contact shadow during drag.

## Route composition

- Home: photography-led atelier composition with equally discoverable AI, Tarot, and DIY entrances.
- AI questionnaire: six-step progress, one focused question per viewport, and the illustrated wrist-measurement guide from the first concept.
- AI results: all three recommendations visible together on desktop, first valid option selected, persistent next action.
- Tarot setup: theme, optional question, and spread selection remain explicit.
- Tarot draw: two spacious rows on desktop when required; cards never clip horizontally; selected slots and the next action remain visible. Mobile uses a proportional layout rather than scaling a desktop canvas.
- Tarot result: revealed cards, interpretation, all three bracelet recommendations, inline replenishment advice, and the next action remain visible.
- Crystal library, gallery, and profile: replace placeholders with the shared atelier content shell without inventing unavailable business data.

## DIY workbench

### Display tray

- The center stage contains a large circular tray viewed exactly from above.
- Available tray materials are `ACRYLIC_CLEAR`, `BONE_CHINA`, `WOOD`, and `FRENCH_LINEN`, labeled `透明亚克力`, `米白骨瓷`, `原木`, and `法式亚麻`.
- The tray is a display preference only. It never changes bracelet geometry, catalog identity, inventory, price, order material, or server Design JSON.
- The selected tray is persisted per design in local browser storage and is used by the current local export. It is not synchronized across devices.
- Tray selection is identified by text, thumbnail, outline, and selection state. It cannot rely on color alone.

### Current beads and catalog

- Remove the generated concept's separate material-state preview strip.
- Replace it with a `当前已选珠子` strip derived from the current design. Selecting an item selects that exact `componentId` on the ring.
- Each selected bead exposes the available diameter SKUs for the same material family. Changing diameter uses the existing replace operation, preserves `componentId`, and accepts the server-authoritative revision and price.
- The catalog's primary product-type navigation contains `水晶`, `天然石`, and `配饰`. `天然石` and `配饰` may show honest empty/future-catalog states until those products exist; they must not fabricate SKUs.
- Existing crystal color, diameter, and text filters apply only to the crystal product type.

### Drag and removal

- A drag that remains over the tray may reorder the bead using the Bracelet Engine slot ranges.
- Moving a removable bead outside the visible tray boundary reveals a contextual delete treatment. Releasing it outside the tray removes it.
- Releasing over the tray but away from the ring cancels the move. It does not delete.
- Non-removable beads explain why removal is unavailable and return to their prior slot.
- The old centered delete target is removed. Keyboard Delete and Backspace remain supported.

### Responsive behavior

- Mobile is composed independently at actual device proportions, with acceptance at 390x844 and an additional tall-phone check. No desktop surface is scaled or stretched into a phone.
- The tray occupies the upper working region without forcing the catalog or completion action below an inaccessible fold.
- The mobile catalog uses a bottom sheet with product types, filters, and a three-column product grid. The selected-bead strip remains reachable without hiding the main action.
- Desktop acceptance uses 1440x900. The left catalog rail, center tray and bead strip, and right inspector remain within the viewport with internal scrolling where needed.

## Accessibility and states

- All controls meet a 44px touch target on mobile and have visible keyboard focus.
- Tray, catalog type, bead selection, diameter, drag state, and completion state have semantic labels independent of color.
- Reduced motion disables nonessential transitions. Drag feedback uses position and outline only.
- Loading, empty, API error, inventory advisory, replenishment advisory, save, export, and completion states remain inline and non-blocking unless the existing contract requires otherwise.

## Acceptance

- Unit/component tests prove tray persistence, catalog types, selected-bead diameter replacement, and outside-tray removal.
- Browser tests exercise home, questionnaire, AI results, Tarot setup/draw/result, and DIY on 1440x900 and 390x844.
- DIY browser checks cover all four trays, adding a bead, selecting an existing bead, changing its diameter, reordering, dragging outside the tray to remove, saving, exporting, completing, and reloading.
- Browser checks inspect console errors, failed requests, horizontal overflow, clipped Tarot cards, and mobile action reachability.
- `pnpm validate` passes.
- `/Users/chenyanyan/Desktop/玄矶系统.command --self-check`, start, status, real frontend health, and stop are verified against this worktree.

