import assert from "node:assert/strict";
import test from "node:test";

import { DesignV1Schema, type GenerateDesignRequest } from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { DomainApiError } from "../../contracts/api-error.js";
import {
  DesignApplicationService,
  type CatalogProduct,
  type DesignApplicationDependencies
} from "./design-api.service.js";

const catalog: CatalogProduct[] = structuredClone(standardAiDesignFixture).beads.map((bead, index) => ({
  id: bead.beadProductId,
  productType: "MATERIAL",
  sku: `ORACLE-${index + 1}`,
  name: `Oracle material ${index + 1}`,
  currency: "CNY",
  unitPriceMinor: bead.unitPriceMinor,
  active: true,
  crystalId: bead.crystalId,
  crystalNameCn: `测试水晶 ${index + 1}`,
  crystalNameEn: `Test crystal ${index + 1}`,
  colorTags: ["blue"],
  visualTags: [],
  styleTags: ["minimal"],
  emotionTags: [],
  cultureTags: [],
  shape: bead.shape,
  diameterMm: bead.diameterMm,
  lengthAlongStringMm: null,
  materialKey: bead.materialKey,
  modelAssetKey: bead.modelAssetKey,
  textureAssetKey: bead.textureAssetKey,
  availableQuantity: 100
}));

const request: GenerateDesignRequest = {
  requestId: "oracle-design-request",
  locale: "zh-CN",
  currency: "CNY",
  wristCircumferenceMm: 155,
  emotionTags: [],
  styleTags: ["style:minimal"],
  colorTags: ["color:blue"],
  excludedProductIds: [],
  personalizationConsent: false
};

function candidate() {
  return {
    designName: "Oracle balanced direction",
    materialProductIds: catalog.map(({ id }) => id),
    accessoryProductIds: [],
    designStory: "A design composition, not a prediction.",
    recommendationReasons: ["Uses the approved Oracle color and rhythm signal."],
    culturalInspiration: [],
    sourceTemplateIds: [],
    productionNotes: [],
    providerMetadata: {
      modelProvider: "deterministic",
      modelName: "mystcrag-oracle-candidate-builder",
      promptVersion: "oracle-copy-policy-v1",
      knowledgeBaseVersion: "oracle-design-rules-v1",
      designTemplateVersion: "oracle-balanced-rank-1",
      oracleCandidate: {
        sessionId: "oracle-session-1",
        ruleVersion: "oracle-design-rules-v1",
        rank: 1,
        direction: "BALANCED"
      }
    }
  } as const;
}

function createService(inventoryFailure = false) {
  const designs = new Map<string, ReturnType<typeof DesignV1Schema.parse>>();
  let component = 0;
  const designStore: DesignApplicationDependencies["designs"] = {
    async createDesign(ownerId, snapshot) {
      if (designs.has(snapshot.designId)) throw new DomainApiError("CONFLICT", "exists");
      designs.set(snapshot.designId, structuredClone(snapshot));
      const now = new Date("2026-09-29T12:00:00.000Z");
      return { id: snapshot.designId, ownerId, currentRevision: 1, status: "DRAFT", snapshot, createdAt: now, updatedAt: now, deletedAt: null };
    },
    async getDesign(ownerId, designId) {
      const snapshot = designs.get(designId);
      if (!snapshot) throw new DomainApiError("NOT_FOUND", "missing");
      const now = new Date("2026-09-29T12:00:00.000Z");
      return { id: designId, ownerId, currentRevision: 1, status: "DRAFT", snapshot, createdAt: now, updatedAt: now, deletedAt: null };
    },
    async getRevision() { throw new Error("unused"); },
    async listDesignRevisions() { return []; },
    async listDesigns() { return []; },
    async updateDesign() { throw new Error("unused"); },
    async saveDesign() { throw new Error("unused"); },
    async softDeleteDesign() {}
  };
  return new DesignApplicationService({
    designs: designStore,
    catalog: {
      async getCatalogProducts() { return catalog; },
      async listActiveCatalogProducts() { return catalog; },
      async listAvailableCatalogMaterialProducts() { return [] as never; },
      async listAvailableCatalogAccessoryProducts() { return []; }
    },
    pricing: {
      async recalculateDesignPrice(value) {
        const design = DesignV1Schema.parse(value);
        return DesignV1Schema.parse({
          ...design,
          pricing: { ...design.pricing, pricingVersion: "oracle-price-v1" },
          provenance: { ...design.provenance, pricingRuleVersion: "oracle-price-v1" }
        });
      }
    },
    inventory: {
      async validateAvailability() {
        if (inventoryFailure) throw new DomainApiError("INVENTORY_CHANGED", "out of stock");
      }
    },
    publications: { async publishDesign() { throw new Error("unused"); } },
    orders: { async createOrderFromDesign() { throw new Error("unused"); }, async listOrders() { return []; } },
    generator: { async generate() { throw new Error("unused"); } },
    now: () => new Date("2026-09-29T12:00:00.000Z"),
    createId(prefix) { return `${prefix}-${++component}`; }
  });
}

test("Design application accepts only matching Oracle provenance for ORACLE_GUIDED", async () => {
  const result = await createService().generateFromCandidate({
    actorId: "oracle-owner",
    request,
    candidate: candidate(),
    designMode: "ORACLE_GUIDED",
    designId: "oracle-authority-seed"
  });
  assert.equal(result.design.designMode, "ORACLE_GUIDED");
  assert.deepEqual(result.design.provenance.oracleCandidate, candidate().providerMetadata.oracleCandidate);
  assert.equal(result.design.provenance.tarotCandidate, undefined);
  assert.match(result.design.designId, /^oracle-design-/u);

  await assert.rejects(
    () => createService().generateFromCandidate({
      actorId: "oracle-owner",
      request,
      candidate: { ...candidate(), providerMetadata: { ...candidate().providerMetadata, oracleCandidate: undefined } },
      designMode: "ORACLE_GUIDED",
      designId: "oracle-invalid-seed"
    }),
    (error: unknown) => error instanceof DomainApiError && error.code === "VALIDATION_ERROR"
  );
});

test("ORACLE_GUIDED never receives the Tarot restock exception", async () => {
  await assert.rejects(
    () => createService(true).generateFromCandidate({
      actorId: "oracle-owner",
      request,
      candidate: candidate(),
      designMode: "ORACLE_GUIDED",
      designId: "oracle-stock-seed"
    }),
    (error: unknown) => error instanceof DomainApiError && error.code === "INVENTORY_CHANGED"
  );
});
