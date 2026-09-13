import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { mockDesignOptions } from "../fixtures/mock-design-options";
import { MAX_PHYSICS_BODIES, seedLooseParticles, type LooseBodyInput } from "../model/loose-bead-physics";
import {
  LooseBeadStage,
  deriveLooseBodies,
  mmToRadiusPx,
  type BeadLaunchIntent
} from "./loose-bead-stage";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function designWithAnchored() {
  const design = structuredClone(mockDesignOptions[0]!);
  const inline = design.accessories.find((accessory) => accessory.placementMode === "INLINE");
  if (inline) {
    design.accessories = design.accessories.map((accessory) =>
      accessory.componentId === inline.componentId ? accessory : accessory
    );
  }
  return design;
}

test("mmToRadiusPx keeps 6/8/10 mm proportions", () => {
  const inner = 160;
  const r6 = mmToRadiusPx(6, inner);
  const r8 = mmToRadiusPx(8, inner);
  const r10 = mmToRadiusPx(10, inner);
  assert.ok(r6 < r8 && r8 < r10);
  assert.ok(Math.abs(r10 / r6 - 10 / 6) < 0.05);
  assert.ok(r10 * 2 < inner);
});

test("deriveLooseBodies splits beads, inline accessories and anchored overlays", () => {
  const design = designWithAnchored();
  const bodies = deriveLooseBodies(design, 160);
  assert.equal(bodies.physical.length, design.beads.length);
  assert.ok(bodies.anchored.length >= 0);
  for (const body of bodies.physical) {
    assert.ok(body.radiusPx > 0);
    assert.ok(["BEAD", "INLINE_ACCESSORY"].includes(body.kind));
  }
  const seeded = seedLooseParticles(bodies.physical as LooseBodyInput[], {
    centerX: 0,
    centerY: 0,
    innerRadiusPx: 160
  });
  assert.ok(seeded.particles.length <= MAX_PHYSICS_BODIES);
});

test("loose stage renders accessible beads, live region and overflow copy", () => {
  const design = designWithAnchored();
  const launchQueue: BeadLaunchIntent[] = [];
  const markup = renderToStaticMarkup(
    <LooseBeadStage
      busy={false}
      design={design}
      launchQueue={launchQueue}
      onLaunchConsumed={() => undefined}
      onSelect={() => undefined}
      selectedComponentId={design.beads[0]!.componentId}
      trayMaterial="BONE_CHINA"
    />
  );
  assert.match(markup, /data-loose-bead-stage="true"/);
  assert.match(markup, /data-loose-particle-layer="true"/);
  assert.match(markup, /aria-live="polite"/);
  for (const bead of design.beads.slice(0, 3)) {
    assert.match(markup, new RegExp(`data-component-id="${bead.componentId}"`));
    assert.match(markup, new RegExp(`data-loose-bead="${bead.componentId}"`));
  }
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /data-photo-real-bead="true"/);
  const many = structuredClone(design);
  many.beads = Array.from({ length: 49 }, (_, index) => ({
    ...design.beads[0]!,
    componentId: `overflow-bead-${index}`,
    positionIndex: index
  }));
  const overflowMarkup = renderToStaticMarkup(
    <LooseBeadStage
      busy={false}
      design={many}
      launchQueue={[]}
      onLaunchConsumed={() => undefined}
      onSelect={() => undefined}
      selectedComponentId="overflow-bead-0"
      trayMaterial="BONE_CHINA"
    />
  );
  assert.match(overflowMarkup, /托盘空间已满，其他珠子将在成串预览中显示/);
});

test("loose stage keeps business drag callbacks out of the particle layer", () => {
  const editorSource = source("./loose-bead-stage.tsx");
  assert.match(editorSource, /data-loose-bead-stage="true"/);
  assert.doesNotMatch(editorSource, /onMove\(/);
  assert.doesNotMatch(editorSource, /onRemove\(/);
  assert.doesNotMatch(editorSource, /setParticle|setState\(/);
  assert.match(editorSource, /requestAnimationFrame/);
  assert.match(editorSource, /cancelAnimationFrame/);
  assert.match(editorSource, /visibilityState/);
  assert.match(editorSource, /prefers-reduced-motion/);
  assert.match(editorSource, /deterministicFallbackLayout/);
  assert.match(editorSource, /getTrayVisual\(/);
  assert.match(editorSource, /innerRadiusRatio/);
  assert.match(editorSource, /node\.style\.transform = `translate3d\(/);
  assert.match(editorSource, /onLaunchConsumed\(/);
  assert.match(editorSource, /observeElementSize/);
});

test("loose stage launch queue is consumed once per request id", () => {
  const editorSource = source("./loose-bead-stage.tsx");
  assert.match(editorSource, /launchQueue/);
  assert.match(editorSource, /consumedLaunchIds/);
  assert.match(editorSource, /injectLooseParticle/);
  assert.match(editorSource, /originClientX/);
});

test("reduced motion and 49-body paths use deterministic placement without collision animation", () => {
  const editorSource = source("./loose-bead-stage.tsx");
  assert.match(editorSource, /chooseLooseMotionMode/);
  assert.match(editorSource, /REDUCED/);
  assert.match(editorSource, /FALLBACK/);
  assert.match(editorSource, /motion-reduce/);
  assert.match(editorSource, /150/);
});
