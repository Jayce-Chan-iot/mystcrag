# UI Design System

Style: Premium Eastern jewelry aesthetic.

Colors: Ivory, cream, soft gray, purple accent.

Features: 2.5D bracelet editor. AI assistant flow. DIY workspace.
Community gallery.

Avoid cheap ecommerce style.

## Initialization tokens

The frontend scaffold defines semantic colors for background, foreground, surface, muted text, accent, and border in `app/globals.css`. Shared visual primitives belong in `packages/ui`; route-specific composition belongs in `apps/frontend`.

All new layouts must remain mobile first, keyboard accessible, and usable without relying on color alone. The current route pages are structural placeholders, not approved final visual designs.

## DIY editor visual contract

The primary DIY workspace is a top-down 2.5D composition. Individual beads use realistic rendered product imagery to preserve translucency, inclusions, gloss, and material depth, but the editor does not expose a perspective camera, orbit controls, or a free-moving WebGL scene. The bracelet rests on a large circular presentation tray. Users may switch among clear acrylic, off-white bone china, wood, and French linen; this preference is saved locally per Design and included in the exported PNG background, but never changes product, price, inventory, revision, or order data.

On mobile, the large bracelet preview occupies roughly the upper half of the editor surface and the complete bead library begins immediately below the action toolbar. Catalog categories remain horizontally scrollable; search, color, and diameter filters stay visible above a dense three-column product grid.

Core interaction is direct manipulation: tapping a catalog bead inserts it after the selected bead and dragging a bead around the ring changes its ordered position. Once dragging starts, the circular tray rim becomes the removal boundary; releasing the bead outside the tray removes it when contract constraints allow, while releasing inside the tray away from the ring cancels. A dragged bead keeps its original scale, opacity, color filter, circular silhouette, and photo lighting; drag feedback must never add a rectangular shadow or otherwise change the material appearance. Keyboard users can select beads, move them with arrow keys, and remove them with Delete or Backspace.

The inspector and mobile catalog sheet expose the current bracelet as directly selectable bead thumbnails. When the catalog contains multiple sellable diameters for the same crystal identity, the selected bead can switch between those variants without changing its `componentId`. The catalog navigation is future-ready for three product families: crystals, natural stones, and accessories; unavailable families show an inline empty state rather than a dead control or fabricated inventory.

DIY material edits update the authoritative total price in place. Routine add, move, and remove operations must not open a blocking price-confirmation panel; inventory or revision conflicts may still use an explicit error notice. The preview provides a two-state “收缩成串 / 散开查看” control: the connected state tightens the ring according to component count so adjacent beads read as a finished bracelet, while the spread state leaves enough space for precise selection and reordering.

The editor derives the current bracelet circumference from the sum of every bead diameter plus the occupied width of each inline accessory. This preview estimate updates after every material edit and does not reuse the original questionnaire wrist target. The common suggested range is 130–200 mm inclusive. Below 130 mm, the stage quietly advises that the bracelet is below the common range; above 200 mm it advises that the bracelet is above the common range. These states never open a modal and never disable completion or order creation. The copy must identify the range as a suggestion rather than a validity rule.

Ring geometry is size-aware rather than count-only: each component receives angular space proportional to its physical occupied length, and the visual scale is reduced as the total circumference grows. This preserves the visible diameter differences between 6/8/10/12 mm products while preventing dense designs from collapsing into an unreadable stack. Bead imagery uses a transparent circular crop of the product render, intrinsic specular highlights, visible inclusions, and a soft circular contact shadow to match photographed crystal rather than a flat color token.

The homepage has two distinct task entries. “AI 设计” enters the six-step questionnaire, while “DIY 创作” bypasses the questionnaire and opens the DIY editor directly.

After successful completion, both desktop and mobile must immediately show a completed state and disable the completion action so one interaction cannot create duplicate order snapshots.

On desktop viewports, the DIY workspace becomes a viewport-bound three-column jewelry workbench. Side rails use fluid clamp widths and may scroll internally; the center preview shrinks with short browser windows, while the horizontal bead shelf remains fully visible inside the viewport. The left rail owns product-family navigation, catalog search, filters, and categories; the center owns the tray-based bracelet stage plus bead shelf; the right inspector owns current-bead selection, same-crystal diameter controls, grouped design summary, authoritative total, clear action, and prominent completion action. Saving remains available in the top bar, while exporting produces a local PNG design image using the active display tray. This desktop composition is a responsive presentation change only and must not fork the underlying design, pricing, inventory, persistence, or direct-manipulation behavior from mobile.

## AI result selection contract

Desktop AI results present all three generated schemes as a single comparison grid instead of stacked full-width cards. Each scheme keeps its bracelet image, material combination, short story, authoritative price, budget state, and selection control visible. The first valid scheme is selected by default so the next step is never ambiguous. A sticky action bar summarizes the current selection and keeps “进入 DIY 调整” visible while the user compares schemes. Narrow viewports may stack cards, but selection state and the next-step action must remain accessible.

## Viewport density contract

Desktop pages follow the approved reference-board proportions at the actual browser viewport rather than using CSS `zoom` or a transform-scaled application. At heights of 560 px and below, each principal route switches to a compact composition: the homepage keeps the hero above all three creation cards, the questionnaire keeps the current question and navigation action in view, AI and Tarot results preserve their three-way comparison, the Tarot draw keeps the deck, slots, and reveal action visible, and the DIY workbench compresses its shelf while retaining the tray and completion controls. Mobile controls remain at least 44 px even when visual spacing is reduced.

Each homepage creation card is a single semantic link. Clicking its photograph, title, description, note, or circular arrow opens the corresponding path, and keyboard focus outlines the entire card.

Tarot setup includes a 13.0–20.0 cm design-wrist input and a collapsible photographic measurement guide. The value remains route-scoped and is sent with the recommendation request so all three generated designs use the chosen wrist size. The range describes supported recommendation sizing; subsequent DIY completion retains its separate non-blocking fit advisory.
