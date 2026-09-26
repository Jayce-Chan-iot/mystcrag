import assert from "node:assert/strict";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { mockDesignOptions } from "../fixtures/mock-design-options";
import {
  deriveLooseBodies,
  hitTargetSizePx,
  mmToRadiusPx
} from "../model/loose-bead-controller";
import { MAX_PHYSICS_BODIES, deterministicFallbackLayout, seedLooseParticles } from "../model/loose-bead-physics";
import { LooseBeadStage, type BeadLaunchIntent } from "./loose-bead-stage";

function designWithAnchored() {
  return structuredClone(mockDesignOptions[0]!);
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
  for (const body of bodies.physical) {
    assert.ok(body.radiusPx > 0);
  }
  const seeded = seedLooseParticles(bodies.physical, { centerX: 0, centerY: 0, innerRadiusPx: 160 });
  assert.ok(seeded.particles.length <= MAX_PHYSICS_BODIES);
});

test("loose stage renders only visible particles with 44px hit targets and limited priority", () => {
  const design = designWithAnchored();
  const many = structuredClone(design);
  many.beads = Array.from({ length: 49 }, (_, index) => ({
    ...design.beads[0]!,
    componentId: `overflow-bead-${index}`,
    positionIndex: index
  }));
  const launchQueue: BeadLaunchIntent[] = [];
  const markup = renderToStaticMarkup(
    <LooseBeadStage
      busy={false}
      design={many}
      launchQueue={launchQueue}
      onLaunchConsumed={() => undefined}
      onSelect={() => undefined}
      selectedComponentId="overflow-bead-0"
      trayMaterial="BONE_CHINA"
    />
  );
  assert.match(markup, /data-loose-bead-stage="true"/);
  assert.match(markup, /data-loose-particle-layer="true"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /托盘空间已满，其他珠子将在成串预览中显示/);
  const beadButtons = markup.match(/data-loose-bead="/g) ?? [];
  assert.ok(beadButtons.length <= 48, `expected <=48 bead buttons, got ${beadButtons.length}`);
  // SSR fallback layout never emits a 49th particle button.
  assert.ok(!markup.includes('data-loose-bead="overflow-bead-48"'));
  assert.match(markup, /data-loose-hit-size="44"/);
  assert.match(markup, /data-loose-image-size=/);
  // Priority is limited: not every bead can be priority.
  const priorityCount = (markup.match(/fetchPriority="high"|priority=/g) ?? []).length;
  assert.ok(priorityCount <= 8, `too many priority images: ${priorityCount}`);
});

test("responsive stage metadata exposes a shared inner radius token", () => {
  const design = designWithAnchored();
  const markup = renderToStaticMarkup(
    <LooseBeadStage
      busy={false}
      design={design}
      launchQueue={[]}
      onLaunchConsumed={() => undefined}
      onSelect={() => undefined}
      selectedComponentId={design.beads[0]!.componentId}
      trayMaterial="BONE_CHINA"
    />
  );
  assert.match(markup, /data-loose-stage-size=/);
  assert.match(markup, /data-loose-motion-mode=/);
});

test("hit target helper never inflates the physical image diameter", () => {
  assert.equal(hitTargetSizePx(20), 44);
  assert.equal(hitTargetSizePx(44), 44);
  assert.equal(hitTargetSizePx(52), 52);
  const fallback = deterministicFallbackLayout(
    [{ componentId: "a", radiusPx: 10, kind: "BEAD" }],
    { centerX: 0, centerY: 0, innerRadiusPx: 80 }
  );
  assert.equal(fallback.particles[0]!.radiusPx, 10);
});
