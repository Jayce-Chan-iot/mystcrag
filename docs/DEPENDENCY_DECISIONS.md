# Dependency Decisions

## DEC-COMMERCE-001 — Medusa for Phase 1 finished-goods commerce

**Task:** TASK-COMMERCE-OSS-SELECT-001
**Product Owner decision:** 2026-10-11 — approve Medusa as the sole finished-goods commerce authority for the first self-operated site
**State:** architecture selection only; no package, runtime, schema, production service, payment provider or deployment has been added

The reviewed `TASK-COMMERCE-OSS-FIT-001` report at commit `97428aa` compared Medusa, Vendure and Saleor and ran an isolated Medusa `2.21.2` PoC with a throwaway database. It verified Admin product/variant/collection entry, CN/CNY and TW/TWD manually entered region-rule prices, three-language reads, draft withdrawal and restart persistence. This fixes **Medusa `2.21.2` as the tested integration baseline**, not as an automatically installed dependency or a claim that a later release is equivalent. The first implementation task must recheck the official license, Node compatibility, exact resolved package versions and upstream security notices before pinning dependencies; any version change requires a documented compatibility probe and review.

### Version recheck addendum — TASK-COMMERCE-MEDUSA-BASE-001 (2026-10-11)

The implementing task rechecked license, Node compatibility, resolved versions and security notices before pinning. Installed and probed: `@medusajs/{admin-sdk,admin-shared,caching,cli,dashboard,draft-order,framework,medusa}@2.21.2`, `@medusajs/ui@4.2.6`, `@tanstack/react-query@5.64.2`, `react-i18next@13.5.0`, `react-router-dom@7.18.2`, `zod@4.2.0`. Dev tooling mirrors the official scaffold; notably `ts-node@^10.9.2` is required because the Medusa CLI loads `medusa-config.ts` through `require("ts-node")`, with `tsconfig.json` keeping the scaffold's `ts-node.swc` setting.

- **License:** the 2.21.2 packages ship a mixed MIT/Enterprise notice. Per the upstream `ENTERPRISE-LICENSE.md` at tag `v2.21.2`, Enterprise Materials are limited to RBAC and SSO paths; every other path, including the translation feature flag used here, is MIT. No RBAC/SSO feature flag is enabled.
- **Node:** core packages declare `^20.19.0 || >=22.12.0`; the workspace runs Node `22.22.3` and the package declares `>=22.22.0`.
- **Security notices (2026-10-11):** GitHub advisories for `@medusajs/medusa` = 0. `pnpm audit` shows the Medusa subtree introduces 15 advisory paths that the existing tree does not reach (1 critical: `proxy-addr <2.0.8`, GHSA-jqcg-44mw-7w3h, in the Express stack; 7 high; 7 moderate), all in transitive dependencies (`@medusajs/cli`, `@medusajs/deps`, `glob`, `@medusajs/utils`, the admin bundler and `bullmq`). Remediation would need registry `overrides` in the root `pnpm-workspace.yaml`, which this task was not authorized to edit; recorded here for an explicit follow-up decision.
- **pnpm 11 build gate:** `strictDepBuilds` defaults to `true` in pnpm 11, so the four build-script packages Medusa adds (`@medusajs/telemetry`, `@swc/core`, `msgpackr-extract`, `protobufjs`) must be listed in the root `pnpm-workspace.yaml` `allowBuilds` map; otherwise every workspace `pnpm install`, including the CI `--frozen-lockfile` step, exits 1 with `ERR_PNPM_IGNORED_BUILDS`. That root file is outside this task's writable paths, so the exact entries and recommended values were reported for decision instead of edited.
- **`jose` override compatibility (partially verified):** `jwks-rsa@3.2.2` (transitive under `@medusajs/auth`) declares `jose ^4.15.4` while the workspace override pins `jose 6.2.10`. Static inspection shows the four APIs `jwks-rsa` consumes (`decodeJwt`, `decodeProtectedHeader`, `importJWK`, `exportSPKI`) exist in 6.2.10, and the isolated probe's cold start plus email/password admin login exercised the auth module without errors — `jwks-rsa` was loaded, but its JWKS fetch/verify path is not reached by email/password login. That JWKS code path is **not actually verified** by this task and stays unverified until a dedicated compatibility probe covers it.
- **`@types/react` hoist guard:** pnpm 11 hoists a single version per alias into `node_modules/.pnpm/node_modules`, chosen by ascending depth then lexicographic node id. The scaffold's `@types/react@^18.3.2` / `@types/react-dom@^18.2.25` devDependencies made `@types/react@18.3.31` win the workspace hoist, breaking `@mystcrag/frontend` typecheck (React 19 sources resolving the hoisted 18 types). Because `apps/commerce` has no React source files (only tsconfig `jsx` settings) and no Medusa or `@radix-ui` package requires these types non-optionally, both devDependencies are intentionally not ported; the hoist stays at the frontend's `@types/react@19.2.17` / `@types/react-dom@19.2.3`. Verified on the committed lockfile: `pnpm --filter @mystcrag/commerce typecheck` and `pnpm --filter @mystcrag/frontend typecheck` both exit 0.

Medusa owns finished-goods Product, Variant, Collection, Price, Inventory and, only after a separately approved payment/order phase, finished-goods Order. Its Admin and Store APIs are reused. Mystcrag's existing Prisma `Crystal`/`MaterialProduct`/`AccessoryProduct`, `DesignV1`, `DesignRevision`, `DesignPublication`, DIY prices and immutable design-order snapshots remain separate, unchanged authorities. No second editable finished-goods Product/Variant/Price/Order schema is authorized in Mystcrag Prisma. Brand/designer attribution, versioned license grants and media provenance may be a minimal Medusa extension or separately owned metadata/projection; they are **not** a parallel commerce catalog.

The PoC also demonstrated that Medusa's native Store response is **not** Mystcrag's public publication authority: a missing zh-TW translation falls back to source text; missing market price returns a visible product with null calculated price; missing image remains visible; license grants are not native. The Phase 1 public read boundary must fail closed for missing/expired market authorization, unapproved media, any required reviewed translation, absent manually approved market price, draft/withdrawn status and upstream errors. Lists, details, homepage features and SEO must all read that same gated projection. Direct public access to an ungated Medusa Store endpoint or publishable key must not bypass it; the implementation plan requires a network/route exposure test, not merely a hidden frontend link.

One Medusa service with its **own database/schema and credentials** is the chosen isolation direction. It must not share the existing Mystcrag Prisma schema or connect to a user's development database. The exact host, migration/startup command, internal API route, credential custody and network exposure policy are implementation contracts to be proven in a separately registered task. Redis-backed production modules are an official strong recommendation in the reviewed report, not a claim of a hard local PoC prerequisite. Payment channels, tax, shipping, refunds and production topology remain unselected; no cart or checkout UI is authorized in this phase.

Rollback before real content is non-destructive: stop the isolated Medusa service, remove its public-read integration from the site, and leave existing DIY/design/order data untouched. Later real-content rollback must additionally preserve approved media/license records and provide export/withdrawal evidence. The detailed execution order and acceptance gates live in [the Medusa Phase 1 plan](superpowers/plans/2026-10-11-medusa-showroom-phase1.md).

No new registry runtime dependency was added in Phase 0–1. `@mystcrag/bracelet-engine` is a local workspace package using existing TypeScript/tsx tooling.

The circle interaction remains on Pointer Events because dnd-kit would still require a custom physical-slot solver and circular collision layer. Zustand/zundo, TanStack Query, Motion, Radix, and Vaul remain reviewed candidates and will be installed only if their vertical slice replaces meaningful infrastructure.

## DEC-ORACLE-001 — Star Oracle cast engine source and dependency baseline

**Task:** TASK-ORACLE-ENGINE-001, registered by TASK-ORACLE-QA-001<br>
**Verified:** 2026-09-29<br>
**State:** `DONE`; no new registry runtime dependency was added

`@mystcrag/oracle-engine` is a local workspace package (`packages/oracle-engine`) using the existing TypeScript/tsx tooling, matching `@mystcrag/bracelet-engine`. It declares no third-party runtime dependency.

The cast logic is an independent implementation of the **public-domain** three-coin I Ching method and the traditional King Wen hexagram ordering. The design phase consulted the following MIT/CC-BY-SA open-source projects as behavioral references only; no runtime dependency was added and no modern interpretation text was copied:

| Reference | License | Used for |
| --- | --- | --- |
| `limjiechao/ts-hexagram-generator` | MIT | Pure domain modeling and cast-record structure |
| `Brianfit/I-Ching` | MIT | Independent comparison for three-coin probabilities |
| `DaviRain-Su/classic_system` | MIT code; some content CC BY-SA 4.0 | Matrix and visualization structure only; no modern text copied |

The package stores only structural facts: coin outcomes, line values, trigram pairs, traditional Chinese hexagram names and King Wen numbers. It contains no fortune claim, modern commentary, crystal-effect claim, product identifier, pricing rule or user data. The source note lives in `packages/oracle-engine/UPSTREAM_SOURCE.md`.

## DEC-AUTH-002 — identity dependency and configuration baseline

**Task:** TASK-AUTH-002<br>
**Verified:** 2026-08-25<br>
**State:** `DONE`; SOL accepted and integrated the dependency/configuration baseline; no authentication runtime is implemented by this decision

### Frozen packages

| Package | Exact version | Owner package | Runtime/module evidence | License |
| --- | --- | --- | --- | --- |
| `@auth0/nextjs-auth0` | `4.27.0` | `@mystcrag/frontend` dependency | Official peer metadata accepts Next `^16.0.10`, React/React DOM `^19.2.1`; the official README requires Node 20 LTS or newer; ESM exports include typed server/client entry points | MIT |
| `jose` | `6.2.10` | `@mystcrag/backend` dependency | Official v6 is universal ESM targeting ES2022 and supports Node.js/WebCrypto; the repository Backend is already ESM. Package declarations compile under the repository TypeScript `6.0.3` gate | MIT |
| `@playwright/test` | `1.62.1` | root development dependency | Registry engine is Node `>=20`; official Playwright installation guidance supports current Node 22.x; typed Node test runner | Apache-2.0 |

The repository floor remains Node `>=22.0.0`, CI Node 22, pnpm `11.4.0`, React `19.2.7`, TypeScript `6.0.3`, and Fastify `5.10.0`. The production identity baseline is patched within the existing Next.js 16.2 line from `16.2.10` to `16.2.12`, with matching `eslint-config-next@16.2.12`; no major/minor or unrelated dependency was upgraded. Registry metadata and official releases were checked on 2026-08-25: [Next.js v16.2.12 release](https://github.com/vercel/next.js/releases/tag/v16.2.12), [Auth0 SDK repository and Next.js 16 setup](https://github.com/auth0/nextjs-auth0), [Auth0 SDK v4.27.0 release](https://github.com/auth0/nextjs-auth0/releases/tag/v4.27.0), [`jose` repository/runtime matrix](https://github.com/panva/jose), [`jose` v6.2.10 release](https://github.com/panva/jose/releases/tag/v6.2.10), [Playwright installation](https://playwright.dev/docs/intro), and [Playwright v1.62.1 release](https://github.com/microsoft/playwright/releases/tag/v1.62.1).

### Compatibility and dependency-tree result

- Auth0 SDK `4.27.0` directly declares Next `^16.0.10` and React/React DOM `^19.2.1` peer ranges, which include the frozen Next `16.2.12` and React `19.2.7` versions. Next `16.2.12` declares Node `>=20.9.0`, React/React DOM `^18.2.0 || ^19.0.0`, and optional Playwright `^1.51.1` compatibility, covering Node 22 and Playwright `1.62.1`; TypeScript `6.0.3` remains accepted by `eslint-config-next@16.2.12`. The SDK's official setup specifies root `proxy.ts` for Next.js 16 and a broad matcher for rolling sessions. `apps/frontend/proxy.ts` remains exclusively owned by AUTH-005 and was not created or edited here.
- The SDK's shipped route dispatcher handles logout only for `GET /auth/logout`. That default cannot replace the frozen public `POST /auth/logout` plus exact Origin validation. AUTH-005 must retain an explicit wrapper/custom route and prove local cookie clearing precedes upstream logout.
- pnpm reports one `@auth0/nextjs-auth0`, one `@playwright/test`, and one `jose` version. The pnpm 11 workspace override `jose: 6.2.10` makes the SDK, `openid-client`, Backend, and the pre-existing MCP SDK consumer share the reviewed version rather than retaining a second patch version.
- The SDK necessarily brings its official protocol internals (`openid-client`, `oauth4webapi`, `jose`, cookie/HKDF support, and `swr`). These are transitive implementation details, not a second application-owned Auth/OIDC/JWT stack. No forbidden direct dependency was added.
- `pnpm install --frozen-lockfile`, repository typecheck, and production build are the implementation compatibility probes for ESM declarations and TypeScript 6/Next 16 composition; AUTH-005 must additionally compile its concrete SDK wrapper before implementation handoff.

### Security and license result

Registry package metadata, official releases, and GitHub advisories were inspected, followed by `pnpm audit`. The pre-repair `16.2.10` tree reported 0 critical, 17 high, 8 moderate, and 0 low advisories. The `16.2.12` tree reports 0 critical, 13 high, 3 moderate, and 0 low. It no longer contains the Next.js Proxy bypass [GHSA-6gpp-xcg3-4w24](https://github.com/advisories/GHSA-6gpp-xcg3-4w24), Server Actions SSRF [GHSA-89xv-2m56-2m9x](https://github.com/advisories/GHSA-89xv-2m56-2m9x), rewrites SSRF [GHSA-p9j2-gv94-2wf4](https://github.com/advisories/GHSA-p9j2-gv94-2wf4), or the other Next advisories patched by `>=16.2.11`. The remaining findings are pre-existing transitive or baseline-package findings in `sharp`, `postcss`, `find-my-way`, `valibot`, `brace-expansion`, `fast-uri`, `js-yaml`, `nanoid`, and `deepmerge-ts`; they are not introduced by the Next patch or the AUTH-002 direct additions. The audit is not all green, but this repair adds no High or Critical advisory and changes no unrelated direct dependency. The selected Auth0 SDK, `jose`, and Playwright licenses remain MIT, MIT, and Apache-2.0 respectively.

### Authoritative environment-to-option mapping

AUTH-005 must read only the registered `MYSTCRAG_*` names and pass values explicitly; the SDK's implicit `AUTH0_*`/`APP_BASE_URL` fallbacks are not configuration authorities:

| Environment variable | Explicit consumer/SDK option |
| --- | --- |
| `MYSTCRAG_APP_ORIGIN` | Auth0 `appBaseUrl`; also exact Origin/redirect authority |
| `MYSTCRAG_AUTH_PROVIDER` | startup provider selector; production must equal `auth0` |
| `MYSTCRAG_AUTH_ISSUER` | exact Backend issuer; AUTH-005 validates its HTTPS Auth0 issuer form and derives the SDK `domain` explicitly |
| `MYSTCRAG_AUTH_AUDIENCE` | Auth0 `authorizationParameters.audience` and Backend exact audience |
| `MYSTCRAG_AUTH_CLIENT_ID` | Auth0 `clientId` |
| `MYSTCRAG_AUTH_CLIENT_SECRET` | Auth0 `clientSecret` |
| `MYSTCRAG_AUTH_CALLBACK_URL` | exact validation input for `${MYSTCRAG_APP_ORIGIN}/auth/callback` and the Auth0 allowlist; no inferred host |
| `MYSTCRAG_AUTH_LOGOUT_URL` | server-constructed post-logout target and exact Auth0 allowlist input |
| `MYSTCRAG_AUTH_SESSION_SECRET` | Auth0 `secret`; exactly 32 random bytes represented as 64 hexadecimal characters |

AUTH-005 must explicitly configure the stateless encrypted Cookie Session with `rolling: true`, `inactivityDuration: 28800`, `absoluteDuration: 604800`, `SameSite=Lax`, `Path=/`, no Domain, and environment-appropriate name/Secure rules from [AUTH_SESSION_CONTRACT.md](AUTH_SESSION_CONTRACT.md). Passing `sessionStore` is forbidden: no Redis, persistent SessionStore, session database, or `AuthSession` Prisma model is authorized. Provider/admin grant revocation remains bounded by the next renewal or the 15-minute Access Token maximum. Provider/JWKS/session dependency outage uses the existing HTTP `500` + `INTERNAL_ERROR` envelope.

`.env.example` remains a development template: `signed-test` is explicit development/test-only, while staging/production require isolated Auth0 clients and exact secret-managed HTTPS values. `NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN` remains temporary development/test compatibility only; AUTH-005 must remove production dependence without exposing any Token to browser JavaScript.

### Consumers, rollback, and probes

- AUTH-003 consumes no new runtime package but may start only after this task is SOL-integrated and registered `DONE`.
- AUTH-004 consumes Backend `jose@6.2.10` for exact issuer/audience/signature/expiry/JWKS verification.
- AUTH-005 consumes Auth0 SDK `4.27.0` and the frozen environment mapping; only AUTH-005 may add `apps/frontend/proxy.ts` and the POST logout wrapper.
- AUTH-006 consumes root Playwright `1.62.1` for isolated browser security/E2E coverage.
- Rollback is one revert of the AUTH-002 commit followed by `pnpm install --frozen-lockfile`; no schema, secret, provider Application, or runtime data migration exists in this task. If a later probe disproves compatibility, block the consumer task and revise this dependency decision through a new reviewed task rather than changing the AUTH-001 topology.
- Remaining implementation probes: AUTH-004 must exercise the JWKS/issuer/audience/timeout matrix; AUTH-005 must prove proxy rolling behavior, encrypted host-only HttpOnly cookie flags/lifetimes, token custody, and POST logout Origin enforcement; Operations must compare each isolated staging/production Auth0 allowlist byte-for-byte. A failed probe blocks its consumer/release.


## DEC-AUTH-011 — Authing OIDC dependency decision

**Task:** TASK-AUTH-011<br>
**Verified:** 2026-09-15<br>
**State:** `IMPLEMENTED`; live Authing tenant smoke remains operationally gated

### Selected

| Package | Exact version | Owner package | Evidence | License |
| --- | --- | --- | --- | --- |
| `jose` | `6.2.10` | frontend + backend | Already frozen via workspace override; ESM/WebCrypto; session JWE + RS256 JWKS verification | MIT |

### Rejected

| Package | Reason |
| --- | --- |
| `@authing/nextjs@0.1.2` | peer `next ^12.0.9` only; incompatible with Next 16 |
| Authing Guard / browser SDK | Browser token/localStorage model violates AUTH_SESSION_CONTRACT |
| `@auth0/nextjs-auth0@4.27.0` | Removed as the production identity SDK for Authing; no dual production stack |
| `openid-client@6.8.8` | Evaluated (MIT, ESM). Not added as a direct runtime dependency: the BFF only needs discovery document fetch, authorize URL construction, code/refresh token POST, and end_session URL — implemented with `fetch` + `jose` so Edge-safe rolling and cookie crypto stay on the already-frozen WebCrypto library without a second OIDC stack. |

### Probes

- Frontend typecheck/lint/build after removing `@auth0/nextjs-auth0`.
- Backend factory/verifier/discovery unit tests.
- Synthetic OIDC callback success/denial/outage tests.
- Secret scan: no tokens in cookie ciphertext or client-visible session projection.
