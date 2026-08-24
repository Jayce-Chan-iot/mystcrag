# QA Evidence Cleanup Plan

**Task:** TASK-REPO-001
**Owner:** QA
**Branch:** `task/repo-001-evidence-retention`

## Preserve by default

- `docs/ui-references/**` canonical UI references.
- Files cited by current controlling or release reports unless their citation is intentionally updated.
- `outputs/knowledge-acquisition/**` machine-readable knowledge coverage.
- Spreadsheet deliverables, validators, and their user-facing previews.
- Runtime assets under `apps/frontend/public/**`.

## Execution

1. Enumerate tracked QA/output candidates and record count/size by location.
2. Hash candidates and identify byte-for-byte duplicates.
3. Search code and documentation for directory and exact-file references.
4. Choose one canonical file from each duplicate group using current-doc citation, curated location, and descriptive naming in that order.
5. Remove duplicate copies and clearly reproducible raw capture sets that have no current evidentiary value.
6. Update `.gitignore` so regenerated raw evidence does not return.
7. Record retained categories, deleted paths/count/bytes, and recovery method.
8. Run `pnpm validate`, path checks, `git diff --check`, and inspect every deletion.

## Safety gate

Do not delete a unique or cited file merely because it lives in an output directory. Git history is the recovery mechanism for committed deletions; the final report must identify the cleanup commit/branch state.
