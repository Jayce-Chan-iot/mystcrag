import assert from "node:assert/strict";
import test from "node:test";

import {
  DesignV1Schema,
  GenerateDesignResponseSchema,
  type DesignV1,
  type GenerateDesignResponse
} from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";
import type { CatalogMaterialProduct } from "@mystcrag/database";

import { DomainApiError } from "../../contracts/api-error.js";
import {
  DesignApplicationService,
  type CatalogProduct,
  type DesignApplicationDependencies
} from "../design/design-api.service.js";
import { TarotService } from "./tarot.service.js";
import {
  InMemoryTarotRepository,
  ZeroRandomSource,
  cloneTestValue,
  tarotTestNow
} from "./tarot.test-utils.js";

const actorId = "tarot-real-design-owner";

type PersistedDesign = Awaited<ReturnType<DesignApplicationDependencies["designs"]["getDesign"]>>;
type PersistedRevision = Awaited<ReturnType<DesignApplicationDependencies["designs"]["getRevision"]>>;

function realCatalog(): CatalogMaterialProduct[] {
  return structuredClone(standardAiDesignFixture).beads.map((bead, index) => ({
    id: bead.beadProductId,
    productType: "MATERIAL" as const,
    sku: `REAL-TAROT-${index + 1}`,
    name: `Real Tarot material ${index + 1}`,
    currency: "CNY" as const,
    unitPriceMinor: bead.unitPriceMinor,
    active: true,
    crystalId: bead.crystalId,
    crystalNameCn: `真实测试水晶 ${index + 1}`,
    crystalNameEn: `Real test crystal ${index + 1}`,
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
}

function createRealRecommendationHarness(options: {
  failSecondRankOnce?: boolean;
  tamperFirstResponse?: "SEQUENCE" | "PROVENANCE";
  preferences?: {
    wristCircumferenceMm?: number;
    budget?: { minMinor?: number; maxMinor?: number };
  };
  authoritativeMetadata?: boolean;
} = {}) {
  const tarotRepository = new InMemoryTarotRepository();
  const catalog = realCatalog();
  if (options.authoritativeMetadata === false) {
    for (const product of catalog) {
      product.visualTags = [];
      product.styleTags = [];
      product.emotionTags = [];
      product.cultureTags = [];
    }
  }
  const catalogProducts: CatalogProduct[] = cloneTestValue(catalog);
  const designs = new Map<string, PersistedDesign>();
  const revisions = new Map<string, PersistedRevision[]>();
  const candidateSequences = new Map<string, string[]>();
  const generationRequests: Array<{
    requestId: string;
    wristCircumferenceMm: number;
    styleTags: readonly string[];
    designId: string;
  }> = [];
  let createAttempts = 0;
  let componentSequence = 0;
  let failSecondRankOnce = options.failSecondRankOnce ?? false;

  const designStore: DesignApplicationDependencies["designs"] = {
    async createDesign(ownerId, snapshot) {
      createAttempts += 1;
      if (designs.has(snapshot.designId)) {
        throw new DomainApiError("CONFLICT", "Design already exists");
      }
      const row: PersistedDesign = {
        id: snapshot.designId,
        ownerId,
        currentRevision: 1,
        status: "DRAFT",
        snapshot: cloneTestValue(snapshot),
        createdAt: tarotTestNow,
        updatedAt: tarotTestNow,
        deletedAt: null
      };
      designs.set(snapshot.designId, row);
      revisions.set(snapshot.designId, [{
        id: `revision-${snapshot.designId}-1`,
        designId: snapshot.designId,
        revisionNumber: 1,
        snapshot: cloneTestValue(snapshot),
        changeType: "CREATED",
        changeReason: "Initial design",
        createdBy: ownerId,
        createdAt: tarotTestNow
      }]);
      return cloneTestValue(row);
    },
    async getDesign(ownerId, designId) {
      const row = designs.get(designId);
      if (!row || row.ownerId !== ownerId) {
        throw new DomainApiError("NOT_FOUND", "Design not found");
      }
      return cloneTestValue(row);
    },
    async getRevision(designId, revision) {
      const row = revisions.get(designId)?.find(
        (candidate) => candidate.revisionNumber === revision
      );
      if (!row) throw new DomainApiError("NOT_FOUND", "Revision not found");
      return cloneTestValue(row);
    },
    async listDesignRevisions(ownerId, designId) {
      await this.getDesign(ownerId, designId);
      return cloneTestValue(revisions.get(designId) ?? []);
    },
    async updateDesign() {
      throw new Error("Update is outside this integration harness");
    },
    async saveDesign(ownerId, designId) {
      return this.getDesign(ownerId, designId);
    }
  };

  const pricing: DesignApplicationDependencies["pricing"] = {
    async recalculateDesignPrice(input) {
      const design = DesignV1Schema.parse(input);
      const laborFeeMinor = 275;
      return DesignV1Schema.parse({
        ...design,
        pricing: {
          ...design.pricing,
          laborFeeMinor,
          totalPriceMinor: design.pricing.materialSubtotalMinor + laborFeeMinor,
          pricingVersion: "tarot-real-pricing-v1",
          priceCalculatedAt: tarotTestNow.toISOString()
        },
        provenance: {
          ...design.provenance,
          pricingRuleVersion: "tarot-real-pricing-v1"
        }
      });
    }
  };

  const designService = new DesignApplicationService({
    designs: designStore,
    catalog: {
      async getCatalogProducts(ids) {
        return cloneTestValue(catalogProducts.filter(({ id }) => ids.includes(id)));
      },
      async listActiveCatalogProducts(currency, excluded = []) {
        return cloneTestValue(catalogProducts.filter(
          (product) => product.active &&
            product.currency === currency &&
            !excluded.includes(product.id)
        ));
      }
    },
    pricing,
    inventory: {
      async validateAvailability(requirements) {
        for (const [productId, quantity] of requirements) {
          assert.ok(catalog.some((product) => product.id === productId && product.active));
          assert.ok(quantity > 0 && quantity <= 100);
        }
      }
    },
    publications: {
      async publishDesign() {
        throw new Error("Publication is outside this integration harness");
      }
    },
    orders: {
      async createOrderFromDesign() {
        throw new Error("Orders are outside this integration harness");
      }
    },
    generator: {
      async generate() {
        throw new Error("Public AI generation is outside this integration harness");
      }
    },
    now: () => tarotTestNow,
    createId(prefix) {
      componentSequence += 1;
      return `${prefix}-real-${componentSequence}`;
    }
  });

  const tamperResponse = (
    response: GenerateDesignResponse,
    kind: "SEQUENCE" | "PROVENANCE"
  ): GenerateDesignResponse => {
    const altered = cloneTestValue(response);
    if (kind === "PROVENANCE") {
      altered.design.provenance.knowledgeBaseVersion = "wrong-tarot-rule";
    } else {
      const replacement = altered.design.beads[1]!;
      altered.design.beads[0] = {
        ...altered.design.beads[0]!,
        beadProductId: replacement.beadProductId,
        crystalId: replacement.crystalId,
        materialKey: replacement.materialKey,
        shape: replacement.shape,
        diameterMm: replacement.diameterMm,
        modelAssetKey: replacement.modelAssetKey,
        textureAssetKey: replacement.textureAssetKey,
        unitPriceMinor: replacement.unitPriceMinor
      };
      const materialSubtotalMinor = altered.design.beads.reduce(
        (total, bead) => total + bead.unitPriceMinor,
        0
      );
      altered.design.pricing.materialSubtotalMinor = materialSubtotalMinor;
      altered.design.pricing.totalPriceMinor =
        materialSubtotalMinor + altered.design.pricing.laborFeeMinor;
    }
    return GenerateDesignResponseSchema.parse(altered);
  };

  const tarotService = new TarotService({
    repository: tarotRepository,
    random: new ZeroRandomSource(),
    catalog: {
      async listActiveCatalogProducts() {
        return cloneTestValue(catalog);
      }
    },
    designGenerator: {
      async generateFromCandidate(input) {
        const candidate = input.candidate as { materialProductIds: string[] };
        candidateSequences.set(input.designId, [...candidate.materialProductIds]);
        generationRequests.push({
          requestId: input.request.requestId,
          wristCircumferenceMm: input.request.wristCircumferenceMm,
          styleTags: [...input.request.styleTags],
          designId: input.designId
        });
        if (input.request.requestId.endsWith(":2") && failSecondRankOnce) {
          failSecondRankOnce = false;
          throw new Error("simulated real rank two failure");
        }
        const response = await designService.generateFromCandidate(input);
        return options.tamperFirstResponse && input.request.requestId.endsWith(":1")
          ? tamperResponse(response, options.tamperFirstResponse)
          : response;
      }
    },
    designReader: {
      async getOwnedDesign(ownerId, designId) {
        return (await designStore.getDesign(ownerId, designId)).snapshot;
      }
    },
    preferences: {
      async getDesignPreferences(ownerId) {
        assert.equal(ownerId, actorId);
        return options.preferences;
      }
    }
  });

  return {
    catalog,
    tarotRepository,
    tarotService,
    designs,
    candidateSequences,
    generationRequests,
    getCreateAttempts: () => createAttempts
  };
}

async function revealRealRecommendationSession(service: TarotService) {
  const created = await service.create(actorId, {
    requestId: "real-recommendation-create",
    spreadType: "SINGLE",
    theme: "SELF_GROWTH"
  });
  await service.select(actorId, created.session.sessionId, {
    requestId: "real-recommendation-select",
    slot: "GUIDANCE",
    displayedPosition: 0,
    expectedRevision: 1,
    operationId: "real-recommendation-select"
  });
  return service.reveal(actorId, created.session.sessionId, {
    requestId: "real-recommendation-reveal",
    expectedRevision: 2
  });
}

const recommendationRequest = (expectedRevision: number) => ({
  requestId: "real-recommendations",
  expectedRevision,
  saveQuestion: false,
  locale: "zh-CN" as const,
  currency: "CNY" as const
});

test("real Design application service persists the exact three Tarot candidates with authoritative pricing and provenance", async () => {
  const harness = createRealRecommendationHarness();
  const revealed = await revealRealRecommendationSession(harness.tarotService);
  const rawQuestion = "How can I reflect on this transition?";
  const response = await harness.tarotService.recommendations(
    actorId,
    revealed.session.sessionId,
    { ...recommendationRequest(revealed.session.revision), question: rawQuestion }
  );

  assert.ok(response.session.recommendations);
  assert.equal(response.session.recommendations.length, 3);
  assert.equal(harness.designs.size, 3);
  assert.deepEqual(
    harness.generationRequests.map(({ requestId }) => requestId),
    [
      `${revealed.session.sessionId}:1`,
      `${revealed.session.sessionId}:2`,
      `${revealed.session.sessionId}:3`
    ]
  );
  assert.deepEqual(
    harness.generationRequests.map(({ styleTags }) =>
      styleTags.find((tag) => tag.startsWith("tarot-direction-"))
    ),
    [
      "tarot-direction-balanced",
      "tarot-direction-contrast",
      "tarot-direction-neutral-led"
    ]
  );
  assert.equal(new Set(harness.generationRequests.map(({ designId }) => designId)).size, 3);
  for (const recommendation of response.session.recommendations) {
    const persisted = harness.designs.get(recommendation.design.designId)?.snapshot;
    assert.ok(persisted);
    assert.equal(persisted.designMode, "TAROT_GUIDED");
    assert.equal(persisted.bracelet.wristCircumferenceMm, 155);
    assert.equal(persisted.pricing.pricingVersion, "tarot-real-pricing-v1");
    assert.equal(
      persisted.pricing.totalPriceMinor,
      persisted.pricing.materialSubtotalMinor + 275
    );
    assert.deepEqual(
      persisted.beads.map(({ beadProductId }) => beadProductId),
      harness.candidateSequences.get(persisted.designId)
    );
    assert.equal(persisted.provenance.sourceDesignId, null);
    assert.deepEqual(persisted.provenance.tarotCandidate, {
      sessionId: revealed.session.sessionId,
      ruleVersion: "tarot-design-rules-v1",
      rank: recommendation.rank,
      direction: ["BALANCED", "CONTRAST", "NEUTRAL_LED"][recommendation.rank - 1]
    });
    assert.equal(persisted.provenance.knowledgeBaseVersion, "tarot-design-rules-v1");
    assert.match(persisted.provenance.designTemplateVersion ?? "", /^tarot-(balanced|contrast|neutral-led)-rank-[123]$/);
    for (const bead of persisted.beads) {
      const product = harness.catalog.find(({ id }) => id === bead.beadProductId);
      assert.ok(product);
      assert.equal(bead.modelAssetKey, product.modelAssetKey);
      assert.equal(bead.textureAssetKey, product.textureAssetKey);
      assert.equal(bead.unitPriceMinor, product.unitPriceMinor);
    }
  }
  const storedSession = harness.tarotRepository.readPrivate(revealed.session.sessionId);
  assert.equal(storedSession.questionCiphertext, null);
  assert.equal(JSON.stringify(storedSession).includes(rawQuestion), false);
});

test("real Design application retry reuses a partial rank without creating duplicate designs", async () => {
  const harness = createRealRecommendationHarness({ failSecondRankOnce: true });
  const revealed = await revealRealRecommendationSession(harness.tarotService);
  const request = recommendationRequest(revealed.session.revision);

  await assert.rejects(
    () => harness.tarotService.recommendations(actorId, revealed.session.sessionId, request),
    /simulated real rank two failure/
  );
  assert.equal(harness.designs.size, 1);
  const recovered = await harness.tarotService.recommendations(
    actorId,
    revealed.session.sessionId,
    request
  );

  assert.equal(recovered.session.recommendations?.length, 3);
  assert.equal(harness.designs.size, 3);
  assert.equal(harness.getCreateAttempts(), 4);
});

test("saved budget reverses a no-budget lexical tie in the persisted real Design sequence", async () => {
  const noBudgetHarness = createRealRecommendationHarness({
    authoritativeMetadata: false
  });
  const noBudgetRevealed = await revealRealRecommendationSession(
    noBudgetHarness.tarotService
  );
  const noBudgetResponse = await noBudgetHarness.tarotService.recommendations(
    actorId,
    noBudgetRevealed.session.sessionId,
    recommendationRequest(noBudgetRevealed.session.revision)
  );
  const noBudgetBalanced = noBudgetResponse.session.recommendations?.find(
    ({ rank }) => rank === 1
  );
  assert.ok(noBudgetBalanced);
  const noBudgetPersisted = noBudgetHarness.designs.get(
    noBudgetBalanced.design.designId
  )?.snapshot;
  assert.ok(noBudgetPersisted);
  assert.equal(
    noBudgetPersisted.beads[0]?.beadProductId,
    "product-aquamarine-round-8"
  );
  assert.equal(
    noBudgetBalanced.design.beads[0]?.beadProductId,
    "product-aquamarine-round-8"
  );

  const savedBudgetHarness = createRealRecommendationHarness({
    authoritativeMetadata: false,
    preferences: {
      budget: { minMinor: 900, maxMinor: 1_050 }
    }
  });
  const savedBudgetRevealed = await revealRealRecommendationSession(
    savedBudgetHarness.tarotService
  );
  const savedBudgetResponse = await savedBudgetHarness.tarotService.recommendations(
    actorId,
    savedBudgetRevealed.session.sessionId,
    recommendationRequest(savedBudgetRevealed.session.revision)
  );

  assert.ok(savedBudgetResponse.session.recommendations);
  const savedBudgetBalanced = savedBudgetResponse.session.recommendations.find(
    ({ rank }) => rank === 1
  );
  assert.ok(savedBudgetBalanced);
  const savedBudgetPersisted = savedBudgetHarness.designs.get(
    savedBudgetBalanced.design.designId
  )?.snapshot;
  assert.ok(savedBudgetPersisted);
  assert.equal(
    savedBudgetPersisted.beads[0]?.beadProductId,
    "product-quartz-round-10"
  );
  assert.equal(
    savedBudgetBalanced.design.beads[0]?.beadProductId,
    "product-quartz-round-10"
  );
});

test("saved wrist reaches every real candidate and budget does not hard-filter products", async () => {
  const harness = createRealRecommendationHarness({
    authoritativeMetadata: false,
    preferences: {
      wristCircumferenceMm: 165,
      budget: { minMinor: 900, maxMinor: 1_050 }
    }
  });
  const revealed = await revealRealRecommendationSession(harness.tarotService);
  const response = await harness.tarotService.recommendations(
    actorId,
    revealed.session.sessionId,
    recommendationRequest(revealed.session.revision)
  );

  assert.ok(response.session.recommendations);
  assert.ok(response.session.recommendations.every(
    ({ design }) => design.bracelet.wristCircumferenceMm === 165
  ));
  const selectedProductIds = new Set(
    [...harness.candidateSequences.values()].flat()
  );
  assert.deepEqual(
    [...selectedProductIds].sort(),
    harness.catalog.map(({ id }) => id).sort()
  );
});

test("invalid saved wrist or budget preferences fail before design persistence", async () => {
  for (const preferences of [
    { wristCircumferenceMm: 129 },
    { budget: { minMinor: 2_000, maxMinor: 1_000 } }
  ]) {
    const harness = createRealRecommendationHarness({ preferences });
    const revealed = await revealRealRecommendationSession(harness.tarotService);
    await assert.rejects(
      () => harness.tarotService.recommendations(
        actorId,
        revealed.session.sessionId,
        recommendationRequest(revealed.session.revision)
      ),
      (error: unknown) => error instanceof DomainApiError && error.code === "INTERNAL_ERROR"
    );
    assert.equal(harness.designs.size, 0);
  }
});

for (const tamperFirstResponse of ["SEQUENCE", "PROVENANCE"] as const) {
  test(`Tarot linking rejects a real generated response with mismatched ${tamperFirstResponse.toLowerCase()}`, async () => {
    const harness = createRealRecommendationHarness({ tamperFirstResponse });
    const revealed = await revealRealRecommendationSession(harness.tarotService);

    await assert.rejects(
      () => harness.tarotService.recommendations(
        actorId,
        revealed.session.sessionId,
        recommendationRequest(revealed.session.revision)
      ),
      (error: unknown) => error instanceof DomainApiError && error.code === "INTERNAL_ERROR"
    );
    const storedSession = harness.tarotRepository.readPrivate(revealed.session.sessionId);
    assert.equal(storedSession.status, "DRAWN");
    assert.deepEqual(storedSession.recommendations, []);
  });
}
