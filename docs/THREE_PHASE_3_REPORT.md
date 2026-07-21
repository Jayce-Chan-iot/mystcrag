# Three Engine Phase 3 Handoff Report

Date: 2026-07-21

Branch: `feature/three-bracelet-scene`

Owner: 3D Engine Lead

## 1. Scope delivered

- Implemented the one-way `DesignV1 -> BraceletSceneDescriptor -> React Three Fiber` path for the V1 `CIRCLE` layout.
- Added size-aware parameterized placement for mixed bead diameters, INLINE accessories, and ANCHORED pendants resolved by `anchorComponentId`.
- Added click-to-select by stable `componentId`, a wireframe selection outline, bead-only replacement preview, and deterministic relayout after replacement.
- Added damped orbit rotation and wheel/pinch zoom. Dragging a bead is deliberately not a V1 edit interaction.
- Added LOW/MEDIUM/HIGH quality profiles, mobile LOW default/HIGH clamp, adaptive DPR, lazy scene loading, procedural asset fallback, resource caching/reuse, instancing, and explicit unload disposal.
- Added a standalone `BraceletDemo` export which loads `standardAiDesignFixture`, selects one bead, and previews 6/8/10 mm material replacements.

## 2. Boundary confirmation

The implementation changes only Three Engine runtime data. It does not recalculate price, query or modify inventory, change compliance, redefine `DesignV1`, import database/AI/backend modules, or place Three.js classes in a shared contract. `replacePreviewComponent` produces a new scene descriptor and never writes GPU/runtime choices back into the design.

No cross-module product decision was needed. The requested Phase 3 plan, handoff template, and decision log files were absent from this repository at the start of work; this report follows the existing `ENGINEERING_GUIDE.md` handoff fields.

## 3. Performance implementation and fixture baseline

Runtime `onPerformanceStats` records initialization milliseconds, renderer draw calls, rendered triangles, material count, texture count, active DPR, and resolved quality after warm-up. The Demo displays this record directly.

The shared five-component fixture has five distinct geometry/material pairs and four reused materials, so its unselected baseline is five instanced draw groups; the selection outline adds one draw call while selected. Texture count is zero in LOW and one generated studio environment in MEDIUM/HIGH before catalog textures are introduced. Actual canvas initialization and renderer counters are device/browser dependent and are captured rather than hard-coded.

| Profile | CPU descriptor/resource prep* | Draw groups | Triangles | Materials | Textures | DPR | Sample budget |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| LOW | 1.342 ms | 5 | 1,132 | 4 | 0 | 0.75-1.25 | 1 |
| MEDIUM | 0.508 ms | 5 | 2,308 | 4 | 1 | 0.75-1.75 | 4 |
| HIGH | 0.950 ms | 5 | 4,732 | 4 | 1 | 0.75-2.00 | 8 |

\* One local Node preparation sample on the handoff host, excluding WebGL/context startup. Browser initialization is reported by `onPerformanceStats`. LOW uses 16-segment spheres with simplified transparency and no environment texture; MEDIUM uses 28 segments, base PBR, transmission, and studio environment; HIGH uses 40 segments, higher transmission/index of refraction, and the highest sample budget.

Geometry/material resources are keyed and reused. Equal geometry/material render items share one `InstancedMesh`; selection uses a separate outline so shared materials are not cloned or mutated. All caches, generated environment maps, controls, geometries, and materials dispose during unmount. No physics engine or per-frame physical simulation is used.

## 4. Tests

Package tests cover:

1. main-ring and production order;
2. mixed bead diameters;
3. INLINE accessory placement;
4. ANCHORED pendant placement;
5. `anchorComponentId` resolution;
6. stable `componentId` mapping;
7. replacement relayout;
8. immutable input;
9. deterministic/serializable descriptor;
10. invalid asset warning plus procedural fallback;
11. cache reuse and resource disposal;
12. mobile quality selection and adaptive DPR;
13. production `componentSequence` consistency after preview changes.

Focused result: 14/14 Three Engine tests passed. Final gate: `pnpm validate` passed (7 architecture tests plus all workspace lint, strict typecheck, tests, and builds).

## 5. Demo usage

Import `BraceletDemo` from `@mystcrag/three-engine/demo`, or mount `LazyBraceletScene` from `@mystcrag/three-engine/react` with a descriptor produced by `designV1ToSceneDescriptor`. The application remains responsible for choosing where the dynamically loaded canvas appears in the product flow.

## 6. Deferred work and risks

- Catalog-hosted GLTF/Draco decoding and real crystal texture delivery remain deferred; V1 renders deterministic procedural geometry when assets are unavailable.
- Device GPU results must be sampled on representative iOS Safari and Android Chrome hardware. The runtime metrics callback and adaptive controls are present for that pass.
- A future product editor may submit a validated replace operation to Backend; this engine intentionally does not update `DesignV1`, pricing, inventory, or persistence itself.

## 7. Acceptance traceability

| Requirement | Implementation | Verification |
| --- | --- | --- |
| CIRCLE layout | `createCircleTransforms` distributes the main-ring footprint around one deterministic circle | main-ring order and deterministic descriptor tests |
| Mixed bead diameters | Every item contributes its actual procedural diameter/dimensions and radial offset | 6/8/10 mm offset and angular-layout assertions |
| Bead rendering | Beads resolve to reusable sphere geometry and physical material presets | descriptor geometry mapping and resource tests |
| INLINE accessory | INLINE components participate in the same ordered ring and consume `positionIndex` | spacer is sequence item 1 and uses cylinder geometry |
| ANCHORED pendant | Anchored items remain outside the main-ring sequence and derive transforms from their anchor | pendant type, placement, and radial distance assertions |
| `anchorComponentId` | Anchor lookup uses a `componentId -> RenderItem` map | exact anchor ID assertion |
| Rotation and zoom | Damped `OrbitControls`, pan disabled, bounded camera distance | strict build/typecheck; manual Demo interaction surface |
| Click selection | Instanced pointer `instanceId` maps back to a bead's stable `componentId` | one-to-one component mapping test; accessory replacement is excluded |
| Selection highlight | A separate purple wireframe mesh outlines the selected item | highlight is independent of shared material mutation |
| Replacement preview | `replacePreviewComponent` returns a new descriptor with the same `componentId` | identity, geometry, material, and immutability assertions |
| Relayout after replacement | Main-ring transforms are recalculated and anchored items are recomputed afterward | target and pendant positions both change in the replacement test |
| LOW/MEDIUM/HIGH | Quality profiles alter geometry density, transparency, IOR, environment, shadows, samples, and DPR cap | monotonic quality-profile assertions and metric table |
| Mobile quality | Narrow or coarse-pointer viewports default to LOW; HIGH is clamped to LOW | mobile quality resolver test |
| Adaptive DPR | Frame-rate samples lower or recover DPR within profile bounds | low/high FPS controller test |
| Dynamic loading | `LazyBraceletScene` wraps the Canvas module with `React.lazy` and `Suspense` | package build and exported Demo usage |
| Asset fallback | Unknown model/texture keys emit warnings; procedural geometry remains renderable | all-invalid asset fallback test |
| Cache/reuse/instancing | Reference-counted cache plus geometry/material grouping and `InstancedMesh` | reuse and final-release disposal tests |
| Scene disposal | Geometry, material, environment map, controls, and caches have unmount cleanup | resource cache/bundle disposal tests |
| No real-time physics | Layout is derived once from descriptor data; only camera damping and metric sampling run per frame | source boundary review |
| Production consistency | Preview changes keep main-ring `componentId` order unchanged | post-replacement `componentSequence` equality test |

## 8. Data flow and state ownership

```text
validated DesignV1
       |
       | designV1ToSceneDescriptor (pure, deterministic adapter)
       v
BraceletSceneDescriptor
       |
       +--> React Three Fiber rendering
       +--> componentId selection state (application-owned)
       +--> replacePreviewComponent (runtime preview only)
       `--> onPerformanceStats (observation only)
```

The consuming application owns `selectedComponentId`, selected catalog material, and the current preview descriptor. A click never mutates contract data. When a user confirms a real product change, the application must send the approved shared `REPLACE_COMPONENT` operation through the product workflow, receive a newly validated/priced `DesignV1`, and regenerate the scene descriptor. The preview helper must not be treated as a pricing, inventory, production, persistence, or compliance operation.

Main-ring order is always derived from DesignV1 `positionIndex`, but stable identity is always `componentId`. `sequenceIndex` in a scene descriptor is derived render metadata and is not an editing identity.

## 9. Public entry points

| Import path | Export | Purpose |
| --- | --- | --- |
| `@mystcrag/three-engine` | `designV1ToSceneDescriptor` | validate and adapt shared design data into plain scene data |
| `@mystcrag/three-engine` | `replacePreviewComponent` | create an immutable bead-replacement preview descriptor |
| `@mystcrag/three-engine` | quality, DPR, cache, and descriptor types | application/runtime integration |
| `@mystcrag/three-engine/react` | `BraceletCanvas` | eager R3F Canvas mount |
| `@mystcrag/three-engine/react` | `LazyBraceletScene` | preferred dynamically loaded Canvas boundary |
| `@mystcrag/three-engine/react` | `BraceletScene` | scene content for an application-owned Canvas |
| `@mystcrag/three-engine/demo` | `BraceletDemo` | fixture-backed selection and replacement demonstration |

Minimal integration:

```tsx
import { designV1ToSceneDescriptor } from "@mystcrag/three-engine";
import { LazyBraceletScene } from "@mystcrag/three-engine/react";
import { useMemo, useState } from "react";

export function DesignPreview({ design }: { design: unknown }) {
  const descriptor = useMemo(() => designV1ToSceneDescriptor(design), [design]);
  const [selectedComponentId, setSelectedComponentId] = useState<string>();

  return (
    <LazyBraceletScene
      descriptor={descriptor}
      selectedComponentId={selectedComponentId}
      onSelectComponent={setSelectedComponentId}
      quality="MEDIUM"
      fallback={<span>Loading 3D preview…</span>}
    />
  );
}
```

The host container must provide a usable height. `BraceletCanvas` supplies a 320 px minimum but the final responsive workspace sizing remains an application concern.

## 10. Changed-file inventory

| Area | Principal files | Responsibility |
| --- | --- | --- |
| Adapter | `src/adapters/design-v1-to-scene-descriptor.ts`, `component-to-render-item.ts` | DesignV1 validation, order, procedural render mapping, asset warnings |
| Layout | `src/layout/circle-layout.ts` | size-aware circle and anchored transforms |
| Interaction | `src/interactions/replace-preview.ts` | immutable bead preview replacement and relayout |
| Runtime | `src/runtime/scene-descriptor.ts`, `quality.ts`, `adaptive-dpr.ts`, `asset-cache.ts` | plain descriptors, quality policy, DPR control, lifecycle cache |
| R3F | `src/react/BraceletCanvas.tsx`, `BraceletScene.tsx`, `scene-resources.ts` | Canvas, controls, instancing, materials, lighting/environment, metrics, disposal |
| Dynamic boundary | `src/react/LazyBraceletScene.tsx` | code splitting and loading fallback |
| Demo | `demo/BraceletDemo.tsx` | shared-fixture selection/replacement workflow |
| Tests | `tests/design-v1-scene-adapter.test.ts`, `runtime-quality-resources.test.ts` | required functional, deterministic, quality, and lifecycle coverage |
| Package surface | `index.ts`, `package.json`, `pnpm-lock.yaml` | exports and explicit Three.js type dependency |

No files under AI Agent, Database, Backend, Frontend product flow, or Design Contract were changed by the Phase 3 commit.

## 11. Validation and handoff record

- Working branch at implementation commit: `feature/three-bracelet-scene`.
- Implementation commit: `35ede9f feat: implement parametric bracelet scene`.
- `pnpm --filter @mystcrag/three-engine typecheck`: passed.
- `pnpm --filter @mystcrag/three-engine test`: 14 passed, 0 failed.
- `pnpm validate`: passed twice after implementation; all seven workspace lint/typecheck/test/build tasks passed.
- Root architecture suite: 7 passed, 0 failed.
- Production frontend build: passed for all existing static routes.
- Prisma schema validation and Backend build/tests: passed as part of the unchanged workspace gate.

Recommended next verification is a manual GPU matrix on current iOS Safari and Android Chrome: record cold/warm initialization, steady-state FPS during orbit, DPR recovery, memory after repeated mount/unmount, and renderer counters for representative 16-, 20-, and 24-bead designs in LOW and MEDIUM. HIGH should remain desktop-only unless a later device capability policy explicitly approves it.

## 12. Rebase and final handoff manifest

### 12.1 Commit mapping

| Record | Commit | Meaning |
| --- | --- | --- |
| Baseline commit before rebase | `61e964b` | original Phase 3 implementation HEAD before rebasing onto the locally integrated Phase 3 workflow baseline |
| Implementation HEAD after rebase | `35ede9f` | content-equivalent rebased implementation commit |
| Final runtime handoff commit | `35ede9f feat: implement parametric bracelet scene` | authoritative commit for Three Engine code, Demo, tests, initial report, package manifest, and lockfile changes |
| Report expansion commit | `b8b1d22 docs: expand three phase 3 handoff report` | documentation-only acceptance, API, integration, and validation detail added after runtime handoff |

The commit hash changed because Git recreated the implementation commit on top of the new local integration baseline. The runtime diff is handed off by post-rebase commit `35ede9f`; `61e964b` is retained only as historical pre-rebase traceability.

### 12.2 Exact implementation file list

The following is the exact `git diff-tree --name-status 35ede9f` scope. `A` means added and `M` means modified.

| Status | File |
| --- | --- |
| A | `docs/THREE_PHASE_3_REPORT.md` |
| A | `packages/three-engine/demo/BraceletDemo.tsx` |
| M | `packages/three-engine/index.ts` |
| M | `packages/three-engine/package.json` |
| M | `packages/three-engine/src/adapters/component-to-render-item.ts` |
| M | `packages/three-engine/src/adapters/design-v1-to-scene-descriptor.ts` |
| M | `packages/three-engine/src/adapters/index.ts` |
| A | `packages/three-engine/src/interactions/replace-preview.ts` |
| A | `packages/three-engine/src/layout/circle-layout.ts` |
| A | `packages/three-engine/src/react/BraceletCanvas.tsx` |
| A | `packages/three-engine/src/react/BraceletScene.tsx` |
| A | `packages/three-engine/src/react/LazyBraceletScene.tsx` |
| A | `packages/three-engine/src/react/index.ts` |
| A | `packages/three-engine/src/react/scene-resources.ts` |
| A | `packages/three-engine/src/runtime/adaptive-dpr.ts` |
| A | `packages/three-engine/src/runtime/asset-cache.ts` |
| A | `packages/three-engine/src/runtime/quality.ts` |
| M | `packages/three-engine/src/runtime/scene-descriptor.ts` |
| M | `packages/three-engine/tests/design-v1-scene-adapter.test.ts` |
| A | `packages/three-engine/tests/runtime-quality-resources.test.ts` |
| M | `pnpm-lock.yaml` |

This is 21 files: 13 added and 8 modified. It contains no AI Agent, Database, Backend, Frontend product-flow, UI package, or Design Contract source change.

### 12.3 New public interfaces

Root entry point `@mystcrag/three-engine` adds or exposes:

- adapter: `designV1ToSceneDescriptor`, `SceneAdapterOptions`, `componentToRenderItem`, `componentToGeometry`, `getComponentDiameterMm`, and `isBeadComponent`;
- preview interaction: `replacePreviewComponent` and `PreviewReplacement`;
- runtime descriptor types: `DesignBraceletSceneDescriptor`, `BraceletGeometryDescriptor`, `RenderItem`, `RenderGeometry`, `NumericTransform`, `NumericVector3`, and `SceneConversionWarning`;
- quality: `MaterialQuality`, `MaterialQualityProfile`, `MATERIAL_QUALITY_PROFILES`, `resolveMaterialQuality`, and `isMobileViewport`;
- performance/resource runtime: `AdaptiveDpr`, `AdaptiveDprOptions`, `AssetCache`, and `Disposable`.

React entry point `@mystcrag/three-engine/react` exposes:

- `BraceletCanvas` and `BraceletCanvasProps`;
- `BraceletScene`, `BraceletSceneProps`, and `ScenePerformanceStats`;
- `LazyBraceletScene` and `LazyBraceletSceneProps`.

Demo entry point `@mystcrag/three-engine/demo` exposes `BraceletDemo`.

Legacy `BraceletBeadConfiguration`, `BraceletConfiguration`, and `BraceletGenerator` remain compatibility exports and were not redefined as a new design protocol.

### 12.4 `BraceletSceneDescriptor` runtime model

The actual scene runtime model is plain serializable data owned by Three Engine:

```ts
type BraceletSceneDescriptor = {
  designId: string;
  revision: number;
  layout: "CIRCLE";
  geometry: {
    targetInnerCircumferenceMm: number;
    braceletRadiusMm: number;
    beadGapMm: number;
  };
  renderItems: readonly RenderItem[];
  cameraPreset: "JEWELRY_ORBIT";
  environmentPreset: "SOFT_STUDIO";
  warnings: readonly SceneConversionWarning[];
};
```

Each `RenderItem` carries stable `componentId`, component/accessory type, `INLINE | ANCHORED` placement, derived `sequenceIndex`, optional `anchorComponentId`/`anchorSlot`, numeric transform, procedural geometry descriptor, geometry/material/texture keys, asset fallback status, and selectable/non-draggable interaction metadata. No `Vector3`, `Material`, `BufferGeometry`, React object, renderer, GPU handle, price, inventory, or compliance value is stored in this model.

### 12.5 Demo and interaction entry points

- Demo component: `packages/three-engine/demo/BraceletDemo.tsx`.
- Package import: `@mystcrag/three-engine/demo`.
- Demo route: none. The task boundary prohibited modifying the Frontend product flow, so the deliverable is an independently mountable exported component rather than an `apps/frontend` route.
- Shared fixture: `standardAiDesignFixture` from `@mystcrag/design-contract/fixtures` is converted once with `designV1ToSceneDescriptor`.
- Click-selection entry: `BraceletScene` receives `onSelectComponent`; an instanced mesh click maps `event.instanceId` to the corresponding bead `componentId`. Accessories are deliberately not emitted as bead replacement targets.
- Selection state: host-owned `selectedComponentId`, passed to `BraceletScene`/`LazyBraceletScene`; the selected item receives a separate wireframe highlight.
- Replacement entry: `replacePreviewComponent(descriptor, componentId, replacement)` from the root package or adapters entry point.
- Demo replacement action: `replaceSelected` calls `replacePreviewComponent` for the selected bead and stores the new preview descriptor. This does not modify `DesignV1` or submit a product update.

### 12.6 LOW/MEDIUM/HIGH modes

| Mode | Geometry | Material/environment | Shadows/AA | DPR cap | Sample budget | Mobile behavior |
| --- | --- | --- | --- | ---: | ---: | --- |
| LOW | 16 sphere/radial segments | simplified transparency, IOR 1.34, direct lights, no generated environment texture | disabled | 1.25 | 1 | default on narrow/coarse-pointer devices |
| MEDIUM | 28 segments | physical material, IOR 1.42, transmission, generated studio environment | enabled | 1.75 | 4 | available when explicitly selected or on desktop default |
| HIGH | 40 segments | highest transmission treatment, IOR 1.50, generated studio environment | enabled | 2.00 | 8 | explicit mobile HIGH request is clamped to LOW |

Every mode also uses adaptive DPR with a 0.75 lower bound. LOW/MEDIUM/HIGH are runtime-only policies and never become DesignV1 fields.

### 12.7 Exact 14/14 Three Engine tests

Adapter/layout/interaction suite:

1. `1. main ring follows DesignV1 and production order`
2. `2. different bead diameters affect radial offset and angular layout`
3. `3. INLINE accessory occupies its production position`
4. `4-5. ANCHORED pendant follows anchorComponentId`
5. `6. componentId is the stable one-to-one scene identity`
6. `7. preview replacement preserves identity and relayouts the ring and pendant`
7. `8. adapter and replacement do not mutate their inputs`
8. `9. descriptor is deterministic, serializable, and preserves revision`
9. `10. invalid assets receive warnings and procedural fallback`
10. `13. production componentSequence stays consistent after preview changes`

Runtime quality/resource suite:

11. `11. cache reuses resources and disposes them after the final release`
12. `11. scene resources reuse geometry/material and release on unload`
13. `12. mobile defaults and clamps to LOW while desktop defaults to MEDIUM`
14. `adaptive DPR reduces under load and recovers within its cap`

Result: 14 passed, 0 failed, 0 skipped, 0 todo.

### 12.8 `@types/three` and lockfile scope

`@types/three@^0.180.0` was added only to `packages/three-engine` `devDependencies`. Three.js `0.180.0` does not publish bundled TypeScript declarations through its package manifest, while the new R3F scene imports typed Three.js runtime objects and addon controls/environments. The matching DefinitelyTyped package is therefore required for strict `tsc --noEmit`. Keeping it as a package-local development dependency avoids a runtime dependency change and avoids moving Three Engine typing responsibility into Frontend or the workspace root.

The `pnpm-lock.yaml` change is generated dependency metadata only:

- one new `packages/three-engine` importer entry for `@types/three`;
- package/snapshot entries for `@types/three@0.180.0`;
- its resolved dependency closure: `@dimforge/rapier3d-compat@0.12.0`, `@tweenjs/tween.js@23.1.3`, `@types/stats.js@0.17.4`, existing `@types/webxr@0.5.24`, `@webgpu/types@0.1.71`, `fflate@0.8.3`, and `meshoptimizer@0.22.0`;
- 46 added lockfile lines in the implementation commit;
- no removal, version upgrade, unrelated importer edit, root manifest edit, Frontend manifest edit, or workspace configuration edit.

These packages are type/example dependency closure; the direct addition is a devDependency and is not intended to increase the production browser bundle.

### 12.9 Decision Log references

- `docs/DECISION_LOG.md`, `P3-001 — Establish Phase 3 parallel-development governance`: approved repository-wide branch ownership, module boundaries, handoff evidence, and `pnpm validate` gates followed by this work.
- `docs/DECISION_LOG.md`, `DEC-PHASE3-THREE-DEPENDENCY-001 — Add Three.js TypeScript definitions`: approved the package-local `@types/three@^0.180.0` addition and exact lockfile dependency closure. Its implementation reference records `feature/three-bracelet-scene` at pre-rebase commit `61e964b`; the content-equivalent post-rebase implementation is `35ede9f`.

Neither decision changes Design Contract, Database, or API semantics. No additional cross-module decision was introduced by the Three Engine runtime implementation.
