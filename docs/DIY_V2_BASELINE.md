# DIY V2 Baseline

Date: 2026-08-18. Environment: real Next.js Frontend, Fastify Backend, local PostgreSQL and signed development authentication; Mock disabled.

Playwright exercised `/diy/design-diy-private` at 390×844, 430×932, 1024×768, 1440×900, and 1920×1080. All had no document-level horizontal overflow and no console warning/error. AI questionnaire → results → DIY also completed.

- Add produced Update followed by a redundant Price request; price and revision changed correctly.
- Connected/spread changed presentation only; drag reordered, and the center delete target appeared only during drag.
- Display angles were size-weighted, but drag targeting still used equal `angle / 2π * count` slots.
- Clear removed beads through sequential HTTP requests.
- Mobile used a complete static catalog rather than a collapsed/half/expanded sheet.
- At 1024px lower explanatory content clipped; wide desktop left substantial unused stage space.
- A 12-bead AI design displayed 9.0cm as “手围”, conflating material path with wrist/target.
- PNG export used independent equal-angle placement and did not visually match the editor.

Local evidence is under `output/playwright/diy-v2-before/`. Raw CLI artifacts are not release assets.
