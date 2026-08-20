import assert from "node:assert/strict";
import test from "node:test";

import { createPrivateDrawState, type RandomSource } from "@mystcrag/tarot-engine";

import { PersistenceError } from "../errors/persistence-errors.js";
import {
  parseDrawSnapshot,
  parsePrivateDrawState,
  parseRecommendationSnapshot,
  validateDrawSnapshotForWrite,
  validatePrivateDrawStateForWrite,
  validateRecommendationSnapshotForWrite
} from "./tarot-snapshot.mapper.js";

class ZeroRandomSource implements RandomSource {
  nextInt(): number {
    return 0;
  }
}

const validPrivateState = () =>
  createPrivateDrawState({ spreadType: "SINGLE", random: new ZeroRandomSource() });

const validRecommendationSnapshot = {
  interpretation: {
    headline: "A reflective direction",
    summary: "Use the imagery as a prompt for a balanced bracelet direction.",
    cardReflections: [{ slot: "GUIDANCE", reflection: "Notice the visual rhythm that feels steady." }],
    designRationale: "A restrained palette supports a clear focal point.",
    disclaimer: "For reflection and creative inspiration only."
  },
  colorStory: {
    primaryColor: "#A8C5D1",
    supportColor: "#F2EEE5",
    accentColor: "#B58A63",
    rationale: "Soft blue and warm neutral tones create balance."
  },
  materialRecommendations: [{
    beadProductId: "product-aquamarine-round-8",
    displayName: "Aquamarine round bead",
    crystalName: "Aquamarine",
    colorTags: ["blue"],
    reason: "Its translucent blue supports the visual direction."
  }]
};

test("Tarot snapshot mappers accept canonical strict values on write and read", () => {
  const privateState = validPrivateState();
  assert.deepEqual(validatePrivateDrawStateForWrite(privateState), privateState);
  assert.deepEqual(parsePrivateDrawState(structuredClone(privateState)), privateState);
  assert.deepEqual(validateDrawSnapshotForWrite({ acceptedSelections: [] }), { acceptedSelections: [] });
  assert.deepEqual(parseDrawSnapshot({ acceptedSelections: [] }), { acceptedSelections: [] });
  assert.deepEqual(
    validateRecommendationSnapshotForWrite(validRecommendationSnapshot),
    validRecommendationSnapshot
  );
  assert.deepEqual(parseRecommendationSnapshot(validRecommendationSnapshot), validRecommendationSnapshot);
});

test("Tarot snapshot write validation rejects unknown/private fields as VALIDATION_ERROR", () => {
  assert.throws(
    () => validateDrawSnapshotForWrite({ acceptedSelections: [], deckOrder: ["private"] }),
    (error: unknown) => error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
  );
  assert.throws(
    () => validateRecommendationSnapshotForWrite({
      ...validRecommendationSnapshot,
      question: "must not be persisted in a snapshot"
    }),
    (error: unknown) => error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
  );
});

test("Tarot snapshot read validation classifies malformed JSON as DATA_INTEGRITY_ERROR", () => {
  assert.throws(
    () => parsePrivateDrawState({ ...validPrivateState(), deckOrder: ["00-the-fool"] }),
    (error: unknown) => error instanceof PersistenceError && error.code === "DATA_INTEGRITY_ERROR"
  );
  assert.throws(
    () => parseDrawSnapshot({ acceptedSelections: [], unexpected: true }),
    (error: unknown) => error instanceof PersistenceError && error.code === "DATA_INTEGRITY_ERROR"
  );
  assert.throws(
    () => parseRecommendationSnapshot({ ...validRecommendationSnapshot, rawQuestion: "private" }),
    (error: unknown) => error instanceof PersistenceError && error.code === "DATA_INTEGRITY_ERROR"
  );
});
