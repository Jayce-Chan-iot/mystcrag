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
