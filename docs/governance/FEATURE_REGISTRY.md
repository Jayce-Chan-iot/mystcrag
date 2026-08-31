# Feature Registry

Status vocabulary: `ACTIVE` is mounted and backed by a runtime path; `PARTIAL` is usable with documented gaps; `EXPERIMENTAL` is implemented but not the production path; `DORMANT` has no production consumer; `PLANNED` has no implemented product path; `LEGACY` exists only for compatibility.

| ID | Feature | Product/API entry | Canonical implementation | Owner | Status | Gaps / next task |
| --- | --- | --- | --- | --- | --- | --- |
| FEAT-001 | Original atelier home/navigation | `/` and shared layout | `apps/frontend/app/page.tsx` | FRONTEND | ACTIVE | Keep original UI as product baseline |
| FEAT-002 | AI questionnaire and three designs | `/ai-design`, design recommendation APIs | frontend questionnaire + backend recommendation service + deterministic RuleBasedProvider/Design/Knowledge packages | FRONTEND | ACTIVE | Grounded deterministic generation is production; continuous AI modification follows an accepted L3 editor, not a new prerequisite Core package |
| FEAT-003 | Design result and compact bracelet view | `/design/[id]` | `BraceletPreview`, Design Contract public projection | FRONTEND | ACTIVE | Distinguish from editing renderers |
| FEAT-004 | 2D DIY bracelet editing | `/diy`, `/diy/[id]` | `FlatBraceletEditor` + Bracelet Engine | FRONTEND | ACTIVE | Request-bound gestures, tab-memory history and exactly 25 `React.useState` hooks in the 1,275-line `DiyEditor`; Qwen/TASK-FE-002 is the only proposed first Worker |
| FEAT-005 | 3D bracelet preview/editor | package renderer and frontend wrapper | Three Engine + `ThreeBraceletPreview` | THREE | EXPERIMENTAL | Intentionally absent from production DIY; TASK-3D-001 |
| FEAT-006 | Sequence-only editor | test-mounted component | `BraceletSequenceEditor` | FRONTEND | DORMANT | Assign product role or retire; TASK-FE-001 |
| FEAT-007 | Crystal library | `/crystal-library` | frontend library feature + catalog APIs/data | FRONTEND | ACTIVE | Component is large; no duplicate authority identified |
| FEAT-008 | Personal design gallery | `/gallery`, design list/clone/delete/export APIs | frontend gallery + Design Application Service | FRONTEND | ACTIVE | The route lists only the signed actor's designs; it is not a public community feed |
| FEAT-009 | Profile/design/order history | `/profile`, design/order list APIs | frontend profile + Design API | FRONTEND | PARTIAL | Design/order history is durable and owner-scoped; address, favorites, preferences and privacy state remain browser-local |
| FEAT-010 | Save/clone/delete/publish design | Design APIs | `DesignApplicationService` | BACKEND | ACTIVE | Thin legacy wrappers are uncomposed |
| FEAT-011 | Pricing/inventory checks | Design price/save/order flows | backend application service + database repositories | BACKEND | ACTIVE | Thin wrapper classes add no current policy |
| FEAT-012 | Immutable order creation | `/api/orders/from-design`, `/api/orders` | Design API + Order Repository/snapshot contract | BACKEND | ACTIVE | No cart/payment/shipping integration |
| FEAT-013 | Tarot-guided design | `/tarot/**`, `/api/tarot/**` | Tarot Engine + backend Tarot service + frontend Tarot feature | TAROT | ACTIVE | Public enum/schema duplication; TASK-CONTRACT-001 |
| FEAT-014 | Knowledge admin console | `/admin/knowledge/**`, `/api/admin/knowledge/**` | Knowledge Core + backend admin + frontend admin | KNOWLEDGE | ACTIVE | Requires configured admin API key |
| FEAT-015 | Knowledge ingestion/review | worker, CLI and admin pipeline | Knowledge Ingestion/Core + Knowledge Worker | KNOWLEDGE | ACTIVE | Evidence outputs need retention policy |
| FEAT-016 | MCP knowledge/design tools | MCP server | `apps/mcp-server` | MCP | ACTIVE | Deployment/consumer configuration is external |
| FEAT-017 | Design decision trace/usage telemetry | recommendation/Tarot persistence | DB repositories + backend recorder | BACKEND | PARTIAL | Operational telemetry exists; product analytics does not |
| FEAT-018 | Authentication and user identity | `/auth/**`, same-origin `/api/**` BFF, Auth0 verifier and external-identity mapping | `docs/AUTH_SESSION_CONTRACT.md`; frontend auth boundary; backend auth providers; external identity repository | SOL -> DATABASE/BACKEND/FRONTEND/QA DAG | PARTIAL | Implementation and isolated security E2E are complete. Product Owner deferred production acceptance until a future deployment phase; the approved staging p95 benchmark and exact staging/production Auth0 allowlist/login/logout smoke remain release gates. This deployment-only gap does not block unrelated registered product Feature development |
| FEAT-019 | Product catalog persistence | Prisma catalog models/repositories/seed | Database package | DATABASE | ACTIVE | Spreadsheet import remains operational artifact, not runtime feature |
| FEAT-020 | Persistent design templates | Prisma `DesignTemplate` | none | DATABASE | DORMANT | Model has no production consumer; TASK-DB-001 |
| FEAT-021 | White label / multitenancy | none | none | SOL | PLANNED | No Tenant/Brand/Theme/hostname/catalog-isolation model; TASK-WL-001 architecture spike remains backlog |
| FEAT-022 | Cart and payment | none | none | BACKEND | PLANNED | Direct immutable order creation only; TASK-COMMERCE-001 contract requires Product Owner provider/policy decisions |
| FEAT-023 | Product analytics dashboard | none | none | SOL | PLANNED | Do not confuse with KnowledgeUsageEvent |
| FEAT-024 | Legacy grouped-design import | package compatibility exports/migration | Design Contract migration + AI/Three legacy adapters | CONTRACT | LEGACY | Usage proof and sunset decision; TASK-COMPAT-001 |
| FEAT-025 | Community publication and discovery | backend design publish boundary only | Publication Service + Publication Repository | BACKEND | PARTIAL | Publish is backend-only; privacy-safe versioned share, public projection, moderation, feed and frontend actions are unresolved |

## Registration rule

A feature is not `ACTIVE` because a file or test exists. It must have a production composition root, route, command, or worker entry point and an owner. Changing a status requires updating this table in the same task.
