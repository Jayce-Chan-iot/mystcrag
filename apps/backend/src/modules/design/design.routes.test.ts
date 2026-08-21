import assert from "node:assert/strict";
import test from "node:test";

import {
  DesignV1Schema,
  toPublicDesign,
  type DesignV1
} from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { createApp } from "../../app.js";
import {
  SignedTestTokenAuthProvider,
  signTestAccessToken
} from "../../auth/signed-test-auth-provider.js";
import { DomainApiError } from "../../contracts/api-error.js";
import type { KnowledgeUsageEvent } from "../../observability/knowledge-usage-recorder.js";
import { AiRecommendationDesignAdapter } from "./ai-recommendation-design.adapter.js";
import {
  DesignApplicationService,
  MockDesignGenerationAdapter,
  type CatalogProduct,
  type DesignGenerationAdapter
} from "./design-api.service.js";

type PersistedDesign = {
  id: string;
  ownerId: string;
  currentRevision: number;
  status: "DRAFT" | "GENERATED" | "SAVED" | "ARCHIVED";
  snapshot: DesignV1;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};
type PersistedDesignRevision = {
  id: string;
  designId: string;
  revisionNumber: number;
  snapshot: DesignV1;
  changeType: "CREATED" | "UPDATED" | "RESTORED" | "AI_OPTIMIZED";
  changeReason: string | null;
  createdBy: string;
  createdAt: Date;
};

const actorId = "actor-owner";
const fixedNow = new Date("2026-07-21T10:00:00.000Z");
const authSecret = "mystcrag-backend-auth-test-secret-2026";
const authIssuer = "https://auth.test.mystcrag.local";
const authAudience = "mystcrag-backend";
const authProvider = new SignedTestTokenAuthProvider({
  secret: authSecret,
  issuer: authIssuer,
  audience: authAudience,
  now: () => fixedNow
});
const cloneDesign = () => structuredClone(standardAiDesignFixture);

function catalogFromFixture(): CatalogProduct[] {
  const design = cloneDesign();
  return [
    ...design.beads.map((bead, index) => ({
      id: bead.beadProductId,
      productType: "MATERIAL" as const,
      sku: `BEAD-${index}`,
      name: bead.beadProductId,
      crystalId: bead.crystalId,
      crystalNameCn: `测试水晶 ${index + 1}`,
      crystalNameEn: bead.crystalId,
      colorTags: index === 0 ? ["blue", "cool"] : ["neutral"],
      visualTags: ["translucent"],
      styleTags: ["minimal"],
      emotionTags: ["calm-aesthetic"],
      cultureTags: ["design-inspiration-only"],
      shape: bead.shape,
      diameterMm: bead.diameterMm,
      materialKey: bead.materialKey,
      modelAssetKey: bead.modelAssetKey,
      textureAssetKey: bead.textureAssetKey,
      currency: design.currency,
      unitPriceMinor: bead.unitPriceMinor,
      active: true
    })),
    ...design.accessories.map((accessory, index) => ({
      id: accessory.accessoryProductId,
      productType: "ACCESSORY" as const,
      sku: `ACCESSORY-${index}`,
      name: accessory.accessoryProductId,
      accessoryType: accessory.accessoryType,
      material: accessory.material,
      finish: accessory.finish,
      dimensions: structuredClone(accessory.dimensions),
      modelAssetKey: accessory.modelAssetKey,
      textureAssetKey: accessory.textureAssetKey ?? null,
      currency: design.currency,
      unitPriceMinor: accessory.unitPriceMinor,
      active: true
    }))
  ];
}

function createHarness(
  generator: DesignGenerationAdapter = new MockDesignGenerationAdapter()
) {
  const catalog = catalogFromFixture();
  const catalogById = new Map(catalog.map((product) => [product.id, product]));
  const current = new Map<string, PersistedDesign>();
  const revisionRows = new Map<string, PersistedDesignRevision[]>();
  const orderSnapshots: DesignV1[] = [];
  const recordedUsageEvents: KnowledgeUsageEvent[] = [];
  let componentCounter = 0;
  let createAttempts = 0;
  let failUpdate = false;
  let inventoryChanged = false;
  let orderPriceChanged = false;
  let orderInventoryChanged = false;

  const seed = (design: DesignV1, ownerId = actorId) => {
    const now = new Date(design.createdAt);
    current.set(design.designId, {
      id: design.designId,
      ownerId,
      currentRevision: design.revision,
      status: "DRAFT",
      snapshot: structuredClone(design),
      createdAt: now,
      updatedAt: new Date(design.updatedAt),
      deletedAt: null
    });
    revisionRows.set(design.designId, [
      {
        id: `revision-${design.designId}-${design.revision}`,
        designId: design.designId,
        revisionNumber: design.revision,
        snapshot: structuredClone(design),
        changeType: "CREATED",
        changeReason: "Initial design",
        createdBy: ownerId,
        createdAt: now
      }
    ]);
  };

  const requireOwned = (owner: string, designId: string) => {
    const design = current.get(designId);
    if (!design || design.ownerId !== owner) {
      throw new DomainApiError("NOT_FOUND", "Design not found");
    }
    return design;
  };

  const designs = {
    async createDesign(ownerId: string, snapshot: DesignV1) {
      createAttempts += 1;
      if (current.has(snapshot.designId)) {
        throw new DomainApiError("CONFLICT", "Design already exists");
      }
      seed(snapshot, ownerId);
      return structuredClone(current.get(snapshot.designId)!);
    },
    async getDesign(ownerId: string, designId: string) {
      return structuredClone(requireOwned(ownerId, designId));
    },
    async getRevision(designId: string, revisionNumber: number) {
      const revision = revisionRows
        .get(designId)
        ?.find((item) => item.revisionNumber === revisionNumber);
      if (!revision) throw new DomainApiError("NOT_FOUND", "Design revision not found");
      return structuredClone(revision);
    },
    async listDesignRevisions(ownerId: string, designId: string) {
      requireOwned(ownerId, designId);
      return structuredClone(revisionRows.get(designId) ?? []);
    },
    async updateDesign(
      ownerId: string,
      designId: string,
      expectedRevision: number,
      snapshot: DesignV1,
      changeReason: string
    ) {
      const existing = requireOwned(ownerId, designId);
      if (existing.currentRevision !== expectedRevision) {
        throw new DomainApiError("CONFLICT", "Design revision conflict");
      }
      if (failUpdate) throw new Error("transaction failed");
      const next = {
        ...existing,
        currentRevision: snapshot.revision,
        snapshot: structuredClone(snapshot),
        updatedAt: new Date(snapshot.updatedAt)
      };
      current.set(designId, next);
      revisionRows.get(designId)!.push({
        id: `revision-${designId}-${snapshot.revision}`,
        designId,
        revisionNumber: snapshot.revision,
        snapshot: structuredClone(snapshot),
        changeType: "UPDATED",
        changeReason,
        createdBy: ownerId,
        createdAt: fixedNow
      });
      return structuredClone(next);
    },
    async saveDesign(ownerId: string, designId: string, expectedRevision: number) {
      const existing = requireOwned(ownerId, designId);
      if (existing.currentRevision !== expectedRevision) {
        throw new DomainApiError("CONFLICT", "Design revision conflict");
      }
      existing.status = "SAVED";
      return structuredClone(existing);
    }
  };

  const pricing = {
    async recalculateDesignPrice(input: DesignV1) {
      const design = DesignV1Schema.parse(input);
      const beads = design.beads.map((bead) => ({
        ...bead,
        unitPriceMinor: catalogById.get(bead.beadProductId)!.unitPriceMinor
      }));
      const accessories = design.accessories.map((accessory) => ({
        ...accessory,
        unitPriceMinor: catalogById.get(accessory.accessoryProductId)!.unitPriceMinor
      }));
      const materialSubtotalMinor = beads.reduce((sum, item) => sum + item.unitPriceMinor, 0);
      const accessorySubtotalMinor = accessories.reduce(
        (sum, item) => sum + item.unitPriceMinor,
        0
      );
      const pricingValue = {
        ...design.pricing,
        materialSubtotalMinor,
        accessorySubtotalMinor,
        pricingVersion: "cny-retail-2026-07-v1",
        priceCalculatedAt: fixedNow.toISOString(),
        totalPriceMinor:
          materialSubtotalMinor +
          accessorySubtotalMinor +
          design.pricing.laborFeeMinor +
          design.pricing.designFeeMinor +
          design.pricing.packagingFeeMinor +
          design.pricing.platformFeeEstimateMinor +
          design.pricing.logisticsFeeEstimateMinor -
          design.pricing.discountMinor +
          design.pricing.adjustments.reduce((sum, item) => sum + item.amountMinor, 0)
      };
      return DesignV1Schema.parse({
        ...design,
        beads,
        accessories,
        pricing: pricingValue,
        provenance: {
          ...design.provenance,
          pricingRuleVersion: pricingValue.pricingVersion
        }
      });
    }
  };

  const inventory = {
    async validateAvailability() {
      if (inventoryChanged) {
        throw new DomainApiError("INVENTORY_CHANGED", "Catalog inventory changed");
      }
    }
  };

  const publications = {
    async publishDesign(
      ownerId: string,
      designId: string,
      revisionNumber: number,
      options: {
        visibility: "UNLISTED" | "PUBLIC";
        publishConsent: true;
        allowRemix: boolean;
        creatorDisplayMode: "ANONYMOUS" | "DISPLAY_NAME";
      }
    ) {
      requireOwned(ownerId, designId);
      const revision = (revisionRows.get(designId) ?? []).find(
        (item) => item.revisionNumber === revisionNumber
      );
      if (!revision) throw new DomainApiError("NOT_FOUND", "Revision not found");
      if (
        revision.snapshot.compliance.complianceStatus !== "PASSED" ||
        revision.snapshot.compliance.reviewRequired
      ) {
        throw new DomainApiError("COMPLIANCE_BLOCKED", "Design is not cleared");
      }
      const publicDesign = toPublicDesign({
        ...revision.snapshot,
        community: options,
        production: { ...revision.snapshot.production, productionNotes: [] }
      });
      return {
        id: "publication-1",
        designId,
        designRevisionId: revision.id,
        visibility: options.visibility,
        allowRemix: options.allowRemix,
        creatorDisplayMode: options.creatorDisplayMode,
        status: "PUBLISHED",
        publishedAt: fixedNow,
        unpublishedAt: null,
        design: publicDesign
      };
    }
  };

  const orders = {
    async createOrderFromDesign(
      ownerId: string,
      designId: string,
      revisionNumber: number,
      expectedTotalPriceMinor: number,
      expectedPricingVersion: string
    ) {
      const design = requireOwned(ownerId, designId);
      if (design.currentRevision !== revisionNumber) {
        throw new DomainApiError("CONFLICT", "Design revision is no longer current");
      }
      if (
        design.snapshot.compliance.complianceStatus === "REJECTED" ||
        design.snapshot.compliance.reviewRequired
      ) {
        throw new DomainApiError("COMPLIANCE_BLOCKED", "Design is not cleared");
      }
      if (
        orderPriceChanged ||
        expectedTotalPriceMinor !== design.snapshot.pricing.totalPriceMinor ||
        expectedPricingVersion !== design.snapshot.pricing.pricingVersion
      ) {
        throw new DomainApiError("PRICE_CHANGED", "Server price differs");
      }
      if (orderInventoryChanged) {
        throw new DomainApiError("INVENTORY_CHANGED", "Inventory differs");
      }
      const snapshot = structuredClone(design.snapshot);
      orderSnapshots.push(snapshot);
      return {
        id: `order-${orderSnapshots.length}`,
        userId: ownerId,
        status: "PENDING" as const,
        currency: snapshot.currency,
        totalAmountMinor: snapshot.pricing.totalPriceMinor,
        designRevisionId: `revision-${designId}-${revisionNumber}`,
        createdAt: fixedNow,
        designSnapshot: snapshot,
        pricingSnapshot: structuredClone(snapshot.pricing),
        productionSnapshot: structuredClone(snapshot.production),
        pricingRuleVersion: snapshot.pricing.pricingVersion
      };
    }
  };

  const service = new DesignApplicationService({
    generator,
    designs,
    usage: {
      async record(events) {
        recordedUsageEvents.push(...events.map((event) => ({ ...event })));
      }
    },
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
    publications,
    orders,
    now: () => fixedNow,
    createId(prefix) {
      componentCounter += 1;
      return `${prefix}-${componentCounter}`;
    }
  });

  return {
    service,
    current,
    revisionRows,
    orderSnapshots,
    recordedUsageEvents,
    seed,
    setFailUpdate(value: boolean) {
      failUpdate = value;
    },
    setInventoryChanged(value: boolean) {
      inventoryChanged = value;
    },
    setOrderPriceChanged(value: boolean) {
      orderPriceChanged = value;
    },
    setOrderInventoryChanged(value: boolean) {
      orderInventoryChanged = value;
    },
    catalog,
    getCreateAttempts() {
      return createAttempts;
    }
  };
}

const generateBody = {
  requestId: "request-generate",
  locale: "zh-CN",
  currency: "CNY" as const,
  wristCircumferenceMm: 155,
  emotionTags: ["calm"],
  styleTags: ["minimal"],
  colorTags: ["blue"],
  excludedProductIds: [],
  personalizationConsent: false
};

function tarotCandidateInput(harness: ReturnType<typeof createHarness>) {
  const materialIds = harness.catalog
    .filter((product) => product.productType === "MATERIAL")
    .map(({ id }) => id);
  return {
    actorId,
    request: { ...generateBody, requestId: "tarot-session-1:1" },
    candidate: {
      designName: "Tarot balanced direction",
      materialProductIds: Array.from(
        { length: 20 },
        (_, index) => materialIds[index % materialIds.length]!
      ),
      accessoryProductIds: [],
      designStory: "A reflective color rhythm built from the selected cards.",
      recommendationReasons: ["Uses a balanced visual rhythm."],
      culturalInspiration: [],
      sourceTemplateIds: [],
      providerMetadata: {
        modelProvider: "deterministic",
        modelName: "tarot-candidate-builder",
        promptVersion: "tarot-balanced-rank-1",
        knowledgeBaseVersion: "tarot-design-rules-v1",
        designTemplateVersion: "tarot-balanced-rank-1",
        tarotCandidate: {
          sessionId: "tarot-session-1",
          ruleVersion: "tarot-design-rules-v1",
          rank: 1,
          direction: "BALANCED" as const
        }
      }
    },
    designMode: "TAROT_GUIDED" as const,
    designId: "tarot-design-session-1-rules-v1-rank-1"
  };
}

function requestHeaders(
  owner = actorId,
  overrides: { audience?: string; expiresAtEpochSeconds?: number; issuer?: string } = {}
) {
  const token = signTestAccessToken(
    {
      subject: owner,
      issuer: overrides.issuer ?? authIssuer,
      audience: overrides.audience ?? authAudience,
      expiresAtEpochSeconds:
        overrides.expiresAtEpochSeconds ?? Math.floor(fixedNow.getTime() / 1000) + 3600
    },
    authSecret
  );
  return { authorization: `Bearer ${token}` };
}

test("generate creates a server-owned design and immutable revision 1", async () => {
  const harness = createHarness();
  const result = await harness.service.generate(actorId, generateBody);
  assert.equal(result.design.revision, 1);
  assert.match(result.design.designId, /^design-/);
  assert.equal(result.design.createdAt, fixedNow.toISOString());
  assert.equal(harness.revisionRows.get(result.design.designId)?.length, 1);
  assert.deepEqual(
    result.design.beads.map((bead) => bead.unitPriceMinor),
    [1200, 800, 1000]
  );
});

test("internal candidate generation persists TAROT_GUIDED mode and reuses its authority-fingerprinted design ID", async () => {
  const harness = createHarness();
  const input = tarotCandidateInput(harness);

  const first = await harness.service.generateFromCandidate(input);
  const retry = await harness.service.generateFromCandidate(input);

  assert.match(first.design.designId, /^tarot-design-[0-9a-f]{32}$/);
  assert.notEqual(first.design.designId, input.designId);
  assert.equal(first.design.designMode, "TAROT_GUIDED");
  assert.deepEqual(first.design.provenance.tarotCandidate, {
    sessionId: "tarot-session-1",
    ruleVersion: "tarot-design-rules-v1",
    rank: 1,
    direction: "BALANCED"
  });
  assert.equal(first.design.pricing.pricingVersion, "cny-retail-2026-07-v1");
  assert.deepEqual(retry, first);
  assert.equal(harness.current.size, 1);
  assert.equal(harness.getCreateAttempts(), 2);
});

test("internal TAROT_GUIDED generation rejects a candidate without immutable Tarot provenance", async () => {
  const harness = createHarness();
  const input = tarotCandidateInput(harness);
  const candidate = structuredClone(input.candidate);
  delete (candidate.providerMetadata as { tarotCandidate?: unknown }).tarotCandidate;

  await assert.rejects(
    () => harness.service.generateFromCandidate({ ...input, candidate }),
    (error: unknown) =>
      error instanceof DomainApiError && error.code === "VALIDATION_ERROR"
  );
  assert.equal(harness.current.size, 0);
});

test("deterministic candidate conflict rejects an existing design with a different product sequence", async () => {
  const harness = createHarness();
  const input = tarotCandidateInput(harness);
  const first = await harness.service.generateFromCandidate(input);
  const stored = harness.current.get(first.design.designId)!;
  const collidingSnapshot = structuredClone(stored.snapshot);
  collidingSnapshot.beads[0]!.beadProductId = collidingSnapshot.beads[1]!.beadProductId;
  stored.snapshot = DesignV1Schema.parse(collidingSnapshot);

  await assert.rejects(
    () => harness.service.generateFromCandidate(input),
    (error: unknown) => error instanceof DomainApiError && error.code === "CONFLICT"
  );
});

test("deterministic candidate conflict rejects an existing design with different provenance", async () => {
  const harness = createHarness();
  const input = tarotCandidateInput(harness);
  const first = await harness.service.generateFromCandidate(input);
  const stored = harness.current.get(first.design.designId)!;
  const collidingSnapshot = structuredClone(stored.snapshot);
  collidingSnapshot.provenance.knowledgeBaseVersion = "different-tarot-rules";
  stored.snapshot = DesignV1Schema.parse(collidingSnapshot);

  await assert.rejects(
    () => harness.service.generateFromCandidate(input),
    (error: unknown) => error instanceof DomainApiError && error.code === "CONFLICT"
  );
});

test("public generate rejects a client-supplied design mode", async () => {
  const harness = createHarness();
  const app = createApp({ designService: harness.service, authProvider });
  const response = await app.inject({
    method: "POST",
    url: "/api/design/generate",
    headers: requestHeaders(),
    payload: { ...generateBody, designMode: "TAROT_GUIDED" }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.equal(harness.current.size, 0);
  await app.close();
});

test("AI-generated two-material options remain distinct after pricing and persistence", async () => {
  const harness = createHarness(new AiRecommendationDesignAdapter());
  const excludedId = "product-aquamarine-round-8";
  const directions = ["airy-rhythm", "layered-contrast", "focal-balance"];
  const results = await Promise.all(directions.map((direction) =>
    harness.service.generate(actorId, {
      ...generateBody,
      requestId: `request-lifecycle-${direction}`,
      styleTags: ["minimal", "landscape", direction],
      colorTags: ["mist-blue"],
      excludedProductIds: [excludedId],
      minBudgetMinor: 29_900,
      maxBudgetMinor: 49_900
    })
  ));
  const sequences = results.map(({ design }) =>
    design.beads.map(({ beadProductId }) => beadProductId)
  );

  assert.equal(new Set(results.map(({ design }) => design.designId)).size, 3);
  assert.equal(new Set(sequences.map((sequence) => sequence.join("|"))).size, 3);
  assert.ok(sequences.every((sequence) => sequence.length === 12));
  assert.ok(sequences.every((sequence) => !sequence.includes(excludedId)));
  assert.ok(results.every(({ design }) =>
    design.revision === 1 &&
    design.provenance.modelProvider === "rule-based" &&
    harness.current.has(design.designId) &&
    harness.revisionRows.get(design.designId)?.length === 1
  ));
});

test("update applies finite operations, rebuilds positions, and detects conflicts", async () => {
  const harness = createHarness();
  const original = cloneDesign();
  harness.seed(original);
  const updated = await harness.service.update(actorId, {
    requestId: "request-update",
    designId: original.designId,
    expectedRevision: 1,
    operations: [
      {
        operation: "MOVE_COMPONENT",
        componentId: "bead-moonstone-1",
        targetPositionIndex: 0
      }
    ]
  });
  assert.equal(updated.design.revision, 2);
  assert.equal(updated.design.production.componentSequence[0], "bead-moonstone-1");
  assert.deepEqual(
    [...updated.design.beads, ...updated.design.accessories]
      .filter((item) => "positionIndex" in item && item.positionIndex !== null)
      .map((item) => item.positionIndex)
      .sort(),
    [0, 1, 2, 3]
  );
  await assert.rejects(
    () =>
      harness.service.update(actorId, {
        requestId: "stale",
        designId: original.designId,
        expectedRevision: 1,
        operations: [
          { operation: "REMOVE_COMPONENT", componentId: "bead-quartz-1" }
        ]
      }),
    (error: unknown) => error instanceof DomainApiError && error.code === "CONFLICT"
  );
  await assert.rejects(
    () =>
      harness.service.update(actorId, {
        requestId: "unknown-component",
        designId: original.designId,
        expectedRevision: 2,
        operations: [
          { operation: "REMOVE_COMPONENT", componentId: "component-does-not-exist" }
        ]
      }),
    /unknown componentId/
  );
});

test("update reprices add and remove operations before validating the next snapshot", async () => {
  const harness = createHarness();
  const original = cloneDesign();
  harness.seed(original);
  const source = original.beads[0]!;
  const addedComponentId = "bead-added-from-library";

  const added = await harness.service.update(actorId, {
    requestId: "request-add-component",
    designId: original.designId,
    expectedRevision: 1,
    operations: [
      {
        operation: "ADD_COMPONENT",
        component: {
          ...source,
          componentId: addedComponentId,
          positionIndex: 1,
          role: "MAIN"
        }
      }
    ]
  });
  assert.equal(added.design.beads.length, original.beads.length + 1);
  assert.equal(
    added.design.pricing.materialSubtotalMinor,
    original.pricing.materialSubtotalMinor + source.unitPriceMinor
  );

  const removed = await harness.service.update(actorId, {
    requestId: "request-remove-component",
    designId: original.designId,
    expectedRevision: 2,
    operations: [{ operation: "REMOVE_COMPONENT", componentId: addedComponentId }]
  });
  assert.equal(removed.design.beads.length, original.beads.length);
  assert.equal(removed.design.pricing.materialSubtotalMinor, original.pricing.materialSubtotalMinor);
});

test("invalid DTOs fail at the route boundary", async () => {
  const harness = createHarness();
  const app = createApp({ designService: harness.service, authProvider });
  const response = await app.inject({
    method: "POST",
    url: "/api/design/generate",
    headers: requestHeaders(),
    payload: { requestId: "invalid", currency: "CNY" }
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  await app.close();
});

test("price ignores forged client totals and reports catalog and inventory changes", async () => {
  const harness = createHarness();
  const forged = cloneDesign();
  forged.beads[0]!.unitPriceMinor += 9_999;
  forged.pricing.materialSubtotalMinor += 9_999;
  forged.pricing.totalPriceMinor += 9_999;
  const validatedForgery = DesignV1Schema.parse(forged);
  const repriced = await harness.service.price(actorId, {
    requestId: "price-forgery",
    currency: "CNY",
    design: validatedForgery
  });
  assert.equal(repriced.design.beads[0]!.unitPriceMinor, 1200);
  assert.equal(repriced.design.pricing.totalPriceMinor, 5500);
  assert.equal(repriced.warnings[0]?.code, "PRICE_CHANGED");

  harness.setInventoryChanged(true);
  const unavailable = await harness.service.price(actorId, {
    requestId: "inventory-change",
    currency: "CNY",
    design: cloneDesign()
  });
  assert.equal(unavailable.warnings.some(({ code }) => code === "INVENTORY_CHANGED"), true);
});

test("save ignores injected ownerId and uses actor context", async () => {
  const harness = createHarness();
  const design = cloneDesign();
  harness.seed(design);
  const app = createApp({ designService: harness.service, authProvider });
  const response = await app.inject({
    method: "POST",
    url: "/api/design/save",
    headers: { ...requestHeaders(), "x-actor-id": "forged-owner" },
    payload: { requestId: "save", ownerId: "forged-owner", design }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().design.designId, design.designId);
  assert.equal(harness.current.get(design.designId)?.ownerId, actorId);
  await app.close();
});

test("publish enforces ownership, consent, PASSED compliance, and public projection", async () => {
  const harness = createHarness();
  const design = cloneDesign();
  harness.seed(design);
  const app = createApp({ designService: harness.service, authProvider });
  const publishBody = {
    requestId: "publish",
    design,
    visibility: "PUBLIC",
    publishConsent: true,
    allowRemix: true,
    creatorDisplayMode: "DISPLAY_NAME"
  };
  const unauthorized = await app.inject({
    method: "POST",
    url: "/api/design/publish",
    headers: requestHeaders("different-actor"),
    payload: publishBody
  });
  assert.equal(unauthorized.statusCode, 403);
  assert.equal(unauthorized.json().error.code, "FORBIDDEN");

  const noConsent = await app.inject({
    method: "POST",
    url: "/api/design/publish",
    headers: requestHeaders(),
    payload: { ...publishBody, publishConsent: false }
  });
  assert.equal(noConsent.statusCode, 403);
  assert.equal(noConsent.json().error.code, "CONSENT_REQUIRED");

  const rejected = cloneDesign();
  rejected.compliance = {
    complianceStatus: "REJECTED",
    restrictedClaims: [
      {
        code: "BLOCKED_CLAIM",
        category: "GUARANTEED_FORTUNE_CHANGE",
        fieldPath: "story.designStory",
        severity: "HIGH",
        userVisibleMessage: "Blocked claim"
      }
    ],
    disclaimerKeys: [],
    reviewRequired: true
  };
  const rejectedResponse = await app.inject({
    method: "POST",
    url: "/api/design/publish",
    headers: requestHeaders(),
    payload: { ...publishBody, design: rejected }
  });
  assert.equal(rejectedResponse.statusCode, 403);
  assert.equal(rejectedResponse.json().error.code, "COMPLIANCE_BLOCKED");

  const published = await app.inject({
    method: "POST",
    url: "/api/design/publish",
    headers: requestHeaders(),
    payload: publishBody
  });
  assert.equal(published.statusCode, 200);
  assert.deepEqual(published.json().design.production.productionNotes, []);
  assert.equal(JSON.stringify(published.json()).includes("unitCostMinor"), false);
  await app.close();
});

test("order maps compliance, revision, price, and inventory failures", async () => {
  const harness = createHarness();
  const design = cloneDesign();
  harness.seed(design);
  const app = createApp({ designService: harness.service, authProvider });
  const body = {
    requestId: "order",
    design,
    expectedRevision: design.revision,
    expectedPricingVersion: design.pricing.pricingVersion,
    expectedTotalPriceMinor: design.pricing.totalPriceMinor
  };
  harness.setOrderPriceChanged(true);
  const price = await app.inject({
    method: "POST",
    url: "/api/orders/from-design",
    headers: requestHeaders(),
    payload: body
  });
  assert.equal(price.statusCode, 409);
  assert.equal(price.json().error.code, "PRICE_CHANGED");

  harness.setOrderPriceChanged(false);
  harness.setOrderInventoryChanged(true);
  const inventory = await app.inject({
    method: "POST",
    url: "/api/orders/from-design",
    headers: requestHeaders(),
    payload: body
  });
  assert.equal(inventory.statusCode, 409);
  assert.equal(inventory.json().error.code, "INVENTORY_CHANGED");

  const rejected = DesignV1Schema.parse({
    ...cloneDesign(),
    compliance: {
      complianceStatus: "REJECTED",
      restrictedClaims: [
        {
          code: "BLOCKED_CLAIM",
          category: "GUARANTEED_FORTUNE_CHANGE",
          fieldPath: "story.designStory",
          severity: "HIGH",
          userVisibleMessage: "Blocked claim"
        }
      ],
      disclaimerKeys: [],
      reviewRequired: true
    }
  });
  const rejectedOrder = await app.inject({
    method: "POST",
    url: "/api/orders/from-design",
    headers: requestHeaders(),
    payload: {
      ...body,
      design: rejected,
      expectedPricingVersion: rejected.pricing.pricingVersion,
      expectedTotalPriceMinor: rejected.pricing.totalPriceMinor
    }
  });
  assert.equal(rejectedOrder.statusCode, 403);
  assert.equal(rejectedOrder.json().error.code, "COMPLIANCE_BLOCKED");
  await app.close();
});

test("successful order snapshots remain immutable after later design changes", async () => {
  const harness = createHarness();
  const design = cloneDesign();
  harness.seed(design);
  const response = await harness.service.createOrder(actorId, {
    requestId: "order-success",
    design,
    expectedRevision: 1,
    expectedPricingVersion: design.pricing.pricingVersion,
    expectedTotalPriceMinor: design.pricing.totalPriceMinor
  });
  const capturedName = response.snapshot.design.designName;
  harness.current.get(design.designId)!.snapshot.designName = "Later mutable name";
  assert.equal(response.snapshot.design.designName, capturedName);
  assert.equal(harness.orderSnapshots[0]!.designName, capturedName);
});

test("failed update transaction leaves current design and revisions unchanged", async () => {
  const harness = createHarness();
  const design = cloneDesign();
  harness.seed(design);
  harness.setFailUpdate(true);
  await assert.rejects(() =>
    harness.service.update(actorId, {
      requestId: "rollback",
      designId: design.designId,
      expectedRevision: 1,
      operations: [
        { operation: "MOVE_COMPONENT", componentId: "bead-moonstone-1", targetPositionIndex: 0 }
      ]
    })
  );
  assert.equal(harness.current.get(design.designId)?.currentRevision, 1);
  assert.equal(harness.revisionRows.get(design.designId)?.length, 1);
});

test("GET design and revision history return owner-scoped public DTOs", async () => {
  const harness = createHarness();
  const design = cloneDesign();
  harness.seed(design);
  const app = createApp({ designService: harness.service, authProvider });
  const currentResponse = await app.inject({
    method: "GET",
    url: `/api/design/${design.designId}`,
    headers: requestHeaders()
  });
  const revisionsResponse = await app.inject({
    method: "GET",
    url: `/api/design/${design.designId}/revisions`,
    headers: requestHeaders()
  });
  assert.equal(currentResponse.statusCode, 200);
  assert.equal(currentResponse.json().designId, design.designId);
  assert.equal(revisionsResponse.json().revisions.length, 1);
  assert.equal(JSON.stringify(revisionsResponse.json()).includes("ownerId"), false);

  const forbiddenResponse = await app.inject({
    method: "GET",
    url: `/api/design/${design.designId}`,
    headers: requestHeaders("different-actor")
  });
  assert.equal(forbiddenResponse.statusCode, 403);
  assert.equal(forbiddenResponse.json().error.code, "FORBIDDEN");
  await app.close();
});

test("GET material catalog returns active public products without commercial costs", async () => {
  const harness = createHarness();
  const app = createApp({ designService: harness.service, authProvider });
  const response = await app.inject({
    method: "GET",
    url: "/api/catalog/materials?currency=CNY",
    headers: requestHeaders()
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().materials.length, 3);
  assert.equal(response.json().materials[0].crystalNameCn, "测试水晶 1");
  assert.deepEqual(response.json().materials[0].visualTags, ["translucent"]);
  assert.deepEqual(response.json().materials[0].styleTags, ["minimal"]);
  assert.deepEqual(response.json().materials[0].emotionTags, ["calm-aesthetic"]);
  assert.deepEqual(response.json().materials[0].cultureTags, ["design-inspiration-only"]);
  assert.equal(response.body.includes("unitCostMinor"), false);

  const invalidCurrency = await app.inject({
    method: "GET",
    url: "/api/catalog/materials?currency=USD",
    headers: requestHeaders()
  });
  assert.equal(invalidCurrency.statusCode, 400);
  assert.equal(invalidCurrency.json().error.code, "VALIDATION_ERROR");
  await app.close();
});

test("protected routes reject missing, invalid, expired, and wrong-audience credentials", async () => {
  const harness = createHarness();
  const app = createApp({ designService: harness.service, authProvider });

  for (const route of [
    { method: "POST" as const, url: "/api/design/generate" },
    { method: "POST" as const, url: "/api/design/update" },
    { method: "POST" as const, url: "/api/design/price" },
    { method: "POST" as const, url: "/api/design/save" },
    { method: "POST" as const, url: "/api/design/publish" },
    { method: "POST" as const, url: "/api/orders/from-design" },
    { method: "GET" as const, url: "/api/design/design-id" },
    { method: "GET" as const, url: "/api/design/design-id/revisions" },
    { method: "GET" as const, url: "/api/catalog/materials?currency=CNY" }
  ]) {
    const response = await app.inject(route);
    assert.equal(response.statusCode, 401, `${route.method} ${route.url}`);
    assert.equal(response.json().error.code, "UNAUTHORIZED");
  }

  const cases = [
    { name: "invalid", headers: { authorization: "Bearer secret-token-value" } },
    {
      name: "expired",
      headers: requestHeaders(actorId, {
        expiresAtEpochSeconds: Math.floor(fixedNow.getTime() / 1000) - 1
      })
    },
    {
      name: "wrong audience",
      headers: requestHeaders(actorId, { audience: "different-service" })
    },
    {
      name: "wrong issuer",
      headers: requestHeaders(actorId, { issuer: "https://attacker.example" })
    },
    { name: "x-actor-id only", headers: { "x-actor-id": actorId } }
  ];

  for (const credentialCase of cases) {
    const response = await app.inject({
      method: "POST",
      url: "/api/design/generate",
      headers: credentialCase.headers,
      payload: generateBody
    });
    assert.equal(response.statusCode, 401, credentialCase.name);
    assert.equal(response.json().error.code, "UNAUTHORIZED", credentialCase.name);
    assert.equal(response.body.includes("secret-token-value"), false, credentialCase.name);
  }
  await app.close();
});

test("generate, update, and save record knowledge usage lifecycle events", async () => {
  const harness = createHarness();
  const generated = await harness.service.generate(actorId, generateBody);
  const createdEvents = harness.recordedUsageEvents.filter(
    (event) => event.eventType === "design.created"
  );
  assert.equal(createdEvents.length, 1);
  assert.equal(createdEvents[0]!.actorId, actorId);
  assert.equal(createdEvents[0]!.designId, generated.design.designId);
  assert.equal(createdEvents[0]!.revisionNumber, 1);
  assert.equal(createdEvents[0]!.payload.source, "generate");
  assert.equal(createdEvents[0]!.payload.designMode, "AI_GENERATED");

  harness.recordedUsageEvents.length = 0;
  const original = cloneDesign();
  harness.seed(original);
  await harness.service.update(actorId, {
    requestId: "request-update-usage",
    designId: original.designId,
    expectedRevision: 1,
    operations: [
      {
        operation: "MOVE_COMPONENT",
        componentId: "bead-moonstone-1",
        targetPositionIndex: 0
      }
    ]
  });
  const updatedEvent = harness.recordedUsageEvents.find(
    (event) => event.eventType === "design.updated"
  );
  assert.ok(updatedEvent, "design.updated event is recorded");
  assert.equal(updatedEvent!.actorId, actorId);
  assert.equal(updatedEvent!.designId, original.designId);
  assert.equal(updatedEvent!.revisionNumber, 2);
  assert.deepEqual(updatedEvent!.payload.operationTypes, ["MOVE_COMPONENT"]);
  assert.equal(updatedEvent!.payload.previousRevision, 1);

  harness.recordedUsageEvents.length = 0;
  const snapshot = harness.current.get(original.designId)!.snapshot;
  const saved = await harness.service.save(actorId, {
    requestId: "request-save-usage",
    design: DesignV1Schema.parse(snapshot)
  });
  assert.equal(saved.design.revision, 2);
  const savedEvent = harness.recordedUsageEvents.find(
    (event) => event.eventType === "design.saved"
  );
  assert.ok(savedEvent, "design.saved event is recorded");
  assert.equal(savedEvent!.actorId, actorId);
  assert.equal(savedEvent!.designId, original.designId);
  assert.equal(savedEvent!.revisionNumber, 2);
  assert.equal(savedEvent!.payload.designMode, snapshot.designMode);
});
