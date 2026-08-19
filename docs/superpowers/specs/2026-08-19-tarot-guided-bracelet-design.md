# Tarot-Guided Bracelet Integration Design

Date: 2026-08-19
Status: approved in chat for specification
Scope: Mystcrag web/mobile product, backend, database, AI recommendation, and QA

## 1. Objective

Add a Tarot-guided creation path beside the existing AI Design and DIY paths. A user selects a theme, optionally asks a question, draws either one card or a past/present/future spread, receives a reflective interpretation, and gets three real, priced, editable bracelet designs derived from the reading.

The feature is a design-inspiration experience. It must not make medical claims, guaranteed-effect claims, investment promises, or deterministic-fortune claims.

## 2. Approved product flow

The landing page presents three equally weighted paths:

1. **AI Inspiration Design** — six preference questions and three editable designs.
2. **Tarot Crystal Guidance** — one-card or three-card reading followed by color, material, and bracelet recommendations.
3. **Free DIY Creation** — direct access to the bead catalog and editor.

The Tarot path is:

```text
Landing page
  -> /tarot/setup
  -> /tarot/draw/:sessionId
  -> reveal cards in place
  -> /tarot/result/:sessionId
  -> select one of three designs
  -> /diy/:designId
```

`/tarot` redirects to `/tarot/setup`. There is no required standalone Tarot marketing page.

## 3. Approved UI behavior

### 3.1 Shared landing page

- Keep the Mystcrag ivory, ink, muted-violet visual system.
- Show AI Design, Tarot Guidance, and DIY as equal-size panels with equal-weight actions.
- AI capability copy includes Five Elements imagery, emotional state, color preference, style, wrist size, and budget.
- DIY description is: “从光泽、色彩与排列中，自由创作只属于你的手串。”
- Five Elements and Tarot are labeled as cultural/design inspiration, not factual prediction.

### 3.2 Setup

- Show a theme select and an optional question field together.
- Initial themes: relationships, career, self-growth, new beginnings, and financial planning.
- Show one-card and three-card modes on the same page.
- The optional question has a 120-character limit.
- The raw question is not saved by default.
- The primary action creates the server session before navigation.

### 3.3 Draw

- Desktop uses the approved fan of card backs.
- Mobile uses a touch-sized, horizontally scrollable half-fan.
- A selected card preserves its shape and color, lifts slightly, then moves to its slot.
- Three-card mode fills Past, Present, and Future in order.
- One-card mode fills one Guidance slot.
- Cards remain face down until every required slot is filled.
- The user selects a position in a server-shuffled deck; the client never decides card identity or orientation.
- Restart creates a new session and does not mutate the completed draw.

### 3.4 Reveal and result

- Reveal cards in slot order and visibly rotate reversed cards.
- Desktop uses the approved centered reading stage with three bracelet choices in one row.
- Mobile shows the three cards first and all three bracelet choices vertically; recommendations are not hidden behind a carousel.
- The result includes a concise interpretation, primary/support/accent colors, materials, wrist size, and authoritative price.
- Actions are Save, Select Design and Enter DIY, and low-priority Redraw.

## 4. Source and isolation strategy

The authorized upstream snapshot remains at `prototypes/tarot-upstream`. It is not a pnpm workspace and no production module imports from it.

Runtime code is adapted into Mystcrag-owned boundaries:

- `packages/tarot-engine`: pure deck, spread, selection, orientation, and mapping logic.
- `apps/backend/src/modules/tarot`: authentication, session lifecycle, persistence, recommendation orchestration, and public mappers.
- `apps/frontend/src/features/tarot`: Mystcrag routes, components, state adapters, and responsive interactions.
- `apps/frontend/public/tarot/cards`: the reviewed runtime card assets.

The upstream Next.js application, navigation, premium page, styles, and Zustand session authority are not embedded into Mystcrag. Useful domain code is ported with provenance comments where a file retains substantial upstream structure. The upstream `Math.random` shuffle is not used in production.

The recorded upstream commit is `e4d3a20265dd8a8b7e14e9ec980685fe20a79040`. Written authorization evidence is a release gate for public/commercial deployment, not a blocker for local integration work authorized by the project owner.

## 5. Tarot engine

`@mystcrag/tarot-engine` is a pure TypeScript package with no React, Fastify, Prisma, filesystem, or network dependency.

It owns:

- the 78-card identifiers and localized metadata;
- `SINGLE` and `PAST_PRESENT_FUTURE` spreads;
- injected random-byte selection and Fisher-Yates shuffle;
- unique position selection;
- upright/reversed orientation;
- versioned card-to-design tags;
- validated public and private session schemas.

Randomness is injected behind a small interface. Production uses Node cryptographic randomness. Tests use a deterministic fake. The engine never formats AI prose or queries products.

Card data contains only identifiers, names, keywords, and design tags. Long interpretation prose remains versioned content outside the core draw algorithm.

## 6. Recommendation pipeline

The pipeline is rule-first and AI-second:

1. Convert each revealed card and orientation to structured design tags.
2. Derive a color story.
3. Score active catalog products using authoritative catalog data.
4. Generate three distinct, valid bracelet candidates through the existing design orchestration.
5. Price each candidate through the existing pricing service.
6. Ask the AI layer to write concise reflective copy from the validated structured result.
7. Validate and compliance-check AI output; use deterministic fallback copy when AI is unavailable or invalid.

For three cards:

- Present supplies the primary color and strongest design intent.
- Past supplies the supporting color and stabilizing material tags.
- Future supplies the accent color and contrast tags.

For one card, the card supplies the primary direction and the engine adds a catalog-derived neutral support and restrained accent.

Material scoring uses:

- 40% color match;
- 25% visual/style tag match;
- 15% selected theme match;
- 10% current availability;
- 10% saved budget preference when available.

If no budget preference exists, budget is not a hard filter. Prices remain authoritative and visible.

The three generated directions are intentionally distinct:

1. balanced primary/support/accent distribution;
2. stronger contrast and focal-bead emphasis;
3. lighter neutral-led interpretation.

Every candidate uses active sellable SKUs, has a valid sequence, and targets a saved wrist size when available. Otherwise it targets 15.5 cm. Completion remains blocked outside the existing 13–20 cm guardrail.

AI cannot choose the drawn card, orientation, product price, inventory, or final component sequence. It only writes bounded explanation text.

## 7. Persistence model

Add these enums:

- `TarotSpreadType`: `SINGLE`, `PAST_PRESENT_FUTURE`.
- `TarotSessionStatus`: `DRAWING`, `DRAWN`, `RECOMMENDED`, `SAVED`, `ABANDONED`.
- `DesignMode.TAROT_GUIDED`.

Add `TarotSession`:

- `id`, `ownerId`, `spreadType`, `theme`, `status`;
- `stateRevision` for optimistic concurrency;
- `deckVersion`, `ruleVersion`;
- server-only `privateDeckState` JSON;
- validated `drawSnapshot` JSON;
- nullable validated `recommendationSnapshot` JSON;
- nullable `questionCiphertext` and `questionSavedAt`, populated only after explicit opt-in;
- nullable `selectedDesignId`;
- nullable `parentSessionId` for redraw lineage;
- timestamps.

Add `TarotDesignRecommendation`:

- `id`, `sessionId`, `designId`, `rank`, `createdAt`;
- unique `(sessionId, rank)` and `(sessionId, designId)` constraints;
- restrictive foreign keys to the session and existing design.

`User` gains a Tarot session relation and `Design` gains a Tarot recommendation relation.

The optional raw question is not persisted unless the user explicitly enables question saving. In the default path, the frontend submits it only to the recommendation request, backend logs redact it, and the service does not write it. If saving is enabled, the value is application-encrypted and never returned in list responses.

Session JSON is validated on every repository read and write. Public mappers never expose private deck order, encryption material, hidden prompt content, costs, or inventory quantities.

## 8. API contract

All Tarot routes require the existing verified bearer authentication and owner scoping. They use the existing error envelope.

### `POST /api/tarot/sessions`

Request: spread type and theme.
Response: public session identifier, status, revision, spread slots, and card-back asset metadata.

The service shuffles a complete deck once and stores private deck state. It does not reveal card identities.

### `POST /api/tarot/sessions/:id/select`

Request: slot, displayed position, expected revision, and client operation ID.
Response: accepted slot, selected count, completion flag, and new revision.

The route rejects duplicate physical positions and out-of-order slots. Retrying the same operation ID is idempotent.

### `POST /api/tarot/sessions/:id/reveal`

Request: expected revision.
Response: all revealed cards, orientations, localized metadata, and new revision.

It requires every spread slot to be selected. Repeated reveal requests return the existing reveal.

### `POST /api/tarot/sessions/:id/recommendations`

Request: optional question, `saveQuestion`, locale, currency, and expected revision.
Response: interpretation, color story, material recommendations, and three `PublicDesignV1` values.

Generation is idempotent for one session and rule version. Retries return the existing linked designs rather than creating duplicates.

### `GET /api/tarot/sessions/:id`

Returns the owner-scoped public projection required to restore setup, draw, reveal, or result state after refresh.

### `POST /api/tarot/sessions/:id/save`

Marks a recommended session saved and records the selected design when supplied. Existing design save and revision APIs continue to own bracelet persistence.

Restart uses `POST /api/tarot/sessions` with `parentSessionId`; completed sessions are immutable apart from Saved status and selected-design metadata.

## 9. State flow and ownership

```text
Browser -> authenticated Tarot API -> Tarot service
                                  -> tarot-engine
                                  -> Tarot repository
                                  -> active material catalog
                                  -> recommendation/design service
                                  -> pricing service
                                  -> AI prose adapter + compliance validation
```

The browser owns animation state only. Backend and database own session identity, deck order, selected positions, card identities, orientations, recommendations, design IDs, and prices.

Frontend route reloads always rehydrate from `GET /api/tarot/sessions/:id`. Local storage is not authoritative and does not store raw questions.

## 10. Error handling

Reuse the stable API error envelope and existing codes wherever possible:

- `UNAUTHORIZED` and `FORBIDDEN` for authentication and ownership;
- `VALIDATION_ERROR` for malformed themes, modes, slots, and question limits;
- `CONFLICT` for stale revision, duplicate position, invalid state transition, or out-of-order slot;
- `NOT_FOUND` for unavailable owner-scoped sessions;
- `INVENTORY_CHANGED` and `PRICE_CHANGED` during design generation;
- `COMPLIANCE_BLOCKED` for unsafe requested content;
- `INTERNAL_ERROR` for unexpected failures.

The UI shows inline recovery rather than large modal dialogs. Network failure keeps the selected animation visually pending until the server confirms it. A rejected selection returns the card to the fan. AI failure does not discard the draw or designs; deterministic interpretation copy is used.

## 11. Privacy, safety, and content rules

- Do not log bearer credentials, private deck state, raw questions, or AI provider prompts.
- Redact the optional question from request logs.
- Keep sessions owner-scoped and private.
- Treat AI provider output as untrusted and validate it before persistence or display.
- Convert medical, death, guaranteed-return, or deterministic prediction requests into bounded self-reflection language or block them when rewriting would be misleading.
- Do not claim crystal efficacy.
- Do not expose hidden reasoning or chain-of-thought.
- Public/commercial release requires documented rights for source code, card faces, card back, fonts, and any third-party imagery.

## 12. Feature flag and rollout

Add a backend Tarot feature flag and a matching server-rendered frontend flag. Both default off outside explicitly configured environments during development.

Rollout order:

1. engine and contracts;
2. additive database migration and repository;
3. backend session lifecycle;
4. deterministic recommendation integration;
5. frontend routes and responsive UI;
6. AI prose adapter and fallback;
7. end-to-end verification;
8. public-release rights review and flag enablement.

Disabling the flag hides the landing entry and rejects new session creation, while existing saved designs remain accessible through normal Design and DIY routes.

## 13. Testing and acceptance

### Unit

- deterministic shuffle under injected test randomness;
- 78 unique cards and no duplicate draw;
- upright/reversed generation;
- one-card and three-card slot rules;
- no reveal before completion;
- tag, palette, and weighted material scoring;
- AI fallback and compliance rewriting.

### Contract and backend

- request/response schema validation;
- authentication and owner isolation;
- optimistic revision conflicts;
- idempotent select, reveal, and recommendation requests;
- immutable completed draw state;
- three linked designs using active SKUs and authoritative prices;
- raw question absent from persistence and logs by default;
- additive migration constraints and repository JSON validation.

### Frontend

- three equal landing entries and unchanged AI/DIY navigation;
- setup validation and privacy copy;
- mouse, touch, and keyboard card selection;
- selected card does not change shape or color;
- desktop fan and mobile half-fan remain inside the viewport;
- reveal animation respects reduced-motion settings;
- all three result designs are visible and selectable;
- sticky mobile actions do not cover content;
- entering DIY loads the selected real design.

### End to end

Test at 1440×1024 and 390×844:

- single-card complete flow;
- three-card complete flow with at least one reversed card fixture;
- refresh during draw and on result;
- redraw creates a new session;
- AI failure fallback;
- price/inventory conflict recovery;
- Tarot design editing, save, export, and completion;
- existing AI Design and direct DIY regression flows.

The final handoff requires the narrow package checks, database tests, frontend/backend tests, browser flows, and `pnpm validate` to pass with fresh evidence.

## 14. Non-goals for the first integration

- Celtic Cross, pentagram, daily-card history, multiplayer, social sharing, payments, subscriptions, or the upstream premium page.
- A Tarot content-management UI.
- User-selectable deck artwork.
- Deterministic future predictions.
- Importing the upstream visual theme or embedding the upstream application as an iframe.
