# Mystcrag Decision Log

Record cross-module and shared-asset proposals here before implementation. `PROPOSED` and `REJECTED` entries do not authorize code changes. Only `APPROVED` entries reviewed by the Tech Lead authorize the described shared change.

## Decision fields

- Date:
- Proposed by Agent:
- Affected modules:
- Decision:
- Rationale:
- Rejected alternatives:
- Contract impact:
- Database impact:
- API impact:
- Approval status: `PROPOSED | APPROVED | REJECTED | SUPERSEDED`
- Approved by:
- Approval date:
- Implementation branch or commit:

## Decisions

### DEC-KNOWLEDGE-SYSTEM-001 — Approve the knowledge-driven design system architecture

- Date: 2026-08-20
- Proposed by Agent: Chief Architect (EPIC 0 audit)
- Affected modules: `packages/design-contract`, `packages/ai-agent`, `packages/database`, `apps/backend`, `apps/frontend`, plus planned `packages/knowledge-core`, `packages/design-engine`, `packages/knowledge-ingestion`, `apps/knowledge-worker`, `apps/mcp-server`, `packages/tarot-engine`
- Decision: Adopt the knowledge-driven design system architecture recorded in `docs/KNOWLEDGE_SYSTEM_SPEC.md`. The authoritative ADR list (ADR-1 through ADR-13) is section 15 of that specification: DesignV1 stays unchanged with decision traces in a sidecar table; `ai-agent` narrows to an explanation layer while a deterministic `design-engine` owns composition; taxonomy ships as a versioned fixture in `design-contract`; knowledge storage uses PostgreSQL + pgvector (no ChromaDB); the job queue uses pg-boss (no Redis); ingestion uses Crawlee; rule evaluation spikes `json-rules-engine`; color math uses Culori; MCP uses the official TypeScript SDK behind a dedicated `apps/mcp-server`; tarot enters the pipeline as a soft `RecommendationContext` source (P6) instead of a dedicated scoring engine.
- Rationale: The task book requires an explainable, testable, deterministic design chain (Context → Knowledge → Decision Rules → Design Engine → DesignV1) without a mandatory LLM, without a parallel design contract, and without duplicate infrastructure. The repository audit confirmed the existing contracts, repositories, and geometry kernel can be extended in place.
- Rejected alternatives: A parallel `DesignPlan` schema; embedding decision traces inside `DesignV1`; ChromaDB/Redis/new vector stores; a tarot-specific design engine; a second test framework; frontend-bundled knowledge runtimes.
- Contract impact: Additive only. New schema families (taxonomy, RecommendationContext, Knowledge, DecisionRule, DesignDecisionTrace) join `@mystcrag/design-contract`; optional `lengthAlongStringMm` on beads/accessories and the `TAROT_GUIDED` design mode remain the only DesignV1-facing additions. `schemaVersion` stays `1.0.0`.
- Database impact: Incremental migrations only (Product V2 nullable columns, knowledge table family, `design_decision_traces`, tarot sessions). Existing rows and order snapshots remain untouched; `pgvector/pgvector:pg17` replaces the stock postgres image.
- API impact: Existing routes unchanged. Planned additive routes: `/api/design/recommend|evaluate|optimize|suggest`, `/api/design/:id/trace`, `/api/knowledge/search`, and the six tarot session endpoints, all following the current Bearer + Zod + error-envelope conventions.
- Approval status: `APPROVED`
- Approved by: Project owner
- Approval date: 2026-08-20
- Implementation branch or commit: `feat/knowledge-system` worktree; EPIC 0 documents committed at `efec785`.

### DEC-MVP-2P5D-001 — Adopt the 2.5D editor as the MVP interaction target

- Date: 2026-08-17
- Proposed by Agent: Product and QA planning
- Affected modules: `apps/frontend`, `packages/three-engine`, product requirements, MVP acceptance, desktop/mobile interaction QA
- Decision: The primary MVP DIY route uses a front-facing, image-based 2.5D bracelet editor. The release gate covers direct bead selection, addition, reorder, removal, connected/spread presentation, size-aware circumference, server-authoritative price/revision, save/reload, and single order-snapshot completion on desktop and mobile. Three.js remains available as an optional visualization capability but is not required on the primary DIY route and WebGL availability is not an MVP acceptance condition.
- Rationale: The project owner explicitly selected 2.5D as the final target and prioritized interaction correctness across computer and mobile surfaces. A direct-manipulation surface is more predictable for touch insertion, reordering, and deletion while preserving the shared design, pricing, persistence, and order contracts.
- Rejected alternatives: Requiring an orbit-controlled 3D editor for MVP; treating a CSS-sized browser screenshot as proof of interaction correctness; accepting clickability without verifying Backend and persisted state.
- Contract impact: None. `DesignV1`, stable `componentId`, finite update operations, pricing, production order, and public projections remain canonical.
- Database impact: None. Existing immutable revision and order-snapshot invariants remain required.
- API impact: None. Existing Generate, Update, Price, Save, Get, Catalog, and Order routes remain authoritative.
- Approval status: `APPROVED`
- Approved by: Project owner
- Approval date: 2026-08-17
- Implementation branch or commit: Current local MVP worktree; exact commit pending interaction QA closeout.

### P3-001 — Establish Phase 3 parallel-development governance

- Date: 2026-07-21
- Proposed by Agent: Tech Lead
- Affected modules: Repository-wide collaboration and integration workflow; no product runtime module
- Decision: Use one role-owned branch per Backend, AI, 3D, Frontend, and QA Agent; enforce directory ownership, prior approval for shared assets, a fixed merge order, handoff evidence, and `pnpm validate` before handoff and after every merge.
- Rationale: Parallel development needs explicit ownership and integration gates to prevent Design Contract drift, cross-module edits, public cost leakage, and unverified merges.
- Rejected alternatives: Direct development on `main`; shared feature branches; Agent-to-Agent branch merges; unlogged shared protocol edits; validating only after all branches are merged.
- Contract impact: None. Design Contract V1 remains `1.0.0` and the single source of design truth.
- Database impact: None. The Phase 2C persistence baseline and invariants remain unchanged.
- API impact: None. Existing shared DTOs and stable error envelope remain unchanged.
- Approval status: `APPROVED`
- Approved by: Tech Lead
- Approval date: 2026-07-21
- Implementation branch or commit: `chore/phase-3-parallel-workflow`

### DEC-PHASE3-THREE-DEPENDENCY-001 — Add Three.js TypeScript definitions

- Date: 2026-07-21
- Proposed by Agent: 3D Engine Lead
- Affected modules: `packages/three-engine`, `pnpm-lock.yaml`
- Decision: Add `@types/three@^0.180.0` as a development dependency of `@mystcrag/three-engine`. Accept the generated lockfile entries for `@types/three@0.180.0` and its transitive type/example dependencies: `@dimforge/rapier3d-compat@0.12.0`, `@tweenjs/tween.js@23.1.3`, `@types/stats.js@0.17.4`, existing `@types/webxr@0.5.24`, `@webgpu/types@0.1.71`, `fflate@0.8.3`, and `meshoptimizer@0.22.0`.
- Rationale: Phase 3 adds typed React Three Fiber scene code that imports Three.js runtime types. The `three@0.180.0` runtime remains a peer/development dependency, while its matching DefinitelyTyped package is required only to typecheck and build `packages/three-engine`. The manifest change stays inside the 3D-owned package.
- Rejected alternatives: Hand-written ambient declarations would duplicate and weaken upstream types; `skipLibCheck` or untyped imports would reduce strictness; moving the dependency to the root or Frontend manifest would violate module ownership; removing it makes the new scene fail TypeScript validation.
- Shared asset impact: `pnpm-lock.yaml` adds one importer entry and 45 generated lines for the exact dependency closure. The diff contains no removal, upgrade, unrelated importer change, root manifest change, Frontend manifest change, or workspace configuration change. The lockfile must be regenerated with `pnpm install` after rebasing on local `main`; it must not be edited manually.
- Risk: The type package adds install footprint and transitive example/runtime declarations, so lockfile conflicts and package-store size can increase. Runtime bundle impact is expected to be zero because it is a development dependency and no new runtime import is introduced. Version drift is limited by matching Three.js `0.180.x`. `@types/three`, `fflate`, and `meshoptimizer` report MIT licenses; the dependency closure remains subject to the repository's normal license review before distribution. Frontend production build and the full workspace gate must pass after regeneration.
- Contract impact: None. `DesignV1` and the one-way adapter boundary are unchanged.
- Database impact: None.
- API impact: None.
- Approval status: `APPROVED`
- Approved by: Tech Lead
- Approval date: 2026-07-21
- Implementation branch or commit: `feature/three-bracelet-scene` at pre-rebase commit `61e964b`

### P35-001 — Establish Phase 3.5 remediation governance

- Date: 2026-07-22
- Proposed by Agent: Tech Lead
- Affected modules: Phase 3.5 Backend Security, Database Verification, Browser Integration, Frontend Three Integration, and QA rerun workflow
- Decision: Use four role-owned fix branches and one deferred QA rerun branch; require clean role-only history, fixed merge order, shared-change approval, complete handoff evidence, and `pnpm install` plus `pnpm validate` after every merge.
- Rationale: The first QA gate confirmed that individually passing modules do not prove the real browser, authentication, Three, and PostgreSQL MVP path. Phase 3.5 needs explicit cross-module boundaries and evidence without Contract drift or premature QA imports.
- Rejected alternatives: Fixing directly on `main`; one shared remediation branch; merging the old QA commit through a fix branch; accepting Mock/fixture evidence as a production path; restarting QA before all four post-merge gates pass.
- Contract impact: None. `@mystcrag/design-contract` remains the single source of design DTOs and invariants.
- Database impact: No schema or migration semantic change is authorized.
- API impact: Existing design DTOs remain unchanged; the separately approved authentication decision governs auth error/context semantics.
- Approval status: `APPROVED`
- Approved by: Tech Lead
- Approval date: 2026-07-22
- Implementation branch or commit: `chore/phase-3-5-remediation-coordination`; `docs/PHASE_3_5_REMEDIATION_PLAN.md`

### DEC-P35-POSTGRES-TEST-COMMAND-001 — Guard the live PostgreSQL test command

- Date: 2026-07-22
- Proposed by Agent: Database Verification Lead
- Affected modules: Root `package.json`, `packages/database` test infrastructure, PostgreSQL CI service
- Decision: Replace the root `db:test` reset command with the reviewed `TEST_DATABASE_URL` preparation, migration, and repository-test chain. The preparer must reject missing, unsafe, non-test, or non-empty database targets. No Prisma Schema or migration SQL change is authorized.
- Rationale: BUG-P3-004 requires repeatable live PostgreSQL evidence while preventing an implicit fixed local URL and destructive reset from targeting an unintended database.
- Rejected alternatives: Counting only Prisma validation or unit doubles; keeping a hard-coded development password/URL as the authoritative test target; using `prisma migrate reset --force` without a test-database guard; modifying production schema to simplify tests.
- Contract impact: None.
- Database impact: Test orchestration only. The reviewed migration and schema remain unchanged.
- API impact: None.
- Approval status: `APPROVED`
- Approved by: Tech Lead
- Approval date: 2026-07-22
- Implementation branch or commit: Candidate `fix/postgres-verification@d923f06`; approval retains only the exact root `db:test` script scope reviewed on 2026-07-22. The branch remains subject to history cleanup and handoff review.

### DEC-P35-FRONTEND-THREE-LINK-001 — Link Three Engine into the Frontend workspace importer

- Date: 2026-07-22
- Proposed by Agent: 3D Integration Lead
- Affected modules: `apps/frontend/package.json`, `pnpm-lock.yaml`, `packages/three-engine` public exports as a consumer dependency
- Decision: Allow the Frontend to declare `@mystcrag/three-engine: workspace:*` and retain the generated three-line lockfile importer link `link:../../packages/three-engine`. No registry dependency, version upgrade, root manifest change, or Design Contract change is authorized.
- Rationale: BUG-P3-002 cannot mount the real Three Engine while the Frontend lacks an explicit workspace dependency. The generated link records the existing internal package without expanding the registry dependency closure.
- Rejected alternatives: Deep relative imports into `packages/three-engine`; duplicating scene code inside Frontend; loading an undeclared package; copying Three runtime types into the shared Contract.
- Contract impact: None. Frontend consumes the existing public Three adapter/runtime boundary.
- Database impact: None.
- API impact: None.
- Approval status: `APPROVED`
- Approved by: Tech Lead
- Approval date: 2026-07-22
- Implementation branch or commit: Candidate `fix/frontend-three-integration@210010a`; approval retains only the exact Frontend importer and three-line lockfile diff reviewed on 2026-07-22. The branch remains subject to history cleanup, auth adaptation, and handoff review.

### DEC-P35-AUTH-BOUNDARY-001 — Require verified Backend actor context

- Date: 2026-07-22
- Proposed by Agent: Backend Security Lead
- Affected modules: `apps/backend` authentication/context boundary, Frontend integration consumers, QA security tests, `docs/API_SPECIFICATION.md`
- Decision: Protected design/order routes must resolve `actorId` only from verified authentication claims. Remove `x-actor-id` as an external identity source. Add stable generic `UNAUTHORIZED` and owner-safe `FORBIDDEN` behavior, and document it in the API specification before handoff. Development/test authentication must be explicitly enabled, signature/issuer/audience/expiry verified, and rejected as a production fallback.
- Rationale: BUG-P3-005 shows that an arbitrary actor header defeats owner-scoped persistence even when request bodies correctly reject `ownerId`. Browser and 3D proxy integration need one authoritative identity boundary before QA reruns.
- Rejected alternatives: Renaming the actor header; trusting a server-configured actor ID without credential verification; anonymous owner routes; embedding authentication fields in Design Contract DTOs; shipping a production test-token fallback.
- Contract impact: None. Design Contract request/response DTOs do not gain identity fields.
- Database impact: None. Existing owner predicates and transaction boundaries remain unchanged.
- API impact: Protected routes gain documented 401/403 authentication/authorization behavior; design DTO success schemas and existing domain error meanings remain unchanged.
- Approval status: `APPROVED`
- Approved by: Tech Lead
- Approval date: 2026-07-22
- Implementation branch or commit: Candidate `fix/backend-auth-boundary@acd4df8`; implementation remains subject to code review, API specification update, validation, and integration-consumer adaptation.

### DEC-P35-BACKEND-AI-LINK-001 — Connect the rule-based AI recommendation package to Backend generation

- Date: 2026-07-22
- Proposed by Agent: Autonomous Tech Lead
- Affected modules: `apps/backend`, `packages/ai-agent` public exports as a consumed dependency, `apps/backend/package.json`, and generated `pnpm-lock.yaml` importer metadata
- Decision: Allow the Backend design-generation composition layer to depend on `@mystcrag/ai-agent: workspace:*` and adapt the existing validated rule-based recommendation output into the existing `DesignGenerationAdapter`. The adapter may request three differentiated creative candidates but must continue using Backend catalog, inventory, identity, timestamps, pricing, compliance, revision, and persistence as authoritative values. The generated lockfile may contain only the corresponding workspace link. No Design Contract, AI candidate contract, Prisma schema, migration, or public API DTO change is authorized.
- Rationale: The Phase 3 Backend currently composes a fixed `MockDesignGenerationAdapter` that ignores most questionnaire inputs for material and structure selection. A real browser transport alone would therefore fail the approved product requirement that emotion, color, style, budget, wrist size, cultural inspiration, exclusions, and available inventory materially affect three differentiated proposals. The existing AI package already implements deterministic, provider-independent, compliance-checked recommendation logic; wiring its public boundary avoids duplicating AI logic inside the Frontend or Backend.
- Rejected alternatives: Keeping the fixed Backend Mock as the production generator; fabricating three variants in browser state; adding a second design DTO; trusting AI prices or inventory; introducing a paid or keyed LLM requirement for the MVP.
- Contract impact: None. Provider output remains untrusted and `@mystcrag/design-contract` remains the only design protocol.
- Database impact: None. Existing design/revision persistence and server-owned commerce invariants remain unchanged.
- API impact: No DTO or route-shape change. `POST /api/design/generate` continues to use the existing shared request/response schemas; the browser may call it for each server-generated option while preserving the original questionnaire context.
- Approval status: `APPROVED`
- Approved by: Autonomous Tech Lead
- Approval date: 2026-07-22
- Implementation branch or commit: `fix/mvp-browser-integration`; final diff and generated lockfile link remain subject to focused tests and `pnpm validate`.

### DEC-P35-BACKEND-PRODUCTION-BUNDLE-001 — Bundle Backend-owned workspace sources for production startup

- Date: 2026-07-22
- Proposed by Agent: QA Backend Production Packaging Fix Agent
- Affected modules: `apps/backend` build configuration, generated `pnpm-lock.yaml` metadata, and the existing Backend dependencies on `@mystcrag/database`, `@mystcrag/ai-agent`, and `@mystcrag/design-contract`
- Decision: Compile the Backend entry point as a Node.js ESM bundle with `esbuild`, resolving the three Backend-consumed workspace packages to their source entry points. Generate the Prisma client before bundling. Keep Backend-direct Fastify and Zod dependencies external, and bundle the Database package's generated Prisma client, PostgreSQL adapter, and transitive runtime graph so their resolution remains rooted in the owning Database package. The emitted `apps/backend/dist/index.js` must run directly with Node.js without relying on workspace package exports that point at TypeScript source. Add a module-local smoke command that starts that exact artifact against configured PostgreSQL, verifies `/health`, sends `SIGTERM`, and requires a clean exit.
- Rationale: Plain `tsc` only emits files under `apps/backend/src`. Its output preserves bare workspace imports, but the current private workspace packages intentionally export TypeScript sources whose internal ESM imports refer to non-emitted `.js` files. `node dist/index.js` consequently fails before startup. Bundling the Backend-owned runtime graph produces an executable application artifact; Fastify and Zod keep normal Backend dependency resolution, while Database-owned Prisma and PostgreSQL imports keep the resolution context lost when Database source is inlined into the Backend bundle.
- Rejected alternatives: Running `tsx src/index.ts` as production; committing generated JavaScript beside every workspace source; changing all package exports and build ownership across Database, AI Agent, and Design Contract; externalizing Database-owned Prisma/PostgreSQL dependencies after moving their importing source into the Backend bundle, which breaks strict pnpm resolution from `apps/backend/dist`.
- Contract impact: None. Design DTOs, schemas, validation, and provider trust boundaries are unchanged.
- Database impact: None. Prisma schema, migrations, generated-client semantics, repository behavior, and transaction boundaries are unchanged. Prisma generation is an explicit build prerequisite only.
- API impact: None. Routes, authentication, error semantics, and response bodies are unchanged.
- Approval status: `APPROVED`
- Approved by: Autonomous Tech Lead
- Approval date: 2026-07-22
- Implementation branch or commit: `fix/qa-backend-production-start`; the validated commit hash is recorded in the Git handoff because a commit cannot contain its own SHA.

---

### DEC-KNOWLEDGE-SYSTEM-002 — Rule Compiler semantics for Active Decision Rules

- Date: 2026-08-21
- Proposed by Agent: Knowledge System Agent
- Affected modules: `packages/knowledge-core` (new `src/compiler/rule-compiler.ts` and `KnowledgeCore.compileActiveRules` facade), `packages/design-contract` (consumed `DecisionRuleSchema`)
- Decision: The Rule Compiler compiles the published APPROVED knowledge version into Active Decision Rules as a pure deterministic function. Knowledge types map onto the task-book section 17 ladder as MATERIAL_COMPATIBILITY→P3, COLOR_THEORY→P4, STYLE_RULE→P5, CULTURAL_SYMBOLISM/TAROT→P6, structural composition types→P7, MARKET_OBSERVATION→P8. Within NEGATIVE_RULE, material-subject prohibitions compile as HARD P3 constraints while color-subject clashes stay SOFT P4. Rule weight = confidence × strongest cited source authority; sources below a 0.6 authority threshold are dropped. Conflict detection groups by (type, subject, relation, canonical applicability conditions): rules guarded by different conditions are complementary situations and both survive, while divergent unconditional rules on the same key resolve by priority, weight, confidence, then id. Context-driven subjects (`tarot:`/`style:`/`emotion:` prefixes) generate conditions on the `contextTaxonomyRefs` fact; all other subjects generate conditions on `designTaxonomyRefs`; authored rule conditions are preserved verbatim. `KnowledgeCore.compileActiveRules` caches context-free compiles per (knowledge version, catalog version, scope) with a 32-entry cap; context-scoped compiles always recompile.
- Rationale: Task book section 18 requires the compile pipeline to be deterministic and to include relevance, credibility, status, context, feasibility, dedup, conflict, priority, and weight steps. Situation-aware conflict grouping preserves the curated handbook's style-conditional rule pairs (e.g. cool-harmony variants for ethereal vs modern styles) that naive (type, subject, relation) grouping would discard; it keeps the E2E-2 cold-start corpus above the 100-rule floor (94→≥100 compiled rules from the 116-rule fixture corpus).
- Rejected alternatives: Reusing the review-chain `detectRuleConflicts` directly (payload-divergent groups ignore applicability conditions and over-drop complementary rules); priority derived from source authority; HARD color-level negative rules (over-constrains soft aesthetics guidance); caching context-scoped compiles (unbounded cache keyed by user context).
- Contract impact: None. `DecisionRuleSchema` is consumed as-is; no schema changes.
- Database impact: None. Reads use the existing knowledge repository production queries.
- API impact: None yet. The compiled rule set feeds EPIC 9 design generation and the planned `/api/design/suggest` caching path.
- Approval status: `APPROVED`
- Approved by: Autonomous Tech Lead
- Approval date: 2026-08-21
- Implementation branch or commit: `feat/knowledge-system` worktree, EPIC 8 Rule Compiler commit.

---

### DEC-KNOWLEDGE-SYSTEM-003 — Adopt json-rules-engine for condition evaluation with a typed scoring layer (ADR-6 spike outcome)

- Date: 2026-08-21
- Proposed by Agent: Knowledge System Agent
- Affected modules: `packages/knowledge-core` (spike test `tests/engine-spike.test.ts`, `json-rules-engine` devDependency), planned `packages/design-engine` evaluation layer
- Decision: Adopt `json-rules-engine@7` as the rule evaluation engine for the decision pipeline. The spike proves the full compiled fixture corpus (≥100 Active Decision Rules) loads and evaluates: facts gate firing (`designTaxonomyRefs`/`contextTaxonomyRefs`), `all`/`any`/`not` composites evaluate correctly, engine `priority` (inverted ladder rank: `8 - P{N}`) surfaces HARD rules ahead of SOFT guidance, and evaluation is deterministic across repeated runs. Two documented adaptations: (1) the engine requires the conditions root to be a single `all`/`any`/`not`/`condition` node, so bare compiled conditions are wrapped in a single-child `all` conjunction — semantically identical; (2) the engine emits binary events without weights, hardness, or knowledge provenance, so a Mystcrag typed scoring layer must join fired event rule ids back to the compiled rule set to compute `Σ SoftRuleScore` and verify 100% HARD satisfaction.
- Rationale: Task book section 19 mandates spiking json-rules-engine before any custom engine and forbids rewriting a full rule engine for a small gap. The spike confirms the only gaps are the conditions-root wrap (one-line adapter) and weighted scoring (explicitly planned as the typed layer per spec ADR-6), so adoption is the cheapest correct path.
- Rejected alternatives: Building a custom condition evaluator (forbidden without a failed spike); adopting the engine for scoring too (no weighted scoring support; events are binary); changing `DecisionRuleSchema` conditions to always wrap roots in `all` (pushes engine-specific shape into the contract; the wrap belongs to the evaluator adapter).
- Contract impact: None. `DecisionRuleSchema` unchanged; the wrap is an evaluator-side adaptation.
- Database impact: None.
- API impact: None.
- Approval status: `APPROVED`
- Approved by: Autonomous Tech Lead
- Approval date: 2026-08-21
- Implementation branch or commit: `feat/knowledge-system` worktree, EPIC 8 spike commit.

---

### DEC-KNOWLEDGE-SYSTEM-004 — Tarot worktree merge order and Context Resolver unification (EPIC 7)

- Date: 2026-08-21
- Proposed by Agent: Knowledge System Agent
- Affected modules: `packages/context-resolver` (new), `packages/tarot-engine` (consumed), `packages/design-contract` (consumed), `apps/backend` tarot module (deferred to EPIC 9 wiring)
- Decision: (1) **Merge order (spec §9 registration)**: the in-flight `tarot-guided-integration` branch (03e5ad7) was merged into the knowledge-system branch after EPIC 8 (02a46de) in commit 27fedd8. Preserved as-is per spec §9: the server-authoritative session model, `tarot-engine` pure engine (card catalog, draw session, spreads, deterministic RNG), TarotSession persistence, the backend tarot module with its 6 endpoints, question encryption, and the frontend tarot entry/results flow. The tarot-specific `scoreTarotMaterials` (40/25/15/10/10 weighted scoring) stays behind the runtime flag at this merge point and is not deleted; it retires when the design-engine path consumes the unified pipeline, so the merge stays reversible. (2) **Context Resolver design**: `packages/context-resolver` exposes three deterministic resolvers — `resolveQuestionnaireContext`/`resolveManualContext` (legacy raw tags normalized onto canonical taxonomy ids via `resolveTaxonomyId`; unknown tags are dropped as recorded issues, never fatal) and `resolveTarotContext` (knowledge TAROT-domain rules matched by subject take precedence and map into soft preferences only; uncovered cards fall back to `tarot-engine` design signals — tones from `designTags.colors`, emotions from card keywords; rule provenance lands in `contextWeights` as `confidence × TAROT_SOURCE_WEIGHT`). `mergeContexts` unifies 1–4 sources: source list deduplicated by `sourceType`, preferences/avoidances/hard-constraint id lists unioned with first-occurrence order, context weights keyed per source, and hard constraints taken from the first non-tarot source so tarot never overrides P0/P1/P2 hard constraints. Context ids are content-addressed (SHA-256 of the canonical input projection, 12-hex prefix) so identical inputs yield identical ids for downstream caching.
- Rationale: Spec §9 explicitly requires the tarot worktree merge order to be registered in DECISION_LOG, and ADR-10 redirects tarot recommendation generation into the knowledge pipeline as soft preferences (never hard constraints, no deterministic fortune claims). Content-addressed context ids make `/api/design/recommend` responses cacheable and reproducible; taxonomy normalization keeps the resolver deterministic while tolerating legacy questionnaire values.
- Rejected alternatives: Deleting `scoreTarotMaterials` at merge time (irreversible while EPIC 9 wiring is pending; violates "keep changes within the assigned module" until the replacement path lands); letting tarot sources set hard constraints (violates ADR-10 compliance red line); merging questionnaire and tarot as a single monolithic resolver (loses per-source weights and provenance); counter- or timestamp-based context ids (non-deterministic, breaks caching and replay).
- Contract impact: None. The package consumes `RecommendationContextSchema` from `@mystcrag/design-contract` as-is; no schema changes.
- Database impact: None.
- API impact: None yet. The resolver feeds the planned `POST /api/design/recommend` endpoint (EPIC 9 design-engine integration).
- Approval status: `APPROVED`
- Approved by: Autonomous Tech Lead
- Approval date: 2026-08-21
- Implementation branch or commit: `feat/knowledge-system` worktree, EPIC 7 Context Resolver commit.

---

### DEC-KNOWLEDGE-SYSTEM-005 — Design Engine as a pure deterministic pipeline with the ADR-6 typed scoring layer (EPIC 9)

- Date: 2026-08-21
- Proposed by Agent: Knowledge System Agent
- Affected modules: `packages/design-engine` (new), `packages/design-contract` (consumed), `tests/architecture.test.mjs` (boundary extensions)
- Decision: `packages/design-engine` implements the spec §4.1 pipeline — Candidate Selection → Allocation → Quantity → Layout (all four contract strategies) → Scoring → Constraint Validation — as pure synchronous functions with zero I/O, no LLM calls, and a caller-supplied clock (`now` parameter) so generation is fully deterministic. Key mechanics: (1) **Rule set input is a structural subset** (`EngineRuleSet`: versions + `DecisionRule[]` from design-contract) so the engine never depends on knowledge-core, preserving the dependency graph (design-engine → design-contract + culori + json-rules-engine only); knowledge-core's `CompiledRuleSet` satisfies it structurally. (2) **ADR-6 typed scoring layer**: `evaluateRuleSet` runs compiled rules through json-rules-engine (spike's documented single-child `all` wrap; `priority = 8 - P{N}`), joins fired event rule ids back to the rule set, sums `Σ weight × confidence` over fired SOFT rules, and treats fired HARD rules with negative relations (`conflicts-with`, `avoid`, `forbidden-claims`) as violations. (3) **Scoring formula `design-score-v1`**: six contract sub-scores; color blends culori OKLCH pair harmony (canonical color taxonomy → representative hex fixture) with context color-preference coverage at 60/40; composition is strategy-native (mirror symmetry / focal centring / rhythm regularity / lightness monotonicity); constraint = 100 − 25×violations; overall = 0.22 color + 0.18 material + 0.15 style + 0.20 composition + 0.25 constraint. (4) **Layout**: SYMMETRIC_BALANCE builds mirrored wings from role pairs with odd-count leftovers clustered beside the focal (perfect palindromes are impossible with odd product counts); CENTER_FOCAL keeps a focal cluster central; REPEAT_RHYTHM inserts focals at regular intervals; LOW_CONTRAST_FLOW sorts by OKLCH lightness into a gradient. (5) **Quantity** fills the target inner circumference (62/38 main/accent share + top-up, bead length = `lengthAlongStringMm ?? diameterMm`, gap 0.4, elastic allowance 7) and trims under hard budgets accent-first, never below one bead per allocated product. (6) `generateDesignCandidates` returns the top 3 of the 4 strategy candidates ranked by overall score with strategy-order tiebreak; designIds and traceIds are content-addressed (SHA-256 of the canonical input projection) for cacheable `/api/design/recommend` responses. Architecture tests extended: frontend may not import design-engine/context-resolver; design-engine may not import database/knowledge-core/ingestion/bracelet-engine/ai-agent; context-resolver may not import database/knowledge-core/design-engine; ai-agent may not import the database package.
- Rationale: Spec §4.3 fixes design-engine's module boundary (design-contract + culori) and ADR-2 reserves authoritative composition decisions for the engine while ai-agent narrows to explanation; ADR-6 requires the typed scoring layer on top of json-rules-engine's binary events; the test strategy demands same-input determinism (100 runs) and explicit score formulas ("no magic score"). The structural-subset rule set input decouples compile-time (knowledge-core) from evaluate-time (design-engine) so MCP and backend can reuse the engine without dragging Prisma.
- Rejected alternatives: depending on knowledge-core for the `CompiledRuleSet` type (violates the dependency graph and would leak Prisma into mcp-server consumers); letting the engine own timestamps via `Date.now()` (breaks determinism and replay); perfect-palindrome symmetric layout (impossible with odd bead counts — honest mirror-pair construction with a small focal-adjacent asymmetric core instead); random or catalog-order candidate diversity (non-deterministic; strategy-based diversity instead); per-strategy quantity plans (duplicated fill logic with identical results).
- Contract impact: None. Consumes `RecommendationContext`, `CatalogMaterialProduct` (as a Pick), `DecisionRule`, `BeadV1`, `BraceletV1`, `DesignScore`, `DesignDecisionTrace`, `LayoutStrategy` as-is; outputs contract-schema-valid beads and traces.
- Database impact: None. Stock arrives as an injected `ReadonlyMap` snapshot; the engine never queries.
- API impact: None yet. `generateDesignCandidates`/`evaluateDesignDraft` feed the planned `POST /api/design/recommend` and `/api/design/evaluate` endpoints (EPIC 10 backend wiring).
- Approval status: `APPROVED`
- Approved by: Autonomous Tech Lead
- Approval date: 2026-08-21
- Implementation branch or commit: `feat/knowledge-system` worktree, EPIC 9 design-engine commit.

---

### DEC-TAROT-PREFERENCE-001 — Isolate saved Tarot design preferences behind a Backend port

- Date: 2026-08-20
- Proposed by Agent: Tarot guided integration review
- Affected modules: `apps/backend`, Tarot recommendation orchestration, future user-preference persistence adapter
- Decision: `TarotService` consumes an optional owner-scoped `TarotPreferencePort` that returns a saved wrist circumference and optional min/max budget. Values are validated before catalog scoring or Design persistence. Production explicitly wires a no-store adapter that returns `undefined`, preserving the 155 mm wrist default and no-hard-budget behavior until a real preference store exists.
- Rationale: The recommendation service must be able to consume saved preferences without coupling Tarot orchestration to a not-yet-approved persistence model. The explicit no-store adapter makes the current integration cost visible and prevents an accidental plaintext, ad-hoc, or cross-module preference store.
- Rejected alternatives: Hard-code 155 mm permanently; infer preference persistence from questionnaire requests; add an unreviewed database table; make budget a catalog hard filter.
- Contract impact: None. Preferences remain server-side generation inputs and are not added to the Tarot request DTO.
- Database impact: None today. A future saved-preference store requires a separately reviewed adapter and persistence decision.
- API impact: None. Existing request and response schemas are unchanged.
- Approval status: `APPROVED`
- Approved by: Tarot integration task owner through binding review ruling
- Approval date: 2026-08-20
- Implementation branch or commit: `codex/tarot-guided-integration`; exact fix-round commit is recorded in the Task 5 report.

---

### DEC-KNOWLEDGE-SYSTEM-006 — Deterministic recommendation API with an immutable decision-trace sidecar and operation-script optimization (EPIC 10)

- Date: 2026-08-21
- Proposed by Agent: Knowledge System Agent
- Affected modules: `apps/backend` (new `recommendation.service.ts`, `recommendation.controller.ts`, `recommendation.routes.ts`), `packages/design-contract` (new `recommendation-api.schema.ts`), `packages/database` (new `DesignDecisionTrace` model + repository + migration), `apps/frontend` (questionnaire wizard, DIY editor, design-api client)
- Decision: The Backend gains a `RecommendationApplicationService` that orchestrates the EPIC 7–9 stack behind five authenticated endpoints: `POST /api/design/recommend` resolves a `RecommendationContext` (context-resolver), compiles active `APPROVED` rules (knowledge-core), generates at most three candidates (design-engine), re-prices through the authoritative `PriceStore`, validates inventory, persists each candidate as a revision-1 design, and appends a decision-trace sidecar row; `POST /api/design/evaluate` re-scores a persisted design and flags `traceStale` when later edits outdate its trace; `POST /api/design/optimize` regenerates a layout that preserves `lockedComponentIds` and returns a finite `ADD/MOVE/REMOVE/REPLACE_COMPONENT` operation script the client applies through the existing revisioned `POST /api/design/update` (so undo and the 50-step history stack keep working); `GET /api/design/:id/trace` returns the latest immutable trace; `GET /api/materials/:id/suggest` ranks at most eight partner materials by color harmony plus tag affinity. Traces live in the new `design_decision_traces` table — one immutable row per `(designId, revisionNumber)`, `JSONB` payload, update/delete rejected by trigger, restrictive design FK. Recommendation is idempotent: engine design IDs are content-addressed, an identical re-request returns the same persisted candidates, and a content-addressed ID colliding with an owner-edited design falls back to a fresh ID instead of failing. The frontend questionnaire wizard replaces its three concurrent `generate` fan-outs with one `recommend` call; the DIY editor adds a one-click optimize button (operations applied through the normal edit path with undo) and a selection-scoped material suggestion panel.
- Rationale: Spec §7.1 (ADR-1 traceability) requires every generated design to carry an auditable record of which rules fired and why the layout was chosen, without polluting the public `DesignV1` contract; a sidecar table satisfies both. Returning optimization as an operation script keeps all mutations on the single revisioned, consent-guarded Update path — the server never silently overwrites a user's design. Content-addressed IDs make recommend cacheable and retry-safe, matching the idempotency discipline already used by orders and Tarot recommendations. One `recommend` call replaces three `generate` calls, cutting backend load and giving the client a deterministic, scored, ranked candidate list.
- Rejected alternatives: persisting traces inside the `DesignV1` snapshot (mixes audit data into the public DTO and breaks schema compatibility for existing designs); letting optimize write a new revision server-side (bypasses optimistic-revision control, undo, and the user's explicit apply step); a recommendation-specific table duplicating design snapshots (the design already persists; the sidecar stores only decisions); keeping the three-way `generate` fan-out in the questionnaire (three independent LLM-free generations produce unranked duplicates, triple catalog/pricing work, and no score comparison); rebuilding material suggestions with an LLM call (deterministic color-harmony ranking is sufficient and stays free of I/O).
- Contract impact: Additive. `@mystcrag/design-contract` exports the new `recommendation-api.schema.ts` DTOs (`RecommendDesignRequest/Response`, `EvaluateDesignRequest/Response`, `OptimizeDesignRequest/Response`, `DesignTraceResponse`, `MaterialSuggestResponse`, `RecommendedDesignCandidate`, `MaterialSuggestion`). Existing schemas are unchanged; all new schemas are `strictObject` and reuse the shared identifier, locale, currency, and minor-amount primitives.
- Database impact: Additive. New `DesignDecisionTrace` Prisma model mapped to `design_decision_traces` with a unique `(designId, revisionNumber)` index, `JSONB` trace validated on read/write, immutability trigger, and `Restrict` design FK; migration `20260821100000_add_design_decision_traces`.
- API impact: Additive. Five new authenticated, owner-scoped endpoints documented in `API_SPECIFICATION.md` (Design Recommendation API section). No existing route changes; stable error codes are reused (`CONFLICT` for stale revisions, `VALIDATION_ERROR` for unknown locked components, `NOT_FOUND`/`FORBIDDEN` ownership discipline).
- Approval status: `APPROVED`
- Approved by: Autonomous Tech Lead
- Approval date: 2026-08-21
- Implementation branch or commit: `feat/knowledge-system` worktree, EPIC 10 recommendation API commit.

---

### DEC-KNOWLEDGE-SYSTEM-007 — MCP server as a thin dual-transport projection over knowledge-core and design-engine (EPIC 11)

- Date: 2026-08-21
- Proposed by Agent: Knowledge System Agent
- Affected modules: `apps/mcp-server` (new app: `src/tools.ts`, `src/server.ts`, `src/runtime.ts`, `src/index.ts`, `src/deps.ts`, `src/projection.ts`, `tests/tools.test.ts`), `tests/architecture.test.mjs`, `turbo.json`, `packages/database/src/mappers/catalog-mapper.ts` (shared `toContractCatalogMaterials`), `packages/knowledge-core/src/catalog.ts` (shared `catalogFeasibilitySnapshotOf`), `packages/design-engine/src/palette.ts` (`recommendPalettes`)
- Decision: `@mystcrag/mcp-server` exposes exactly five tools — `search_knowledge`, `get_rules`, `get_material_compatibility`, `recommend_palette`, `evaluate_design` — on the official `@modelcontextprotocol/sdk` `McpServer` with Zod `strictObject` input schemas. Tools consume narrow dependency ports (`KnowledgeSearchPort`, `CatalogPort`, `StockPort`) so tests wire in-memory fakes; the composition root `src/runtime.ts` alone constructs Prisma (`createPrismaClient`), `KnowledgeCore` (with `HashEmbeddingProvider` so the vector channel matches the worker), `ProductRepository`, and `InventoryRepository`. Both transports ship in one entrypoint: stdio (default; all logs go to stderr so the JSON-RPC stream stays clean) and stateless Streamable HTTP (`POST /mcp`, one transport+server per request, no session id, DNS-rebinding-protected via the SDK's `createMcpExpressApp`). Rule responses use a public projection (`ruleId`, type, domain, subject, relation, confidence, summary) that hides fingerprints, source references, and version bookkeeping. `recommend_palette` delegates to the new pure `recommendPalettes` in design-engine (OKLCH pair harmony), and `evaluate_design` runs the same catalog→context→compile→evaluate pipeline as the Backend recommend API through shared `toContractCatalogMaterials` / `catalogFeasibilitySnapshotOf` helpers.
- Rationale: Task book §36/37 and ADR-12 require official-SDK MCP exposure with zero business-logic duplication; ports keep the tool layer testable without a database, and the shared catalog mappers guarantee the MCP `evaluate_design` and the Backend `/api/design/recommend` see byte-identical catalog views (same `productCatalogVersion`). Resolves spec open question 3.2: both transports are supported — stdio for local/editor clients, stateless HTTP for containerized or remote clients — because the stateless pattern needs no session store and survives horizontal scaling.
- Rejected alternatives: reimplementing retrieval/scoring inside the MCP layer (business copy, violates architecture tests); routing the Backend through MCP (ADR-12 explicitly forbids; adds a network hop and an LLM-client dependency the main chain must not have); stateful HTTP sessions (requires sticky routing and a session store for no current benefit); Fastify adapter (SDK 1.30 ships a first-party Express adapter with DNS-rebinding protection; Backend's Fastify stays untouched because MCP is a separate process).
- Contract impact: None. `@mystcrag/design-contract` is unchanged; MCP input schemas are transport-local Zod schemas validated before any knowledge-core call.
- Database impact: None. Read-only access to existing tables through existing repositories.
- API impact: Additive, separate protocol. Documented in `API_SPECIFICATION.md` (MCP Knowledge Tools API section). No HTTP routes on the Backend change.
- Approval status: `APPROVED`
- Approved by: Autonomous Tech Lead
- Approval date: 2026-08-21
- Implementation branch or commit: `feat/knowledge-system` worktree, EPIC 11 MCP server commit.

---

## New decision template

### P3-NNN — Short decision title

- Date:
- Proposed by Agent:
- Affected modules:
- Decision:
- Rationale:
- Rejected alternatives:
- Contract impact:
- Database impact:
- API impact:
- Approval status: `PROPOSED`
- Approved by:
- Approval date:
- Implementation branch or commit:
