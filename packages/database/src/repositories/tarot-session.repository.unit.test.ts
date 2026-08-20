import assert from "node:assert/strict";
import test from "node:test";

import {
  createPrivateDrawState,
  revealDraw,
  selectPosition,
  type PrivateDrawState,
  type RandomSource,
  type RevealedTarotCard
} from "@mystcrag/tarot-engine";

import type { PrismaClient } from "../../generated/client/client.js";
import { PersistenceError } from "../errors/persistence-errors.js";
import {
  TarotSessionRepositoryImpl,
  type TarotDrawSnapshot,
  type TarotRecommendationSnapshot
} from "./tarot-session.repository.js";

class ZeroRandomSource implements RandomSource {
  nextInt(maxExclusive: number): number {
    assert.ok(maxExclusive > 0);
    return 0;
  }
}

const toDrawSnapshot = (
  state: PrivateDrawState,
  cards?: readonly RevealedTarotCard[]
): TarotDrawSnapshot => ({
  acceptedSelections: state.selections.map((selection) => ({ ...selection })),
  ...(cards
    ? {
        revealedCards: cards.map((card) => ({
          slot: card.slot,
          displayedPosition: card.displayedPosition,
          cardId: card.id,
          number: card.number,
          nameZh: card.nameZh,
          nameEn: card.nameEn,
          assetFile: card.assetFile,
          orientation: card.orientation,
          keywords: [...(card.orientation === "UPRIGHT" ? card.uprightKeywords : card.reversedKeywords)]
        }))
      }
    : {})
});

const recommendationSnapshot: TarotRecommendationSnapshot = {
  interpretation: {
    headline: "A grounded next step",
    summary: "Use the imagery as a prompt for a balanced design direction.",
    cardReflections: [{ slot: "GUIDANCE", reflection: "Notice the colors that feel steady." }],
    designRationale: "Three visual directions vary contrast and focus.",
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

const recommendationLinks = [1, 2, 3].map((rank) => ({
  id: `recommendation-${rank}`,
  designId: `design-${rank}`,
  rank,
  createdAt: new Date("2026-08-20T10:00:00.000Z"),
  design: { ownerId: "owner-1" }
}));

type TransactionRow = {
  id: string;
  ownerId: string;
  spreadType: "SINGLE";
  theme: "SELF_GROWTH";
  status: "DRAWING" | "DRAWN" | "RECOMMENDED" | "SAVED";
  stateRevision: number;
  deckVersion: string;
  ruleVersion: string;
  privateDeckState: PrivateDrawState;
  drawSnapshot: TarotDrawSnapshot;
  recommendationSnapshot: TarotRecommendationSnapshot | null;
  questionCiphertext: string | null;
  questionSavedAt: Date | null;
  selectedDesignId: string | null;
  parentSessionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  recommendations: typeof recommendationLinks;
  parentSession: null;
};

const rowFor = (input: {
  state: PrivateDrawState;
  drawSnapshot: TarotDrawSnapshot;
  stateRevision: number;
  status: TransactionRow["status"];
  recommendationSnapshot?: TarotRecommendationSnapshot;
  selectedDesignId?: string;
  questionCiphertext?: string;
  questionSavedAt?: Date;
}): TransactionRow => ({
  id: "session-1",
  ownerId: "owner-1",
  spreadType: "SINGLE",
  theme: "SELF_GROWTH",
  status: input.status,
  stateRevision: input.stateRevision,
  deckVersion: "rws-major-minor-v1",
  ruleVersion: "tarot-design-v1",
  privateDeckState: input.state,
  drawSnapshot: input.drawSnapshot,
  recommendationSnapshot: input.recommendationSnapshot ?? null,
  questionCiphertext: input.questionCiphertext ?? null,
  questionSavedAt: input.questionSavedAt ?? null,
  selectedDesignId: input.selectedDesignId ?? null,
  parentSessionId: null,
  createdAt: new Date("2026-08-20T10:00:00.000Z"),
  updatedAt: new Date("2026-08-20T10:01:00.000Z"),
  recommendations: input.recommendationSnapshot === undefined ? [] : recommendationLinks,
  parentSession: null
});

class TransactionDouble {
  private readIndex = 0;

  constructor(
    private readonly rows: readonly TransactionRow[],
    private readonly updateCount = 1
  ) {}

  readonly tarotSession: {
    findFirst: () => Promise<TransactionRow | null>;
    updateMany: () => Promise<{ count: number }>;
    count: () => Promise<number>;
  } = {
    findFirst: async () => null,
    updateMany: async () => ({ count: 0 }),
    count: async () => 0
  };

  readonly design = {
    count: async () => 3
  };

  readonly tarotDesignRecommendation = {
    createMany: async () => ({ count: 3 })
  };

  async $transaction<T>(callback: (transaction: TransactionDouble) => Promise<T>): Promise<T> {
    return callback(this);
  }

  initialize(): this {
    this.tarotSession.findFirst = async () =>
      this.rows[Math.min(this.readIndex++, this.rows.length - 1)] ?? null;
    this.tarotSession.updateMany = async () => ({ count: this.updateCount });
    this.tarotSession.count = async () => 1;
    return this;
  }
}

const repositoryWith = (...rows: TransactionRow[]) => {
  const transaction = new TransactionDouble(rows).initialize();
  return new TarotSessionRepositoryImpl(transaction as unknown as PrismaClient);
};

const singleDrawStates = () => {
  const initial = createPrivateDrawState({
    spreadType: "SINGLE",
    random: new ZeroRandomSource()
  });
  const selected = selectPosition(initial, {
    slot: "GUIDANCE",
    displayedPosition: 12,
    expectedRevision: 0,
    operationId: "select-concurrently"
  });
  const revealed = revealDraw(selected, 1);
  return { initial, selected, revealed };
};

test("a selection CAS loser returns the concurrently accepted identical operation", async () => {
  const { initial, selected } = singleDrawStates();
  const transaction = new TransactionDouble([
    rowFor({
      state: initial,
      drawSnapshot: toDrawSnapshot(initial),
      stateRevision: 1,
      status: "DRAWING"
    }),
    rowFor({
      state: selected,
      drawSnapshot: toDrawSnapshot(selected),
      stateRevision: 2,
      status: "DRAWING"
    })
  ], 0).initialize();
  const repository = new TarotSessionRepositoryImpl(transaction as unknown as PrismaClient);

  const result = await repository.updateDraw({
    ownerId: "owner-1",
    sessionId: "session-1",
    expectedRevision: 1,
    operationId: "select-concurrently",
    status: "DRAWING",
    privateDeckState: selected,
    drawSnapshot: toDrawSnapshot(selected)
  });

  assert.equal(result.stateRevision, 2);
  assert.deepEqual(result.privateDeckState.selections, [{
    slot: "GUIDANCE",
    displayedPosition: 12,
    operationId: "select-concurrently"
  }]);
});

test("an exact reveal no-op rejects revisions outside the current-or-consumed window", async () => {
  const { revealed } = singleDrawStates();
  const current = rowFor({
    state: revealed.state,
    drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards),
    stateRevision: 3,
    status: "DRAWN"
  });

  for (const expectedRevision of [1, 4]) {
    await assert.rejects(
      () => repositoryWith(current).updateDraw({
        ownerId: "owner-1",
        sessionId: "session-1",
        expectedRevision,
        status: "DRAWN",
        privateDeckState: revealed.state,
        drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards)
      }),
      (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
    );
  }
});

test("an exact reveal no-op accepts the current and immediately consumed revisions", async () => {
  const { revealed } = singleDrawStates();
  const current = rowFor({
    state: revealed.state,
    drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards),
    stateRevision: 3,
    status: "DRAWN"
  });

  for (const expectedRevision of [2, 3]) {
    const result = await repositoryWith(current).updateDraw({
      ownerId: "owner-1",
      sessionId: "session-1",
      expectedRevision,
      status: "DRAWN",
      privateDeckState: revealed.state,
      drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards)
    });
    assert.equal(result.stateRevision, 3);
  }
});

test("an exact recommendation no-op rejects old/future revisions and an older retry after save", async () => {
  const { revealed } = singleDrawStates();
  const recommended = rowFor({
    state: revealed.state,
    drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards),
    stateRevision: 4,
    status: "RECOMMENDED",
    recommendationSnapshot
  });
  const saved = rowFor({
    state: revealed.state,
    drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards),
    stateRevision: 5,
    status: "SAVED",
    recommendationSnapshot,
    selectedDesignId: "design-2"
  });
  const input = {
    ownerId: "owner-1",
    sessionId: "session-1",
    recommendationSnapshot,
    recommendations: recommendationLinks.map(({ rank, designId }) => ({ rank, designId }))
  };

  for (const expectedRevision of [1, 5]) {
    await assert.rejects(
      () => repositoryWith(recommended).saveRecommendations({ ...input, expectedRevision }),
      (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
    );
  }
  for (const expectedRevision of [3, 4]) {
    await assert.rejects(
      () => repositoryWith(saved).saveRecommendations({ ...input, expectedRevision }),
      (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
    );
  }
});

test("an exact recommendation no-op accepts only its immediate window or refreshed later state", async () => {
  const { revealed } = singleDrawStates();
  const recommended = rowFor({
    state: revealed.state,
    drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards),
    stateRevision: 4,
    status: "RECOMMENDED",
    recommendationSnapshot
  });
  const saved = rowFor({
    state: revealed.state,
    drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards),
    stateRevision: 5,
    status: "SAVED",
    recommendationSnapshot,
    selectedDesignId: "design-2"
  });
  const input = {
    ownerId: "owner-1",
    sessionId: "session-1",
    recommendationSnapshot,
    recommendations: recommendationLinks.map(({ rank, designId }) => ({ rank, designId }))
  };

  for (const expectedRevision of [3, 4]) {
    const result = await repositoryWith(recommended).saveRecommendations({
      ...input,
      expectedRevision
    });
    assert.equal(result.stateRevision, 4);
  }
  const refreshed = await repositoryWith(saved).saveRecommendations({
    ...input,
    expectedRevision: 5
  });
  assert.equal(refreshed.stateRevision, 5);
});

test("a recommendation retry with different ciphertext is not an exact repository no-op", async () => {
  const { revealed } = singleDrawStates();
  const persistedAt = new Date("2026-08-20T10:02:00.000Z");
  const recommended = rowFor({
    state: revealed.state,
    drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards),
    stateRevision: 4,
    status: "RECOMMENDED",
    recommendationSnapshot,
    questionCiphertext: "random-envelope-from-winner",
    questionSavedAt: persistedAt
  });

  const exact = await repositoryWith(recommended).saveRecommendations({
    ownerId: "owner-1",
    sessionId: "session-1",
    expectedRevision: 3,
    recommendationSnapshot,
    recommendations: recommendationLinks.map(({ rank, designId }) => ({ rank, designId })),
    questionCiphertext: "random-envelope-from-winner",
    questionSavedAt: persistedAt
  });
  assert.equal(exact.questionCiphertext, "random-envelope-from-winner");
  assert.deepEqual(exact.questionSavedAt, persistedAt);

  await assert.rejects(
    () => repositoryWith(recommended).saveRecommendations({
      ownerId: "owner-1",
      sessionId: "session-1",
      expectedRevision: 3,
      recommendationSnapshot,
      recommendations: recommendationLinks.map(({ rank, designId }) => ({ rank, designId })),
      questionCiphertext: "different-random-envelope-from-cas-loser",
      questionSavedAt: new Date("2026-08-20T10:02:00.001Z")
    }),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

test("a recommendation CAS loser rejects a different ciphertext and timestamp", async () => {
  const { revealed } = singleDrawStates();
  const drawn = rowFor({
    state: revealed.state,
    drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards),
    stateRevision: 3,
    status: "DRAWN"
  });
  const recommended = rowFor({
    state: revealed.state,
    drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards),
    stateRevision: 4,
    status: "RECOMMENDED",
    recommendationSnapshot,
    questionCiphertext: "random-envelope-from-winner",
    questionSavedAt: new Date("2026-08-20T10:02:00.000Z")
  });
  const transaction = new TransactionDouble([drawn, recommended], 0).initialize();
  const repository = new TarotSessionRepositoryImpl(transaction as unknown as PrismaClient);

  await assert.rejects(
    () => repository.saveRecommendations({
      ownerId: "owner-1",
      sessionId: "session-1",
      expectedRevision: 3,
      recommendationSnapshot,
      recommendations: recommendationLinks.map(({ rank, designId }) => ({ rank, designId })),
      questionCiphertext: "different-random-envelope-from-cas-loser",
      questionSavedAt: new Date("2026-08-20T10:02:00.001Z")
    }),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

test("an exact save no-op rejects revisions outside the current-or-consumed window", async () => {
  const { revealed } = singleDrawStates();
  const saved = rowFor({
    state: revealed.state,
    drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards),
    stateRevision: 5,
    status: "SAVED",
    recommendationSnapshot,
    selectedDesignId: "design-2"
  });

  for (const expectedRevision of [2, 6]) {
    await assert.rejects(
      () => repositoryWith(saved).markSaved({
        ownerId: "owner-1",
        sessionId: "session-1",
        expectedRevision,
        selectedDesignId: "design-2"
      }),
      (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
    );
  }
});

test("an exact save no-op accepts the current and immediately consumed revisions", async () => {
  const { revealed } = singleDrawStates();
  const saved = rowFor({
    state: revealed.state,
    drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards),
    stateRevision: 5,
    status: "SAVED",
    recommendationSnapshot,
    selectedDesignId: "design-2"
  });

  for (const expectedRevision of [4, 5]) {
    const result = await repositoryWith(saved).markSaved({
      ownerId: "owner-1",
      sessionId: "session-1",
      expectedRevision,
      selectedDesignId: "design-2"
    });
    assert.equal(result.stateRevision, 5);
  }
});
