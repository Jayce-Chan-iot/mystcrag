import assert from "node:assert/strict";
import test from "node:test";

import {
  CreateOracleSessionResponseSchema,
  DesignV1Schema,
  GenerateOracleRecommendationsResponseSchema,
  GetOracleSessionResponseSchema,
  SaveOracleSessionResponseSchema,
  toPublicDesign,
  type DesignV1
} from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";
import type { AvailableCatalogMaterialProduct } from "@mystcrag/database";
import type { CoinSource } from "@mystcrag/oracle-engine";

import { DomainApiError } from "../../contracts/api-error.js";
import { deriveOracleDesignAuthorityId } from "../design/design-api.service.js";
import { OracleService } from "./oracle.service.js";
import { InMemoryOracleRepository } from "./oracle.test-utils.js";
import type { OracleDesignGenerator } from "./oracle.types.js";

class CountingCoinSource implements CoinSource {
  reads = 0;
  constructor(private readonly values: readonly (2 | 3)[] = Array(18).fill(2)) {}
  nextCoin(): 2 | 3 {
    const value = this.values[this.reads];
    if (value === undefined) throw new Error("unexpected entropy read");
    this.reads += 1;
    return value;
  }
}

test("create consumes exactly 18 coins, drops question, and persists one complete CAST", async () => {
  const repository = new InMemoryOracleRepository();
  const coins = new CountingCoinSource();
  const copyInputs: unknown[] = [];
  const service = new OracleService({
    repository,
    coins,
    copy: {
      async createInterpretation(input) {
        copyInputs.push(structuredClone(input));
        return {
          interpretation: {
            headline: "观察当下的设计线索",
            summary: "以稳定秩序观察色彩与材质。",
            keywords: ["观察", "秩序", "留白"],
            designRationale: "以沉静配色保持均衡节奏。",
            disclaimer: "仅供自我观察、文化体验与设计灵感，不构成确定性建议，也不声称水晶具有任何功效。",
            source: { kind: "MYSTCRAG_ORIGINAL", version: "test-copy-v1" }
          }
        };
      }
    }
  });

  const response = await service.create("oracle-owner", {
    requestId: "create-oracle-1",
    operationId: "operation-oracle-1",
    locale: "zh-CN",
    currency: "CNY",
    wristCircumferenceMm: 158,
    question: "这段隐私问题不能继续传播"
  });

  assert.equal(coins.reads, 18);
  assert.deepEqual(CreateOracleSessionResponseSchema.parse(response), response);
  assert.equal(response.session.status, "CAST");
  assert.equal(response.session.cast.lines.length, 6);
  assert.equal(response.session.cast.transformedHexagram?.number !== undefined, true);
  assert.equal(JSON.stringify(response).includes("隐私问题"), false);
  assert.equal(JSON.stringify(copyInputs).includes("question"), false);
  assert.equal(JSON.stringify(repository.lastCreateInput).includes("question"), false);
});

test("same create operation replays while durable input reuse conflicts", async () => {
  const repository = new InMemoryOracleRepository();
  const service = new OracleService({ repository, coins: new CountingCoinSource(Array(54).fill(2)) });
  const input = {
    requestId: "create-replay-1",
    operationId: "operation-replay-1",
    locale: "zh-CN" as const,
    currency: "CNY" as const,
    wristCircumferenceMm: 160
  };
  const first = await service.create("oracle-owner", input);
  const replay = await service.create("oracle-owner", { ...input, requestId: "create-replay-2" });
  assert.deepEqual(replay.session, first.session);

  await assert.rejects(
    () => service.create("oracle-owner", { ...input, requestId: "changed", wristCircumferenceMm: 170 }),
    (error: unknown) => error instanceof DomainApiError && error.code === "CONFLICT"
  );
});

test("create rejects a parent session owned by another actor", async () => {
  const repository = new InMemoryOracleRepository();
  const service = new OracleService({ repository, coins: new CountingCoinSource(Array(36).fill(2)) });
  const parent = await service.create("first-owner", {
    requestId: "parent-create",
    operationId: "parent-operation",
    locale: "zh-CN",
    currency: "CNY"
  });

  await assert.rejects(
    () => service.create("second-owner", {
      requestId: "child-create",
      operationId: "child-operation",
      locale: "zh-CN",
      currency: "CNY",
      parentSessionId: parent.session.sessionId
    }),
    (error: unknown) => error instanceof DomainApiError && error.code === "NOT_FOUND"
  );
});

test("get restores an owner-scoped static cast without consuming entropy", async () => {
  const repository = new InMemoryOracleRepository();
  const coins = new CountingCoinSource(Array.from({ length: 6 }, () => [2, 2, 3] as const).flat());
  const service = new OracleService({ repository, coins });
  const created = await service.create("oracle-owner", {
    requestId: "static-create",
    operationId: "static-operation",
    locale: "en-US",
    currency: "CNY"
  });
  const readsAfterCreate = coins.reads;
  const restored = await service.get("oracle-owner", created.session.sessionId);

  assert.equal(coins.reads, readsAfterCreate);
  assert.deepEqual(GetOracleSessionResponseSchema.parse(restored), restored);
  assert.equal(restored.session.cast.transformedHexagram, undefined);
  await assert.rejects(
    () => service.get("other-owner", created.session.sessionId),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "NOT_FOUND"
  );
});

function recommendationCatalog(): AvailableCatalogMaterialProduct[] {
  return structuredClone(standardAiDesignFixture).beads.map((bead, index) => ({
    id: bead.beadProductId,
    productType: "MATERIAL",
    sku: `ORACLE-SERVICE-${index + 1}`,
    name: `Oracle service material ${index + 1}`,
    currency: "CNY",
    unitPriceMinor: bead.unitPriceMinor,
    active: true,
    availableQuantity: 100,
    crystalId: bead.crystalId,
    crystalNameCn: `测试水晶 ${index + 1}`,
    crystalNameEn: `Test crystal ${index + 1}`,
    mineralName: "Quartz",
    colorTags: index === 0 ? ["white", "blue"] : ["black"],
    visualTags: [],
    styleTags: ["minimal"],
    emotionTags: [],
    cultureTags: [],
    shape: bead.shape,
    diameterMm: 60,
    lengthAlongStringMm: null,
    holeDiameterMm: null,
    grade: null,
    visualProfile: null,
    materialKey: bead.materialKey,
    modelAssetKey: bead.modelAssetKey,
    textureAssetKey: bead.textureAssetKey
  }));
}

function generatedOracleDesign(input: {
  sequence: readonly string[];
  rank: number;
  direction: "BALANCED" | "CONTRAST" | "NEUTRAL_LED";
  sessionId: string;
  wrist: number;
  catalog: readonly AvailableCatalogMaterialProduct[];
  designIdSeed: string;
  tamperPrice?: boolean;
  tamperIdentity?: boolean;
}): DesignV1 {
  const byId = new Map(input.catalog.map((product) => [product.id, product]));
  const beads = input.sequence.map((productId, positionIndex) => {
    const product = byId.get(productId)!;
    return {
      componentId: `oracle-component-${input.rank}-${positionIndex}`,
      positionIndex,
      beadProductId: product.id,
      crystalId: product.crystalId,
      materialKey: product.materialKey,
      shape: product.shape,
      diameterMm: product.diameterMm,
      quantity: 1 as const,
      role: positionIndex === 0 ? "FOCAL" as const : "MAIN" as const,
      modelAssetKey: product.modelAssetKey!,
      textureAssetKey: product.textureAssetKey!,
      unitPriceMinor: product.unitPriceMinor + (input.tamperPrice && positionIndex === 0 ? 1 : 0)
    };
  });
  const subtotal = beads.reduce((sum, bead) => sum + bead.unitPriceMinor, 0);
  const draft = DesignV1Schema.parse({
    ...structuredClone(standardAiDesignFixture),
    designId: `oracle-output-${input.rank}`,
    designName: `Oracle ${input.direction}`,
    designMode: "ORACLE_GUIDED",
    locale: "zh-CN",
    currency: "CNY",
    bracelet: {
      ...standardAiDesignFixture.bracelet,
      wristCircumferenceMm: input.wrist,
      targetInnerCircumferenceMm: input.wrist + 7,
      totalBeadCount: beads.length
    },
    beads,
    accessories: [],
    pricing: {
      ...standardAiDesignFixture.pricing,
      materialSubtotalMinor: subtotal,
      accessorySubtotalMinor: 0,
      laborFeeMinor: 0,
      designFeeMinor: 0,
      packagingFeeMinor: 0,
      platformFeeEstimateMinor: 0,
      logisticsFeeEstimateMinor: 0,
      discountMinor: 0,
      totalPriceMinor: subtotal,
      pricingVersion: "oracle-price-v1"
    },
    production: {
      ...standardAiDesignFixture.production,
      wristCircumferenceMm: input.wrist,
      billOfMaterials: beads.map((bead) => ({
        productId: bead.beadProductId,
        specification: "Catalog item",
        quantity: 1,
        sourceComponentIds: [bead.componentId]
      })),
      componentSequence: beads.map(({ componentId }) => componentId),
      anchoredComponents: []
    },
    provenance: {
      ...standardAiDesignFixture.provenance,
      modelProvider: "deterministic",
      modelName: "mystcrag-oracle-candidate-builder",
      promptVersion: "oracle-copy-policy-v1",
      knowledgeBaseVersion: "oracle-design-rules-v1",
      designTemplateVersion: `oracle-${input.direction.toLowerCase().replaceAll("_", "-")}-rank-${input.rank}`,
      sourceDesignId: null,
      tarotCandidate: undefined,
      oracleCandidate: {
        sessionId: input.sessionId,
        ruleVersion: "oracle-design-rules-v1",
        rank: input.rank,
        direction: input.direction
      }
    }
  });
  return DesignV1Schema.parse({
    ...draft,
    designId: input.tamperIdentity
      ? `tampered-oracle-design-${input.rank}`
      : deriveOracleDesignAuthorityId(input.designIdSeed, draft)
  });
}

test("recommendations create three catalog-backed Oracle designs and save idempotently", async () => {
  const repository = new InMemoryOracleRepository();
  const catalog = recommendationCatalog();
  const designs = new Map<string, DesignV1>();
  let tamperPrice = false;
  let tamperIdentity = false;
  const designGenerator: OracleDesignGenerator = {
    async generateFromCandidate(generation) {
      const candidate = generation.candidate as {
        materialProductIds: string[];
        providerMetadata: { oracleCandidate: { rank: number; direction: "BALANCED" | "CONTRAST" | "NEUTRAL_LED"; sessionId: string } };
      };
      const authority = candidate.providerMetadata.oracleCandidate;
      const design = generatedOracleDesign({
        sequence: candidate.materialProductIds,
        rank: authority.rank,
        direction: authority.direction,
        sessionId: authority.sessionId,
        wrist: generation.request.wristCircumferenceMm,
        catalog,
        designIdSeed: generation.designId,
        tamperPrice,
        tamperIdentity
      });
      designs.set(design.designId, design);
      return { requestId: generation.request.requestId, design: toPublicDesign(design), warnings: [] };
    }
  };
  const designReader = {
    async getOwnedDesign(ownerId: string, designId: string) {
      assert.equal(ownerId, "oracle-owner");
      const design = designs.get(designId);
      if (!design) throw new Error("missing design");
      return structuredClone(design);
    }
  };
  const service = new OracleService({
    repository,
    coins: new CountingCoinSource(Array(18).fill(2)),
    catalog: { async listActiveCatalogProducts() { return structuredClone(catalog); } },
    designGenerator,
    designReader
  });
  const created = await service.create("oracle-owner", {
    requestId: "recommend-create",
    operationId: "recommend-create-operation",
    locale: "zh-CN",
    currency: "CNY",
    wristCircumferenceMm: 155
  });
  const recommended = await service.recommendations("oracle-owner", created.session.sessionId, {
    requestId: "recommend-1",
    operationId: "recommend-operation-1",
    expectedRevision: 1
  });
  assert.deepEqual(GenerateOracleRecommendationsResponseSchema.parse(recommended), recommended);
  assert.deepEqual(recommended.session.recommendations!.map(({ direction }) => direction), ["BALANCED", "CONTRAST", "NEUTRAL_LED"]);
  const replay = await service.recommendations("oracle-owner", created.session.sessionId, {
    requestId: "recommend-2",
    operationId: "recommend-operation-1",
    expectedRevision: 1
  });
  assert.deepEqual(replay.session, recommended.session);

  const selectedDesignId = recommended.session.recommendations![1]!.design.designId;
  const saved = await service.save("oracle-owner", created.session.sessionId, {
    requestId: "save-1",
    operationId: "save-operation-1",
    expectedRevision: 2,
    selectedDesignId
  });
  assert.deepEqual(SaveOracleSessionResponseSchema.parse(saved), saved);
  const saveReplay = await service.save("oracle-owner", created.session.sessionId, {
    requestId: "save-2",
    operationId: "save-operation-1",
    expectedRevision: 2,
    selectedDesignId
  });
  assert.deepEqual(saveReplay.session, saved.session);

  const secondRepository = new InMemoryOracleRepository();
  const changedPriceService = new OracleService({
    repository: secondRepository,
    coins: new CountingCoinSource(Array(18).fill(2)),
    catalog: { async listActiveCatalogProducts() { return structuredClone(catalog); } },
    designGenerator,
    designReader
  });
  const second = await changedPriceService.create("oracle-owner", {
    requestId: "price-create",
    operationId: "price-create-operation",
    locale: "zh-CN",
    currency: "CNY"
  });
  tamperPrice = true;
  await assert.rejects(
    () => changedPriceService.recommendations("oracle-owner", second.session.sessionId, {
      requestId: "price-recommend",
      operationId: "price-recommend-operation",
      expectedRevision: 1
    }),
    (error: unknown) => error instanceof DomainApiError && error.code === "PRICE_CHANGED"
  );

  tamperPrice = false;
  tamperIdentity = true;
  const thirdRepository = new InMemoryOracleRepository();
  const changedIdentityService = new OracleService({
    repository: thirdRepository,
    coins: new CountingCoinSource(Array(18).fill(2)),
    catalog: { async listActiveCatalogProducts() { return structuredClone(catalog); } },
    designGenerator,
    designReader
  });
  const third = await changedIdentityService.create("oracle-owner", {
    requestId: "identity-create",
    operationId: "identity-create-operation",
    locale: "zh-CN",
    currency: "CNY"
  });
  await assert.rejects(
    () => changedIdentityService.recommendations("oracle-owner", third.session.sessionId, {
      requestId: "identity-recommend",
      operationId: "identity-recommend-operation",
      expectedRevision: 1
    }),
    (error: unknown) => error instanceof DomainApiError && error.code === "INTERNAL_ERROR"
  );
});

test("recommendations fail with INVENTORY_CHANGED before generation when stock cannot complete a bracelet", async () => {
  const repository = new InMemoryOracleRepository();
  const catalog = recommendationCatalog().map((product) => ({ ...product, availableQuantity: 0 }));
  let generationCalls = 0;
  const service = new OracleService({
    repository,
    coins: new CountingCoinSource(Array(18).fill(2)),
    catalog: { async listActiveCatalogProducts() { return structuredClone(catalog); } },
    designGenerator: {
      async generateFromCandidate(): Promise<never> {
        generationCalls += 1;
        throw new Error("generation must not run for unavailable stock");
      }
    },
    designReader: {
      async getOwnedDesign(): Promise<never> {
        throw new Error("design lookup must not run for unavailable stock");
      }
    }
  });
  const created = await service.create("oracle-owner", {
    requestId: "inventory-create",
    operationId: "inventory-create-operation",
    locale: "zh-CN",
    currency: "CNY"
  });

  await assert.rejects(
    () => service.recommendations("oracle-owner", created.session.sessionId, {
      requestId: "inventory-recommend",
      operationId: "inventory-recommend-operation",
      expectedRevision: 1
    }),
    (error: unknown) => error instanceof DomainApiError && error.code === "INVENTORY_CHANGED"
  );
  assert.equal(generationCalls, 0);
});

function oracleRecommendationService(catalog: readonly AvailableCatalogMaterialProduct[]): OracleService {
  const designs = new Map<string, DesignV1>();
  const designGenerator: OracleDesignGenerator = {
    async generateFromCandidate(generation) {
      const candidate = generation.candidate as {
        materialProductIds: string[];
        providerMetadata: {
          oracleCandidate: {
            rank: number;
            direction: "BALANCED" | "CONTRAST" | "NEUTRAL_LED";
            sessionId: string;
          };
        };
      };
      const authority = candidate.providerMetadata.oracleCandidate;
      const design = generatedOracleDesign({
        sequence: candidate.materialProductIds,
        rank: authority.rank,
        direction: authority.direction,
        sessionId: authority.sessionId,
        wrist: generation.request.wristCircumferenceMm,
        catalog,
        designIdSeed: generation.designId
      });
      designs.set(design.designId, design);
      return { requestId: generation.request.requestId, design: toPublicDesign(design), warnings: [] };
    }
  };
  const designReader = {
    async getOwnedDesign(ownerId: string, designId: string) {
      assert.equal(ownerId, "oracle-owner");
      const design = designs.get(designId);
      if (!design) throw new Error("missing design");
      return structuredClone(design);
    }
  };
  return new OracleService({
    repository: new InMemoryOracleRepository(),
    coins: new CountingCoinSource(Array(18).fill(2)),
    catalog: { async listActiveCatalogProducts() { return structuredClone(catalog); } },
    designGenerator,
    designReader
  });
}

const isConflict = (error: unknown): boolean =>
  error instanceof DomainApiError && error.code === "CONFLICT";

test("recommendations replay in RECOMMENDED state rejects a changed expected revision", async () => {
  const service = oracleRecommendationService(recommendationCatalog());
  const created = await service.create("oracle-owner", {
    requestId: "revision-recommended-create",
    operationId: "revision-recommended-create-operation",
    locale: "zh-CN",
    currency: "CNY",
    wristCircumferenceMm: 155
  });
  const sessionId = created.session.sessionId;
  const recommended = await service.recommendations("oracle-owner", sessionId, {
    requestId: "revision-recommended-1",
    operationId: "revision-recommended-operation",
    expectedRevision: 1
  });
  const exactReplay = await service.recommendations("oracle-owner", sessionId, {
    requestId: "revision-recommended-2",
    operationId: "revision-recommended-operation",
    expectedRevision: 1
  });
  assert.deepEqual(exactReplay.session, recommended.session);

  await assert.rejects(
    () => service.recommendations("oracle-owner", sessionId, {
      requestId: "revision-recommended-3",
      operationId: "revision-recommended-operation",
      expectedRevision: 2
    }),
    isConflict
  );
});

test("save replay in SAVED state rejects a changed expected revision", async () => {
  const service = oracleRecommendationService(recommendationCatalog());
  const created = await service.create("oracle-owner", {
    requestId: "revision-save-create",
    operationId: "revision-save-create-operation",
    locale: "zh-CN",
    currency: "CNY",
    wristCircumferenceMm: 155
  });
  const sessionId = created.session.sessionId;
  const recommended = await service.recommendations("oracle-owner", sessionId, {
    requestId: "revision-save-recommend",
    operationId: "revision-save-recommend-operation",
    expectedRevision: 1
  });
  const selectedDesignId = recommended.session.recommendations![0]!.design.designId;
  const saved = await service.save("oracle-owner", sessionId, {
    requestId: "revision-save-1",
    operationId: "revision-save-operation",
    expectedRevision: 2,
    selectedDesignId
  });
  const exactReplay = await service.save("oracle-owner", sessionId, {
    requestId: "revision-save-2",
    operationId: "revision-save-operation",
    expectedRevision: 2,
    selectedDesignId
  });
  assert.deepEqual(exactReplay.session, saved.session);

  await assert.rejects(
    () => service.save("oracle-owner", sessionId, {
      requestId: "revision-save-3",
      operationId: "revision-save-operation",
      expectedRevision: 3,
      selectedDesignId
    }),
    isConflict
  );
});

test("recommendations replay in SAVED state rejects a changed expected revision", async () => {
  const service = oracleRecommendationService(recommendationCatalog());
  const created = await service.create("oracle-owner", {
    requestId: "revision-saved-create",
    operationId: "revision-saved-create-operation",
    locale: "zh-CN",
    currency: "CNY",
    wristCircumferenceMm: 155
  });
  const sessionId = created.session.sessionId;
  const recommended = await service.recommendations("oracle-owner", sessionId, {
    requestId: "revision-saved-recommend-1",
    operationId: "revision-saved-recommend-operation",
    expectedRevision: 1
  });
  const selectedDesignId = recommended.session.recommendations![0]!.design.designId;
  const saved = await service.save("oracle-owner", sessionId, {
    requestId: "revision-saved-save",
    operationId: "revision-saved-save-operation",
    expectedRevision: 2,
    selectedDesignId
  });
  const exactReplay = await service.recommendations("oracle-owner", sessionId, {
    requestId: "revision-saved-recommend-2",
    operationId: "revision-saved-recommend-operation",
    expectedRevision: 1
  });
  assert.deepEqual(exactReplay.session, saved.session);

  await assert.rejects(
    () => service.recommendations("oracle-owner", sessionId, {
      requestId: "revision-saved-recommend-3",
      operationId: "revision-saved-recommend-operation",
      expectedRevision: 2
    }),
    isConflict
  );
});
