# Mystcrag Phase 3 Integration Checklist

Use this checklist for every Agent handoff and repeat it during Tech Lead merge review.

## Branch and scope

- [ ] `git branch --show-current` matches the assigned Phase 3 branch.
- [ ] The branch baseline is the latest reviewed `main` commit available when work began.
- [ ] `git status` contains no unrelated or unaccounted changes.
- [ ] The diff changes only the Agent's owned module, owned tests, and role report.
- [ ] No other Agent's branch was merged into this branch.

## Shared decisions and documentation

- [ ] The handoff explicitly states whether a shared protocol or shared asset changed.
- [ ] Every shared change has a prior entry in `docs/DECISION_LOG.md` with Tech Lead approval.
- [ ] Contract, architecture, API, database, AI-contract, or 3D-contract changes update their controlling document in the same approved change.
- [ ] The role report and handoff list changed files, limitations, unfinished work, dependencies, and merge risks.

## Contract and API compatibility

- [ ] `@mystcrag/design-contract` remains the single source of design types, schemas, DTOs, and invariants.
- [ ] `schemaVersion: "1.0.0"`, camelCase wire JSON, component identity, order, money, consent, compliance, and immutable-snapshot rules remain consistent.
- [ ] API requests and successful responses pass the shared DTO schemas.
- [ ] Stable API errors and request IDs remain compatible.
- [ ] Client-supplied owner identity, prices, totals, costs, and inventory are not trusted.
- [ ] Database models, JSON validation, BIGINT minor-unit conversion, revisions, and order snapshots remain compatible.
- [ ] Frontend imports and renders only Public DTOs and never imports database or internal commercial types.
- [ ] 3D consumes validated `DesignV1` through `designV1ToSceneDescriptor` or its approved adapter boundary.
- [ ] AI provider output is treated as `unknown`, passes `AiDesignCandidateSchema`, is enriched by trusted inputs, and passes `DesignV1Schema` before use.
- [ ] Commercial cost fields, supplier references, hidden reasoning, prompts, and private conversations do not leak into public DTOs, logs, Frontend, community views, or 3D descriptors.

## Verification and merge gate

- [ ] Focused tests for the changed module pass.
- [ ] New behavior includes appropriate positive, negative, boundary, and privacy/contract tests.
- [ ] `pnpm validate` passes on the final branch commit, including lint, TypeScript, tests, Prisma validation, Backend build, and Frontend production build.
- [ ] Tech Lead reviewed the final diff and handoff evidence.
- [ ] After merge, `pnpm install` passes on `main`.
- [ ] After merge, `pnpm validate` passes on `main`.
- [ ] If the post-merge gate fails, the merge train is stopped before the next branch.
