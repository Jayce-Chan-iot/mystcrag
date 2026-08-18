import assert from "node:assert/strict";
import test from "node:test";

import { createBraceletLayout, evaluateBraceletFit, resolveSlotAtAngle, solveRingRadius } from "../src/index.js";

test("equal and mixed components form a stable full ring", () => {
  const equal = createBraceletLayout(Array.from({ length: 20 }, (_, index) => ({ componentId: `b${index}`, widthMm: 8 })), { gapMm: 0.3 });
  assert.equal(equal.slots.length, 20);
  assert.ok(equal.radius > 20);
  const mixed = createBraceletLayout([14, 3, 6, 8, 12].map((widthMm, index) => ({ componentId: `m${index}`, widthMm })), { gapMm: 0.2 });
  assert.deepEqual(mixed.slots.map((slot) => slot.width), [14, 3, 6, 8, 12]);
  for (const slot of mixed.slots) assert.equal(resolveSlotAtAngle(mixed, slot.angle)?.componentId, slot.componentId);
});

test("tiny spacer receives a smaller angular neighborhood than a hero bead", () => {
  const layout = createBraceletLayout([14, 3, 6, 8, 12].map((widthMm, index) => ({ componentId: `m${index}`, widthMm })));
  const spans = layout.slots.map((slot) => ((slot.endAngle - slot.startAngle + Math.PI * 2) % (Math.PI * 2)));
  assert.ok((spans[0] ?? 0) > (spans[1] ?? Infinity));
});

test("single, empty, floating precision and invalid geometry are handled", () => {
  assert.equal(createBraceletLayout([]).slots.length, 0);
  assert.equal(createBraceletLayout([{ componentId: "only", widthMm: 12 }]).slots[0]?.componentId, "only");
  assert.ok(Number.isFinite(solveRingRadius([6.1, 7.3, 10.7, 12.2], 0.25)));
  assert.throws(() => createBraceletLayout([{ componentId: "bad", widthMm: 0 }]));
});

test("fit keeps wrist, target and estimated values distinct", () => {
  const fit = evaluateBraceletFit({ assembledMaterialPathMm: 158, elasticAllowanceMm: 5, targetInnerCircumferenceMm: 160, userWristCircumferenceMm: 155 });
  assert.equal(fit.status, "VALID");
  assert.equal(fit.deltaFromTargetMm, -2);
  assert.equal(evaluateBraceletFit({ assembledMaterialPathMm: 129, elasticAllowanceMm: 5, targetInnerCircumferenceMm: 160, userWristCircumferenceMm: 155 }).status, "TOO_SMALL");
  assert.equal(evaluateBraceletFit({ assembledMaterialPathMm: 201, elasticAllowanceMm: 5, targetInnerCircumferenceMm: 160, userWristCircumferenceMm: 155 }).status, "TOO_LARGE");
});
