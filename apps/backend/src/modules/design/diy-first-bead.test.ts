import assert from "node:assert/strict";
import test from "node:test";

import {
  DesignV1Schema,
  type CreateDiyFirstBeadRequest,
  type DesignV1
} from "@mystcrag/design-contract";

import { DomainApiError } from "../../contracts/api-error.js";
import {
  DesignApplicationService,
  type CatalogProduct
} from "./design-api.service.js";

const fixedNow = new Date("2026-07-21T10:00:00.000Z");
const actorId = "actor-owner";
const otherActorId = "different-actor";

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

function materialProduct(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: "product-aquamarine-round-8",
    productType: "MATERIAL",
    sku: "BEAD-AQUA-8",
    name: "海蓝宝圆珠 8mm",
    crystalId: "crystal-aquamarine",
    crystalNameCn: "海蓝宝",
    crystalNameEn: "Aquamarine",
    colorTags: ["blue"],
    visualTags: ["translucent"],
    styleTags: ["minimal"],
    emotionTags: ["calm-aesthetic"],
    cultureTags: ["design-inspiration-only"],
    shape: "ROUND",
    diameterMm: 8,
    materialKey: "aquamarine",
    modelAssetKey: "model-aquamarine-round-8",
    textureAssetKey: "texture-aquamarine-round-8",
    currency: "CNY",
    unitPriceMinor: 1200,
    active: true,
    ...overrides
  };
}

function request(overrides: Partial<CreateDiyFirstBeadRequest> = {}): CreateDiyFirstBeadRequest {
  return {
    requestId: "request-first-bead",
    beadProductId: "product-aquamarine-round-8",
    locale: "zh-CN",
    currency: "CNY",
    ...overrides
  };
}

function createHarness(options: { products?: CatalogProduct[]; available?: boolean } = {}) {
  const products = options.products ?? [materialProduct()];
  let available = options.available ?? true;
  const byId = new Map(products.map((product) => [product.id, product]));
  const designsById = new Map<string, PersistedDesign>();
  const requestIndex = new Map<string, string>();
  const requestFingerprints = new Map<string, string>();
  let priceLookups = 0;
  let stockChecks = 0;
  let createAttempts = 0;

  const requestKey = (owner: string, requestId: string) => `${owner}\u0000${requestId}`;

  const store = {
    async createDesign() {
      throw new Error("createDesign is not part of the first-bead flow");
    },
    async getDesign(owner: string, designId: string) {
      const design = designsById.get(designId);
      if (!design || design.ownerId !== owner) {
        throw new DomainApiError("NOT_FOUND", "Design not found");
      }
      return structuredClone(design);
    },
    async getRevision() {
      throw new Error("getRevision is not part of the first-bead flow");
    },
    async listDesignRevisions() {
      throw new Error("listDesignRevisions is not part of the first-bead flow");
    },
    async listDesigns(owner: string) {
      return [...designsById.values()]
        .filter((design) => design.ownerId === owner)
        .map((design) => structuredClone(design));
    },
    async updateDesign() {
      throw new Error("updateDesign is not part of the first-bead flow");
    },
    async saveDesign() {
      throw new Error("saveDesign is not part of the first-bead flow");
    },
    async softDeleteDesign() {
      throw new Error("softDeleteDesign is not part of the first-bead flow");
    },
    async findFirstBeadByRequest(owner: string, requestId: string, fingerprint: string) {
      const key = requestKey(owner, requestId);
      const designId = requestIndex.get(key);
      if (!designId) return null;
      if (requestFingerprints.get(key) !== fingerprint) {
        throw new DomainApiError(
          "CONFLICT",
          "The creation request key was already used with different parameters"
        );
      }
      return structuredClone(designsById.get(designId)!);
    },
    async createFirstBeadIdempotently(
      owner: string,
      requestId: string,
      fingerprint: string,
      snapshot: DesignV1
    ) {
      createAttempts += 1;
      const key = requestKey(owner, requestId);
      const existingId = requestIndex.get(key);
      if (existingId) {
        if (requestFingerprints.get(key) !== fingerprint) {
          throw new DomainApiError(
            "CONFLICT",
            "The creation request key was already used with different parameters"
          );
        }
        return structuredClone(designsById.get(existingId)!);
      }
      const stored: PersistedDesign = {
        id: snapshot.designId,
        ownerId: owner,
        currentRevision: 1,
        status: "DRAFT",
        snapshot: structuredClone(snapshot),
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null
      };
      designsById.set(snapshot.designId, stored);
      requestIndex.set(key, snapshot.designId);
      requestFingerprints.set(key, fingerprint);
      return structuredClone(stored);
    }
  };

  const service = new DesignApplicationService({
    generator: {
      async generate() {
        throw new Error("The AI generator is not part of the first-bead flow");
      }
    },
    designs: store,
    catalog: {
      async getCatalogProducts(ids: readonly string[]) {
        return products.filter((product) => ids.includes(product.id)).map((product) => ({ ...product }));
      },
      async listActiveCatalogProducts(currency: "CNY" | "TWD") {
        return products
          .filter((product) => product.currency === currency && product.active)
          .map((product) => ({ ...product }));
      },
      async listAvailableCatalogMaterialProducts() {
        return [];
      },
      async listAvailableCatalogAccessoryProducts() {
        return [];
      }
    },
    pricing: {
      async recalculateDesignPrice(input: unknown) {
        priceLookups += 1;
        const design = DesignV1Schema.parse(input);
        const beads = design.beads.map((bead) => ({
          ...bead,
          unitPriceMinor: byId.get(bead.beadProductId)!.unitPriceMinor
        }));
        const materialSubtotalMinor = beads.reduce((total, bead) => total + bead.unitPriceMinor, 0);
        const pricingValue = {
          ...design.pricing,
          materialSubtotalMinor,
          accessorySubtotalMinor: 0,
          pricingVersion: "cny-retail-2026-07-v1",
          priceCalculatedAt: fixedNow.toISOString(),
          totalPriceMinor: materialSubtotalMinor
        };
        return DesignV1Schema.parse({
          ...design,
          beads,
          pricing: pricingValue,
          provenance: { ...design.provenance, pricingRuleVersion: pricingValue.pricingVersion }
        });
      }
    },
    inventory: {
      async validateAvailability() {
        stockChecks += 1;
        if (!available) {
          throw new DomainApiError("INVENTORY_CHANGED", "Catalog inventory changed");
        }
      }
    },
    publications: {
      async publishDesign() {
        throw new Error("publishDesign is not part of the first-bead flow");
      }
    },
    orders: {
      async createOrderFromDesign() {
        throw new Error("createOrderFromDesign is not part of the first-bead flow");
      },
      async listOrders() {
        return [];
      }
    },
    now: () => fixedNow,
    createId: (prefix: string) => `${prefix}-${designsById.size + 1}`
  });

  return {
    service,
    products,
    designsById,
    getPriceLookups: () => priceLookups,
    getStockChecks: () => stockChecks,
    getCreateAttempts: () => createAttempts,
    setAvailable(value: boolean) {
      available = value;
    }
  };
}

test("first bead creates exactly one private DIY_CREATED revision-1 design from the selected SKU", async () => {
  const harness = createHarness();
  const result = await harness.service.createDiyFirstBead(actorId, request());

  assert.equal(result.requestId, "request-first-bead");
  assert.equal(result.design.revision, 1);
  assert.equal(result.design.designMode, "DIY_CREATED");
  assert.equal(result.design.community.visibility, "PRIVATE");
  assert.equal(result.design.beads.length, 1);
  assert.equal(result.design.accessories.length, 0);
  assert.equal(result.design.beads[0]!.beadProductId, "product-aquamarine-round-8");
  assert.equal(result.design.beads[0]!.unitPriceMinor, 1200);
  assert.equal(result.design.pricing.pricingVersion, "cny-retail-2026-07-v1");
  assert.equal(result.design.provenance.generatedBy, "USER");
  assert.equal(harness.designsById.size, 1);
});

test("a replayed request returns the original design without re-pricing or re-checking stock", async () => {
  const harness = createHarness();
  const first = await harness.service.createDiyFirstBead(actorId, request());

  harness.products[0]!.unitPriceMinor = 999_999;
  harness.setAvailable(false);

  const replay = await harness.service.createDiyFirstBead(actorId, request());

  assert.equal(replay.design.designId, first.design.designId);
  assert.deepEqual(replay.design.pricing, first.design.pricing);
  assert.equal(replay.design.beads[0]!.unitPriceMinor, 1200);
  assert.equal(harness.getPriceLookups(), 1);
  assert.equal(harness.getStockChecks(), 1);
  assert.equal(harness.designsById.size, 1);
});

test("reusing a request key with a different bead conflicts", async () => {
  const harness = createHarness({
    products: [
      materialProduct(),
      materialProduct({
        id: "product-moonstone-round-8",
        sku: "BEAD-MOON-8",
        name: "月光石圆珠 8mm",
        crystalId: "crystal-moonstone",
        crystalNameCn: "月光石",
        crystalNameEn: "Moonstone",
        materialKey: "moonstone",
        modelAssetKey: "model-moonstone-round-8",
        textureAssetKey: "texture-moonstone-round-8",
        unitPriceMinor: 1500
      })
    ]
  });
  await harness.service.createDiyFirstBead(actorId, request());

  await assert.rejects(
    harness.service.createDiyFirstBead(actorId, request({ beadProductId: "product-moonstone-round-8" })),
    (error: unknown) => error instanceof DomainApiError && error.code === "CONFLICT"
  );
  assert.equal(harness.designsById.size, 1);
});

test("a delisted bead is rejected without persisting a draft", async () => {
  const harness = createHarness({ products: [materialProduct({ active: false })] });

  await assert.rejects(
    harness.service.createDiyFirstBead(actorId, request()),
    (error: unknown) => error instanceof DomainApiError && error.code === "INVENTORY_CHANGED"
  );
  assert.equal(harness.designsById.size, 0);
});

test("a zero-stock bead is rejected without persisting a draft", async () => {
  const harness = createHarness({ available: false });

  await assert.rejects(
    harness.service.createDiyFirstBead(actorId, request()),
    (error: unknown) => error instanceof DomainApiError && error.code === "INVENTORY_CHANGED"
  );
  assert.equal(harness.designsById.size, 0);
});

test("a currency mismatch is rejected without persisting a draft", async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.service.createDiyFirstBead(actorId, request({ currency: "TWD" })),
    (error: unknown) => error instanceof DomainApiError && error.code === "INVENTORY_CHANGED"
  );
  assert.equal(harness.designsById.size, 0);
});

test("concurrent double-click retries collapse to one design", async () => {
  const harness = createHarness();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => harness.service.createDiyFirstBead(actorId, request()))
  );

  assert.equal(new Set(results.map(({ design }) => design.designId)).size, 1);
  assert.equal(harness.designsById.size, 1);
});

test("different actors never share a design for the same request key", async () => {
  const harness = createHarness();
  const owner = await harness.service.createDiyFirstBead(actorId, request());
  const other = await harness.service.createDiyFirstBead(otherActorId, request());

  assert.notEqual(owner.design.designId, other.design.designId);
  assert.equal(harness.designsById.size, 2);
});
