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
  type CatalogMaterialProduct,
  type TarotRecommendationSnapshot
} from "@mystcrag/database";
import {
  createPrivateDrawState,
  revealDraw,
  selectPosition
} from "@mystcrag/tarot-engine";

import { DomainApiError } from "../../contracts/api-error.js";
import { TarotService } from "./tarot.service.js";
import {
  InMemoryTarotRepository,
  ZeroRandomSource,
  cloneTestValue,
  tarotTestNow,
  toTestDrawSnapshot
} from "./tarot.test-utils.js";

const actorId = "tarot-owner";
const otherActorId = "tarot-other-owner";

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
        return cloneTestValue(design);
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
  assert.equal(response.cardBack.assetFile, "CardBack.png");

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
  assert.equal(accepted.session.status, "DRAWING");
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
        operationId: "new-selection-after-reveal"
      }),
    (error: unknown) => error instanceof DomainApiError && error.code === "CONFLICT"
  );
});

test("an exact accepted selection retry reconciles after draw, recommendation, and save advance", async () => {
  const { repository, service, designs } = createHarness();
  const created = await createSingle(service);
  const command = {
    requestId: "select-lifecycle-retry",
    slot: "GUIDANCE" as const,
    displayedPosition: 4,
    expectedRevision: 1,
    operationId: "select-lifecycle-operation"
  };
  await service.select(actorId, created.session.sessionId, command);
  const revealed = await service.reveal(actorId, created.session.sessionId, {
    requestId: "reveal-lifecycle",
    expectedRevision: 2
  });

  const drawnRetry = await service.select(actorId, created.session.sessionId, command);
  assert.equal((drawnRetry.session as { status: string }).status, "DRAWN");

  const recommended = await repository.saveRecommendations({
    ownerId: actorId,
    sessionId: created.session.sessionId,
    expectedRevision: revealed.session.revision,
    recommendationSnapshot,
    recommendations: designs.map((design, index) => ({
      rank: index + 1,
      designId: design.designId
    }))
  });
  const recommendedRetry = await service.select(actorId, created.session.sessionId, command);
  assert.equal((recommendedRetry.session as { status: string }).status, "RECOMMENDED");

  await repository.markSaved({
    ownerId: actorId,
    sessionId: created.session.sessionId,
    expectedRevision: recommended.stateRevision,
    selectedDesignId: designs[0]!.designId
  });
  const savedRetry = await service.select(actorId, created.session.sessionId, command);
  assert.equal((savedRetry.session as { status: string }).status, "SAVED");

  await assert.rejects(
    () => service.select(actorId, created.session.sessionId, {
      ...command,
      displayedPosition: 5
    }),
    (error: unknown) => error instanceof DomainApiError && error.code === "CONFLICT"
  );
});

test("an exact reveal retry reconciles after recommendation and save advance", async () => {
  const { repository, service, designs } = createHarness();
  const created = await createSingle(service);
  await service.select(actorId, created.session.sessionId, {
    requestId: "select-before-lifecycle-reveal",
    slot: "GUIDANCE",
    displayedPosition: 9,
    expectedRevision: 1,
    operationId: "select-before-lifecycle-reveal"
  });
  const revealCommand = {
    requestId: "reveal-lifecycle-retry",
    expectedRevision: 2
  };
  const revealed = await service.reveal(actorId, created.session.sessionId, revealCommand);
  const recommended = await repository.saveRecommendations({
    ownerId: actorId,
    sessionId: created.session.sessionId,
    expectedRevision: revealed.session.revision,
    recommendationSnapshot,
    recommendations: designs.map((design, index) => ({
      rank: index + 1,
      designId: design.designId
    }))
  });

  const recommendedRetry = await service.reveal(
    actorId,
    created.session.sessionId,
    revealCommand
  );
  assert.equal(recommendedRetry.session.status, "RECOMMENDED");

  await repository.markSaved({
    ownerId: actorId,
    sessionId: created.session.sessionId,
    expectedRevision: recommended.stateRevision,
    selectedDesignId: designs[0]!.designId
  });
  const savedRetry = await service.reveal(actorId, created.session.sessionId, revealCommand);
  assert.equal(savedRetry.session.status, "SAVED");

  await assert.rejects(
    () => service.reveal(actorId, created.session.sessionId, {
      ...revealCommand,
      expectedRevision: 1
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
  assert.equal(
    (restored as { cardBack?: { assetFile: string } }).cardBack?.assetFile,
    "CardBack.png"
  );
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
    drawSnapshot: toTestDrawSnapshot(revealed.state, revealed.cards),
    recommendationSnapshot,
    questionCiphertext: "encrypted-private-value",
    questionSavedAt: tarotTestNow,
    selectedDesignId: null,
    parentSessionId: null,
    recommendations: designs.map((design, index) => ({
      id: `recommendation-${index + 1}`,
      designId: design.designId,
      rank: index + 1,
      createdAt: tarotTestNow
    })),
    createdAt: tarotTestNow,
    updatedAt: tarotTestNow
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

const recommendationCatalog = (): CatalogMaterialProduct[] => {
  const design = structuredClone(standardAiDesignFixture);
  const active = design.beads.map((bead, index) => ({
    id: bead.beadProductId,
    productType: "MATERIAL" as const,
    sku: `TAROT-MATERIAL-${index + 1}`,
    name: `Tarot material ${index + 1}`,
    currency: design.currency,
    unitPriceMinor: bead.unitPriceMinor,
    active: true,
    crystalId: bead.crystalId,
    crystalNameCn: `测试水晶 ${index + 1}`,
    crystalNameEn: `Test crystal ${index + 1}`,
    colorTags: ["chartreuse"],
    visualTags: index === 1 ? ["focused"] : [],
    styleTags: [],
    emotionTags: index === 1 ? ["self-growth"] : [],
    cultureTags: [],
    shape: bead.shape,
    diameterMm: bead.diameterMm,
    materialKey: bead.materialKey,
    modelAssetKey: bead.modelAssetKey,
    textureAssetKey: bead.textureAssetKey
  }));
  return [
    ...active,
    {
      ...active[0]!,
      id: "product-inactive-perfect-match",
      sku: "TAROT-INACTIVE",
      active: false,
      colorTags: ["amber", "ivory", "ink"]
    }
  ];
};

async function revealRecommendationSession(service: TarotService) {
  const created = await createSingle(service, "create-for-recommendations");
  await service.select(actorId, created.session.sessionId, {
    requestId: "select-for-recommendations",
    slot: "GUIDANCE",
    displayedPosition: 0,
    expectedRevision: 1,
    operationId: "select-for-recommendations"
  });
  return service.reveal(actorId, created.session.sessionId, {
    requestId: "reveal-for-recommendations",
    expectedRevision: 2
  });
}

function createRecommendationHarness() {
  const repository = new InMemoryTarotRepository();
  const catalog = recommendationCatalog();
  const generationCalls: Array<{
    actorId: string;
    request: {
      requestId: string;
      wristCircumferenceMm: number;
      styleTags: readonly string[];
    };
    candidate: unknown;
    designMode: string;
    designId: string;
  }> = [];
  let catalogCalls = 0;
  const service = new TarotService({
    repository,
    random: new ZeroRandomSource(),
    catalog: {
      async listActiveCatalogProducts() {
        catalogCalls += 1;
        return cloneTestValue(catalog);
      }
    },
    designGenerator: {
      async generateFromCandidate(input) {
        generationCalls.push(cloneTestValue(input));
        throw new Error("stop after observing the ranked candidate");
      }
    }
  });
  return {
    repository,
    service,
    catalog,
    generationCalls,
    getCatalogCalls: () => catalogCalls
  };
}

test("recommendation ranking consumes authoritative Crystal visual and theme metadata", async () => {
  const harness = createRecommendationHarness();
  const revealed = await revealRecommendationSession(harness.service);
  await assert.rejects(
    () => harness.service.recommendations(actorId, revealed.session.sessionId, {
      requestId: "recommendation-authoritative-tags",
      expectedRevision: revealed.session.revision,
      saveQuestion: false,
      locale: "zh-CN",
      currency: "CNY"
    }),
    /stop after observing the ranked candidate/
  );

  const firstCandidate = harness.generationCalls[0]?.candidate;
  assert.ok(
    typeof firstCandidate === "object" &&
    firstCandidate !== null &&
    "materialProductIds" in firstCandidate
  );
  const ids = (firstCandidate as { materialProductIds: string[] }).materialProductIds;
  assert.equal(ids[0], harness.catalog[1]!.id);
});

test("saveQuestion fails closed before catalog, generation, or persistence", async () => {
  const harness = createRecommendationHarness();
  const revealed = await revealRecommendationSession(harness.service);
  const sessionId = revealed.session.sessionId;

  await assert.rejects(
    () => harness.service.recommendations(actorId, sessionId, {
      requestId: "reject-question-persistence",
      expectedRevision: revealed.session.revision,
      question: "This must not be stored in plaintext",
      saveQuestion: true,
      locale: "zh-CN",
      currency: "CNY"
    }),
    (error: unknown) => error instanceof DomainApiError && error.code === "VALIDATION_ERROR"
  );
  assert.equal(harness.generationCalls.length, 0);
  assert.equal(harness.getCatalogCalls(), 0);
  const stored = harness.repository.readPrivate(sessionId);
  assert.equal(stored.status, "DRAWN");
  assert.equal(stored.questionCiphertext, null);
});
