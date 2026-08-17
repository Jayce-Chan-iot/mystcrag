# Mystcrag MVP Development Plan

## Goal

Build the smallest complete commercial loop: AI design -\> DIY
modification -\> 2.5D preview -\> persistence -\> order information.

## MVP Scope

### Must Have

-   Responsive web application
-   AI design questionnaire
-   Crystal recommendation
-   Design JSON generation
-   Front-facing, size-aware 2.5D bracelet preview
-   Add, select, reorder, replace, and remove bead interactions
-   Connected/spread presentation without design-state mutation
-   13.0–20.0 cm completion gate derived from component dimensions
-   Backend-authoritative price and revision calculation
-   Save and refresh recovery
-   Immutable `PENDING` order snapshot generation
-   Equivalent core behavior on desktop mouse/keyboard and mobile touch

### Not First Priority

-   AR try-on
-   Perspective or orbit-controlled 3D editing
-   Complex social features
-   Advanced machine learning recommendation
-   Payment, shipping, tax, and production inventory reservation
-   Large-scale external product-image acquisition

## Acceptance Criteria

User can: 1. Enter preferences or bypass the questionnaire for direct DIY
2. Receive and select an AI design 3. Modify the bracelet without corrupting
component identity or order 4. See Backend-confirmed circumference, revision,
and price changes 5. Save and reload the final design 6. Generate exactly one
order snapshot for a valid completion action.

Release admission requires all P0 interaction cases in
`INTERACTION_TEST_PLAN.md` to pass on desktop and mobile, no BLOCKER, CRITICAL,
or core-flow MAJOR defects, and successful forced workspace validation.
