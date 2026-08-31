import {
  UpdateDesignOperationSchema,
  type AccessoryV1,
  type BeadV1,
  type PublicDesignV1,
  type UpdateDesignOperation
} from "@mystcrag/design-contract";
import type { FrontendErrorCode } from "../../../lib/api/frontend-api-error";

/**
 * Optimistic Design Projection.
 *
 * This module is a projection layer over the canonical PublicDesignV1 aggregate,
 * never a second domain model. The server remains the authority for pricing,
 * inventory, revision and persistence: projected designs reuse the confirmed
 * pricing object untouched and never invent revisions. Backend applyOperations
 * semantics (splice-out/splice-in moves, index-preserving replacement) are
 * mirrored so reconciliation does not jump the UI.
 */

export type OptimisticSyncStatus = "saved" | "syncing" | "failed" | "conflict" | "recovered";

export type PendingEdit = {
  requestId: string;
  operations: readonly UpdateDesignOperation[];
  undoOperations: readonly UpdateDesignOperation[];
};

export type OptimisticDesignState = {
  confirmed: PublicDesignV1;
  pending: readonly PendingEdit[];
  undoStack: readonly PendingEdit[];
  redoStack: readonly PendingEdit[];
  status: OptimisticSyncStatus;
  failureCode: FrontendErrorCode | null;
  recoverableEdits: readonly PendingEdit[];
  discardedEdits: readonly PendingEdit[];
};

export type EditSettleOutcome =
  | { ok: true; design: PublicDesignV1 }
  | { ok: false; code: FrontendErrorCode };

const UNDO_STACK_LIMIT = 50;

type InlineAccessory = Extract<AccessoryV1, { placementMode: "INLINE" }>;
type AnchoredAccessory = Extract<AccessoryV1, { placementMode: "ANCHORED" }>;
type MainRingComponent = BeadV1 | InlineAccessory;

export function createOptimisticState(design: PublicDesignV1): OptimisticDesignState {
  return {
    confirmed: design,
    pending: [],
    undoStack: [],
    redoStack: [],
    status: "saved",
    failureCode: null,
    recoverableEdits: [],
    discardedEdits: []
  };
}

function mainRing(design: PublicDesignV1): MainRingComponent[] {
  return [
    ...design.beads,
    ...design.accessories.filter(
      (accessory): accessory is InlineAccessory => accessory.placementMode === "INLINE"
    )
  ].sort((left, right) => left.positionIndex - right.positionIndex);
}

function rebuildDesign(design: PublicDesignV1, ring: MainRingComponent[], anchored: AnchoredAccessory[]): PublicDesignV1 {
  const renumbered = ring.map((component, positionIndex) => ({ ...component, positionIndex }));
  const beads = renumbered.filter((component): component is BeadV1 => "beadProductId" in component);
  const inlineAccessories = renumbered.filter(
    (component): component is InlineAccessory => !("beadProductId" in component)
  );
  return {
    ...design,
    bracelet: { ...design.bracelet, totalBeadCount: beads.length },
    beads,
    accessories: [...inlineAccessories, ...anchored],
    production: {
      ...design.production,
      wristCircumferenceMm: design.bracelet.wristCircumferenceMm,
      componentSequence: renumbered.map((component) => component.componentId),
      anchoredComponents: anchored.map((accessory) => ({
        componentId: accessory.componentId,
        anchorComponentId: accessory.anchorComponentId,
        anchorSlot: accessory.anchorSlot
      }))
    }
  };
}

function applyOperation(design: PublicDesignV1, operation: UpdateDesignOperation): PublicDesignV1 {
  if (operation.operation === "UPDATE_BRACELET") {
    return { ...design, bracelet: operation.bracelet };
  }

  const ring = mainRing(design);
  let anchored = design.accessories.filter(
    (accessory): accessory is AnchoredAccessory => accessory.placementMode === "ANCHORED"
  );

  if (operation.operation === "MOVE_COMPONENT") {
    const index = ring.findIndex((component) => component.componentId === operation.componentId);
    if (index < 0 || operation.targetPositionIndex >= ring.length) return design;
    const [component] = ring.splice(index, 1);
    ring.splice(Math.max(0, operation.targetPositionIndex), 0, component!);
    return rebuildDesign(design, ring, anchored);
  }

  if (operation.operation === "ADD_COMPONENT") {
    const known = new Set([...ring, ...anchored].map((component) => component.componentId));
    if (known.has(operation.component.componentId)) return design;
    if ("beadProductId" in operation.component || operation.component.placementMode === "INLINE") {
      const target = Math.min(Math.max(0, operation.component.positionIndex), ring.length);
      ring.splice(target, 0, operation.component);
    } else {
      anchored = [...anchored, operation.component];
    }
    return rebuildDesign(design, ring, anchored);
  }

  if (operation.operation === "REMOVE_COMPONENT") {
    // The Backend rejects removing an anchor bead; the editor guards it too. The
    // projection cascades anyway so a queued edge case never dangles an anchor.
    anchored = anchored.filter((accessory) => accessory.anchorComponentId !== operation.componentId);
    const nextRing = ring.filter((component) => component.componentId !== operation.componentId);
    const nextAnchored = anchored.filter((accessory) => accessory.componentId !== operation.componentId);
    if (nextRing.length === ring.length && nextAnchored.length === anchored.length) return design;
    return rebuildDesign(design, nextRing, nextAnchored);
  }

  // REPLACE_COMPONENT
  if (operation.replacement.componentId !== operation.componentId) return design;
  const ringIndex = ring.findIndex((component) => component.componentId === operation.componentId);
  const anchoredIndex = anchored.findIndex((accessory) => accessory.componentId === operation.componentId);
  if (ringIndex < 0 && anchoredIndex < 0) return design;
  const replacement = operation.replacement;
  if (ringIndex >= 0) ring.splice(ringIndex, 1);
  if (anchoredIndex >= 0) anchored = anchored.filter((_, index) => index !== anchoredIndex);
  if ("beadProductId" in replacement || replacement.placementMode === "INLINE") {
    ring.splice(Math.max(0, ringIndex), 0, replacement);
  } else {
    anchored = [...anchored, replacement];
  }
  return rebuildDesign(design, ring, anchored);
}

export function projectDesign(state: OptimisticDesignState): PublicDesignV1 {
  if (state.pending.length === 0) return state.confirmed;
  return state.pending.reduce(
    (projection, edit) => edit.operations.reduce(applyOperation, projection),
    state.confirmed
  );
}

function withPendingEdit(state: OptimisticDesignState, edit: PendingEdit): OptimisticDesignState {
  if (state.status === "conflict") return state;
  return {
    ...state,
    pending: [...state.pending, edit],
    status: "syncing",
    failureCode: null,
    recoverableEdits: [],
    discardedEdits: [...state.discardedEdits, ...state.recoverableEdits]
  };
}

export function enqueueEdit(state: OptimisticDesignState, edit: PendingEdit): OptimisticDesignState {
  const next = withPendingEdit(state, edit);
  if (next === state) return state;
  return {
    ...next,
    undoStack: [...next.undoStack, edit].slice(-UNDO_STACK_LIMIT),
    redoStack: []
  };
}

export function applyUndo(state: OptimisticDesignState, requestId: string): OptimisticDesignState {
  const entry = state.undoStack[state.undoStack.length - 1];
  if (!entry || state.status === "conflict") return state;
  const edit: PendingEdit = { requestId, operations: entry.undoOperations, undoOperations: entry.operations };
  const pending = withPendingEdit(state, edit);
  if (pending === state) return state;
  return {
    ...pending,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [...state.redoStack, { requestId: edit.requestId, operations: entry.operations, undoOperations: entry.undoOperations }]
  };
}

export function applyRedo(state: OptimisticDesignState, requestId: string): OptimisticDesignState {
  const entry = state.redoStack[state.redoStack.length - 1];
  if (!entry || state.status === "conflict") return state;
  const edit: PendingEdit = { requestId, operations: entry.operations, undoOperations: entry.undoOperations };
  const pending = withPendingEdit(state, edit);
  if (pending === state) return state;
  return {
    ...pending,
    redoStack: state.redoStack.slice(0, -1),
    undoStack: [...state.undoStack, { requestId: edit.requestId, operations: entry.operations, undoOperations: entry.undoOperations }].slice(-UNDO_STACK_LIMIT)
  };
}

export function nextEditToSync(state: OptimisticDesignState): PendingEdit | null {
  if (state.status !== "syncing" && state.status !== "recovered") return null;
  return state.pending[0] ?? null;
}

export function settleEdit(
  state: OptimisticDesignState,
  requestId: string,
  outcome: EditSettleOutcome
): OptimisticDesignState {
  const inFlight = state.pending[0];
  if (!inFlight || inFlight.requestId !== requestId) return state;

  if (outcome.ok) {
    const pending = state.pending.slice(1);
    return {
      ...state,
      confirmed: outcome.design,
      pending,
      status: pending.length > 0 ? "syncing" : "saved",
      failureCode: null
    };
  }

  if (outcome.code === "CONFLICT") {
    return { ...state, status: "conflict", failureCode: "CONFLICT" };
  }

  const rolledBack = state.pending;
  const rolledBackIds = new Set(rolledBack.map((edit) => edit.requestId));
  return {
    ...state,
    pending: [],
    undoStack: state.undoStack.filter((entry) => !rolledBackIds.has(entry.requestId)),
    redoStack: state.redoStack.filter((entry) => !rolledBackIds.has(entry.requestId)),
    status: "failed",
    failureCode: outcome.code,
    recoverableEdits: rolledBack
  };
}

export function retryFailedEdits(state: OptimisticDesignState): OptimisticDesignState {
  if (state.status !== "failed" || state.recoverableEdits.length === 0) return state;
  return {
    ...state,
    pending: [...state.recoverableEdits],
    undoStack: [...state.undoStack, ...state.recoverableEdits].slice(-UNDO_STACK_LIMIT),
    status: "syncing",
    failureCode: null,
    recoverableEdits: []
  };
}

export function resolveConflict(state: OptimisticDesignState, freshServerDesign: PublicDesignV1): OptimisticDesignState {
  if (state.status !== "conflict") return state;
  if (freshServerDesign.revision === state.confirmed.revision) {
    return {
      ...state,
      confirmed: freshServerDesign,
      status: state.pending.length > 0 ? "syncing" : "saved",
      failureCode: null
    };
  }
  const discardedIds = new Set(state.pending.map((edit) => edit.requestId));
  return {
    ...state,
    confirmed: freshServerDesign,
    pending: [],
    undoStack: state.undoStack.filter((entry) => !discardedIds.has(entry.requestId)),
    redoStack: state.redoStack.filter((entry) => !discardedIds.has(entry.requestId)),
    status: "recovered",
    failureCode: null,
    discardedEdits: [...state.discardedEdits, ...state.pending]
  };
}

export function dismissRecoveryNotice(state: OptimisticDesignState): OptimisticDesignState {
  return {
    ...state,
    discardedEdits: [],
    status: state.status === "recovered" && state.pending.length === 0 ? "saved" : state.status
  };
}

export type EditRecoveryRecord = {
  designId: string;
  revision: number;
  edits: readonly PendingEdit[];
};

export type RecoveryOutcome = "restored" | "discarded-design" | "discarded-revision";

export function serializeRecoveryRecord(state: OptimisticDesignState): string | null {
  if (state.pending.length === 0) return null;
  // Edit intent only: no credentials, tokens, cookies or other sensitive data.
  const record: EditRecoveryRecord = {
    designId: state.confirmed.designId,
    revision: state.confirmed.revision,
    edits: state.pending.map((edit) => ({
      requestId: edit.requestId,
      operations: edit.operations,
      undoOperations: edit.undoOperations
    }))
  };
  return JSON.stringify(record);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parsePendingEdit(value: unknown): PendingEdit | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!exactKeys(candidate, ["requestId", "operations", "undoOperations"])) return null;
  if (!isNonEmptyString(candidate.requestId)) return null;
  if (!Array.isArray(candidate.operations) || candidate.operations.length === 0) return null;
  if (!Array.isArray(candidate.undoOperations)) return null;
  const operations: UpdateDesignOperation[] = [];
  for (const operation of candidate.operations) {
    const parsed = UpdateDesignOperationSchema.safeParse(operation);
    if (!parsed.success) return null;
    operations.push(parsed.data);
  }
  const undoOperations: UpdateDesignOperation[] = [];
  for (const operation of candidate.undoOperations) {
    const parsed = UpdateDesignOperationSchema.safeParse(operation);
    if (!parsed.success) return null;
    undoOperations.push(parsed.data);
  }
  return { requestId: candidate.requestId, operations, undoOperations };
}

export function parseRecoveryRecord(json: string): EditRecoveryRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const candidate = parsed as Record<string, unknown>;
  if (!exactKeys(candidate, ["designId", "revision", "edits"])) return null;
  if (!isNonEmptyString(candidate.designId)) return null;
  if (!Number.isSafeInteger(candidate.revision) || (candidate.revision as number) <= 0) return null;
  if (!Array.isArray(candidate.edits) || candidate.edits.length === 0) return null;
  const edits: PendingEdit[] = [];
  for (const item of candidate.edits) {
    const edit = parsePendingEdit(item);
    if (!edit) return null;
    edits.push(edit);
  }
  return { designId: candidate.designId, revision: candidate.revision as number, edits };
}

export function restoreRecoveredEdits(
  state: OptimisticDesignState,
  record: EditRecoveryRecord
): { state: OptimisticDesignState; outcome: RecoveryOutcome } {
  if (record.designId !== state.confirmed.designId) {
    return { state, outcome: "discarded-design" };
  }
  if (state.pending.length > 0 || record.revision !== state.confirmed.revision) {
    return {
      state: {
        ...state,
        discardedEdits: [...state.discardedEdits, ...record.edits],
        status: "recovered"
      },
      outcome: "discarded-revision"
    };
  }
  return {
    state: {
      ...state,
      pending: [...record.edits],
      undoStack: [...state.undoStack, ...record.edits].slice(-UNDO_STACK_LIMIT),
      redoStack: [],
      status: "recovered",
      failureCode: null
    },
    outcome: "restored"
  };
}
