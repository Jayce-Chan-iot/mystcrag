# Mystcrag Documentation Index

This index routes current work. Historical phase reports are retained for evidence but are not controlling specifications.

Always read `PROJECT_CONTEXT.md`, `CODING_STANDARD.md`, and the task-specific documents below.

Repository governance entry points:

- Current repository map: `governance/CURRENT_REPOSITORY_MAP.md`
- Target structure: `governance/TARGET_REPOSITORY_STRUCTURE.md`
- Feature and ownership registries: `governance/FEATURE_REGISTRY.md`, `governance/MODULE_OWNERS.md`
- Canonical implementations and duplicate audit: `governance/CANONICAL_COMPONENTS.md`, `governance/DUPLICATE_CODE_AUDIT.md`
- Branches, health, and active tasks: `governance/BRANCH_REGISTRY.md`, `governance/REPOSITORY_HEALTH.md`, `tasks/TASK_REGISTRY.md`
- Current audit and planning handoff: `governance/BASELINE_VALIDATION.md`, `CURRENT_PRODUCT_STATUS.md`, `NEXT_PHASE_BACKLOG.md`, `FEATURE-018_PLAN.md`, `TASK_DISPATCH_PACKAGE.md`
- QA/output evidence retention: `governance/QA_EVIDENCE_RETENTION.md`

| Task | Controlling documents |
| --- | --- |
| Repository governance / cleanup | `governance/CURRENT_REPOSITORY_MAP.md`, `governance/TARGET_REPOSITORY_STRUCTURE.md`, `governance/MODULE_OWNERS.md`, `tasks/TASK_REGISTRY.md` |
| Product / MVP | `PRODUCT_REQUIREMENT.md`, `MVP_DEVELOPMENT_PLAN.md`, `UI_DESIGN_SYSTEM.md` |
| Frontend / interaction | `UI_DESIGN_SYSTEM.md`, `INTERACTION_TEST_PLAN.md`, `API_SPECIFICATION.md` |
| UI reference implementation | `UI_REFERENCE_AND_ASSET_MANIFEST.md`, `AGENT_FULL_UI_REBUILD_AND_QA_PROMPT.md`, `UI_DESIGN_SYSTEM.md`, `INTERACTION_TEST_PLAN.md` |
| Bracelet Engine | `BRACELET_GEOMETRY.md`, `DESIGN_CONTRACT_V1.md`, `THREE_ENGINE_SPEC.md` |
| Backend / API | `API_SPECIFICATION.md`, `DESIGN_CONTRACT_V1.md`, `SECURITY_AND_PRIVACY.md` |
| Database | `DATABASE_SCHEMA.md`, `PERSISTENCE_MODEL_V1.md`, `SECURITY_AND_PRIVACY.md` |
| AI | `AI_AGENT_SPEC.md`, `DESIGN_CONTRACT_V1.md` |
| Knowledge system | `KNOWLEDGE_SYSTEM_SPEC.md` (status: APPROVED, DEC-KNOWLEDGE-SYSTEM-001), `API_SPECIFICATION.md`, `DATABASE_SCHEMA.md` |
| Combined original UI + knowledge architecture | `superpowers/specs/2026-08-24-original-ui-knowledge-merge-design.md`, `API_SPECIFICATION.md`, `DATABASE_SCHEMA.md`, `DESIGN_CONTRACT_V1.md` |
| 3D | `THREE_ENGINE_SPEC.md`, `BRACELET_GEOMETRY.md`, `DESIGN_CONTRACT_V1.md` |
| QA / browser | `INTERACTION_TEST_PLAN.md`, `USER_ACCEPTANCE_CHECKLIST.md`, `DIY_V2_BASELINE.md` |
| Local operation | `LOCAL_DEMO_GUIDE.md`, `ENGINEERING_GUIDE.md`, `DEPLOYMENT_GUIDE.md` |
| Dependencies / OSS | `DEPENDENCY_DECISIONS.md`, `OSS_RESEARCH.md` |
| Tarot-guided design | `superpowers/specs/2026-08-19-tarot-guided-bracelet-design.md`, `superpowers/plans/2026-08-20-tarot-guided-bracelet-integration.md`, `API_SPECIFICATION.md`, `SECURITY_AND_PRIVACY.md` |

Files ending in `_REPORT.md` or `_PLAN.md` describe earlier implementation phases. Consult them when tracing a decision, regression, or prior verification result. `DECISION_LOG.md` remains the cross-module decision record.

The approved Tarot product and architecture source is the [Tarot-guided bracelet design specification](superpowers/specs/2026-08-19-tarot-guided-bracelet-design.md). Its task order and verification gates are in the [Tarot-guided bracelet integration plan](superpowers/plans/2026-08-20-tarot-guided-bracelet-integration.md).
