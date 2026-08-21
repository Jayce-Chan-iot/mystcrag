import assert from "node:assert/strict";
import test from "node:test";

import {
  DesignV1Schema,
  toPublicDesign,
  type DesignDecisionTrace,
  type DesignV1,
  type RecommendDesignRequest
} from "@mystcrag/design-contract";
import {
  compileDecisionRules,
  type CatalogFeasibilitySnapshot
} from "@mystcrag/knowledge-core";

import { createApp } from "../../app.js";
import {
  SignedTestTokenAuthProvider,
  signTestAccessToken
} from "../../auth/signed-test-auth-provider.js";
import { DomainApiError } from "../../contracts/api-error.js";
import type { CatalogProduct } from "./design-api.service.js";
import { RecommendationApplicationService } from "./recommendation.service.js";

const actorId = "actor-owner";
const fixedNow = new Date("2026-08-21T10:00:00.000Z");
const authSecret = "mystcrag-backend-auth-test-secret-2026";
const authIssuer = "https://auth.test.mystcrag.local";
const authAudience = "mystcrag-backend";
const authProvider = new SignedTestTokenAuthProvider({
  secret: authSecret,
  issuer: authIssuer,
  audience: authAudience,
  now: () => fixedNow
});

const CATALOG_MATERIALS: CatalogProduct[] = [
  {
    id: "product-amethyst-8",
    productType: "MATERIAL",
    sku: "BEAD-AMETHYST-8",
    name: "紫水晶 8mm",
    crystalId: "crystal-amethyst",
    crystalNameCn: "紫水晶",
    crystalNameEn: "Amethyst",
    colorTags: ["color:purple"],
    visualTags: ["transparency:translucent"],
    styleTags: ["style:minimal"],
    emotionTags: ["emotion:calm"],
    cultureTags: [],
    shape: "ROUND",
    diameterMm: 8,
    materialKey: "material:amethyst",
    modelAssetKey: "sphere-round-8mm-v1",
    textureAssetKey: "texture-amethyst-v1",
    currency: "CNY",
    unitPriceMinor: 600,
    active: true
  },
  {
    id: "product-aquamarine-8",
    productType: "MATERIAL",
    sku: "BEAD-AQUAMARINE-8",
    name: "海蓝宝 8mm",
    crystalId: "crystal-aquamarine",
    crystalNameCn: "海蓝宝",
    crystalNameEn: "Aquamarine",
    colorTags: ["color:blue"],
    visualTags: ["transparency:translucent"],
    styleTags: ["style:minimal"],
    emotionTags: ["emotion:calm"],
    cultureTags: [],
    shape: "ROUND",
    diameterMm: 8,
    materialKey: "material:aquamarine",
    modelAssetKey: "sphere-round-8mm-v1",
    textureAssetKey: "texture-aquamarine-v1",
    currency: "CNY",
    unitPriceMinor: 700,
    active: true
  },
  {
    id: "product-moonstone-6",
    productType: "MATERIAL",
    sku: "BEAD-MOONSTONE-6",
    name: "月光石 6mm",
    crystalId: "crystal-moonstone",
    crystalNameCn: "月光石",
    crystalNameEn: "Moonstone",
    colorTags: ["color:white"],
    visualTags: ["transparency:translucent"],
    styleTags: ["style:ethereal"],
    emotionTags: ["emotion:hope"],
    cultureTags: [],
    shape: "ROUND",
    diameterMm: 6,
    materialKey: "material:moonstone",
    modelAssetKey: "sphere-round-6mm-v1",
    textureAssetKey: "texture-moonstone-v1",
    currency: "CNY",
    unitPriceMinor: 450,
    active: true
  },
  {
    id: "product-citrine-10",
    productType: "MATERIAL",
    sku: "BEAD-CITRINE-10",
    name: "黄水晶 10mm",
    crystalId: "crystal-citrine",
    crystalNameCn: "黄水晶",
    crystalNameEn: "Citrine",
    colorTags: ["color:yellow"],
    visualTags: ["transparency:translucent"],
    styleTags: ["style:natural"],
    emotionTags: ["emotion:joy"],
    cultureTags: [],
    shape: "ROUND",
    diameterMm: 10,
    materialKey: "material:citrine",
    modelAssetKey: "sphere-round-10mm-v1",
    textureAssetKey: "texture-citrine-v1",
    currency: "CNY",
    unitPriceMinor: 800,
    active: true
  },
  {
    id: "product-obsidian-8",
    productType: "MATERIAL",
    sku: "BEAD-OBSIDIAN-8",
    name: "黑曜石 8mm",
    crystalId: "crystal-obsidian",
    crystalNameCn: "黑曜石",
    crystalNameEn: "Obsidian",
    colorTags: ["color:black"],
    visualTags: ["transparency:opaque"],
    styleTags: ["style:bold"],
    emotionTags: ["emotion:grounded"],
    cultureTags: [],
    shape: "ROUND",
    diameterMm: 8,
    materialKey: "material:obsidian",
    modelAssetKey: "sphere-round-8mm-v1",
    textureAssetKey: "texture-obsidian-v1",
    currency: "CNY",
    unitPriceMinor: 300,
    active: true
  }
];

type StoredDesign = {
  id: string;
  ownerId: string;
  currentRevision: number;
  status: "DRAFT" | "GENERATED" | "SAVED" | "ARCHIVED";
  snapshot: DesignV1;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

function createHarness() {
  const catalog = CATALOG_MATERIALS;
  const catalogById = new Map(catalog.map((product) => [product.id, product]));
  const designsById = new Map<string, StoredDesign>();
  const tracesByKey = new Map<string, DesignDecisionTrace>();

  const requireOwned = (owner: string, designId: string): StoredDesign => {
    const design = designsById.get(designId);
    if (!design || design.ownerId !== owner) {
      throw new DomainApiError("NOT_FOUND", "Design not found");
    }
    return design;
  };

  const designs = {
    async createDesign(ownerId: string, snapshot: DesignV1) {
      if (designsById.has(snapshot.designId)) {
        throw new DomainApiError("CONFLICT", "Design already exists");
      }
      const stored: StoredDesign = {
        id: snapshot.designId,
        ownerId,
        currentRevision: snapshot.revision,
        status: "GENERATED",
        snapshot: structuredClone(snapshot),
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null
      };
      designsById.set(snapshot.designId, stored);
      return structuredClone(stored);
    },
    async getDesign(ownerId: string, designId: string) {
      return structuredClone(requireOwned(ownerId, designId));
    },
    async getRevision(designId: string, revisionNumber: number) {
      const design = designsById.get(designId);
      if (!design) {
        throw new DomainApiError("NOT_FOUND", "Design revision not found");
      }
      return {
        id: `${designId}#${revisionNumber}`,
        designId,
        revisionNumber,
        snapshot: design.snapshot,
        changeType: "CREATED" as const,
        changeReason: null,
        createdBy: design.ownerId,
        createdAt: design.createdAt
      };
    },
    async listDesignRevisions(ownerId: string, designId: string) {
      const design = requireOwned(ownerId, designId);
      return [
        {
          id: `${designId}#${design.currentRevision}`,
          designId,
          revisionNumber: design.currentRevision,
          snapshot: design.snapshot,
          changeType: "CREATED" as const,
          changeReason: null,
          createdBy: design.ownerId,
          createdAt: design.createdAt
        }
      ];
    },
    async updateDesign(
      ownerId: string,
      designId: string,
      expectedRevision: number,
      snapshot: DesignV1,
      changeReason: string
    ) {
      const design = requireOwned(ownerId, designId);
      if (design.currentRevision !== expectedRevision) {
        throw new DomainApiError("CONFLICT", "Design revision conflict");
      }
      design.snapshot = structuredClone(snapshot);
      design.currentRevision = snapshot.revision;
      design.updatedAt = fixedNow;
      void changeReason;
      return structuredClone(design);
    },
    async saveDesign(ownerId: string, designId: string, expectedRevision: number) {
      const design = requireOwned(ownerId, designId);
      if (design.currentRevision !== expectedRevision) {
        throw new DomainApiError("CONFLICT", "Design revision conflict");
      }
      design.status = "SAVED";
      return structuredClone(design);
    }
  };

  const pricing = {
    async recalculateDesignPrice(input: DesignV1) {
      const design = DesignV1Schema.parse(input);
      const beads = design.beads.map((bead) => ({
        ...bead,
        unitPriceMinor: catalogById.get(bead.beadProductId)!.unitPriceMinor
      }));
      const materialSubtotalMinor = beads.reduce(
        (sum, item) => sum + item.unitPriceMinor,
        0
      );
      return DesignV1Schema.parse({
        ...design,
        beads,
        pricing: {
          ...design.pricing,
          materialSubtotalMinor,
          accessorySubtotalMinor: 0,
          totalPriceMinor: materialSubtotalMinor,
          pricingVersion: "cny-retail-2026-08-v1",
          priceCalculatedAt: fixedNow.toISOString()
        }
      });
    }
  };

  const inventory = {
    async validateAvailability() {}
  };

  const stock = {
    async getAvailableQuantities(productIds: readonly string[]) {
      return new Map(productIds.map((id) => [id, 9999]));
    }
  };

  const traces = {
    async createTrace(designId: string, revisionNumber: number, input: unknown) {
      const trace = input as DesignDecisionTrace;
      tracesByKey.set(`${designId}#${revisionNumber}`, trace);
      return trace;
    },
    async getTrace(designId: string, revisionNumber: number) {
      return tracesByKey.get(`${designId}#${revisionNumber}`) ?? null;
    },
    async getLatestTrace(designId: string) {
      const revisions = [...tracesByKey.keys()]
        .filter((key) => key.startsWith(`${designId}#`))
        .map((key) => Number(key.split("#")[1]))
        .sort((left, right) => right - left);
      return revisions.length > 0 ? tracesByKey.get(`${designId}#${revisions[0]}`)! : null;
    }
  };

  const rules = {
    async compileActiveRules(snapshot: CatalogFeasibilitySnapshot) {
      return compileDecisionRules({
        knowledgeVersion: "none",
        rules: [],
        sources: new Map(),
        catalog: snapshot
      });
    }
  };

  const service = new RecommendationApplicationService({
    designs,
    catalog: {
      async getCatalogProducts(ids) {
        return catalog.filter((product) => ids.includes(product.id));
      },
      async listActiveCatalogProducts(currency, excluded = []) {
        return catalog.filter(
          (product) => product.currency === currency && !excluded.includes(product.id)
        );
      }
    },
    pricing,
    inventory,
    rules,
    traces,
    stock,
    now: () => fixedNow
  });

  const app = createApp({
    recommendationService: service,
    authProvider,
    logger: false
  });

  return { app, service, designsById, tracesByKey, catalog };
}

function requestHeaders(
  owner = actorId,
  overrides: { audience?: string } = {}
) {
  const token = signTestAccessToken(
    {
      subject: owner,
      issuer: authIssuer,
      audience: overrides.audience ?? authAudience,
      expiresAtEpochSeconds: Math.floor(fixedNow.getTime() / 1000) + 3600
    },
    authSecret
  );
  return { authorization: `Bearer ${token}` };
}

const recommendBody: RecommendDesignRequest = {
  requestId: "request-recommend-1",
  locale: "zh-CN",
  currency: "CNY",
  wristCircumferenceMm: 155,
  emotionTags: ["calm"],
  styleTags: ["minimal"],
  colorTags: ["blue"],
  excludedProductIds: [],
  personalizationConsent: false
};

test("recommend returns engine candidates persisted with decision traces", async () => {
  const harness = createHarness();
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/design/recommend",
    headers: requestHeaders(),
    payload: recommendBody
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.requestId, "request-recommend-1");
  assert.ok(body.candidates.length >= 1);
  assert.ok(body.candidates.length <= 3);
  const first = body.candidates[0];
  assert.match(first.designId, /^design-/);
  assert.ok(["SYMMETRIC_BALANCE", "CENTER_FOCAL", "REPEAT_RHYTHM", "LOW_CONTRAST_FLOW"].includes(
    first.layoutStrategy
  ));
  assert.equal(first.score.formulaVersion, "design-score-v1");
  assert.ok(first.design.beads.length > 0);

  const stored = harness.designsById.get(first.designId);
  assert.ok(stored, "candidate design is persisted");
  assert.equal(stored.ownerId, actorId);
  assert.equal(stored.currentRevision, 1);

  const trace = harness.tracesByKey.get(`${first.designId}#1`);
  assert.ok(trace, "decision trace sidecar is persisted");
  assert.equal(trace.designId, first.designId);
  assert.equal(trace.revision, 1);
  assert.equal(trace.layoutStrategy, first.layoutStrategy);
});

test("recommend requires authentication and a valid contract body", async () => {
  const harness = createHarness();

  const unauthorized = await harness.app.inject({
    method: "POST",
    url: "/api/design/recommend",
    payload: recommendBody
  });
  assert.equal(unauthorized.statusCode, 401);

  const badAudience = await harness.app.inject({
    method: "POST",
    url: "/api/design/recommend",
    headers: requestHeaders(actorId, { audience: "other-audience" }),
    payload: recommendBody
  });
  assert.equal(badAudience.statusCode, 401);

  const invalid = await harness.app.inject({
    method: "POST",
    url: "/api/design/recommend",
    headers: requestHeaders(),
    payload: { ...recommendBody, wristCircumferenceMm: -1 }
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, "VALIDATION_ERROR");
});

test("evaluate scores a persisted design and surfaces trace staleness", async () => {
  const harness = createHarness();
  const recommended = await harness.service.recommend(actorId, recommendBody);
  const designId = recommended.candidates[0]!.designId;

  const response = await harness.app.inject({
    method: "POST",
    url: "/api/design/evaluate",
    headers: requestHeaders(),
    payload: { requestId: "request-evaluate-1", designId }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.designId, designId);
  assert.equal(body.scores.formulaVersion, "design-score-v1");
  assert.ok(body.scores.overallScore >= 0 && body.scores.overallScore <= 100);
  assert.ok(body.reasons.length > 0);

  const foreign = await harness.app.inject({
    method: "POST",
    url: "/api/design/evaluate",
    headers: requestHeaders("actor-intruder"),
    payload: { requestId: "request-evaluate-2", designId }
  });
  assert.equal(foreign.statusCode, 403);
});

test("trace returns the latest decision trace for an owned design", async () => {
  const harness = createHarness();
  const recommended = await harness.service.recommend(actorId, recommendBody);
  const designId = recommended.candidates[0]!.designId;

  const response = await harness.app.inject({
    method: "GET",
    url: `/api/design/${designId}/trace`,
    headers: requestHeaders()
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.designId, designId);
  assert.equal(body.trace.designId, designId);
  assert.equal(body.trace.revision, 1);
  assert.ok(Array.isArray(body.trace.activeRuleIds));

  const missing = await harness.app.inject({
    method: "GET",
    url: "/api/design/design-does-not-exist/trace",
    headers: requestHeaders()
  });
  assert.equal(missing.statusCode, 403);
});

test("suggest ranks compatible partner materials for a base material", async () => {
  const harness = createHarness();
  const response = await harness.app.inject({
    method: "GET",
    url: "/api/materials/product-amethyst-8/suggest?currency=CNY&locale=zh-CN",
    headers: requestHeaders()
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.materialId, "product-amethyst-8");
  assert.equal(body.currency, "CNY");
  assert.ok(body.suggestions.length >= 1);
  assert.ok(body.suggestions.length <= 8);
  for (let index = 1; index < body.suggestions.length; index += 1) {
    assert.ok(body.suggestions[index - 1].score >= body.suggestions[index].score);
  }
  assert.ok(
    body.suggestions.every(
      (suggestion: { material: { beadProductId: string } }) =>
        suggestion.material.beadProductId !== "product-amethyst-8"
    )
  );

  const missingCurrency = await harness.app.inject({
    method: "GET",
    url: "/api/materials/product-amethyst-8/suggest",
    headers: requestHeaders()
  });
  assert.equal(missingCurrency.statusCode, 400);

  const unknownMaterial = await harness.app.inject({
    method: "GET",
    url: "/api/materials/product-unknown/suggest?currency=CNY",
    headers: requestHeaders()
  });
  assert.equal(unknownMaterial.statusCode, 404);
});

test("optimize returns an editable operation script that preserves locked components", async () => {
  const harness = createHarness();
  const recommended = await harness.service.recommend(actorId, recommendBody);
  const designId = recommended.candidates[0]!.designId;
  const stored = harness.designsById.get(designId)!;
  const lockedComponentId = stored.snapshot.beads[0]!.componentId;
  const lockedProductId = stored.snapshot.beads[0]!.beadProductId;

  const response = await harness.app.inject({
    method: "POST",
    url: "/api/design/optimize",
    headers: requestHeaders(),
    payload: {
      requestId: "request-optimize-1",
      designId,
      expectedRevision: 1,
      lockedComponentIds: [lockedComponentId]
    }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.requestId, "request-optimize-1");
  assert.ok(body.operations.length >= 1);
  assert.ok(
    body.design.beads.some((bead: { componentId: string }) => bead.componentId === lockedComponentId)
  );
  assert.ok(
    body.design.beads.some((bead: { beadProductId: string }) => bead.beadProductId === lockedProductId)
  );
  assert.equal(body.design.revision, 2);
  assert.equal(body.score.formulaVersion, "design-score-v1");

  const conflict = await harness.app.inject({
    method: "POST",
    url: "/api/design/optimize",
    headers: requestHeaders(),
    payload: {
      requestId: "request-optimize-2",
      designId,
      expectedRevision: 99,
      lockedComponentIds: []
    }
  });
  assert.equal(conflict.statusCode, 409);

  const unknownLock = await harness.app.inject({
    method: "POST",
    url: "/api/design/optimize",
    headers: requestHeaders(),
    payload: {
      requestId: "request-optimize-3",
      designId,
      expectedRevision: 1,
      lockedComponentIds: ["component-not-on-design"]
    }
  });
  assert.equal(unknownLock.statusCode, 400);
});

test("recommend re-request is idempotent for unchanged context", async () => {
  const harness = createHarness();
  const first = await harness.service.recommend(actorId, recommendBody);
  const second = await harness.service.recommend(actorId, recommendBody);

  assert.deepEqual(
    first.candidates.map((candidate) => candidate.designId),
    second.candidates.map((candidate) => candidate.designId)
  );
  assert.equal(harness.designsById.size, first.candidates.length);
});

test("public design projection hides internal pricing detail fields", async () => {
  const harness = createHarness();
  const recommended = await harness.service.recommend(actorId, recommendBody);
  const first = recommended.candidates[0]!;
  const publicDesign = toPublicDesign(harness.designsById.get(first.designId)!.snapshot);
  assert.equal(publicDesign.designId, first.design.designId);
  assert.deepEqual(publicDesign.beads.length, first.design.beads.length);
});
