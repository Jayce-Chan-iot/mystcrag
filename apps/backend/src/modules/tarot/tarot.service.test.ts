import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateTarotSessionResponseSchema,
  GenerateTarotRecommendationsResponseSchema,
  GetTarotSessionResponseSchema,
  RevealTarotSessionResponseSchema,
  SaveTarotSessionResponseSchema,
  SelectTarotCardResponseSchema,
  DesignV1Schema,
  toPublicDesign,
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
    colorTags: index === 0 ? ["amber", "warm"] : index === 1 ? ["ivory", "neutral"] : ["ink", "deep"],
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

function recommendationDesign(designId: string, rank: number): DesignV1 {
  const original = structuredClone(standardAiDesignFixture);
  const rotated = [
    ...original.beads.slice(rank - 1),
    ...original.beads.slice(0, rank - 1)
  ].map((bead, index) => ({
    ...bead,
    positionIndex: original.beads[index]!.positionIndex
  }));
  const inlineAccessories = original.accessories.filter(
    (accessory) => accessory.placementMode === "INLINE"
  );
  return DesignV1Schema.parse({
    ...original,
    designId,
    designName: `Tarot direction ${rank}`,
    designMode: "TAROT_GUIDED",
    beads: rotated,
    pricing: {
      ...original.pricing,
      adjustments: [
        {
          adjustmentId: `test-authoritative-rank-${rank}`,
          label: `Test authoritative rank ${rank}`,
          amountMinor: rank * 10,
          reasonCode: "TEST_AUTHORITATIVE_PRICE"
        }
      ],
      totalPriceMinor: original.pricing.totalPriceMinor + rank * 10
    },
    production: {
      ...original.production,
      componentSequence: [
        ...rotated,
        ...inlineAccessories
      ]
        .sort((left, right) => left.positionIndex - right.positionIndex)
        .map(({ componentId }) => componentId)
    }
  });
}

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

function createRecommendationHarness(options: { failSecondRankOnce?: boolean } = {}) {
  const repository = new InMemoryTarotRepository();
  const catalog = recommendationCatalog();
  const generated = new Map<string, DesignV1>();
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
  let failSecondRankOnce = options.failSecondRankOnce ?? false;
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
        if (input.request.requestId.endsWith(":2") && failSecondRankOnce) {
          failSecondRankOnce = false;
          throw new Error("simulated rank two failure");
        }
        const rank = Number(input.request.requestId.at(-1));
        const design = generated.get(input.designId) ?? recommendationDesign(input.designId, rank);
        generated.set(input.designId, design);
        return {
          requestId: input.request.requestId,
          design: toPublicDesign(design),
          warnings: []
        };
      }
    },
    designReader: {
      async getOwnedDesign(ownerId: string, designId: string) {
        if (ownerId !== actorId) throw new PersistenceError("NOT_FOUND", "Design not found");
        const design = generated.get(designId);
        if (!design) throw new PersistenceError("NOT_FOUND", "Design not found");
        return cloneTestValue(design);
      }
    }
  });
  return {
    repository,
    service,
    catalog,
    generated,
    generationCalls,
    getCatalogCalls: () => catalogCalls
  };
}

test("recommendations generate exactly three real, distinct, catalog-backed designs", async () => {
  const harness = createRecommendationHarness();
  const revealed = await revealRecommendationSession(harness.service);
  const sessionId = revealed.session.sessionId;
  const rawQuestion = "How can I reflect on this transition?";

  const response = await harness.service.recommendations(actorId, sessionId, {
    requestId: "recommendation-response-request",
    expectedRevision: revealed.session.revision,
    question: rawQuestion,
    saveQuestion: false,
    locale: "zh-CN",
    currency: "CNY"
  });

  assert.deepEqual(GenerateTarotRecommendationsResponseSchema.parse(response), response);
  assert.equal(response.session.status, "RECOMMENDED");
  assert.ok(response.session.recommendations);
  assert.equal(response.session.recommendations.length, 3);
  assert.equal(harness.generationCalls.length, 3);
  assert.deepEqual(
    harness.generationCalls.map(({ request }) => request.requestId),
    [`${sessionId}:1`, `${sessionId}:2`, `${sessionId}:3`]
  );
  assert.ok(harness.generationCalls.every(({ request }) => request.wristCircumferenceMm === 155));
  assert.deepEqual(
    harness.generationCalls.map(({ designMode }) => designMode),
    ["TAROT_GUIDED", "TAROT_GUIDED", "TAROT_GUIDED"]
  );
  assert.equal(new Set(harness.generationCalls.map(({ designId }) => designId)).size, 3);

  const directionTags = harness.generationCalls.map(({ request }) =>
    request.styleTags.find((tag) => tag.startsWith("tarot-direction-"))
  );
  assert.deepEqual(directionTags, [
    "tarot-direction-balanced",
    "tarot-direction-contrast",
    "tarot-direction-neutral-led"
  ]);
  const activeIds = new Set(harness.catalog.filter(({ active }) => active).map(({ id }) => id));
  const diameterById = new Map(harness.catalog.map(({ id, diameterMm }) => [id, diameterMm]));
  const candidateSequences = harness.generationCalls.map(({ candidate }) => {
    assert.ok(typeof candidate === "object" && candidate !== null && "materialProductIds" in candidate);
    const ids = (candidate as { materialProductIds: string[] }).materialProductIds;
    assert.ok(ids.every((id) => activeIds.has(id)));
    const assembledMm = ids.reduce((total, id) => total + diameterById.get(id)!, 0);
    assert.ok(assembledMm >= 130 && assembledMm <= 200, `assembled path ${assembledMm}mm`);
    return ids.join("|");
  });
  assert.equal(new Set(candidateSequences).size, 3);

  const returnedPrices = response.session.recommendations.map(
    ({ design }) => design.pricing.totalPriceMinor
  );
  assert.deepEqual(
    returnedPrices,
    [...harness.generated.values()].map(({ pricing }) => pricing.totalPriceMinor)
  );
  const stored = harness.repository.readPrivate(sessionId);
  assert.equal(stored.questionCiphertext, null);
  assert.equal(JSON.stringify(stored).includes(rawQuestion), false);
});

test("recommendation retry survives a partial generation failure without duplicate designs", async () => {
  const harness = createRecommendationHarness({ failSecondRankOnce: true });
  const revealed = await revealRecommendationSession(harness.service);
  const sessionId = revealed.session.sessionId;
  const request = {
    requestId: "recommendations-after-partial-failure",
    expectedRevision: revealed.session.revision,
    saveQuestion: false,
    locale: "zh-CN" as const,
    currency: "CNY" as const
  };

  await assert.rejects(
    () => harness.service.recommendations(actorId, sessionId, request),
    /simulated rank two failure/
  );
  assert.equal(harness.generated.size, 1);
  assert.equal(harness.repository.readPrivate(sessionId).status, "DRAWN");

  const recovered = await harness.service.recommendations(actorId, sessionId, request);
  assert.ok(recovered.session.recommendations);
  assert.equal(recovered.session.recommendations.length, 3);
  assert.equal(harness.generated.size, 3);
  assert.deepEqual(
    harness.generationCalls.map(({ request: callRequest }) => callRequest.requestId),
    [`${sessionId}:1`, `${sessionId}:2`, `${sessionId}:1`, `${sessionId}:2`, `${sessionId}:3`]
  );

  const callsBeforeLinkedRetry = harness.generationCalls.length;
  const linkedRetry = await harness.service.recommendations(actorId, sessionId, {
    ...request,
    requestId: "recommendations-linked-retry"
  });
  assert.ok(linkedRetry.session.recommendations);
  assert.deepEqual(linkedRetry.session.recommendations, recovered.session.recommendations);
  assert.equal(harness.generationCalls.length, callsBeforeLinkedRetry);
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
