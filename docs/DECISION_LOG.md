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
