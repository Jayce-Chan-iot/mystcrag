import assert from "node:assert/strict";
import test from "node:test";

import type { CatalogMaterialProduct, PublicDesignV1, UpdateDesignOperation } from "@mystcrag/design-contract";

import {
  createAddRequest,
  createMoveRequest,
  createRemoveRequest,
  createReplaceRequest,
  invertOperations
} from "../../../lib/api/design-api";
import { mockDesignOptions } from "../fixtures/mock-design-options";
import {
  applyRedo,
  applyUndo,
  createOptimisticState,
  dismissRecoveryNotice,
  enqueueEdit,
  nextEditToSync,
  parseRecoveryRecord,
  projectDesign,
  resolveConflict,
  restoreRecoveredEdits,
  retryFailedEdits,
  serializeRecoveryRecord,
  settleEdit,
  type OptimisticDesignState,
  type PendingEdit
} from "./optimistic-design";

function baseDesign(): PublicDesignV1 {
  return structuredClone(mockDesignOptions[0]!);
}

function sequence(state: OptimisticDesignState): string[] {
  return projectDesign(state).production.componentSequence;
}

function serverDesign(current: PublicDesignV1, priceDeltaMinor = 100): PublicDesignV1 {
  return {
    ...structuredClone(current),
    revision: current.revision + 1,
    pricing: { ...current.pricing, totalPriceMinor: current.pricing.totalPriceMinor + priceDeltaMinor }
  };
}

const AMETHYST_MATERIAL: CatalogMaterialProduct = {
  beadProductId: "product-amethyst-round-8",
  sku: "SKU-AMETHYST-ROUND-8",
  displayName: "紫水晶圆珠 8mm",
  crystalId: "amethyst",
  crystalNameCn: "紫水晶",
  crystalNameEn: "Amethyst",
  mineralName: "Amethyst",
  colorTags: ["purple"],
  visualTags: ["soft-glow"],
  styleTags: ["minimal"],
  emotionTags: ["quiet"],
  cultureTags: ["landscape"],
  materialKey: "amethyst-soft-v1",
  shape: "ROUND",
  diameterMm: 8,
  modelAssetKey: "sphere-round-8mm-v1",
  textureAssetKey: "amethyst-soft-v1",
  currency: "CNY",
  unitPriceMinor: 2600,
  availableQuantity: 42
};

function addEdit(state: OptimisticDesignState, requestId: string, componentId: string): PendingEdit {
  const projection = projectDesign(state);
  const request = createAddRequest(projection, AMETHYST_MATERIAL, projection.production.componentSequence.length, componentId);
  return { requestId, operations: request.operations, undoOperations: [{ operation: "REMOVE_COMPONENT", componentId }] };
}

function moveEdit(state: OptimisticDesignState, requestId: string, componentId: string, targetPositionIndex: number): PendingEdit {
  const projection = projectDesign(state);
  const current = projection.beads.find((bead) => bead.componentId === componentId)!;
  const request = createMoveRequest(projection, componentId, targetPositionIndex);
  return {
    requestId,
    operations: request.operations,
    undoOperations: [{ operation: "MOVE_COMPONENT", componentId, targetPositionIndex: current.positionIndex }]
  };
}

test("optimistic add inserts the bead into the projection immediately without touching server facts", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const edit = addEdit(s0, "req-add-1", "component-new-bead");
  const s1 = enqueueEdit(s0, edit);

  assert.equal(s1.status, "syncing");
  assert.equal(s1.pending.length, 1);
  const projection = projectDesign(s1);
  assert.equal(projection.beads.length, design.beads.length + 1);
  assert.equal(projection.production.componentSequence.at(-1), "component-new-bead");
  assert.equal(projection.beads.find((bead) => bead.componentId === "component-new-bead")?.materialKey, "amethyst-soft-v1");
  // Server-authoritative facts never change while a request is pending.
  assert.equal(projection.revision, design.revision);
  assert.equal(projection.pricing, s1.confirmed.pricing);
});

test("optimistic move reorders the projected ring and keeps positionIndex contiguous", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const s1 = enqueueEdit(s0, moveEdit(s0, "req-move-1", "bead-01", design.production.componentSequence.length - 1));

  const projection = projectDesign(s1);
  assert.equal(projection.production.componentSequence.at(-1), "bead-01");
  assert.equal(projection.production.componentSequence[0], "bead-02");
  const sortedPositions = [...projection.beads].sort((left, right) => left.positionIndex - right.positionIndex).map((bead) => bead.positionIndex);
  assert.deepEqual(sortedPositions, sortedPositions.map((_, index) => index));
});

test("optimistic remove drops the bead and keeps anchored accessory references consistent", () => {
  const design = baseDesign();
  assert.equal(design.accessories.some((accessory) => accessory.placementMode === "ANCHORED" && accessory.anchorComponentId === "bead-01"), true);
  const s0 = createOptimisticState(design);
  const request = createRemoveRequest(projectDesign(s0), "bead-03");
  const s1 = enqueueEdit(s0, { requestId: "req-remove-1", operations: request.operations, undoOperations: [{ operation: "ADD_COMPONENT", component: design.beads[2]! }] });

  const projection = projectDesign(s1);
  assert.equal(projection.beads.length, design.beads.length - 1);
  assert.equal(projection.production.componentSequence.includes("bead-03"), false);
  assert.equal(projection.accessories.every((accessory) => accessory.placementMode !== "ANCHORED" || projection.production.componentSequence.includes(accessory.anchorComponentId) || projection.beads.some((bead) => bead.componentId === accessory.anchorComponentId)), true);
});

test("projection removes anchored accessories together with their anchor bead instead of dangling", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const s1 = enqueueEdit(s0, {
    requestId: "req-remove-anchor",
    operations: [{ operation: "REMOVE_COMPONENT", componentId: "bead-01" }],
    undoOperations: [{ operation: "ADD_COMPONENT", component: design.beads[0]! }]
  });

  const projection = projectDesign(s1);
  assert.equal(projection.beads.some((bead) => bead.componentId === "bead-01"), false);
  assert.equal(projection.accessories.some((accessory) => accessory.anchorComponentId === "bead-01"), false);
});

test("replace keeps replace semantics, componentId, anchor and position instead of delete+add", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const projection = projectDesign(s0);
  const target = projection.beads[0]!;
  const donor = projection.beads[1]!;
  const request = createReplaceRequest(projection, target.componentId, {
    ...donor,
    componentId: target.componentId,
    positionIndex: target.positionIndex,
    role: target.role,
    unitPriceMinor: target.unitPriceMinor
  });
  assert.equal(request.operations.length, 1);
  assert.equal(request.operations[0]!.operation, "REPLACE_COMPONENT");

  const s1 = enqueueEdit(s0, {
    requestId: "req-replace-1",
    operations: request.operations,
    undoOperations: invertOperations(projection, request.operations)
  });
  const next = projectDesign(s1);
  const replaced = next.beads.find((bead) => bead.componentId === target.componentId)!;
  assert.equal(replaced.positionIndex, target.positionIndex);
  assert.equal(replaced.role, target.role);
  assert.equal(replaced.materialKey, donor.materialKey);
  assert.equal(next.beads.length, design.beads.length);
  // The pendant stays anchored to the same componentId through the replacement.
  assert.equal(next.accessories.some((accessory) => accessory.placementMode === "ANCHORED" && accessory.anchorComponentId === target.componentId), true);
});

test("undo and redo replay through the same serial queue in the correct order", () => {
  const design = baseDesign();
  const originalSequence = design.production.componentSequence;
  const s0 = createOptimisticState(design);
  const s1 = enqueueEdit(s0, addEdit(s0, "req-add-1", "component-undo-bead"));
  const s2 = enqueueEdit(s1, moveEdit(s1, "req-move-1", "bead-01", projectDesign(s1).production.componentSequence.length - 1));
  assert.notDeepEqual(sequence(s2), originalSequence);

  const s3 = applyUndo(s2, "req-undo-move");
  assert.equal(sequence(s3).includes("component-undo-bead"), true);
  assert.equal(sequence(s3)[0], "bead-01");
  assert.equal(s3.pending.at(-1)?.operations[0]?.operation, "MOVE_COMPONENT");

  const s4 = applyUndo(s3, "req-undo-add");
  assert.deepEqual(sequence(s4), originalSequence);

  const s5 = applyRedo(s4, "req-redo-add");
  assert.equal(sequence(s5).includes("component-undo-bead"), true);
  assert.equal(sequence(s5)[0], "bead-01");

  const s6 = applyRedo(s5, "req-redo-move");
  assert.deepEqual(sequence(s6), sequence(s2));
  // Undo history is replayed through the queue, so the wire order stays deterministic.
  assert.deepEqual(s6.pending.map((edit) => edit.requestId), ["req-add-1", "req-move-1", "req-undo-move", "req-undo-add", "req-redo-add", "req-redo-move"]);
});

test("undo is unavailable for rolled back edits and no-ops outside applied history", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  assert.deepEqual(applyUndo(s0, "req-nope"), s0);
  assert.deepEqual(applyRedo(s0, "req-nope"), s0);

  const s1 = enqueueEdit(s0, moveEdit(s0, "req-move-1", "bead-01", 3));
  const failed = settleEdit(s1, "req-move-1", { ok: false, code: "NETWORK_ERROR" });
  assert.equal(failed.undoStack.length, 0);
  assert.deepEqual(applyUndo(failed, "req-undo"), failed);
});

test("consecutive edits settle FIFO and each success adopts the server design as the new authority", () => {
  const design = baseDesign();
  let state = createOptimisticState(design);
  state = enqueueEdit(state, addEdit(state, "req-1", "component-a"));
  state = enqueueEdit(state, moveEdit(state, "req-2", "bead-02", 0));
  state = enqueueEdit(state, addEdit(state, "req-3", "component-b"));

  assert.equal(nextEditToSync(state)?.requestId, "req-1");
  const r1 = serverDesign(state.confirmed, 2_600);
  state = settleEdit(state, "req-1", { ok: true, design: r1 });
  assert.equal(state.confirmed, r1);
  assert.equal(state.status, "syncing");
  assert.equal(nextEditToSync(state)?.requestId, "req-2");
  // The next request must target the revision the server just confirmed.
  assert.equal(state.confirmed.revision, design.revision + 1);

  const projectedAfterSecond = projectDesign(state);
  const r2 = serverDesign(projectedAfterSecond, 0);
  state = settleEdit(state, "req-2", { ok: true, design: r2 });
  assert.equal(nextEditToSync(state)?.requestId, "req-3");

  const r3 = serverDesign(projectDesign(state), 900);
  state = settleEdit(state, "req-3", { ok: true, design: r3 });
  assert.equal(state.status, "saved");
  assert.equal(state.pending.length, 0);
  assert.equal(state.confirmed.revision, design.revision + 3);
  assert.equal(state.confirmed.pricing.totalPriceMinor, r3.pricing.totalPriceMinor);
  // A stale settle for an unknown request is ignored.
  assert.deepEqual(settleEdit(state, "req-ghost", { ok: true, design: r1 }), state);
});

test("twenty consecutive reorder edits keep a stable deterministic order", () => {
  const design = baseDesign();
  let state = createOptimisticState(design);
  const expected = [...design.production.componentSequence];
  for (let index = 0; index < 20; index += 1) {
    const componentId = expected[index % expected.length]!;
    const target = (index * 5 + 3) % expected.length;
    const from = expected.indexOf(componentId);
    expected.splice(from, 1);
    expected.splice(target, 0, componentId);
    const edit = moveEdit(state, `req-move-${index}`, componentId, target);
    state = enqueueEdit(state, edit);
    state = settleEdit(state, `req-move-${index}`, { ok: true, design: serverDesign(projectDesign(state), 0) });
  }
  assert.deepEqual(state.confirmed.production.componentSequence, expected);
});

test("a failed sync rolls back the failed edit plus queued tail and offers retry", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const settledAdd = settleEdit(enqueueEdit(s0, addEdit(s0, "req-add-1", "component-a")), "req-add-1", { ok: true, design: serverDesign(baseDesign(), 2_600) });
  const confirmedAfterAdd = settledAdd.confirmed;
  const withMove = enqueueEdit(settledAdd, moveEdit(settledAdd, "req-move-1", "bead-02", 0));
  const withTail = enqueueEdit(withMove, moveEdit(withMove, "req-move-2", "bead-03", 1));

  const failed = settleEdit(withTail, "req-move-1", { ok: false, code: "NETWORK_ERROR" });
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureCode, "NETWORK_ERROR");
  assert.equal(failed.pending.length, 0);
  assert.deepEqual(sequence(failed), confirmedAfterAdd.production.componentSequence);
  assert.deepEqual(failed.recoverableEdits.map((edit) => edit.requestId), ["req-move-1", "req-move-2"]);
  // The settled add stays in history; the rolled back edits are removed from undo history.
  assert.deepEqual(failed.undoStack.map((edit) => edit.requestId), ["req-add-1"]);

  const retried = retryFailedEdits(failed);
  assert.equal(retried.status, "syncing");
  assert.deepEqual(retried.pending.map((edit) => edit.requestId), ["req-move-1", "req-move-2"]);
  assert.deepEqual(retried.undoStack.map((edit) => edit.requestId), ["req-add-1", "req-move-1", "req-move-2"]);
  assert.notDeepEqual(sequence(retried), confirmedAfterAdd.production.componentSequence);
});

test("an inventory failure rolls back the replacement instead of faking success", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const edit = addEdit(s0, "req-add-1", "component-a");
  const failed = settleEdit(enqueueEdit(s0, edit), "req-add-1", { ok: false, code: "INVENTORY_CHANGED" });
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureCode, "INVENTORY_CHANGED");
  assert.equal(projectDesign(failed).beads.length, design.beads.length);
});

test("a stale revision conflict keeps the optimistic edits visible and blocks further edits until recovery", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const withEdit = enqueueEdit(s0, moveEdit(s0, "req-move-1", "bead-01", 4));
  const conflict = settleEdit(withEdit, "req-move-1", { ok: false, code: "CONFLICT" });

  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.failureCode, "CONFLICT");
  // Conflict must not silently revert the UI nor fake success.
  assert.equal(conflict.pending.length, 1);
  assert.notDeepEqual(sequence(conflict), design.production.componentSequence);
  assert.equal(nextEditToSync(conflict), null);
  // New edits are blocked while the conflict is unresolved.
  assert.deepEqual(enqueueEdit(conflict, moveEdit(conflict, "req-move-2", "bead-02", 0)), conflict);
});

test("conflict recovery adopts the newer server design and discards incompatible local edits explicitly", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const conflict = settleEdit(enqueueEdit(s0, moveEdit(s0, "req-move-1", "bead-01", 4)), "req-move-1", { ok: false, code: "CONFLICT" });

  const newerServer = serverDesign(serverDesign(design, 500), 300);
  const recovered = resolveConflict(conflict, newerServer);
  assert.equal(recovered.status, "recovered");
  assert.equal(recovered.confirmed, newerServer);
  assert.equal(recovered.pending.length, 0);
  assert.deepEqual(recovered.discardedEdits.map((edit) => edit.requestId), ["req-move-1"]);
  assert.deepEqual(sequence(recovered), newerServer.production.componentSequence);
  assert.deepEqual(recovered.undoStack, []);
  const dismissed = dismissRecoveryNotice(recovered);
  assert.equal(dismissed.status, "saved");
  assert.deepEqual(dismissed.discardedEdits, []);
});

test("conflict recovery against an unchanged server revision keeps the queued edits", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const conflict = settleEdit(enqueueEdit(s0, moveEdit(s0, "req-move-1", "bead-01", 4)), "req-move-1", { ok: false, code: "CONFLICT" });

  const resolved = resolveConflict(conflict, structuredClone(design));
  assert.equal(resolved.status, "syncing");
  assert.equal(resolved.pending.length, 1);
  assert.equal(resolved.failureCode, null);
  assert.equal(nextEditToSync(resolved)?.requestId, "req-move-1");
});

test("price, revision and inventory remain server-authoritative through the whole optimistic lifecycle", () => {
  const design = baseDesign();
  let state = createOptimisticState(design);
  state = enqueueEdit(state, addEdit(state, "req-add-1", "component-a"));
  state = enqueueEdit(state, moveEdit(state, "req-move-1", "bead-02", 0));
  for (const intermediate of [projectDesign(state)]) {
    assert.equal(intermediate.revision, design.revision);
    assert.equal(intermediate.pricing.totalPriceMinor, design.pricing.totalPriceMinor);
    assert.equal(intermediate.pricing, state.confirmed.pricing);
  }
  const settled = settleEdit(state, "req-add-1", { ok: true, design: serverDesign(design, 2_600) });
  assert.equal(settled.confirmed.pricing.totalPriceMinor, design.pricing.totalPriceMinor + 2_600);
  assert.equal(settled.confirmed.revision, design.revision + 1);
  // The projection never fabricates a local price while the second edit is pending.
  assert.equal(projectDesign(settled).pricing.totalPriceMinor, settled.confirmed.pricing.totalPriceMinor);
});

test("refresh recovery round-trips only non-sensitive edit intent isolated by designId and revision", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const withEdits = enqueueEdit(enqueueEdit(s0, addEdit(s0, "req-add-1", "component-a")), moveEdit(s0, "req-move-x", "bead-02", 0));
  const pendingState = enqueueEdit(withEdits, moveEdit(withEdits, "req-move-1", "bead-03", 1));

  const json = serializeRecoveryRecord(pendingState);
  assert.notEqual(json, null);
  assert.doesNotMatch(json!, /token|cookie|secret|password|authorization|apiKey/i);

  const record = parseRecoveryRecord(json!)!;
  assert.equal(record.designId, design.designId);
  assert.equal(record.revision, design.revision);
  assert.deepEqual(record.edits.map((edit) => edit.requestId), ["req-add-1", "req-move-x", "req-move-1"]);

  const restored = restoreRecoveredEdits(createOptimisticState(baseDesign()), record);
  assert.equal(restored.outcome, "restored");
  assert.equal(restored.state.status, "recovered");
  assert.deepEqual(restored.state.pending.map((edit) => edit.requestId), ["req-add-1", "req-move-x", "req-move-1"]);
  assert.equal(nextEditToSync(restored.state)?.requestId, "req-add-1");
  assert.deepEqual(sequence(restored.state), sequence(pendingState));
});

test("refresh recovery discards intents from another design or an incompatible revision", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const withEdit = enqueueEdit(s0, moveEdit(s0, "req-move-1", "bead-01", 4));
  const record = parseRecoveryRecord(serializeRecoveryRecord(withEdit)!)!;

  const otherDesign = structuredClone(mockDesignOptions[1]!);
  const isolated = restoreRecoveredEdits(createOptimisticState(otherDesign), record);
  assert.equal(isolated.outcome, "discarded-design");
  assert.equal(isolated.state.pending.length, 0);
  assert.deepEqual(isolated.state.discardedEdits, []);

  const advanced = serverDesign(design, 100);
  const incompatible = restoreRecoveredEdits(createOptimisticState(advanced), record);
  assert.equal(incompatible.outcome, "discarded-revision");
  assert.equal(incompatible.state.pending.length, 0);
  assert.deepEqual(incompatible.state.discardedEdits.map((edit) => edit.requestId), ["req-move-1"]);
  assert.equal(incompatible.state.status, "recovered");
});

test("recovery parsing is allowlist-strict so secrets or malformed payloads never re-enter the editor", () => {
  assert.equal(parseRecoveryRecord("{oops"), null);
  assert.equal(parseRecoveryRecord("null"), null);
  assert.equal(parseRecoveryRecord(JSON.stringify({ designId: "x", revision: 1, edits: [], token: "abc" })), null);
  assert.equal(parseRecoveryRecord(JSON.stringify({ designId: "", revision: 1, edits: [] })), null);
  assert.equal(parseRecoveryRecord(JSON.stringify({ designId: "x", revision: 0, edits: [] })), null);
  assert.equal(parseRecoveryRecord(JSON.stringify({ designId: "x", revision: 1, edits: [{ requestId: "r", operations: [{ operation: "HACK" }], undoOperations: [] }] })), null);
  assert.equal(parseRecoveryRecord(JSON.stringify({ designId: "x", revision: 1, edits: [{ requestId: "r", operations: [], undoOperations: [] }] })), null);

  const design = baseDesign();
  const state = enqueueEdit(createOptimisticState(design), moveEdit(createOptimisticState(design), "req-move-1", "bead-01", 4));
  const record = parseRecoveryRecord(serializeRecoveryRecord(state)!)!;
  for (const edit of record.edits) {
    for (const operation of [...edit.operations, ...edit.undoOperations] as UpdateDesignOperation[]) {
      assert.equal(Object.keys(operation).every((key) => ["operation", "componentId", "targetPositionIndex", "component", "replacement", "bracelet"].includes(key)), true);
    }
  }
  assert.equal(serializeRecoveryRecord(createOptimisticState(design)), null);
});

test("new edits after a failed sync supersede the unrecovered tail explicitly", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const failed = settleEdit(enqueueEdit(s0, moveEdit(s0, "req-move-1", "bead-01", 3)), "req-move-1", { ok: false, code: "NETWORK_ERROR" });
  const fresh = enqueueEdit(failed, moveEdit(failed, "req-move-2", "bead-02", 0));
  assert.equal(fresh.status, "syncing");
  assert.deepEqual(fresh.pending.map((edit) => edit.requestId), ["req-move-2"]);
  assert.deepEqual(fresh.recoverableEdits, []);
  assert.deepEqual(fresh.discardedEdits.map((edit) => edit.requestId), ["req-move-1"]);
});

test("a successful edit after a discarded failure keeps the discard explicit until the user confirms", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const failed = settleEdit(enqueueEdit(s0, moveEdit(s0, "req-move-1", "bead-01", 3)), "req-move-1", { ok: false, code: "INVENTORY_CHANGED" });
  const superseded = enqueueEdit(failed, moveEdit(failed, "req-move-2", "bead-02", 0));
  assert.deepEqual(superseded.discardedEdits.map((edit) => edit.requestId), ["req-move-1"]);

  // The superseding edit succeeding must not hide the discarded one behind a
  // plain saved status.
  const settled = settleEdit(superseded, "req-move-2", { ok: true, design: serverDesign(projectDesign(superseded)) });
  assert.equal(settled.status, "recovered");
  assert.equal(settled.pending.length, 0);
  assert.equal(settled.failureCode, null);
  assert.deepEqual(settled.discardedEdits.map((edit) => edit.requestId), ["req-move-1"]);

  // New edits and syncing keep working while the discard notice is up.
  const next = enqueueEdit(settled, moveEdit(settled, "req-move-3", "bead-03", 0));
  assert.equal(next.status, "syncing");
  assert.equal(nextEditToSync(next)?.requestId, "req-move-3");
  const nextSettled = settleEdit(next, "req-move-3", { ok: true, design: serverDesign(projectDesign(next)) });
  assert.equal(nextSettled.status, "recovered");
  assert.deepEqual(nextSettled.discardedEdits.map((edit) => edit.requestId), ["req-move-1"]);

  // Only the explicit user confirmation clears the discards and lands on saved.
  const dismissed = dismissRecoveryNotice(nextSettled);
  assert.equal(dismissed.status, "saved");
  assert.deepEqual(dismissed.discardedEdits, []);
});

test("conflict resolution at an unchanged revision keeps the discard notice when edits were already discarded", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const failed = settleEdit(enqueueEdit(s0, moveEdit(s0, "req-move-1", "bead-01", 3)), "req-move-1", { ok: false, code: "NETWORK_ERROR" });
  const superseded = enqueueEdit(failed, moveEdit(failed, "req-move-2", "bead-02", 0));
  const conflict = settleEdit(superseded, "req-move-2", { ok: false, code: "CONFLICT" });
  assert.deepEqual(conflict.discardedEdits.map((edit) => edit.requestId), ["req-move-1"]);

  const resolved = resolveConflict(conflict, structuredClone(design));
  assert.equal(resolved.status, "syncing");
  const settled = settleEdit(resolved, "req-move-2", { ok: true, design: serverDesign(projectDesign(resolved)) });
  assert.equal(settled.status, "recovered");
  assert.deepEqual(settled.discardedEdits.map((edit) => edit.requestId), ["req-move-1"]);
});

function updateBraceletEdit(state: OptimisticDesignState, requestId: string, wristCircumferenceMm: number): PendingEdit {
  const current = projectDesign(state).bracelet;
  const bracelet = { ...current, wristCircumferenceMm };
  return {
    requestId,
    operations: [{ operation: "UPDATE_BRACELET", bracelet }],
    undoOperations: [{ operation: "UPDATE_BRACELET", bracelet: current }]
  };
}

test("standalone UPDATE_BRACELET mirrors Backend derivation: normalized totalBeadCount, production wrist and untouched ring identity", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const state = enqueueEdit(s0, updateBraceletEdit(s0, "req-wrist-1", 165));
  const projection = projectDesign(state);

  // The bracelet block must carry the new wrist and the true bead count, not a
  // stale copy of the pre-edit bracelet.
  assert.equal(projection.bracelet.wristCircumferenceMm, 165);
  assert.equal(projection.bracelet.totalBeadCount, projection.beads.length);
  assert.equal(projection.bracelet.totalBeadCount, design.beads.length);
  // Backend also copies the wrist into production so manufacture and preview agree.
  assert.equal(projection.production.wristCircumferenceMm, 165);
  // The ring itself is untouched: identity, order and anchor wiring stay intact.
  assert.deepEqual(projection.production.componentSequence, design.production.componentSequence);
  assert.deepEqual(projection.production.anchoredComponents, design.production.anchoredComponents);
  assert.deepEqual(projection.beads.map((bead) => bead.componentId), design.beads.map((bead) => bead.componentId));
  assert.deepEqual(projection.beads.map((bead) => bead.positionIndex), design.beads.map((bead) => bead.positionIndex));
  // Server authority is preserved through the wrist edit.
  assert.equal(projection.pricing, design.pricing);
  assert.equal(projection.revision, design.revision);
});

test("UPDATE_BRACELET normalizes an out-of-sync totalBeadCount against the live ring", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const drifted = { ...s0, confirmed: { ...design, bracelet: { ...design.bracelet, totalBeadCount: design.beads.length + 3 } } };
  const state = enqueueEdit(drifted, updateBraceletEdit(drifted, "req-wrist-2", 170));
  const projection = projectDesign(state);

  assert.equal(projection.bracelet.wristCircumferenceMm, 170);
  assert.equal(projection.bracelet.totalBeadCount, projection.beads.length);
  assert.notEqual(projection.bracelet.totalBeadCount, design.beads.length + 3);
  assert.equal(projection.production.wristCircumferenceMm, 170);
});

test("a mixed MOVE + UPDATE_BRACELET batch keeps sequence, bracelet and production coherent", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const moved = enqueueEdit(s0, moveEdit(s0, "req-move-1", "bead-01", 4));
  const state = enqueueEdit(moved, updateBraceletEdit(moved, "req-wrist-1", 165));
  const projection = projectDesign(state);

  const expectedSequence = [...design.production.componentSequence];
  const [first] = expectedSequence.splice(expectedSequence.indexOf("bead-01"), 1);
  expectedSequence.splice(4, 0, first!);
  assert.deepEqual(projection.production.componentSequence, expectedSequence);
  assert.equal(projection.bracelet.wristCircumferenceMm, 165);
  assert.equal(projection.production.wristCircumferenceMm, 165);
  assert.equal(projection.bracelet.totalBeadCount, projection.beads.length);
  assert.deepEqual(projection.production.anchoredComponents, design.production.anchoredComponents);
  assert.deepEqual(projection.beads.map((bead) => bead.positionIndex), projection.beads.map((_, index) => index));
});

test("a mixed REPLACE + UPDATE_BRACELET batch keeps replacement identity and wrist derivation coherent", () => {
  const design = baseDesign();
  const s0 = createOptimisticState(design);
  const projection0 = projectDesign(s0);
  const replaceRequest = createReplaceRequest(projection0, "bead-02", {
    ...design.beads[1]!,
    beadProductId: AMETHYST_MATERIAL.beadProductId,
    materialKey: AMETHYST_MATERIAL.materialKey,
    diameterMm: AMETHYST_MATERIAL.diameterMm,
    unitPriceMinor: AMETHYST_MATERIAL.unitPriceMinor
  });
  const replaced = enqueueEdit(s0, {
    requestId: "req-replace-1",
    operations: replaceRequest.operations,
    undoOperations: invertOperations(projection0, replaceRequest.operations)
  });
  const state = enqueueEdit(replaced, updateBraceletEdit(replaced, "req-wrist-1", 172));
  const projection = projectDesign(state);

  const replacedBead = projection.beads.find((bead) => bead.componentId === "bead-02")!;
  assert.equal(replacedBead.beadProductId, AMETHYST_MATERIAL.beadProductId);
  assert.equal(replacedBead.positionIndex, design.beads[1]!.positionIndex);
  assert.deepEqual(projection.production.componentSequence, design.production.componentSequence);
  assert.equal(projection.bracelet.wristCircumferenceMm, 172);
  assert.equal(projection.production.wristCircumferenceMm, 172);
  assert.equal(projection.bracelet.totalBeadCount, projection.beads.length);
});
