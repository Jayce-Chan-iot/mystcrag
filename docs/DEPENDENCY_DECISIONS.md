# Dependency Decisions

No new registry runtime dependency was added in Phase 0–1. `@mystcrag/bracelet-engine` is a local workspace package using existing TypeScript/tsx tooling.

The circle interaction remains on Pointer Events because dnd-kit would still require a custom physical-slot solver and circular collision layer. Zustand/zundo, TanStack Query, Motion, Radix, and Vaul remain reviewed candidates and will be installed only if their vertical slice replaces meaningful infrastructure.

## DEC-AUTH-002 — identity dependency and configuration baseline

**Task:** TASK-AUTH-002<br>
**Verified:** 2026-08-25<br>
**State:** dependency/configuration candidate in `REVIEW`; no authentication runtime is implemented by this decision

### Frozen packages

| Package | Exact version | Owner package | Runtime/module evidence | License |
| --- | --- | --- | --- | --- |
| `@auth0/nextjs-auth0` | `4.27.0` | `@mystcrag/frontend` dependency | Official peer metadata accepts Next `^16.0.10`, React/React DOM `^19.2.1`; the official README requires Node 20 LTS or newer; ESM exports include typed server/client entry points | MIT |
| `jose` | `6.2.10` | `@mystcrag/backend` dependency | Official v6 is universal ESM targeting ES2022 and supports Node.js/WebCrypto; the repository Backend is already ESM. Package declarations compile under the repository TypeScript `6.0.3` gate | MIT |
| `@playwright/test` | `1.62.1` | root development dependency | Registry engine is Node `>=20`; official Playwright installation guidance supports current Node 22.x; typed Node test runner | Apache-2.0 |

The repository floor remains Node `>=22.0.0`, CI Node 22, pnpm `11.4.0`, Next `16.2.10`, React `19.2.7`, TypeScript `6.0.3`, and Fastify `5.10.0`. No baseline version was changed. Registry metadata and official releases were checked on 2026-08-25: [Auth0 SDK repository and Next.js 16 setup](https://github.com/auth0/nextjs-auth0), [Auth0 SDK v4.27.0 release](https://github.com/auth0/nextjs-auth0/releases/tag/v4.27.0), [`jose` repository/runtime matrix](https://github.com/panva/jose), [`jose` v6.2.10 release](https://github.com/panva/jose/releases/tag/v6.2.10), [Playwright installation](https://playwright.dev/docs/intro), and [Playwright v1.62.1 release](https://github.com/microsoft/playwright/releases/tag/v1.62.1).

### Compatibility and dependency-tree result

- Auth0 SDK `4.27.0` directly declares compatible peer ranges for the frozen Next/React versions. Its official setup specifies root `proxy.ts` for Next.js 16 and a broad matcher for rolling sessions. `apps/frontend/proxy.ts` remains exclusively owned by AUTH-005 and was not created or edited here.
- The SDK's shipped route dispatcher handles logout only for `GET /auth/logout`. That default cannot replace the frozen public `POST /auth/logout` plus exact Origin validation. AUTH-005 must retain an explicit wrapper/custom route and prove local cookie clearing precedes upstream logout.
- pnpm reports one `@auth0/nextjs-auth0`, one `@playwright/test`, and one `jose` version. The pnpm 11 workspace override `jose: 6.2.10` makes the SDK, `openid-client`, Backend, and the pre-existing MCP SDK consumer share the reviewed version rather than retaining a second patch version.
- The SDK necessarily brings its official protocol internals (`openid-client`, `oauth4webapi`, `jose`, cookie/HKDF support, and `swr`). These are transitive implementation details, not a second application-owned Auth/OIDC/JWT stack. No forbidden direct dependency was added.
- `pnpm install --frozen-lockfile`, repository typecheck, and production build are the implementation compatibility probes for ESM declarations and TypeScript 6/Next 16 composition; AUTH-005 must additionally compile its concrete SDK wrapper before implementation handoff.

### Security and license result

Registry package metadata and the projects' official security policies were inspected, followed by `pnpm audit`. Before and after this task, the repository audit result is identical: 0 critical, 17 high, 8 moderate, and 0 low advisories, with the same advisory ids. All advisories affect pre-existing Next, Fastify, Prisma tooling, ESLint, PostCSS, Crawlee, and related baseline packages. The after-tree additionally displays Auth0's peer link to the already-present vulnerable Next package; it does not add an advisory id or a vulnerability in Auth0 SDK, `jose`, or Playwright. The task introduced no High or Critical advisory and did not upgrade unrelated dependencies. The selected packages' licenses are MIT, MIT, and Apache-2.0 respectively.

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
