# Next Phase Backlog

**Planning horizon:** current Phase plus the immediately following Phase only<br>
**Selection rule:** the baseline is ready and non-auth development may continue only through separately registered tasks after the M0 Product + Competitor + Cross-platform Audit

## Current Phase entry gates

These are repository gates, not competing product Features:

1. Integrate governance candidate into `main` through an owner-reviewed task.
2. Resolve Tarot public schema authority: TASK-CONTRACT-001 -> TASK-TAROT-001.
3. Resolve AI candidate concept collision: TASK-AI-001 -> TASK-BE-003.
4. Freeze and replay-validate one candidate commit, including isolated authenticated browser smoke.

These baseline gates are `DONE`. FEAT-018 implementation and isolated security verification are also complete; its production deployment acceptance is deferred and does not block unrelated registered Features.

## Priority ranking

Weights: User Value 25, Business Value 20, Core Experience 20, Technical Necessity 15, Dependency Unlock 10, Risk/Cost 10. A higher Risk/Cost score means lower delivery risk/cost.

| Rank | Feature | Priority | User | Business | Core | Technical | Unlock | Risk/Cost | Total |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | FEAT-018 Production Identity & Session | P0 | 22 | 20 | 18 | 15 | 10 | 4 | **89** |
| 2 | FEAT-022 Checkout and Fulfillment Foundation | P0 | 22 | 19 | 18 | 12 | 7 | 4 | **82** |
| 3 | FEAT-004 Resilient DIY Editing Session | P1 | 23 | 14 | 19 | 12 | 6 | 7 | **81** |
| 4 | FEAT-017 Authenticated E2E Release Gate | P1 | 12 | 10 | 12 | 15 | 10 | 8 | **67** |
| 5 | FEAT-025 Community Publication & Discovery | P2 | 18 | 14 | 11 | 6 | 4 | 6 | **59** |
| 6 | FEAT-005 Production 3D Decision/Preview | P2 | 14 | 8 | 8 | 6 | 3 | 4 | **43** |

## P0 — release blockers

### FEAT-018 — Production Identity & Session

- **Name:** Production Identity & Session
- **Priority:** P0
- **User Value:** users can sign in/out and own designs, Tarot sessions and orders across devices.
- **Business Value:** establishes real customer identity, privacy boundary and the prerequisite for commerce/support.
- **Technical Value:** replaces a public fixed token with a standard server-verified session and stable actor provisioning.
- **Technical Risk:** high; security, provider operations, cookie/token boundaries, migration and recovery must be decided contract-first.
- **Estimated Scope:** large, 5 implementation/review tasks after one SOL contract task.
- **Dependencies:** implementation dependencies are complete. Production release still requires the approved same-region staging benchmark, real Origins, byte-exact Auth0 allowlists and real login/logout smoke when deployment resumes.
- **Affected Modules:** backend auth and app composition, frontend auth/session UI and API runtime, database user provisioning, API/security/deployment docs, QA.
- **Parallelizable:** backend and frontend implementation can run in parallel only after the contract/dependency task freezes interfaces and file locks.
- **Recommended Agent Type:** SOL contract/integration, GLM backend/database/tests, Qwen frontend/responsive interaction.
- **Reason:** the shared identity prerequisite is technically integrated. The remaining gap is a deferred production release gate, not authorization for ordinary Features to modify the frozen Auth boundary.

### FEAT-022 — Checkout and Fulfillment Foundation

- **Name:** Checkout, address, payment and order lifecycle
- **Priority:** P0 for commercial launch, but not selected this Phase.
- **User Value:** complete a purchase and understand fulfillment state.
- **Business Value:** converts the design loop into revenue.
- **Technical Value:** extends the strong immutable snapshot boundary into an explicit commerce state machine.
- **Technical Risk:** high; payment provider, tax/shipping policy, inventory reservation, refunds and compliance are external decisions.
- **Estimated Scope:** extra large; must be a later Feature with its own contract and provider decision.
- **Dependencies:** FEAT-018, commercial policy, payment/shipping providers.
- **Affected Modules:** Design Contract, backend, database/migrations, frontend, security/deployment, QA.
- **Parallelizable:** only after order/payment contract and migration land serially.
- **Recommended Agent Type:** SOL + GLM + Qwen.
- **Reason:** high commercial value, but starting before identity would create rework in ownership and recovery.

## P1 — high value

### FEAT-004 — Resilient DIY Editing Session

- **Name:** resilient editing, save state and recovery
- **Priority:** P1
- **User Value:** edits survive latency, refresh and interruption with clear save/conflict feedback.
- **Business Value:** protects the main customization conversion funnel.
- **Technical Value:** decomposes the 1,275-line editor around tested state/mutation boundaries.
- **Technical Risk:** medium; optimistic state and revision conflicts can corrupt UX if poorly sequenced.
- **Estimated Scope:** medium-large.
- **Dependencies:** frozen baseline and production identity for cross-device recovery; Bracelet Engine semantics remain unchanged.
- **Affected Modules:** frontend design feature/API client, backend design revision path, tests.
- **Parallelizable:** frontend state extraction and backend idempotency review require a frozen state/API contract first.
- **Recommended Agent Type:** Qwen primary, GLM for backend boundary, SOL review.
- **Reason:** highest core-experience score, but identity should define the durable owner/session first.

### FEAT-017 — Authenticated E2E Release Gate

- **Name:** isolated full-loop browser release verification
- **Priority:** P1
- **User Value:** indirect; reduces broken customer flows.
- **Business Value:** safer releases.
- **Technical Value:** makes home -> recommendation/DIY -> save -> order replayable on a clean stack.
- **Technical Risk:** low-medium; main risk is reliable test data/auth/runtime isolation.
- **Estimated Scope:** medium.
- **Dependencies:** frozen baseline and FEAT-018 test-session contract.
- **Affected Modules:** QA tests, CI, test fixtures and deployment docs; no product behavior change.
- **Parallelizable:** no with FEAT-018 final E2E because they share auth fixtures and CI files.
- **Recommended Agent Type:** GLM/QA with SOL acceptance review.
- **Reason:** the current browser evidence is manual/partial; this becomes the next release gate after identity.

## P2 — defer

### FEAT-025 — Community Publication & Discovery

- **Name:** public publish, discovery, share and unpublish experience
- **Priority:** P2
- **User Value:** users can discover and share bracelet designs.
- **Business Value:** potential organic discovery and retention.
- **Technical Value:** completes the existing publication persistence boundary.
- **Technical Risk:** medium; privacy, moderation, pagination and public projection policy are unresolved.
- **Estimated Scope:** large.
- **Dependencies:** FEAT-018, moderation/privacy product policy.
- **Affected Modules:** Design Contract, database, backend, frontend, QA.
- **Parallelizable:** backend feed and frontend shell only after public DTO/privacy contract freezes.
- **Recommended Agent Type:** SOL + GLM + Qwen.
- **Reason:** backend-only publication is not enough, but the commercial identity/checkout path has higher priority.

### FEAT-005 — Production 3D Decision/Preview

- **Name:** evidence-based 3D lifecycle or production preview
- **Priority:** P2
- **User Value:** richer material/spatial understanding for capable devices.
- **Business Value:** differentiation, not current conversion prerequisite.
- **Technical Value:** decides an experimental path and eliminates ambiguous lifecycle claims.
- **Technical Risk:** high; WebGL fallback, performance, asset and interaction parity need proof.
- **Estimated Scope:** medium for lifecycle decision, large for production promotion.
- **Dependencies:** TASK-3D-001 and product-owner approval; no MVP dependency.
- **Affected Modules:** Three Engine, frontend wrapper/routes, assets, QA and Three spec.
- **Parallelizable:** renderer work must not overlap Bracelet Engine core or production editor state changes.
- **Recommended Agent Type:** Qwen/Three specialist with SOL review.
- **Reason:** valuable later, but it must not displace identity or resilient 2.5D delivery.

## Recommended selection

```text
RECOMMENDED NEXT TASK:
M0 — Product + Competitor + Cross-platform Audit
```

The audit must re-evaluate Web competitive experience, DIY interaction quality, shared Core boundaries, cross-platform architecture, WeChat Mini Program readiness, AI/3D product work and White Label groundwork against the current code. It is analysis/governance work, not permission to start business implementation. Every resulting Feature still requires its own Task ID, owner, branch, writable/forbidden paths, dependencies and acceptance criteria. Existing Web Auth must not be rewritten for Mini Program preparation; a future WeChat identity integration requires an independent Auth Adapter task over the canonical internal `User` + `ExternalIdentity` model.
