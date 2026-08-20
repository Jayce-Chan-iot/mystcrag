import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateTarotSessionResponseSchema,
  GetTarotSessionResponseSchema,
  RevealTarotSessionResponseSchema,
  SaveTarotSessionResponseSchema,
  SelectTarotCardResponseSchema,
  DesignV1Schema,
  type DesignV1
} from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";
import {
  PersistenceError,
  type CreateTarotSessionRecord,
  type MarkTarotSessionSavedRecord,
  type SaveTarotRecommendationsRecord,
  type TarotDrawSnapshot,
  type TarotRecommendationSnapshot,
  type TarotSessionRecord,
  type TarotSessionRepository,
  type UpdateTarotDrawRecord
} from "@mystcrag/database";
import {
  createPrivateDrawState,
  revealDraw,
  selectPosition,
  type RandomSource,
  type RevealedTarotCard
} from "@mystcrag/tarot-engine";

import { DomainApiError } from "../../contracts/api-error.js";
import { TarotService } from "./tarot.service.js";

const actorId = "tarot-owner";
const otherActorId = "tarot-other-owner";
const fixedNow = new Date("2026-08-20T12:00:00.000Z");

class ZeroRandomSource implements RandomSource {
  nextInt(maxExclusive: number): number {
    assert.ok(maxExclusive > 0);
    return 0;
  }
}

const clone = <T>(value: T): T => structuredClone(value);

const toDrawSnapshot = (
  state: TarotSessionRecord["privateDeckState"],
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
          keywords: [
            ...(card.orientation === "UPRIGHT"
              ? card.uprightKeywords
              : card.reversedKeywords)
          ]
        }))
      }
    : {})
});

const recommendationSnapshot: TarotRecommendationSnapshot = {
  interpretation: {
    headline: "A grounded next step",
    summary: "Use the imagery as a reflective prompt for a balanced design direction.",
    cardReflections: [
      { slot: "GUIDANCE", reflection: "Notice the colors that feel steady today." }
    ],
    designRationale: "Three visual directions vary contrast and focus.",
    disclaimer: "For reflection and creative inspiration only."
  },
  colorStory: {
    primaryColor: "#A8C5D1",
    supportColor: "#F2EEE5",
    accentColor: "#B58A63",
    rationale: "Soft blue and warm neutral tones create balance."
  },
  materialRecommendations: [
    {
      beadProductId: "product-aquamarine-round-8",
      displayName: "Aquamarine round bead",
      crystalName: "Aquamarine",
      colorTags: ["blue"],
      reason: "Its translucent blue supports the visual direction."
    }
  ]
};

class InMemoryTarotRepository implements TarotSessionRepository {
  private readonly records = new Map<string, TarotSessionRecord>();
  private sequence = 0;

  seed(record: TarotSessionRecord): void {
    this.records.set(record.id, clone(record));
  }

  readPrivate(sessionId: string): TarotSessionRecord {
    const record = this.records.get(sessionId);
    assert.ok(record);
    return clone(record);
  }

  async create(input: CreateTarotSessionRecord): Promise<TarotSessionRecord> {
    if (input.parentSessionId !== undefined) {
      this.requireOwned(input.ownerId, input.parentSessionId);
    }
    const createdAt = new Date(fixedNow.getTime() + this.sequence * 1_000);
    const record: TarotSessionRecord = {
      id: `tarot-session-${++this.sequence}`,
      ownerId: input.ownerId,
      spreadType: input.spreadType,
      theme: input.theme,
      status: "DRAWING",
      stateRevision: 1,
      deckVersion: input.deckVersion,
      ruleVersion: input.ruleVersion,
      privateDeckState: clone(input.privateDeckState),
      drawSnapshot: clone(input.drawSnapshot),
      recommendationSnapshot: null,
      questionCiphertext: null,
      questionSavedAt: null,
      selectedDesignId: null,
      parentSessionId: input.parentSessionId ?? null,
      recommendations: [],
      createdAt,
      updatedAt: createdAt
    };
    this.records.set(record.id, record);
    return clone(record);
  }

  async getOwned(ownerId: string, sessionId: string): Promise<TarotSessionRecord> {
    return clone(this.requireOwned(ownerId, sessionId));
  }

  async updateDraw(input: UpdateTarotDrawRecord): Promise<TarotSessionRecord> {
    const current = this.requireOwned(input.ownerId, input.sessionId);
    const existing = input.operationId
      ? current.privateDeckState.selections.find(
          (selection) => selection.operationId === input.operationId
        )
      : undefined;
    if (existing) {
      const retry = input.privateDeckState.selections.find(
        (selection) => selection.operationId === input.operationId
      );
      if (
        retry?.slot !== existing.slot ||
        retry.displayedPosition !== existing.displayedPosition
      ) {
        throw new PersistenceError(
          "CONFLICT",
          "Tarot operation ID was reused with different input"
        );
      }
      return clone(current);
    }
    const exactRevealRetry =
      input.operationId === undefined &&
      current.status === "DRAWN" &&
      JSON.stringify(current.privateDeckState) === JSON.stringify(input.privateDeckState) &&
      JSON.stringify(current.drawSnapshot) === JSON.stringify(input.drawSnapshot) &&
      (input.expectedRevision === current.stateRevision ||
        input.expectedRevision === current.stateRevision - 1);
    if (exactRevealRetry) return clone(current);
    if (current.stateRevision !== input.expectedRevision) {
      throw new PersistenceError("CONFLICT", "Tarot session revision conflict");
    }
    if (current.status !== "DRAWING") {
      throw new PersistenceError("CONFLICT", "Tarot draw is immutable");
    }
    const updated: TarotSessionRecord = {
      ...current,
      status: input.status,
      stateRevision: current.stateRevision + 1,
      privateDeckState: clone(input.privateDeckState),
      drawSnapshot: clone(input.drawSnapshot),
      updatedAt: new Date(current.updatedAt.getTime() + 1_000)
    };
    this.records.set(updated.id, updated);
    return clone(updated);
  }

  async saveRecommendations(
    _input: SaveTarotRecommendationsRecord
  ): Promise<TarotSessionRecord> {
    throw new Error("Recommendation generation belongs to Task 5");
  }

  async markSaved(input: MarkTarotSessionSavedRecord): Promise<TarotSessionRecord> {
    const current = this.requireOwned(input.ownerId, input.sessionId);
    if (current.status === "SAVED") {
      if (
        current.selectedDesignId === (input.selectedDesignId ?? null) &&
        (input.expectedRevision === current.stateRevision ||
          input.expectedRevision === current.stateRevision - 1)
      ) {
        return clone(current);
      }
      throw new PersistenceError("CONFLICT", "Tarot session was already saved");
    }
    if (current.status !== "RECOMMENDED") {
      throw new PersistenceError("CONFLICT", "Tarot session is not ready to save");
    }
    if (current.stateRevision !== input.expectedRevision) {
      throw new PersistenceError("CONFLICT", "Tarot session revision conflict");
    }
    if (
      input.selectedDesignId !== undefined &&
      !current.recommendations.some(
        (recommendation) => recommendation.designId === input.selectedDesignId
      )
    ) {
      throw new PersistenceError(
        "VALIDATION_ERROR",
        "Selected design must be a session recommendation"
      );
    }
    const updated: TarotSessionRecord = {
      ...current,
      status: "SAVED",
      stateRevision: current.stateRevision + 1,
      selectedDesignId: input.selectedDesignId ?? null,
      updatedAt: new Date(current.updatedAt.getTime() + 1_000)
    };
    this.records.set(updated.id, updated);
    return clone(updated);
  }

  private requireOwned(ownerId: string, sessionId: string): TarotSessionRecord {
    const record = this.records.get(sessionId);
    if (!record || record.ownerId !== ownerId) {
      throw new PersistenceError("NOT_FOUND", "Tarot session not found");
    }
    return record;
  }
}

const tarotDesign = (rank: number): DesignV1 =>
  DesignV1Schema.parse({
    ...structuredClone(standardAiDesignFixture),
    designId: `tarot-design-${rank}`,
    designName: `Tarot direction ${rank}`,
    designMode: "TAROT_GUIDED"
  });

function createHarness() {
  const repository = new InMemoryTarotRepository();
  const designs = [1, 2, 3].map(tarotDesign);
  const service = new TarotService({
    repository,
    random: new ZeroRandomSource(),
    designReader: {
      async getOwnedDesign(ownerId: string, designId: string) {
        if (ownerId !== actorId) {
          throw new PersistenceError("NOT_FOUND", "Design not found");
        }
        const design = designs.find((candidate) => candidate.designId === designId);
        if (!design) throw new PersistenceError("NOT_FOUND", "Design not found");
        return clone(design);
      }
    }
  });
  return { repository, service, designs };
}

const createSingle = (service: TarotService, requestId = "create-single") =>
  service.create(actorId, {
    requestId,
    spreadType: "SINGLE",
    theme: "SELF_GROWTH"
  });

test("create persists one complete private shuffle and returns only a validated public drawing", async () => {
  const { repository, service } = createHarness();
  const response = await createSingle(service);

  assert.deepEqual(CreateTarotSessionResponseSchema.parse(response), response);
  assert.equal(response.session.status, "DRAWING");
  assert.equal(response.session.revision, 1);
  assert.deepEqual(response.session.slots, ["GUIDANCE"]);
  assert.match(response.cardBack.assetFile, /\.(?:png|webp|svg)$/);

  const stored = repository.readPrivate(response.session.sessionId);
  assert.equal(stored.privateDeckState.deckOrder.length, 78);
  assert.equal(new Set(stored.privateDeckState.deckOrder).size, 78);
  assert.equal(stored.privateDeckState.orientationOrder.length, 78);

  const publicJson = JSON.stringify(response);
  for (const privateKey of [
    "deckOrder",
    "orientationOrder",
    "privateDeckState",
    "questionCiphertext",
    "ruleVersion",
    "deckVersion"
  ]) {
    assert.equal(publicJson.includes(privateKey), false);
  }
});

test("create accepts only an actor-owned parent session", async () => {
  const { service } = createHarness();
  const parent = await createSingle(service, "create-parent");
  const child = await service.create(actorId, {
    requestId: "create-child",
    spreadType: "SINGLE",
    theme: "NEW_BEGINNINGS",
    parentSessionId: parent.session.sessionId
  });
  assert.equal(child.session.parentSessionId, parent.session.sessionId);

  await assert.rejects(
    () =>
      service.create(otherActorId, {
        requestId: "create-cross-owner-child",
        spreadType: "SINGLE",
        theme: "NEW_BEGINNINGS",
        parentSessionId: parent.session.sessionId
      }),
    (error: unknown) =>
      error instanceof PersistenceError && error.code === "NOT_FOUND"
  );
});

test("select enforces canonical slot order and unique physical positions", async () => {
  const { service } = createHarness();
  const created = await service.create(actorId, {
    requestId: "create-three",
    spreadType: "PAST_PRESENT_FUTURE",
    theme: "RELATIONSHIPS"
  });

  await assert.rejects(
    () =>
      service.select(actorId, created.session.sessionId, {
        requestId: "select-wrong-slot",
        slot: "PRESENT",
        displayedPosition: 8,
        expectedRevision: 1,
        operationId: "wrong-slot"
      }),
    (error: unknown) => error instanceof DomainApiError && error.code === "CONFLICT"
  );

  const first = await service.select(actorId, created.session.sessionId, {
    requestId: "select-past",
    slot: "PAST",
    displayedPosition: 8,
    expectedRevision: 1,
    operationId: "select-past"
  });
  assert.equal(first.session.status, "DRAWING");

  await assert.rejects(
    () =>
      service.select(actorId, created.session.sessionId, {
        requestId: "select-duplicate-position",
        slot: "PRESENT",
        displayedPosition: 8,
        expectedRevision: 2,
        operationId: "duplicate-position"
      }),
    (error: unknown) => error instanceof DomainApiError && error.code === "CONFLICT"
  );
});

test("select rejects stale revisions and returns an identical operation retry without incrementing", async () => {
  const { service } = createHarness();
  const created = await createSingle(service);
  const command = {
    requestId: "select-guidance",
    slot: "GUIDANCE" as const,
    displayedPosition: 12,
    expectedRevision: 1,
    operationId: "select-guidance-once"
  };

  await assert.rejects(
    () => service.select(actorId, created.session.sessionId, { ...command, expectedRevision: 2 }),
    (error: unknown) =>
      (error instanceof DomainApiError || error instanceof PersistenceError) &&
      error.code === "CONFLICT"
  );

  const accepted = await service.select(actorId, created.session.sessionId, command);
  const retry = await service.select(actorId, created.session.sessionId, {
    ...command,
    requestId: "select-guidance-retry"
  });
  assert.deepEqual(SelectTarotCardResponseSchema.parse(accepted), accepted);
  assert.equal(accepted.session.status, "DRAWN");
  assert.equal(accepted.session.revision, 2);
  assert.equal(retry.session.revision, 2);
  assert.deepEqual(retry.session.acceptedSelections, accepted.session.acceptedSelections);
  assert.equal("revealedCards" in retry.session, false);
});

test("reveal requires complete selection and repeated reveal is bounded and idempotent", async () => {
  const { service } = createHarness();
  const created = await createSingle(service);

  await assert.rejects(
    () =>
      service.reveal(actorId, created.session.sessionId, {
        requestId: "premature-reveal",
        expectedRevision: 1
      }),
    (error: unknown) => error instanceof DomainApiError && error.code === "CONFLICT"
  );

  await service.select(actorId, created.session.sessionId, {
    requestId: "select-before-reveal",
    slot: "GUIDANCE",
    displayedPosition: 12,
    expectedRevision: 1,
    operationId: "select-before-reveal"
  });
  const revealed = await service.reveal(actorId, created.session.sessionId, {
    requestId: "reveal-once",
    expectedRevision: 2
  });
  const retry = await service.reveal(actorId, created.session.sessionId, {
    requestId: "reveal-retry",
    expectedRevision: 2
  });

  assert.deepEqual(RevealTarotSessionResponseSchema.parse(revealed), revealed);
  assert.equal(revealed.session.revision, 3);
  assert.ok(revealed.session.revealedCards);
  assert.ok(retry.session.revealedCards);
  assert.equal(revealed.session.revealedCards.length, 1);
  assert.equal(retry.session.revision, 3);
  assert.deepEqual(retry.session.revealedCards, revealed.session.revealedCards);

  await assert.rejects(
    () =>
      service.reveal(actorId, created.session.sessionId, {
        requestId: "reveal-too-old",
        expectedRevision: 1
      }),
    (error: unknown) =>
      (error instanceof DomainApiError || error instanceof PersistenceError) &&
      error.code === "CONFLICT"
  );
});

test("a revealed draw is immutable to later selection commands", async () => {
  const { service } = createHarness();
  const created = await createSingle(service);
  await service.select(actorId, created.session.sessionId, {
    requestId: "select-final",
    slot: "GUIDANCE",
    displayedPosition: 4,
    expectedRevision: 1,
    operationId: "select-final"
  });
  await service.reveal(actorId, created.session.sessionId, {
    requestId: "reveal-final",
    expectedRevision: 2
  });

  await assert.rejects(
    () =>
      service.select(actorId, created.session.sessionId, {
        requestId: "select-after-reveal",
        slot: "GUIDANCE",
        displayedPosition: 4,
        expectedRevision: 3,
        operationId: "select-final"
      }),
    (error: unknown) => error instanceof DomainApiError && error.code === "CONFLICT"
  );
});

test("get restores an owner-scoped public projection without private state", async () => {
  const { service } = createHarness();
  const created = await createSingle(service);
  await service.select(actorId, created.session.sessionId, {
    requestId: "select-restore",
    slot: "GUIDANCE",
    displayedPosition: 20,
    expectedRevision: 1,
    operationId: "select-restore"
  });

  const restored = await service.get(actorId, created.session.sessionId);
  assert.deepEqual(GetTarotSessionResponseSchema.parse(restored), restored);
  assert.equal(restored.session.status, "DRAWING");
  assert.equal(restored.session.acceptedSelections.length, 1);
  assert.equal(JSON.stringify(restored).includes("deckOrder"), false);

  await assert.rejects(
    () => service.get(otherActorId, created.session.sessionId),
    (error: unknown) =>
      error instanceof PersistenceError && error.code === "NOT_FOUND"
  );
});

test("save records only a recommendation selection and returns full public designs", async () => {
  const { repository, service, designs } = createHarness();
  const initial = createPrivateDrawState({ spreadType: "SINGLE", random: new ZeroRandomSource() });
  const selected = selectPosition(initial, {
    slot: "GUIDANCE",
    displayedPosition: 12,
    expectedRevision: 0,
    operationId: "recommended-selection"
  });
  const revealed = revealDraw(selected, 1);
  repository.seed({
    id: "recommended-session",
    ownerId: actorId,
    spreadType: "SINGLE",
    theme: "SELF_GROWTH",
    status: "RECOMMENDED",
    stateRevision: 4,
    deckVersion: "rws-major-minor-v1",
    ruleVersion: "tarot-design-rules-v1",
    privateDeckState: revealed.state,
    drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards),
    recommendationSnapshot,
    questionCiphertext: "encrypted-private-value",
    questionSavedAt: fixedNow,
    selectedDesignId: null,
    parentSessionId: null,
    recommendations: designs.map((design, index) => ({
      id: `recommendation-${index + 1}`,
      designId: design.designId,
      rank: index + 1,
      createdAt: fixedNow
    })),
    createdAt: fixedNow,
    updatedAt: fixedNow
  });

  const response = await service.save(actorId, "recommended-session", {
    requestId: "save-recommended",
    expectedRevision: 4,
    selectedDesignId: "tarot-design-2"
  });

  assert.deepEqual(SaveTarotSessionResponseSchema.parse(response), response);
  assert.equal(response.session.status, "SAVED");
  assert.equal(response.session.selectedDesignId, "tarot-design-2");
  assert.ok(response.session.recommendations);
  assert.deepEqual(
    response.session.recommendations.map(({ rank, design }) => [rank, design.designId]),
    [
      [1, "tarot-design-1"],
      [2, "tarot-design-2"],
      [3, "tarot-design-3"]
    ]
  );
  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes("encrypted-private-value"), false);
  assert.equal(serialized.includes("questionCiphertext"), false);
});
