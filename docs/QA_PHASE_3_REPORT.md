# Mystcrag Phase 3.5 Independent QA Rerun

Date: 2026-07-22
Role: QA Agent
Branch: `test/mvp-integration-rerun`
Final baseline: `2fa2a0a1346c9b5564deb5c6acf59d5589635de4`
Pre-sync backup: `backup/qa-rerun-pre-sync` -> `8ae159a734ad2cd38f8af11c2d9d44791b1d47c7`

## Executive result

Phase 3.5 passes independent release admission on the final remediation baseline. A fresh frozen install generated Prisma Client without a manual workaround, forced build and validation passed, and the compiled Backend bundle started against real PostgreSQL 17. The exact desktop questionnaire that previously collapsed two recommendations now produced three persisted, pairwise-distinct production sequences while honoring the `海蓝宝` exclusion.

The rerun also updated a persisted design from revision 1 to 2, accepted the Backend price change from `10800` to `10600`, saved, refreshed from PostgreSQL, and created a `PENDING` immutable order snapshot at revision 2 and `10600`. The real Three.js WebGL scene mounted on desktop and mobile. No BLOCKER, CRITICAL, or core-flow MAJOR remains open.

## Test environment

- macOS arm64, Node `v26.0.0`, pnpm `11.4.0`.
- Clean detached worktree at final baseline, with no generated Prisma Client before install.
- PostgreSQL `17.10 (Homebrew)` in an isolated cluster on `127.0.0.1:55435`.
- Separate seed-verification, live-test, and runtime databases.
- Compiled Backend `dist/index.js` on `127.0.0.1:4402`, real repository and signed development test identity.
- Optimized Next.js 16.2.10 production build on `127.0.0.1:3402`, Mock disabled.
- Headed Chromium at `1440x1000` and `390x844`.
- Curated screenshots and trace: `output/playwright/qa-rerun/`.

## Independent 33-item acceptance matrix

| # | Requirement | Status | Independent evidence |
| ---: | --- | --- | --- |
| 1 | Browser really calls Backend | PASS | Production Next proxy issued real Generate, Get, Update, Save, refresh Get, and Order requests; final core responses were HTTP 200. |
| 2 | Questionnaire fields reach Backend | PASS | Request included `quiet`, mist blue, eastern/landscape style, CNY `29900..49900`, wrist `155`, consent, and excluded `product-aquamarine-round-8`. |
| 3 | Three designs are really generated | PASS | PostgreSQL persisted Rain After Blue, Moonlit Tide, and Silver Mist with distinct design IDs and rule-based provenance. |
| 4 | Three designs are materially different | PASS | Final canonical ordered `beadProductId@diameterMm` sequences had set size 3. Rain alternated 6/10 mm, Moonlit used a 3+3 block rhythm, and Silver used a quartz-focal layout. |
| 5 | Budget logic works | PASS | Normal result was under budget; the retained low-budget browser run required explicit over-budget acceptance before selection. |
| 6 | No production Mock fallback | PASS | Optimized build used real persisted UUIDs, Backend timestamps/revisions, PostgreSQL reads, and rule-based provenance; Mock was false. |
| 7 | Generate succeeds | PASS | Three concurrent final Generate calls returned 200 and persisted revision-1 designs. |
| 8 | Get succeeds | PASS | Result, DIY, and post-save reload all loaded owner-scoped designs from Backend. |
| 9 | Update succeeds | PASS | Finite `REPLACE_COMPONENT` replaced bead 2 while retaining its `componentId`; response advanced revision 1 -> 2. |
| 10 | Save succeeds | PASS | Save returned 200 with `requestId`, validated design, warnings, and Backend `savedAt`. |
| 11 | Refresh restores | PASS | Reload restored revision 2, total `10600`, and the replacement 6 mm moonstone from PostgreSQL. |
| 12 | Publish or Order succeeds | PASS | Order `cmrvqptzn00048a8mmudt4dkm` was `PENDING`; DB joined it to immutable revision 2 and pricing snapshot `10600`. |
| 13 | Revision comes from Backend | PASS | Revision 2 came from Update and was independently restored by Get after reload. |
| 14 | Price comes from Backend | PASS | Backend changed total `10800` -> `10600`; UI required price acknowledgement before continuation. |
| 15 | Real Three chunk loads | PASS | DIY loaded the dynamic Three boundary; production mode did not preload it on the questionnaire/results route. |
| 16 | Canvas/Scene mounts | PASS | Final desktop and mobile had one Canvas, visible WebGL beads, scene timing, and 3 draw calls after update/reload. |
| 17 | `componentId` hit testing | PASS | Retained independent canvas-click evidence selected an exact stable `componentId`; final baseline also passed Three hit-test tests and list selection identity. |
| 18 | Backend-confirmed replacement | PASS | Selected bead 2 retained `component-c9cc8804-5c9e-4f98-8d24-52beeac2e441`, became 6 mm, and remounted from revision 2. |
| 19 | PostgreSQL live tests | PASS | Dedicated migrated empty DB ran 17/17 live tests against PostgreSQL 17.10. |
| 20 | Migration and seed twice | PASS | Migration applied 1/1; seed ran twice; seed verification retained exact fixture counts and passed 1/1. |
| 21 | Triggers and rollback | PASS | Live suite verified revision/order snapshot immutability, order-delete rejection, optimistic concurrency, and transaction rollback. |
| 22 | Missing credentials rejected | PASS | Direct owner request without Bearer credential returned 401. |
| 23 | `x-actor-id` alone rejected | PASS | Header-only identity returned 401; forged actor header did not override a verified Bearer subject. |
| 24 | Owner authorization works | PASS | Correct signed owner received 200 and a different signed owner received 403. |
| 25 | CNY/TWD are correct | PASS | CNY used fen and its pricing version; retained live TWD evidence used whole TWD units and independent TWD pricing without exchange conversion. |
| 26 | No cost leak | PASS | Recursive public-response scan found no cost or `unitCostMinor` field/value. |
| 27 | No supplier leak | PASS | Recursive public-response scan found no supplier field/value. |
| 28 | No Prisma type leak | PASS | Public response had no Prisma field/value; architecture boundary suite passed 8/8. |
| 29 | Basic accessibility | PASS | Labels, landmarks, progress/status semantics, selected/pressed state, focus outline, and 44 px mobile targets were verified. |
| 30 | Mobile core flow | PASS | Final baseline reloaded persisted revision 2 in a usable `390x844` mobile WebGL editor; retained questionnaire, fallback, budget, and order evidence remains compatible. |
| 31 | Performance smoke | PASS | Final desktop scene was 32 ms/3 draws after reload; final mobile scene was 164.6 ms/3 draws. Retained mobile FCP was 228 ms. Local smoke only. |
| 32 | `pnpm validate` | PASS | Fresh worktree `pnpm validate --force` passed lint, typecheck, tests, architecture, and build without cache reuse. |
| 33 | Production build | PASS | Fresh install generated Prisma Client, `pnpm build --force` passed 7/7, compiled bundle smoke shut down cleanly, and compiled Backend served real PostgreSQL. |

## Final remediation verification

### Fresh install and production artifact

```text
pre-install packages/database/generated/client/client.ts   absent
pnpm install --frozen-lockfile                              PASS; postinstall generated Prisma Client
post-install generated/client/client.ts                     present
pnpm build --force                                          PASS, 7/7
pnpm validate --force                                       PASS
pnpm --filter @mystcrag/backend smoke:start                 PASS; dist health ok, clean shutdown
pnpm --filter @mystcrag/backend start                       PASS; compiled dist served real PostgreSQL
```

The initial QA check looked for `client.js`, while Prisma 7 correctly generates `client.ts`; final evidence uses the configured generator output and actual file type.

### PostgreSQL

- Migration: `20260721140000_init_mystcrag_persistence_v1`, applied successfully.
- Repeated seed counts: users 1, crystals 3, material products 6, accessory products 2, pricing rules 2, inventory 8, designs 3, revisions 4, publications 1, orders 1, snapshots 1.
- Live suite: 17 passed, 0 failed, 0 skipped.
- Runtime order proof: `cmrvqptzn00048a8mmudt4dkm`, `PENDING`, DB total `10600`, revision 2, immutable pricing snapshot `10600`.

### Previously failing exclusion scenario

All three final designs excluded aquamarine. Canonical sequence comparison returned `PAIRWISE_DISTINCT=3`:

- Rain After Blue: alternating moonstone 6 mm and quartz 10 mm; total `10800`.
- Moonlit Tide: grouped quartz/moonstone rhythm; total `10800`.
- Silver Mist: quartz focal pair with moonstone body; total `10200`.

Names and stories also remained distinct, but the admission assertion is based on production-visible product and diameter order, not copy.

## Automated test counts

- root architecture: 8/8;
- Design Contract: 25/25;
- AI Agent: 25/25;
- Three Engine: 14/14;
- Database unit: 4/4;
- Database live: 17/17;
- Backend: 19/19;
- Frontend: 44/44;
- seed verification: 1/1;
- UI: 0 tests, no failure;
- forced workspace build: 7/7.

## Evidence index

Retained coverage includes desktop landing/questionnaire/results/WebGL/revision/order, mobile landing/questionnaire/WebGL/fallback/over-budget, and a short Playwright trace. Final-baseline additions are:

- `desktop-final-distinct-results.png`
- `desktop-final-webgl-diy.png`
- `desktop-final-order.png`
- `mobile-final-webgl-diy.png`

The only open issue is the non-blocking Three environment-blur sample warning documented in `BUG_REPORT.md`; no visual or functional failure was observed.

## Final QA decision

`mvpReadiness: READY`

The final baseline satisfies the specified zero-BLOCKER, zero-CRITICAL, and zero core-flow-MAJOR release gate.
