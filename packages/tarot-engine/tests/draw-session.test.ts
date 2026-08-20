import assert from "node:assert/strict";
import test from "node:test";

import { createPrivateDrawState, revealDraw, selectPosition, type RandomSource } from "../src/index";

class ZeroRandomSource implements RandomSource {
  nextInt(maxExclusive: number): number {
    assert.ok(maxExclusive > 0);
    return 0;
  }
}

class ReversedOrientationRandomSource implements RandomSource {
  private calls = 0;

  nextInt(maxExclusive: number): number {
    const call = this.calls;
    this.calls += 1;
    return call < 77 ? maxExclusive - 1 : 1;
  }
}

test("creates a deterministic Fisher-Yates deck and orientations from its injected random source", () => {
  const state = createPrivateDrawState({
    spreadType: "SINGLE",
    random: new ZeroRandomSource(),
  });

  assert.equal(state.deckOrder.length, 78);
  assert.equal(state.deckOrder[0], "01-the-magician");
  assert.equal(state.deckOrder[77], "00-the-fool");
  assert.deepEqual(new Set(state.deckOrder).size, 78);
  assert.deepEqual(new Set(state.orientationOrder), new Set(["UPRIGHT"]));
  assert.equal(state.revision, 0);
});

test("selects the Guidance slot for a one-card spread", () => {
  const state = createPrivateDrawState({
    spreadType: "SINGLE",
    random: new ZeroRandomSource(),
  });

  const selected = selectPosition(state, {
    slot: "GUIDANCE",
    displayedPosition: 12,
    expectedRevision: 0,
    operationId: "select-guidance",
  });

  assert.deepEqual(selected.selections, [{
    slot: "GUIDANCE",
    displayedPosition: 12,
    operationId: "select-guidance",
  }]);
  assert.equal(selected.revision, 1);
  assert.equal(state.selections.length, 0);
});

test("rejects a selection made against a stale revision", () => {
  const state = createPrivateDrawState({
    spreadType: "SINGLE",
    random: new ZeroRandomSource(),
  });

  assert.throws(
    () => selectPosition(state, {
      slot: "GUIDANCE",
      displayedPosition: 12,
      expectedRevision: 1,
      operationId: "stale-select",
    }),
    /stale revision/,
  );
});

test("returns the existing state for an idempotent selection retry", () => {
  const state = createPrivateDrawState({
    spreadType: "SINGLE",
    random: new ZeroRandomSource(),
  });
  const command = {
    slot: "GUIDANCE" as const,
    displayedPosition: 12,
    expectedRevision: 0,
    operationId: "retry-guidance",
  };
  const selected = selectPosition(state, command);

  assert.strictEqual(selectPosition(selected, command), selected);
});

test("requires Past before Present and Future in a three-card spread", () => {
  const state = createPrivateDrawState({
    spreadType: "PAST_PRESENT_FUTURE",
    random: new ZeroRandomSource(),
  });

  assert.throws(
    () => selectPosition(state, {
      slot: "PRESENT",
      displayedPosition: 12,
      expectedRevision: 0,
      operationId: "present-first",
    }),
    /expected slot PAST/,
  );
});

test("rejects a displayed deck position already selected by another slot", () => {
  const initial = createPrivateDrawState({
    spreadType: "PAST_PRESENT_FUTURE",
    random: new ZeroRandomSource(),
  });
  const past = selectPosition(initial, {
    slot: "PAST",
    displayedPosition: 12,
    expectedRevision: 0,
    operationId: "select-past",
  });

  assert.throws(
    () => selectPosition(past, {
      slot: "PRESENT",
      displayedPosition: 12,
      expectedRevision: 1,
      operationId: "duplicate-position",
    }),
    /already selected/,
  );
});

test("rejects a displayed position outside the deck", () => {
  const state = createPrivateDrawState({
    spreadType: "SINGLE",
    random: new ZeroRandomSource(),
  });

  assert.throws(
    () => selectPosition(state, {
      slot: "GUIDANCE",
      displayedPosition: 78,
      expectedRevision: 0,
      operationId: "invalid-position",
    }),
    /displayed position/,
  );
});

test("does not reveal a draw before every required slot has a selection", () => {
  const state = createPrivateDrawState({
    spreadType: "SINGLE",
    random: new ZeroRandomSource(),
  });

  assert.throws(() => revealDraw(state, 0), /draw is incomplete/);
});

test("reveals selected cards in slot order with stable orientations on repeat", () => {
  const initial = createPrivateDrawState({
    spreadType: "SINGLE",
    random: new ReversedOrientationRandomSource(),
  });
  const selected = selectPosition(initial, {
    slot: "GUIDANCE",
    displayedPosition: 1,
    expectedRevision: 0,
    operationId: "select-reversed",
  });

  const revealed = revealDraw(selected, 1);
  const repeated = revealDraw(revealed.state, 2);

  assert.deepEqual(revealed.cards.map((card) => ({
    id: card.id,
    slot: card.slot,
    orientation: card.orientation,
  })), [{
    id: "01-the-magician",
    slot: "GUIDANCE",
    orientation: "REVERSED",
  }]);
  assert.strictEqual(repeated.state, revealed.state);
  assert.deepEqual(repeated.cards, revealed.cards);
});

test("keeps a revealed draw immutable to additional selections", () => {
  const initial = createPrivateDrawState({
    spreadType: "SINGLE",
    random: new ZeroRandomSource(),
  });
  const selected = selectPosition(initial, {
    slot: "GUIDANCE",
    displayedPosition: 0,
    expectedRevision: 0,
    operationId: "initial-selection",
  });
  const revealed = revealDraw(selected, 1);

  assert.throws(
    () => selectPosition(revealed.state, {
      slot: "GUIDANCE",
      displayedPosition: 1,
      expectedRevision: 2,
      operationId: "after-reveal",
    }),
    /already revealed/,
  );
});
