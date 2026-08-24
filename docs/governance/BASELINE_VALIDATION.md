# Baseline Validation

**Closure task:** BASE-004<br>
**Freeze date:** 2026-08-25<br>
**Integrated P0 code anchor:** local `main` at `8d31f28` before the documentation-only freeze commit<br>
**Baseline commit:** the commit targeted by annotated tag `baseline/v0.1.0-20260825`<br>
**Governance version:** Phase 0 governance v1<br>
**Repository health:** 89 / 100<br>
**Decision:** `READY`

## Executive decision

The P0 baseline is ready. Governance is integrated, both schema consolidations were reviewed and merged in the required serial order, all repository gates pass, and an isolated authenticated browser smoke exercised the persisted recommendation-to-DIY path. No FEAT-018 or AUTH implementation was included.

Governance integration remains scoped to its reviewed chain. User-preexisting `apps/frontend/next-env.d.ts`, `docs/audit/`, and `docs/progress/` changes were not imported into the governance or schema tasks.

## P0 closure result

| Item | Result | Integrated evidence |
| --- | --- | --- |
| Governance candidate | PASS | Reviewed governance/audit chain integrated without unrelated business source or user-preexisting files. |
| BASE-002 | DONE | `d5d6fc3` + `be5646b`; Design Contract is the sole runtime authority for public Tarot schemas. |
| BASE-003 | DONE | `9370ad4` + `f2c03f2` + `8d31f28`; AI bead-layout and backend catalog-draft concepts have distinct names and owners. |
| Serial merge rule | PASS | BASE-003 was claimed only after BASE-002 was integrated and registered `DONE`. |
| Runtime duplicate scan | PASS | No runtime definition or export of the old `AiDesignCandidateSchema` / `AiDesignCandidate`; Tarot Engine consumes Design Contract public schemas. |
| Architecture enforcement | PASS | 15/15 architecture/lifecycle tests, including negative probes for old AI names and duplicate schemas. |

## Full validation results

All commands ran in the clean BASE-004 candidate worktree. No configuration was weakened and no failing test was removed or skipped.

| Gate | Result | Evidence |
| --- | --- | --- |
| Frozen dependency install | PASS | `pnpm install --frozen-lockfile` |
| Lint | PASS | `pnpm lint`; 15/15 Turborepo tasks |
| Typecheck | PASS | `pnpm typecheck`; 15/15 tasks |
| Unit/integration/architecture tests | PASS | `pnpm test`; all 15 workspace tasks, architecture 15/15 |
| Production build | PASS | `pnpm build`; all 15 workspace tasks and Next routes compiled |
| Prisma schema | PASS | `pnpm --filter @mystcrag/database exec prisma validate` |
| Repository validation | PASS | `pnpm validate`; 15/15 tasks |
| Fresh PostgreSQL migrations/tests | PASS | 12/12 migrations; database 65/65; 13 live transaction/trigger/FK/idempotency/Tarot checks |
| Fresh PostgreSQL seed verification | PASS | 12/12 migrations; seed and 1/1 verification; 20 crystals, 96 material products, 4 accessories |
| Isolated authenticated browser smoke | PASS | Dedicated frontend/backend ports; authenticated profile, protected APIs, six-step AI flow, three persisted designs, matching 25-bead DIY view, desktop/mobile navigation; console 0 errors/0 warnings |

The dedicated audit databases `mystcrag_baseline_test_20260825_01` and `mystcrag_baseline_seed_test_20260825_01` are retained for audit because deletion was not authorized. Browser evidence is retained under the ignored `output/playwright/base-004-freeze/` path in the BASE-004 worktree.

## Frozen canonical contracts

- `CANONICAL_TAROT_SCHEMA`: `packages/design-contract/src/schemas/tarot.schema.ts`; Tarot Engine owns only deck/draw/private-state mechanics.
- `AiBeadLayoutCandidateSchema`: AI-owned untrusted/provider-produced contiguous bead-layout proposal.
- `CatalogDesignGenerationDraftSchema`: backend-owned catalog-selected generation draft with provider/Tarot provenance.
- Neither AI schema belongs in Design Contract, and no compatibility alias for the ambiguous old name is authorized.

## Remaining work after baseline

### Baseline P0

None.

### FEAT-018 / AUTH decision gate

Implementation remains blocked until the Human Product Owner resolves identity provider strategy, callback/deployment domains, and browser session topology. The proposal is to reuse the existing provider-neutral auth boundary, separate callbacks by environment, use server-controlled `HttpOnly`, `Secure`, appropriately `SameSite` cookie sessions, and never place long-lived sensitive tokens in `localStorage`. AUTH-003 through AUTH-006 have not started.

### P1

- Production identity/session and deployment contract after Product Owner decisions.
- Reproducible authenticated browser E2E in CI.
- Reconcile stale architecture/catalog/3D status documents.
- Decide lifecycle of dormant editor/3D/backend shells, service wrappers, `DesignTemplate`, and asset/export divergence.

### P2

- Audit and retire or justify explicit compatibility surfaces.
- Split concentration hotspots only under behavior-preserving owner tasks.
- Review branch/worktree metadata before owner-approved cleanup.

## Freeze rule

The annotated tag `baseline/v0.1.0-20260825` must target the exact final local `main` commit containing this record. Remote publication is a separate user-authorized action. FEAT-018 may proceed only to Product Owner decision and dispatch preparation; no Feature implementation is authorized by this baseline record alone.
