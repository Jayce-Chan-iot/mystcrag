# Next Phase Backlog

**Planning baseline:** `2abfdfe76df3302f2c9ae88cfa749832b71e2578`
**Source audit:** [M0 Product, Competitor and Cross-platform Audit](M0_PRODUCT_COMPETITOR_CROSS_PLATFORM_AUDIT.md)
**Development Gate:** `OPEN` for separately registered non-auth tasks
**Selection rule:** only one first Worker is proposed; Human Product Owner dispatch is required

## Current gates

- Repository baseline: `READY`.
- AUTH implementation: `COMPLETE / FROZEN`.
- AUTH-007: `BLOCKED — DEPLOYMENT_ACCEPTANCE_DEFERRED_BY_PRODUCT_OWNER`.
- Production deployment: `NOT STARTED`.
- The deployment-only Auth gates do not block a separately registered Shared Core task.

## Audit-driven priority

| Priority | Suggested task | Outcome | Dependency | State |
| --- | --- | --- | --- | --- |
| P0 | TASK-CORE-001 | platform-neutral DIY command/history/reconciliation core | audit acceptance | **FIRST WORKER — PROPOSED** |
| P0 | TASK-COMMERCE-001 | checkout/fulfillment contract and provider decision | Product Owner commercial policy | BACKLOG |
| P1 | TASK-FE-002 | resilient Web DIY workbench consuming the Core | TASK-CORE-001 DONE | BLOCKED |
| P1 | TASK-SHARE-001 | privacy-safe versioned share/publication contract | moderation/privacy decision | BACKLOG |
| P1 | TASK-AI-002 | real-material conversational refinement | TASK-CORE-001 and AI policy | BLOCKED |
| P1 | TASK-DATA-002 | durable profile/address/preferences contract | profile/privacy/commerce decisions | BACKLOG |
| P2 | TASK-3D-001 | keep experimental or approve one bounded production preview | stable 2D workbench and ROI decision | READY decision task; not selected |
| P2 | TASK-WL-001 | White Label tenancy architecture spike | named partner requirements | BACKLOG |

Every proposed item is specified with evidence, impact, ownership, paths, acceptance criteria, required tests and regression scope in the source audit. This table does not register or start any Worker.

## First Worker selection

```text
RECOMMENDED WORKER: GLM
TASK: TASK-CORE-001 Cross-platform DIY Editing Session Core
BRANCH: task/core-001-diy-editing-session-core
STATUS: PROPOSED — AWAIT HUMAN PRODUCT OWNER DISPATCH
```

This is Core/architecture work, not a frontend visual task. It unlocks the high-value Web workbench and future Mini Program adapters without touching Auth. Qwen is appropriate for TASK-FE-002 only after the Core is accepted; no Qwen task is started now.

## Sequencing

```text
TASK-AUDIT-002 accepted
        |
        v
TASK-CORE-001 (GLM, only selected Worker)
        |
        +--------------------+
        |                    |
        v                    v
TASK-FE-002             future Mini shell/adapter contract
(Qwen, later)           (not yet registered)
        |
        v
TASK-AI-002 can translate grounded intent into shared commands
```

Commerce, community, durable profile, 3D and White Label remain independent backlog lanes. They are not authorized by TASK-AUDIT-002.

## Frozen and deferred boundaries

- Do not rewrite Auth0, the Next.js BFF cookie session, provider verification or `User`/`ExternalIdentity` semantics.
- Future WeChat identity is an independent platform adapter over canonical internal identity.
- Do not move DOM, Canvas, browser storage, Next navigation or WebGL into Shared Core.
- Do not promote Three Engine from `EXPERIMENTAL` without its existing evidence-based lifecycle task.
- Do not add tenancy or commerce schema before their Product Owner/contract gates.
