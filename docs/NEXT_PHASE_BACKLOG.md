# Next Phase Backlog

**Planning baseline:** `2abfdfe76df3302f2c9ae88cfa749832b71e2578`
**Product authority:** ChatGPT conversation `玄矶 DIY 系统需求分析`, ID `6a8ac667-ebb4-83ea-99f9-bb5b267dd97a`
**Source audit:** [M0 Product, Competitor and Cross-platform Audit](M0_PRODUCT_COMPETITOR_CROSS_PLATFORM_AUDIT.md)
**Development Gate:** `OPEN` for separately registered non-auth tasks
**Selection rule:** only one first Worker is proposed; Human Product Owner dispatch is required

> **玄矶当前第一产品目标：将 Mystcrag 的水晶手串 DIY 操作体验、移动端体验和视觉体验提升至当前成熟同类产品水平或以上，并通过 AI 设计能力形成进一步差异化。**

## Current gates

- Repository baseline: `READY`.
- AUTH implementation: `COMPLETE / FROZEN`.
- AUTH-007: `BLOCKED — DEPLOYMENT_ACCEPTANCE_DEFERRED_BY_PRODUCT_OWNER`.
- Production deployment: `NOT STARTED`.
- The deployment-only Auth gates do not block a separately registered Web UX task.

## Audit-driven priority

| Priority | Suggested task | Outcome | Dependency | State |
| --- | --- | --- | --- | --- |
| P0 | TASK-FE-002 | competitive direct manipulation, mobile feedback and safe Web editing continuity | audit acceptance and current screenshot baseline | **FIRST WORKER — PROPOSED** |
| P0 | TASK-ASSET-003 | bead realism and visual parity using provenance-approved assets | FE-002 baseline capture and ASSET ownership | BACKLOG |
| P0 commercial | TASK-COMMERCE-001 | checkout/fulfillment contract and provider decision | Product Owner commercial policy | BACKLOG |
| P1 | TASK-SHARE-001 | privacy-safe versioned share/publication/Remix contract | moderation/privacy decision | BACKLOG |
| P1 | TASK-AI-002 | grounded continuous AI design modification | TASK-FE-002 and AI policy | BLOCKED |
| P1 | TASK-DATA-002 | durable profile/address/preferences contract | profile/privacy/commerce decisions | BACKLOG |
| P1 architecture | Cross-platform extraction decision | extract only stable, accepted interaction behavior | TASK-FE-002 accepted | BACKLOG; no task/package frozen |
| P2 | TASK-3D-001 | keep experimental or approve one bounded production preview | stable L3 2D/mobile workbench and ROI decision | READY decision task; not selected |
| P2 | TASK-WL-001 | White Label tenancy architecture spike | strong Mystcrag UX and named partner requirements | BACKLOG |

Every item is specified with evidence, impact, ownership, paths, acceptance criteria, tests and regression scope in the source audit. This table does not register or start a Worker.

## First Worker selection

```text
RECOMMENDED WORKER: Qwen
TASK: TASK-FE-002 Competitive DIY Interaction and Mobile Feedback
OWNER: FRONTEND / Qwen
BRANCH: task/fe-002-competitive-diy-experience
STATUS: PROPOSED — AWAIT HUMAN PRODUCT OWNER DISPATCH
```

Qwen is the sole execution Owner. SOL performs Review and Integration only and does not share TASK-FE-002 ownership. Stage A is an evidence-only baseline capture under ignored `output/playwright/task-fe-002/before/`; production changes remain forbidden until explicit Human Product Owner approval. Stage B then writes paired evidence under ignored `output/playwright/task-fe-002/after/`. A blocked browser capture blocks implementation and cannot be replaced by a code-only L3 claim.

The revised six-competitor matrix shows that the largest actionable L3 gap is direct-manipulation feedback and mobile editing continuity. Existing Design Contract edit operations and Bracelet Engine layout/fit/slot behavior are sufficient. TASK-CORE-001 is therefore withdrawn as the first prerequisite; no new Core package, workspace importer or `pnpm-lock.yaml` change is authorized.

## Sequencing

```text
TASK-AUDIT-002 accepted
        |
        v
TASK-FE-002 (Qwen, only selected Worker)
        |
        +-----------------------+
        |                       |
        v                       v
TASK-ASSET-003             stable-interaction extraction decision
(realism, later)           (no task/package yet)
        |
        v
TASK-AI-002 can add grounded continuous modification after L3 editor behavior
```

Commerce, community, durable profile, 3D, Mini Program and White Label remain independent backlog lanes. They are not authorized by TASK-AUDIT-002.

## Frozen and deferred boundaries

- Do not rewrite Auth0, the Next.js BFF cookie session, provider verification or `User`/`ExternalIdentity` semantics.
- Future WeChat identity is an independent platform adapter over canonical internal identity.
- Do not create `packages/diy-session-core`, modify `pnpm-lock.yaml` or freeze a cross-platform editing abstraction before TASK-FE-002 evidence.
- Do not promote Three Engine from `EXPERIMENTAL` without its evidence-based lifecycle task.
- Do not add tenancy or commerce schema before Product Owner/contract gates.
