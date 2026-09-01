# M0 Product, Competitor and Cross-platform Audit

**Task:** TASK-AUDIT-002
**Owner:** SOL
**Audit baseline:** `main` at `2abfdfe76df3302f2c9ae88cfa749832b71e2578`
**Observed:** 2026-08-31
**Status:** `REVIEW`
**Auth posture:** implementation complete and frozen; production acceptance remains deferred by Product Owner

> **玄矶当前第一产品目标：将 Mystcrag 的水晶手串 DIY 操作体验、移动端体验和视觉体验提升至当前成熟同类产品水平或以上，并通过 AI 设计能力形成进一步差异化。**

## Product authority and evidence policy

The Human Product Owner's controlling competitor authority for this audit is:

- **Conversation title:** `玄矶 DIY 系统需求分析`
- **Conversation ID:** `6a8ac667-ebb4-83ea-99f9-bb5b267dd97a`

That conversation fixes the direct-competitor set, priority order, experience-level rubric and product direction. It supersedes the earlier audit Agent's self-selected general configurators. The formal matrix therefore uses exactly six competitors: Qi Yi Crystal, 养个石头, 盘个串串, 良旺手作, Lucid Beads and BeadDIY. Beadaro is a different product and is not BeadDIY.

Evidence labels used below:

| Label | Meaning |
| --- | --- |
| `PO-AUTHORITY` | Human Product Owner's controlling synthesis in the named conversation; authoritative for Mystcrag scope and priorities |
| `PUBLIC-CORROBORATED` | a current official site, app-store listing or brand-owned product page supports the named capability |
| `BRAND-CLAIM` | a vendor/brand statement not independently replayed as an end-to-end product fact |
| `REPOSITORY` | verified in Mystcrag source, routes, contracts or tests at the audit baseline |
| `NOT-REPLAYED` | the current audit did not complete the competitor interaction itself; do not treat the claim as observed behavior |

Vendor pages establish public positioning and advertised capability, not conversion quality, performance, fulfillment quality or independent product ratings. Any stars in the Product Owner conversation are relative internal analysis only and are not third-party ratings; this report uses L0–L4 and parity labels instead.

## Method and evidence limits

The repository audit inspected production routes, composition roots, feature components, API clients, package boundaries, persistence models and current tests under the required frontend, backend, Database, Design Contract, Design Engine, Bracelet Engine, Three Engine, AI Agent and governance paths.

`agent-reach` and its Exa backend were unavailable in this environment. The available Web client was used only to corroborate the Product Owner-defined competitors; it did not redefine the set. Direct current sources were available for Qi Yi Crystal, Lucid Beads, BeadDIY, 养个石头, 盘个串串 and 良旺手作, but several domestic product details remain `PO-AUTHORITY / BRAND-CLAIM / NOT-REPLAYED` because their complete in-app flows were not accessible in this audit.

A local mock frontend started successfully, but both permitted desktop-browser paths blocked or timed out on the local origin. Consequently visual-quality and bead-realism levels are conservative code/asset assessments, not screenshot-level visual certification. The first UX worker must capture accepted desktop/mobile states before and after implementation.

## Current product reality

Mystcrag has a real product loop:

```text
Home -> AI questionnaire or direct DIY -> recommendation/result -> 2D editor
     -> explicit save/revision -> immutable order snapshot
```

It stops before a commercial loop because checkout/payment, shipping, fulfillment, durable customer profile data, public sharing and production deployment acceptance are incomplete.

### Verified DIY code facts

- `apps/frontend/src/features/design/components/diy-editor.tsx` is 1,275 lines and contains **exactly 25 `React.useState` hooks concentrated in `DiyEditor`**.
- `FlatBraceletEditor` already supports pointer dragging, native drag fallback, angle-to-slot placement, drag-out removal, keyboard left/right movement and keyboard deletion.
- Design Contract already defines `ADD_COMPONENT`, `MOVE_COMPONENT`, `REMOVE_COMPONENT` and `REPLACE_COMPONENT` operations.
- Bracelet Engine already owns renderer-independent ring layout, slot resolution, geometry and fit calculations.
- `DiyEditor.applyUpdate` sets `isUpdating`, calls the server, then replaces the visible design. Structural controls are disabled while each request is in flight.
- Undo/redo operations exist but are memory-only and each history action is another server update.
- Twenty photographic bead mappings and four tray materials already exist. Their source presence is verified; screenshot-level realism parity is not.
- The workbench exposes hand/wrist data, calculated design circumference, bead count, server-authoritative total price, catalog search/filter, mobile sheets and explicit save.

These facts distinguish a missing architecture authority from a user-facing execution gap: the operation and geometry contracts are sufficient for the next Web UX task, while immediate preview, insertion feedback, nonblocking persistence, recovery communication and visual/mobile polish remain below L3.

## Formal competitor set

All public sources were accessed 2026-08-31. Capabilities not directly corroborated are explicitly labeled rather than promoted to verified facts.

| Competitor | Formal role | Product baseline fixed by Product Owner | Evidence status |
| --- | --- | --- | --- |
| **Qi Yi Crystal** | First priority; closest AI/personalization-to-commerce competitor | Kiki AI, BaZi/Zodiac/Life-Path entry, DIY Builder, 2D/3D, live price, save and checkout | `PO-AUTHORITY`; [official site](https://qiyicrystal.com/en) corroborates Kiki, BaZi/personalization, tap/drag Builder, live price and direct order. The 2D/3D and save details were not independently replayed this turn |
| **养个石头** | First priority; realism and low-learning-cost mobile DIY benchmark | natural-material realism, direct mobile manipulation, drag-based creation and simple entry | `PO-AUTHORITY`; [brand-owned public video](https://www.douyin.com/video/7576186557300883130) advertises free dragging and 100+ natural-material categories; visual/interaction quality was not independently replayed |
| **盘个串串** | First priority; multi-ring and design-ecosystem benchmark | single/multiple rings, design plaza, UGC and adopt/Fork behavior | `PO-AUTHORITY`; [App Store](https://apps.apple.com/cn/app/%E7%9B%98%E4%B8%AA%E4%B8%B2%E4%B8%B2/id6753885752) and [official download page](https://pgcc.shanweish.com/) corroborate an active mobile DIY product. Multi-ring/plaza/Fork details remain not independently replayed |
| **良旺手作** | Specialist benchmark for workbench information and purchase closure | size, circumference, quantity, price, accessories and DIY-to-order loop | `PO-AUTHORITY`; [brand Bilibili page/video](https://www.bilibili.com/video/BV1GZDLB4EZF/) corroborates the WeChat DIY product and customer-designed item narrative. Detailed workbench feedback remains not independently replayed |
| **Lucid Beads** | Specialist international experience benchmark | Intentions, Compose and Freestyle layers; live 3D, Save/Load/Clear, Remix and Add to Cart | `PO-AUTHORITY`; [official FAQ](https://www.lucidbeads.com/faq/) corroborates the three creation layers and Remix; [Compose](https://www.lucidbeads.com/compose/) corroborates live 3D, size, price, Clear and Add to Cart |
| **BeadDIY** | Specialist White Label business-model benchmark | merchant catalog, variants, stock, price, customer design, orders, AI assistance and Shopify checkout | `PO-AUTHORITY`; [Shopify App Store](https://apps.shopify.com/beaddiy) directly lists these merchant/customer capabilities. It is a vendor listing with limited marketplace review evidence, not independent quality validation |

### Formal priority

1. **Qi Yi Crystal** — AI/personalization -> DIY -> checkout continuity.
2. **养个石头** — real beads, direct touch and low learning cost.
3. **盘个串串** — multi-ring, design plaza, UGC and Fork ecosystem.

Specialist benchmarks:

- **Lucid Beads:** international product quality, layered creation, live 3D and Remix.
- **良旺手作:** persistent workbench information and transaction closure.
- **BeadDIY:** White Label merchant catalog and Shopify business model.

The target is not to copy any product:

```text
养个石头的真实和简单
+ 盘个串串的设计生态
+ 良旺手作的信息反馈
+ Lucid Beads 的设计分层和 3D
+ Qi Yi Crystal 的 AI／个性化入口
+ BeadDIY 的 White Label 能力
+ 玄矶自己的 AI Copilot 和东方高级珠宝视觉
```

### Supporting references — not formal competitors

- **珠了个珠:** supporting reference for content acquisition and distribution of the design process.
- **普通白牌源码:** supporting evidence that basic DIY, catalog, price and ordering capability is becoming commoditized and that White Label differentiation cannot be “a builder exists.”

Supporting references never enter formal parity averages and never receive the same priority as the six competitors.

### Removed from the formal matrix

Pandora, Kendra Scott, Nike By You, Zakeke, Ruby Kinglet and Beadaro are removed. They are not used as formal direct-competitor evidence, and no cross-industry appendix is retained in this M0 report. **Beadaro is not BeadDIY.**

## Experience-level rubric

| Level | Definition |
| --- | --- |
| `L0 — Missing` | no usable product path |
| `L1 — Functional` | capability exists but the workflow/feedback is incomplete |
| `L2 — Usable` | users can complete the task with understandable controls |
| `L3 — Market Competitive` | interaction, mobile, visual and feedback quality meet mature direct competitors |
| `L4 — Differentiated` | meaningfully exceeds ordinary competitors through product quality or AI |

`Parity` is the audit's relative analysis: `Below`, `Equal` or `Above`. It is not a third-party score.

## Competitor Experience Matrix

The `Competitor Baseline` column aggregates the six formal roles; it does not imply every competitor supports every feature.

| Dimension | Competitor Baseline | Mystcrag Current | Gap | Priority | Experience Level / Parity | Evidence | Recommended Task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DIY entry speed | Qi Yi offers personalized and free-form entry; 养个石头 emphasizes direct mobile DIY; Lucid layers Intentions/Compose/Freestyle | home exposes AI and direct DIY, but mode progression is not yet one continuous editor journey | clarify “start simple, deepen later” and resume state | P0 | `L2 / Below` | `PO-AUTHORITY`; `REPOSITORY` routes and home CTAs | **TASK-FE-002** |
| Bead material realism | 养个石头 is the realism benchmark; Qi Yi/Lucid sell natural-material confidence | 20 photographic mappings and tray assets exist; current-run visual parity unavailable | prove texture, transparency, inclusions, scale and consistency on real viewports | P0 | `L2 / Below` | `PO-AUTHORITY`; `REPOSITORY`; screenshot gate blocked | TASK-ASSET-003 after FE-002 capture baseline |
| Add / insert | mature builders make the insertion location obvious with immediate feedback | click adds after selected bead; result appears after server response | insertion preview, travel/snap feedback and nonblocking continuation | P0 | `L2 / Below` | `REPOSITORY` `addMaterial` + `applyUpdate` | **TASK-FE-002** |
| Drag / reorder | 养个石头/盘个串串/Lucid establish direct manipulation as table stakes | pointer/keyboard reorder works and angle resolves to a slot; surrounding beads do not preview displacement before commit | lifted state, insertion marker, live reflow, cancel and snap without waiting for server | P0 | `L2 / Below` | `PO-AUTHORITY`; `REPOSITORY` `FlatBraceletEditor` | **TASK-FE-002** |
| Delete / replace | direct selection should expose lightweight remove/replace | both exist with drag-out and selected-bead controls, but every action blocks on server | immediate reversible feedback and clearer selected action state | P0 | `L2 / Below` | `REPOSITORY` remove/replace handlers | **TASK-FE-002** |
| Whole-bracelet rotation | Lucid live 3D and direct competitors establish freely inspectable jewelry | connected/spread toggle exists; no production whole-ring rotation control | add touch-safe 2D inspection rotation without changing sequence; 3D remains separate | P1 | `L0 / Below` | `PO-AUTHORITY`; `REPOSITORY` no production rotation state | TASK-FE-002 if bounded; otherwise TASK-3D-001 |
| Undo / Redo | mature creation tools make experiments safe | real bounded undo/redo exists but is memory-only and server-bound | preserve immediate continuity, communicate pending/failure, recover current session | P0 | `L2 / Below` | `REPOSITORY` 50-entry stacks and `runHistory` | **TASK-FE-002** |
| Save / Load / Refresh recovery | Qi Yi/Lucid support saved designs; Lucid supports Load; continuity is expected | server design load/save exists; local history and intermediate intent disappear on refresh | explicit saved/syncing/failed/recovered state and safe refresh recovery | P0 | `L1 / Below` | `PO-AUTHORITY`; `REPOSITORY` save/load/history | **TASK-FE-002** |
| Wrist feedback | Qi Yi, 良旺 and Lucid keep sizing near design decisions | target wrist, measurement guide and fit message exist | make wrist and actual design length continuously legible on mobile | P1 | `L2 / Equal` | `PUBLIC-CORROBORATED`; `REPOSITORY` wrist inspector/fit | TASK-FE-002 |
| Design length | 良旺 and Lucid expose size/length while composing | circumference is calculated and used in fit feedback but is not consistently prominent | persistent, quiet design-length indicator | P1 | `L2 / Below` | `PO-AUTHORITY`; `REPOSITORY` `calculateBraceletCircumferenceMm` | TASK-FE-002 |
| Bead count | 良旺-style workbench keeps quantity visible | desktop/mobile views show current bead count | consolidate with wrist/length/price rather than scatter it | P1 | `L2 / Equal` | `PO-AUTHORITY`; `REPOSITORY` count labels | TASK-FE-002 |
| Real-time price | Qi Yi, 良旺, Lucid and BeadDIY connect choices to price | authoritative total and unit prices update after every accepted server operation | retain authority while showing immediate pending estimate/state without fabrication | P0 | `L3 / Equal` | official Qi Yi/Lucid/BeadDIY sources; `REPOSITORY` pricing | TASK-FE-002 |
| Search / filter | larger catalogs require fast narrowing by material/color/size | query, product type, category, color and diameter filters exist | mobile discoverability, favorites/recent and result feedback require product validation | P1 | `L2 / Equal` | `REPOSITORY` catalog filters | TASK-FE-002 |
| 2D presentation | direct competitors prioritize legible, tactile bead placement | size-aware photographic 2D editor is production | visual parity, insertion feedback and export parity are unproven | P0 | `L2 / Below` | `REPOSITORY`; screenshot gate blocked | TASK-FE-002 then TASK-ASSET-003 |
| 3D presentation | Qi Yi and Lucid use 3D as inspection/experience benchmark | Three Engine exists but is not mounted in production | lifecycle, mobile performance, fallback and parity proof | P2 | `L0 / Below` | `PO-AUTHORITY`; official Lucid; `REPOSITORY` lifecycle | TASK-3D-001 |
| Animation feedback | mature DIY should show lift, insert, reflow, snap and reversible state change | CSS transitions and dragged bead movement exist; no complete insertion/reflow sequence before server commit | interruptible 150–350ms product feedback and reduced-motion behavior | P0 | `L1 / Below` | `PO-AUTHORITY`; `REPOSITORY` transition/commit paths | **TASK-FE-002** |
| Mobile operation | 养个石头 and 盘个串串 set direct mobile expectations | dedicated mobile sheet and 44px controls exist; network-bound gestures and dense state remain | prevent scroll conflict, preserve canvas, shorten actions and keep feedback visible | P0 | `L2 / Below` | `PO-AUTHORITY`; `REPOSITORY` mobile layout | **TASK-FE-002** |
| Visual luxury | direct competitors compete on natural material confidence; Mystcrag target is Eastern fine jewelry | ivory/purple editorial direction and photographic assets exist | screenshot-verified hierarchy, quiet density, material dominance and state completeness | P0 | `L2 / Below` | `PO-AUTHORITY`; `REPOSITORY`; visual capture blocked | TASK-FE-002 baseline/polish, TASK-ASSET-003 assets |
| AI recommendation | Qi Yi's Kiki/personalization and Lucid Intentions establish guided design | questionnaire produces three grounded, deterministic catalog-backed designs | improve explanation/entry continuity; current structured authority is strong | P1 | `L3 / Equal` | official Qi Yi/Lucid; `REPOSITORY` recommendation path | TASK-AI-002 after FE-002 |
| AI continuous modification | Product Owner sets AI Copilot as Mystcrag's L4 differentiator | optimize/suggest actions exist; no multi-turn “keep hero bead / under budget / add purple” modification | grounded language-to-operation loop with undo and visible rationale | P1 strategic | `L1 / Below` | `PO-AUTHORITY`; `REPOSITORY` optimize/suggest | TASK-AI-002 |
| Community / Remix / Fork | 盘个串串 and Lucid validate design plaza/remix behavior | backend publication boundary exists; no public feed/share/Fork UX | privacy-safe versioned public projection, attribution, moderation and clone flow | P1 | `L1 / Below` | `PO-AUTHORITY`; official Lucid; `REPOSITORY` publication | TASK-SHARE-001 |
| Checkout / order closure | Qi Yi, 良旺, Lucid and BeadDIY connect design to purchase | immutable order snapshot exists; no address, tax, shipping, payment or fulfillment | commerce contract and provider decisions | P0 commercial / deferred | `L1 / Below` | official sources; `REPOSITORY` order snapshot | TASK-COMMERCE-001 |
| White Label | BeadDIY exposes catalog/variant/stock/price/design/order/AI through Shopify | no Tenant, Brand, Theme, hostname or catalog isolation | tenancy/security/configuration architecture after Mystcrag UX stabilizes | P2 | `L0 / Below` | official Shopify listing; `REPOSITORY` schema/config scan | TASK-WL-001 |

## Largest gap to L3

The largest **actionable and repository-verified** gap is the quality of the core DIY interaction on mobile: a gesture can be performed, but the user does not receive mature immediate insert/reflow/snap feedback and must wait for a server round trip before the editor settles. Save/recovery communication and persistent workbench feedback are part of the same experience gap.

Bead realism and visual luxury may be equally important to perceived quality, but the current browser-capture blocker prevents an evidence-backed claim that a specific asset/rendering fix is the single largest gap. The first worker must establish current screenshots before making visual changes; it may polish rendering with existing assets but may not replace unreviewed asset sources.

## First-Worker reassessment

### Answers to the six gating questions

1. **Largest gap to L3:** direct-manipulation feedback and mobile editing continuity, followed closely by screenshot-unverified bead realism/visual polish.
2. **Are Design Contract and Bracelet Engine sufficient?** Yes for the first UX task. The contract already provides the exact edit operations; Bracelet Engine already provides layout, fit and slot resolution.
3. **Are request-bound editing, memory-only history and state concentration the first bottom-layer blocker?** Request-bound editing and memory-only history are direct UX defects. The 25-hook concentration is a maintainability risk. None requires a new workspace package before a scoped Web improvement.
4. **Is TASK-CORE-001 the minimum necessary prerequisite?** No. Creating a new shared package first would delay the highest-priority user-visible work and would prematurely freeze abstractions before the competitive interaction is proven.
5. **Core causality decision:** the chain stops at existing Contract/Engine capability; the missing link is the Web interaction adapter, not a missing geometry or command contract.
6. **Selected first Worker:** **Qwen — TASK-FE-002 Competitive DIY Interaction and Mobile Feedback**.

TASK-CORE-001 is withdrawn as the first Worker and is no longer a `PROPOSED` dispatch. No `packages/diy-session-core` importer or `pnpm-lock.yaml` change is authorized. A later cross-platform extraction decision must be based on the accepted Web interaction model; it is not started here.

### Evidence chain for Qwen

```text
Competitor authority
养个石头: direct, low-learning-cost mobile manipulation
Qi Yi: AI/free-form entry -> live price -> order
Lucid: layered creation + live 3D + save/remix/cart
良旺: wrist/length/count/price information at the workbench
        |
        v
Repository facts
operation DTOs + Bracelet Engine geometry/slot/fit already exist
FlatBraceletEditor already handles pointer and keyboard movement
DiyEditor has exactly 25 React.useState hooks
every committed edit sets isUpdating and waits for designApi.update
history is memory-only; visual state settles after server response
        |
        v
Smallest user-facing intervention
frontend-only optimistic preview/reconciliation adapter
lift/insertion/reflow/snap/cancel feedback
nonblocking syncing/failed/recovered state
mobile wrist/length/count/price strip and focused controls
        |
        v
Expected outcome
move direct editing/mobile/animation/recovery from L1/L2 toward L3
without changing Design Contract, Bracelet Engine, backend, database or Auth
```

## Cross-platform decision

| Boundary | Authority | Decision |
| --- | --- | --- |
| Web shell | Next.js, React, responsive components | Web-only |
| Shared API contract | Design Contract DTOs/operations/error envelope | sufficient for TASK-FE-002 and portable across transports |
| Bracelet geometry/layout | Bracelet Engine | canonical, already portable |
| Web interaction adapter | `DiyEditor`, `FlatBraceletEditor`, frontend model/API client | first improvement target |
| Web identity | Auth0 Next.js BFF secure-cookie session | frozen Web adapter |
| Future WeChat identity | future provider adapter -> canonical `User` + `ExternalIdentity` | separate later task; not started |
| Web storage/navigation/rendering | browser storage, Next navigation, DOM/Canvas/WebGL | platform adapter only |
| Mini Program equivalents | future `wx` request/storage/navigation/rendering | wait until accepted product interaction is stable |

This reverses the earlier premature sequence. Mystcrag should first prove an excellent Web experience, then extract the stable behavior needed by another platform. It must not duplicate domain invariants or rewrite Web Auth.

## AI, 3D, White Label and backend/data posture

- **AI:** production recommendations are deterministic and catalog-grounded. Continuous language-driven modification is an L4 differentiator, but it follows a stable L3 editor.
- **3D:** Three Engine is implemented but not production-mounted. It remains `EXPERIMENTAL` and P2; 2D/mobile interaction is first.
- **White Label:** no tenant/brand/theme/catalog-isolation model exists. BeadDIY proves commercial pressure, not permission to add tenancy before Mystcrag's core experience is strong.
- **Backend/data:** price, stock, ownership and revision authority are sound. Commercial checkout, durable profile/address/favorites and public sharing remain separate contract-led tasks.
- **Auth:** all FEAT-018 implementation and `User`/`ExternalIdentity` semantics remain frozen.

## Prioritized backlog

### P0 — blocks the next user-experience or commercial milestone

#### TASK-FE-002 — Competitive DIY Interaction and Mobile Feedback

- **Evidence:** the matrix places add/insert, drag/reorder, animation, mobile operation and refresh recovery below L3; existing operation and geometry contracts are sufficient, while the UI settles only after request completion.
- **User impact:** removes the most frequent manipulation delay and makes edits, failures and recovery understandable on mobile.
- **Architecture impact:** adds a frontend-only optimistic projection/reconciliation boundary; server authority and shared contracts remain unchanged.
- **Dependencies:** TASK-AUDIT-002 accepted; current desktop/mobile states captured before changes.
- **Execution owner:** FRONTEND / Qwen. Qwen is the sole execution owner; SOL performs Review and Integration and does not share task ownership.
- **Suggested Task ID / branch:** `TASK-FE-002` / `task/fe-002-competitive-diy-experience`.
- **Writable paths:** the exact frontend files in the dispatch package below, the exact TASK-FE-002 row in `docs/tasks/TASK_REGISTRY.md`, and the exact FEAT-004 row in `docs/governance/FEATURE_REGISTRY.md`.
- **Forbidden paths:** backend, packages, root tests, assets, Prisma, dependencies/lockfile, CI/runtime, Auth and other features.
- **Acceptance criteria:** direct manipulation and recovery satisfy the dispatch's viewport, 20-gesture, failure/revision, accessibility and authority criteria.
- **Required tests:** frontend-local interaction/reconciliation/accessibility tests, existing design tests, architecture tests, `pnpm validate` and browser evidence.
- **Regression scope:** Design Contract operations, Bracelet Engine semantics, server price/inventory/revision authority, save/export/order snapshot and Auth-protected API behavior.

#### TASK-COMMERCE-001 — Checkout and Fulfillment Contract

- **Evidence:** the current order path ends at an immutable snapshot; address, tax, shipping, payment, reservation, fulfillment and refund states are absent.
- **User impact:** a real purchase cannot be completed.
- **Architecture impact:** defines a serial commerce state machine and provider boundaries before schema/API/UI work.
- **Dependencies:** Product Owner payment, shipping, tax and fulfillment policy; provider selection; deployment acceptance before production launch.
- **Owner:** SOL contract task, followed by separately owned workers.
- **Suggested Task ID / branch:** `TASK-COMMERCE-001` / `task/commerce-001-checkout-fulfillment-contract`.
- **Writable paths:** exact commerce, API, database, security, privacy, rollback and governance documents only for the contract phase.
- **Forbidden paths:** runtime, schema/migrations, dependencies, Auth and payment integration until the contract is approved.
- **Acceptance criteria:** authoritative state transitions, idempotency, inventory reservation, totals, cancellation/refund and PII boundaries are approved.
- **Required tests:** contract examples and architecture/path validation in the contract phase; implementation tests belong to later tasks.
- **Regression scope:** immutable design/order snapshot, price authority, identity ownership and auditability.

### P1 — high-value product experience

#### TASK-ASSET-003 — Bead Realism and Visual Parity

- **Evidence:** 养个石头 is the Product Owner's realism benchmark; 20 photographic mappings exist, but screenshot-level parity was not verifiable in this run.
- **User impact:** material trust and luxury perception directly affect design confidence and purchase intent.
- **Architecture impact:** preserves the renderer/asset boundary and requires provenance rather than changing domain semantics.
- **Dependencies:** accepted FE-002 before/after screenshots and approved asset provenance/licensing.
- **Owner:** FRONTEND + ASSET, SOL review.
- **Suggested Task ID / branch:** `TASK-ASSET-003` / `task/asset-003-bead-realism-parity`.
- **Writable paths:** exact approved design rendering components, owned runtime assets, asset registry/provenance evidence and task-local visual tests.
- **Forbidden paths:** Design Contract, Bracelet Engine geometry, backend, schema, Auth and unlicensed competitor media.
- **Acceptance criteria:** representative transparent/opaque/inclusion-rich beads retain scale, lighting and identity across mobile/desktop without copied competitor assets.
- **Required tests:** visual regression evidence, missing-asset fallback, responsive rendering and `pnpm validate`.
- **Regression scope:** SKU-to-asset mapping, export/preview consistency, accessibility and load performance.

#### TASK-SHARE-001 — Versioned Design Share, Remix and Fork Contract

- **Evidence:** 盘个串串 and Lucid establish design-ecosystem/Remix expectations; Mystcrag has a backend publication boundary but no public projection, feed, share link or Fork UX.
- **User impact:** designs cannot reliably travel to another person/device or seed a creator ecosystem.
- **Architecture impact:** defines privacy-safe immutable/versioned public DTOs, attribution, moderation and clone boundaries.
- **Dependencies:** Product Owner privacy, moderation, attribution and discoverability policy.
- **Owner:** SOL contract, followed by BACKEND/FRONTEND workers.
- **Suggested Task ID / branch:** `TASK-SHARE-001` / `task/share-001-public-design-contract`.
- **Writable paths:** exact Design Contract, public API/privacy/moderation and governance documents for the contract phase.
- **Forbidden paths:** Auth topology, private-design projection, runtime/schema changes before contract approval.
- **Acceptance criteria:** public/private rules, stable links, version/Fork lineage, attribution, reporting and deletion semantics are approved.
- **Required tests:** contract examples, authorization matrix and later API/E2E coverage.
- **Regression scope:** private design ownership, immutable revisions, user deletion and order snapshots.

#### TASK-AI-002 — Grounded Continuous Design Modification

- **Evidence:** Qi Yi's guided entry and the Product Owner's Mystcrag Copilot target exceed the current one-shot recommendation and optimize/suggest actions.
- **User impact:** users can express iterative constraints such as retaining a hero bead, changing color or staying under budget without losing precise control.
- **Architecture impact:** converts grounded language intent into existing Design Contract operations; SKU, fit, price and inventory stay authoritative.
- **Dependencies:** accepted FE-002 interaction model, provider/privacy/cost policy and an approved evaluation set.
- **Owner:** AI / GLM, with a separately owned frontend consumer.
- **Suggested Task ID / branch:** `TASK-AI-002` / `task/ai-002-grounded-design-refinement`.
- **Writable paths:** exact AI schemas/providers/evals, approved adapter and AI controlling documents.
- **Forbidden paths:** Auth, Bracelet geometry, price/inventory authority, free-form unvalidated writes and unrelated frontend refactors.
- **Acceptance criteria:** every proposal cites intent/constraints, resolves to valid operations, is previewable/reversible and refuses unsupported claims.
- **Required tests:** grounded-operation evals, hallucination/constraint failures, privacy/cost limits and integration tests.
- **Regression scope:** recommendation determinism, catalog grounding, fit and authoritative commerce data.

#### TASK-DATA-002 — Durable Customer Profile Boundary

- **Evidence:** address, favorites, preferences and privacy settings are browser-local despite a canonical identity boundary.
- **User impact:** account data does not survive cross-device use and cannot safely support checkout or service.
- **Architecture impact:** separates durable customer data from Web storage with explicit PII lifecycle and deletion ownership.
- **Dependencies:** Product Owner profile/privacy decisions and the commerce contract's address ownership decision.
- **Owner:** SOL contract, then DATABASE/GLM implementation.
- **Suggested Task ID / branch:** `TASK-DATA-002` / `task/data-002-durable-customer-profile-contract`.
- **Writable paths:** exact profile, privacy, database and API controlling documents for the contract phase.
- **Forbidden paths:** Auth session topology, `User`/`ExternalIdentity` semantics, schema/runtime before approval.
- **Acceptance criteria:** field ownership, consent, retention, export/deletion and cross-device conflict policy are approved.
- **Required tests:** privacy lifecycle/authorization matrix and later database/API tests.
- **Regression scope:** identity mapping, tenant-independent ownership, browser-storage migration and deletion.

Cross-platform extraction is reconsidered only after FE-002 evidence; no task ID, package or abstraction is frozen now.

### P2 — deferrable architecture/product investments

#### TASK-3D-001 — 3D Lifecycle and Production-readiness Decision

- **Evidence:** Lucid provides a public live-3D benchmark; Mystcrag's tested Three Engine is not mounted in production and is WebGL-specific.
- **User impact:** richer inspection is valuable but does not precede a reliable mobile 2D creation loop.
- **Architecture impact:** either retains the adapter as experimental or promotes one bounded preview with fallback/performance budgets.
- **Dependencies:** accepted FE-002 experience and Product Owner ROI decision.
- **Owner:** THREE.
- **Suggested Task ID / branch:** existing `TASK-3D-001` / `task/3d-001-production-readiness-decision`.
- **Writable paths:** exact Three specification, Three Engine/frontend adapter evidence and lifecycle registry rows.
- **Forbidden paths:** Bracelet geometry semantics, Auth, commerce and unrelated editor rewrites.
- **Acceptance criteria:** lifecycle, fallback, device/performance budget and 2D/3D parity decision is evidence-backed.
- **Required tests:** Three Engine suite, visual/parity/performance evidence and fallback coverage.
- **Regression scope:** geometry, sequence, material mapping, low-capability devices and reduced motion.

#### TASK-WL-001 — White Label Tenancy Architecture Spike

- **Evidence:** BeadDIY exposes merchant catalog/variant/stock/price/design/order/AI through Shopify; Mystcrag has no tenant, brand, hostname or catalog isolation.
- **User impact:** no immediate consumer defect; a premature shortcut creates partner data/isolation risk.
- **Architecture impact:** defines tenancy, configuration, theming, asset/catalog and operator security boundaries before schema or UI work.
- **Dependencies:** a named partner/business model and security review.
- **Owner:** SOL.
- **Suggested Task ID / branch:** `TASK-WL-001` / `task/wl-001-tenancy-architecture-spike`.
- **Writable paths:** a new White Label architecture decision and exact governance rows only.
- **Forbidden paths:** schema/migrations, runtime tenancy, Auth rewrite, theme implementation and partner secrets.
- **Acceptance criteria:** isolation model, configuration ownership, hostname resolution, branding/catalog boundary and migration decision are approved.
- **Required tests:** threat/tenant-isolation matrix and later implementation tests.
- **Regression scope:** single-brand behavior, user identity, catalog/stock/price authority and operational access.

### Deployment-only gates

- real staging/production Origins and byte-exact Auth0 allowlists;
- approved same-region session lookup benchmark;
- real Auth0 login/logout smoke and production deployment evidence.

These gates do not block TASK-FE-002 and do not permit any Auth change.

## First Worker Dispatch Package

```text
TASK: TASK-FE-002
TITLE: Competitive DIY Interaction and Mobile Feedback
RECOMMENDED WORKER: Qwen
OWNER: FRONTEND / Qwen
BRANCH: task/fe-002-competitive-diy-experience
STATUS: PROPOSED — HUMAN PRODUCT OWNER MUST DISPATCH

OWNERSHIP BOUNDARY
- Qwen is the sole execution Owner.
- SOL performs Review and Integration only and does not share task ownership.

OBJECTIVE
Raise the existing Web DIY direct-manipulation, mobile feedback and editing
continuity from L1/L2 toward L3 Market Competitive using the existing Design
Contract operations and Bracelet Engine geometry. Do not build a new Core package.

DEPENDENCIES
- Repository baseline READY
- Governance commit 2abfdfe integrated
- Development Gate OPEN
- TASK-AUDIT-002 accepted by Human Product Owner
- Current visual states captured and accepted before UI changes

WRITABLE PATHS
- apps/frontend/src/features/design/components/diy-editor.tsx
- apps/frontend/src/features/design/components/flat-bracelet-editor.tsx
- apps/frontend/src/features/design/components/crystal-bead-image.tsx
- apps/frontend/src/features/design/model/bracelet-fit.ts
- apps/frontend/src/features/design/model/visual-assets.ts
- apps/frontend/src/features/design/model/optimistic-design.ts (new)
- apps/frontend/src/features/design/model/optimistic-design.test.tsx (new)
- apps/frontend/src/features/design/frontend-ai-flow.test.tsx
- apps/frontend/src/features/design/atelier-ui-contract.test.tsx
- exact TASK-FE-002 row in docs/tasks/TASK_REGISTRY.md
- exact FEAT-004 row in docs/governance/FEATURE_REGISTRY.md

IGNORED QA EVIDENCE OUTPUT — NOT A TRACKED SOURCE WRITABLE PATH
- output/playwright/task-fe-002/before/
- output/playwright/task-fe-002/after/
- output/playwright/task-fe-002/ is already covered by .gitignore and must
  contain only this task's raw screenshots and browser artifacts

FORBIDDEN PATHS
- apps/backend/** and every non-design frontend feature
- apps/frontend/public/** (no unreviewed asset replacement)
- docs/ui-references/**
- packages/** including Design Contract, Bracelet Engine and Three Engine
- tests/** outside the listed frontend feature tests
- Prisma/migrations, package manifests, pnpm-lock.yaml and CI/runtime config
- Auth implementation/contracts/tests
- .env, Secrets and generated output
- .gitignore
- repository-root screenshots or browser artifacts
- tracked screenshots or any other task's Playwright evidence

STAGE A — BASELINE CAPTURE
1. Before modifying any production file, start the current application.
2. Capture at least 390x844, 375x812, 430x932 and desktop.
3. Cover the DIY initial state, a selected bead, drag/insertion state, the
   mobile material panel, and the wrist/length/count/price information state.
4. Save all raw screenshots and browser artifacts under
   output/playwright/task-fe-002/before/.
5. Return a screenshot index, current-experience findings and git status.
6. Stop and wait for explicit Human Product Owner baseline acceptance.

Before explicit Human Product Owner approval, do not modify any production
file, implement optimistic updates, or adjust UI, animation or layout.

If browser capture remains blocked, do not skip the screenshot gate. Return
BLOCKED with startup logs, attempted URL, failure reason and the minimum
unblocking condition. Code inspection alone cannot support an L3 claim.

STAGE B — IMPLEMENTATION
Only after explicit Human Product Owner baseline approval may Qwen continue on
the same TASK-FE-002 branch and modify the tracked writable paths. Save the
corresponding final evidence under output/playwright/task-fe-002/after/ and
provide a one-to-one before/after comparison index. Do not commit screenshots
or raw browser artifacts.

ARCHITECTURE CONSTRAINTS
- reuse existing UpdateDesignOperation DTOs and Bracelet Engine slot/fit results
- backend remains price, inventory, ownership and revision authority
- optimistic UI must reconcile to the authoritative server design and roll back
  or expose a recoverable conflict; it must never fabricate price or stock
- do not create a global store, new workspace package or second Design schema
- keep Web storage/navigation/rendering behind the frontend boundary

FUNCTIONAL REQUIREMENTS
- dragged bead has clear selected/lifted state
- target insertion position is visible before release
- surrounding beads preview reflow and release snaps to the chosen slot
- pointer cancel and scroll conflict do not corrupt sequence
- add/remove/replace/undo/redo show immediate reversible local feedback
- syncing, saved, failed, conflict and recovered states are distinguishable
- refresh recovery preserves only the safe current Web editing intent and is
  discarded/reconciled when the server revision is incompatible
- mobile keeps bracelet first and shows wrist, design length, bead count and
  authoritative price without opening a secondary panel
- use existing photographic assets; no fake beads or new unproven imagery
- animation is interruptible, normally 150–350ms, and honors reduced motion

ACCEPTANCE CRITERIA
- 390x844 is the primary viewport; also verify 375x812, 430x932 and desktop
- 20 consecutive reorder gestures produce no sequence error, page-scroll theft,
  layout jump or visible request-bound freeze
- failed and stale-revision responses visibly reconcile without losing the last
  confirmed server design
- keyboard movement/delete and 44px targets remain usable
- add/move/remove/replace/undo/redo/save/refresh all retain server authority
- before/after screenshots and interaction evidence support the claimed L3 move
- no Auth, backend, database, package or asset-source changes

REQUIRED TESTS
- frontend-local optimistic projection and rollback/reconciliation tests
- add/move/remove/replace/undo/redo ordering and history tests
- stale revision, request failure and refresh-recovery tests
- pointer cancel, keyboard, reduced-motion and mobile information-strip checks
- existing frontend design tests, frontend lint/typecheck/build
- existing repository architecture tests and pnpm validate
- desktop/mobile browser evidence; no existing test may be weakened

REGRESSION SCOPE
- DesignV1 and UpdateDesignOperation compatibility
- Bracelet Engine layout, slot, fit and sequence semantics
- server-authoritative price/inventory/revision behavior
- current catalog search/filter, suggestions, save, export and order snapshot
- Auth session rolling and protected same-origin API behavior

HANDOFF
Return one Qwen candidate in REVIEW with before/after evidence, exact diff and
validation. Do not start Mini Program, AI, 3D, Commerce, White Label, Core-package
extraction or any second Worker.
```

## Lockfile decision

Because TASK-CORE-001 is no longer selected or proposed, `pnpm-lock.yaml` remains forbidden and no workspace importer is authorized. The previous lockfile-permission conflict is eliminated by withdrawing the premature package task, not by granting unused write scope.

## Acceptance posture

- TASK-AUDIT-002 remains `REVIEW`.
- TASK-FE-002 is the only first Worker and remains `PROPOSED`; it is not `IN_PROGRESS`.
- No Worker branch/worktree has been created.
- No Feature implementation, Mini Program, AI, 3D, Commerce, White Label, deployment or Auth work is authorized by this audit.

## Validation Evidence

- Validation target: task/audit-002-product-competitor-cross-platform branch HEAD at validation execution time. SOL records the immutable accepted candidate hash when TASK-AUDIT-002 transitions from REVIEW to DONE.
- `node --test tests/architecture.test.mjs`: PASS, 15/15
- `pnpm validate`: PASS, 15/15 workspace packages
- root validation architecture/lifecycle gate: PASS, 16/16
- `git diff --check main...HEAD`: PASS
- worktree status: clean
- final scope: 10 authorized governance/audit documents
- runtime/package/test/Prisma/lockfile/Auth changes: NONE
- TASK-FE-002 branch/worktree: NOT CREATED
