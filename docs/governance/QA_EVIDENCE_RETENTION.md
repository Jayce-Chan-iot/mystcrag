# QA and Output Evidence Retention

**Task:** TASK-REPO-001
**Audit/cleanup date:** 2026-08-24
**Recovery baseline:** `c1262f3`

## Result

The cleanup removed 285 tracked files totaling 42,922,575 bytes (40.93 MiB). No runtime source, runtime asset, canonical UI reference, knowledge coverage JSON, current spreadsheet deliverable, or cited release screenshot was deleted.

## Method

1. Enumerated tracked files across QA, Playwright, artifact, output, and frontend capture locations.
2. Calculated SHA-256 for 332 candidate/evidence files, including the canonical UI reference set.
3. Found three exact duplicate hash groups in the raw Playwright trace; the largest groups contained 55 and 52 copies of the same resource.
4. Compared scenario names and dimensions across the two 42-file full-page capture sets.
5. Searched code and documentation for directory and exact-file references.
6. Preserved cited/current evidence and removed uncited, reproducible, superseded, or duplicate coverage.

## Removed

| Category | Files | Bytes | Reason |
| --- | ---: | ---: | --- |
| Frontend duplicate capture set | 42 | 6,451,578 | Same 7 pages × 6 viewports as another raw set; uncited and reproducible |
| Script duplicate capture set | 42 | 7,817,692 | Same scenario/viewport matrix; uncited and reproducible |
| Frontend root QA images | 12 | 2,617,000 | Ad hoc screenshots/comparisons superseded by canonical UI references |
| Gallery raw captures | 6 | 6,009,268 | Superseded by curated gallery references |
| Profile raw captures | 6 | 954,784 | Superseded by curated profile references |
| Historical QA/UX images | 47 | 8,552,536 | Older raw before/after screenshots; text verification report retained |
| Reproducible E2E artifacts | 9 | 1,916,597 | Script-generated screenshots and local absolute-path report |
| Raw Playwright trace/output metadata | 114 | 5,899,012 | Reproducible trace with extensive byte-identical resources; 15 curated screenshots retained |
| Superseded 2026-07-23 catalog output | 7 | 2,704,108 | Replaced by documented 2026-07-24 simplified template |
| **Total** | **285** | **42,922,575** | **40.93 MiB** |

## Retained

| Category | Files | Size | Reason |
| --- | ---: | ---: | --- |
| `docs/ui-references/` | 21 | 29.20 MiB | Canonical current UI references and asset-manifest evidence |
| `output/playwright/qa-rerun/` screenshots | 15 | 3.84 MiB | Release/bug reports cite this directory and an exact screenshot |
| `outputs/knowledge-acquisition/` | 5 | 0.04 MiB | Machine-readable coverage cited by Knowledge reports/plans |
| `outputs/bead-catalog-template-20260724/` | 5 | 0.17 MiB | Current spreadsheet deliverable, schema, validator, README and changelog |
| `artifacts/ux-audit-20260724/verification-report.md` | 1 | small text | Historical acceptance conclusion; screenshot names remain an index |

Runtime images under `apps/frontend/public/` were outside the deletion scope.

## Prevention policy

- Generated `artifacts/`, root `qa-captures-*`, frontend QA PNGs, script artifacts/captures, and `output/playwright/` are ignored.
- Promote only reviewed, stable UI references to `docs/ui-references/`.
- Release evidence may remain tracked only when a current report cites it and its filename describes the verified condition.
- `outputs/` is not globally ignored because it contains approved machine-readable and user-facing deliverables; each dated output requires a retention decision.

## Recovery

All deleted files are recoverable from Git commit `c1262f3` until repository history is rewritten. Example:

```bash
git restore --source=c1262f3 -- path/to/evidence
```
