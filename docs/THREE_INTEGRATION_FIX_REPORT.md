# Mystcrag Phase 3.5 Three Integration Handoff

Date: 2026-07-22

## Identity

- Agent role: Phase 3.5 Three Integration Agent
- Branch: `fix/frontend-three-integration`
- Integration baseline: `f0b17b65cc14702ce41fc1f552f3ce15037feef5` (`merge: complete browser mvp integration`)
- Historical candidate: `210010af2532c59e205d9b67fd904bddf36e1854`
- Historical backup: `backup/three-pre-cleanup` -> `210010af2532c59e205d9b67fd904bddf36e1854`
- Final implementation HEAD: recorded in the final agent handoff because a commit cannot embed its own hash
- Approved dependency decision: `DEC-P35-FRONTEND-THREE-LINK-001`

The old candidate was not merged or rebased as a whole. Its QA-owned root test, stale same-origin proxy, stale auth assumptions, and obsolete Browser API client were discarded. The Three integration was replayed directly on the latest Browser baseline.

## Outcome

The DIY normal preview is now the real `@mystcrag/three-engine` React Three Fiber scene:

```text
Backend-confirmed PublicDesignV1
  -> designV1ToSceneDescriptor
  -> browser-only dynamic scene chunk
  -> LazyBraceletScene / React Three Fiber Canvas
  -> instanced hit test instanceId -> componentId
  -> host selectedComponentId
  -> finite REPLACE_COMPONENT request
  -> Backend update + authoritative price verification
  -> persisted revision regenerates the descriptor and scene
```

The CSS bracelet is retained only as a visible, keyboard-operable fallback when WebGL is unavailable or the scene throws. It is not the normal successful preview.

The existing Browser lifecycle remains intact: Bearer-authenticated GET, finite Update, authoritative Price verification, Save, over-budget acceptance, and immutable Order snapshot generation were preserved in `diy-editor.tsx` and guarded by an integration test.

## Exact `main...HEAD` inventory

The final branch contains exactly these eight files relative to baseline; no root `tests/*`, Backend, Database, AI, Auth, Contract, or Three Engine internal file is changed.

```text
M apps/frontend/next.config.ts
M apps/frontend/package.json
M apps/frontend/src/features/design/components/diy-editor.tsx
A apps/frontend/src/features/design/components/three-bracelet-preview.tsx
A apps/frontend/src/features/design/components/three-bracelet-scene-client.tsx
A apps/frontend/src/features/design/three-integration.test.tsx
A docs/THREE_INTEGRATION_FIX_REPORT.md
M pnpm-lock.yaml
```

Shared-file scope is limited to the approved Frontend workspace dependency link. The lockfile adds only the three-line `apps/frontend` importer for `@mystcrag/three-engine: link:../../packages/three-engine`; it does not remove the Backend AI link or alter registry resolution.

## Runtime behavior

- `next/dynamic` with `ssr: false` keeps the Three scene out of server rendering and loads the client scene only on the DIY route.
- `designV1ToSceneDescriptor` is memoized by the Backend-confirmed `PublicDesignV1` object.
- The error boundary key includes `designId`, `revision`, and quality, so a confirmed revision or quality change remounts failed/runtime resources cleanly.
- `selectedComponentId` is the only selection identity shared with the host. Three Engine maps an instanced `instanceId` back to its render item's `componentId` before calling the Frontend.
- The editor sends only the existing shared finite `REPLACE_COMPONENT` operation. Three code does not calculate price, inventory, compliance, revision, or persistence.
- AUTO, LOW, MEDIUM, and HIGH are exposed. AUTO delegates to the existing Three Engine policy, which defaults mobile/coarse-pointer clients to LOW and desktop clients to MEDIUM; requested mobile HIGH is clamped to LOW.
- The scene container is `max-w-full` inside a `min-w-0` DIY column; the Canvas owns 100% width/height and React Three Fiber handles responsive canvas sizing.
- Existing Three Engine lifecycle remains authoritative: OrbitControls are damped and disposed on unmount; scene resource bundles, geometries, materials, environment maps, and adaptive DPR controllers use their existing cleanup paths.

## Bracelet and accessory coverage

Production renders whatever schema-valid, Backend-confirmed `PublicDesignV1` is returned; this integration does not fabricate or force product composition. A focused Frontend integration fixture verifies a deterministic 12-bead circle plus two independently anchored accessories, including both `anchorComponentId` relations. Existing Three Engine tests separately cover inline accessories, anchored pendants, mixed diameter layout, stable identity, fallback assets, resource reuse, and disposal.

## Failure and accessibility behavior

- WebGL capability detection checks `webgl2` then `webgl` and catches canvas/context errors.
- WebGL unavailable displays an explicit status message and an interactive 2D bracelet with the same `componentId` selection state.
- Scene render errors are caught and replaced with the same operable fallback.
- Asset misses continue through the Three Engine's procedural geometry/material fallback and surface the descriptor warning count.
- The textual component list remains keyboard-operable for bead selection and uses 44 px minimum targets. Accessories remain visible in the list but disabled as unsupported replacement targets.

## Verification

Focused results on the final content:

- `pnpm --filter @mystcrag/frontend lint`: PASS
- `pnpm --filter @mystcrag/frontend typecheck`: PASS
- `pnpm --filter @mystcrag/frontend test`: PASS, 44/44
- Three integration tests added in this branch: PASS, 10/10
- `pnpm --filter @mystcrag/three-engine typecheck`: PASS
- `pnpm --filter @mystcrag/three-engine test`: PASS, 14/14
- `pnpm --filter @mystcrag/frontend build`: PASS; Next.js 16.2.10 production build compiled and generated all 10 routes
- `pnpm validate`: PASS on the final committed content

The added tests cover dynamic client loading, deterministic descriptor conversion, 12 beads plus two anchors, hit-test identity, fallback selection round-trip, finite replacement, WebGL failure, procedural assets, mobile quality policy, revision/disposal lifecycle, preservation of Browser commercial flows, and the absence of commercial mutation logic in the scene client.

## Real and Mock status

- Three runtime: real `@mystcrag/three-engine`, React Three Fiber, Three.js, instancing, OrbitControls, and runtime disposal paths.
- Production data path: real Browser `designApi` GET/Update/Price/Save/Order path with verified Bearer credential; no new Mock fallback was introduced.
- CSS preview: failure fallback only.
- Automated integration data: schema-valid fixtures, including the dedicated 12-bead/two-anchor coverage design.
- Browser/GPU measurement: not newly claimed by this replay. The production build and source/runtime tests passed, but this handoff does not invent new device FPS, chunk-transfer, cold-init, or physical-mobile results.
- Database E2E: not rerun by this Three-only role. The baseline already contains the separately verified PostgreSQL and Browser integration work.

## Risks and rollback

- A representative iOS Safari and Android Chrome GPU matrix remains a release-observation task; the existing LOW/mobile clamp and operable fallback reduce but do not eliminate device-specific GPU risk.
- The dynamic Three payload is intentionally limited to the DIY scene boundary, but exact transfer size should be remeasured when production asset delivery is added.
- Backend currently controls actual bead/accessory composition. Three renders the confirmed contract and does not add missing merchandise.
- Rollback is one commit: revert the final Conventional Commit on this branch. That removes the Frontend workspace link and scene mount and returns DIY to the existing CSS preview without changing Backend data, persistence, orders, auth, AI, Contract, or Three Engine internals.

## Handoff assessment

- Remaining blocker in assigned scope: none.
- Merge readiness: ready after Tech Lead confirms the exact eight-file diff and reruns the post-merge workspace gate.
- Working tree expectation: clean after the final commit.
