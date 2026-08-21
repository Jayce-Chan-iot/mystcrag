import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import {
  AccessoryDimensionsSchema,
  AccessoryTypeSchema,
  BeadShapeSchema,
  CulturalInspirationSchema,
  DesignV1Schema,
  VisualProfileSchema,
  type CatalogMaterialProduct,
  toOrderSnapshot,
  toPublicDesign,
  type AccessoryV1,
  type BeadV1,
  type ContractWarning,
  type CreateOrderFromDesignRequest,
  type CreateOrderFromDesignResponse,
  type DesignV1,
  type GenerateDesignRequest,
  type GenerateDesignResponse,
  type ListCatalogMaterialsResponse,
  type PriceDesignRequest,
  type PriceDesignResponse,
  type PublishDesignRequest,
  type PublishDesignResponse,
  type SaveDesignRequest,
  type SaveDesignResponse,
  type UpdateDesignOperation,
  type UpdateDesignRequest,
  type UpdateDesignResponse
} from "@mystcrag/design-contract";
import { z } from "zod";

import { DomainApiError } from "../../contracts/api-error.js";

export type CatalogProduct = {
  id: string;
  productType: "MATERIAL" | "ACCESSORY";
  sku: string;
  name: string;
  currency: "CNY" | "TWD";
  unitPriceMinor: number;
  active: boolean;
  crystalId?: string;
  crystalNameCn?: string;
  crystalNameEn?: string;
  colorTags?: string[];
  shape?: string;
  diameterMm?: number;
  lengthAlongStringMm?: number | null;
  holeDiameterMm?: number | null;
  visualProfile?: unknown;
  materialKey?: string;
  accessoryType?: string;
  material?: string;
  finish?: string;
  dimensions?: unknown;
  modelAssetKey: string | null;
  textureAssetKey: string | null;
};

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

type StoredRevision = {
  id: string;
  designId: string;
  revisionNumber: number;
  snapshot: DesignV1;
  changeType: "CREATED" | "UPDATED" | "RESTORED" | "AI_OPTIMIZED";
  changeReason: string | null;
  createdBy: string;
  createdAt: Date;
};

type DesignStore = {
  createDesign(actorId: string, snapshot: DesignV1): Promise<StoredDesign>;
  getDesign(actorId: string, designId: string): Promise<StoredDesign>;
  getRevision(designId: string, revision: number): Promise<StoredRevision>;
  listDesignRevisions(actorId: string, designId: string): Promise<StoredRevision[]>;
  updateDesign(
    actorId: string,
    designId: string,
    expectedRevision: number,
    snapshot: DesignV1,
    changeReason: string
  ): Promise<StoredDesign>;
  saveDesign(actorId: string, designId: string, expectedRevision: number): Promise<StoredDesign>;
};
type CatalogStore = {
  getCatalogProducts(productIds: readonly string[]): Promise<CatalogProduct[]>;
  listActiveCatalogProducts(
    currency: "CNY" | "TWD",
    excludedProductIds?: readonly string[]
  ): Promise<CatalogProduct[]>;
};
type PriceStore = { recalculateDesignPrice(input: unknown): Promise<DesignV1> };
type InventoryStore = {
  validateAvailability(requirements: ReadonlyMap<string, number>): Promise<void>;
};
type PublicationStore = {
  publishDesign(
    actorId: string,
    designId: string,
    revision: number,
    options: {
      visibility: "UNLISTED" | "PUBLIC";
      publishConsent: true;
      allowRemix: boolean;
      creatorDisplayMode: "ANONYMOUS" | "DISPLAY_NAME";
    }
  ): Promise<{
    id: string;
    publishedAt: Date;
    design: ReturnType<typeof toPublicDesign>;
  }>;
};
type OrderStore = {
  createOrderFromDesign(
    actorId: string,
    designId: string,
    revision: number,
    expectedTotalPriceMinor: number,
    expectedPricingVersion: string
  ): Promise<{
    id: string;
    status: "PENDING" | "CONFIRMED" | "IN_PRODUCTION" | "SHIPPED" | "COMPLETED" | "CANCELLED";
    createdAt: Date;
    designSnapshot: DesignV1;
  }>;
};

const AiDesignCandidateSchema = z.strictObject({
  designName: z.string().trim().min(1).max(120),
  materialProductIds: z.array(z.string().min(1)).min(1),
  accessoryProductIds: z.array(z.string().min(1)),
  designStory: z.string().trim().min(1).max(2_000),
  recommendationReasons: z.array(z.string().trim().min(1).max(500)).min(1),
  culturalInspiration: z.array(CulturalInspirationSchema),
  sourceTemplateIds: z.array(z.string().trim().min(1)),
  providerMetadata: z.strictObject({
    modelProvider: z.string().trim().min(1),
    modelName: z.string().trim().min(1),
    promptVersion: z.string().trim().min(1),
    knowledgeBaseVersion: z.string().trim().min(1),
    designTemplateVersion: z.string().trim().min(1).nullable()
  })
});

export interface DesignGenerationAdapter {
  generate(request: GenerateDesignRequest, catalog: readonly CatalogProduct[]): Promise<unknown>;
}

export class MockDesignGenerationAdapter implements DesignGenerationAdapter {
  async generate(
    request: GenerateDesignRequest,
    catalog: readonly CatalogProduct[]
  ): Promise<unknown> {
    const materials = catalog.filter((product) => product.productType === "MATERIAL").slice(0, 3);
    const accessories = catalog.filter((product) => product.productType === "ACCESSORY").slice(0, 2);
    return {
      designName: "Rain After Blue",
      materialProductIds: materials.map(({ id }) => id),
      accessoryProductIds: accessories.map(({ id }) => id),
      designStory: "A balanced color rhythm inspired by the selected palette and style.",
      recommendationReasons: [
        `Uses ${request.styleTags[0] ?? "balanced"} styling as a visual design direction.`
      ],
      culturalInspiration: [],
      sourceTemplateIds: [],
      providerMetadata: {
        modelProvider: "mock",
        modelName: "explicit-development-mock",
        promptVersion: "mock-design-v1",
        knowledgeBaseVersion: "mock-catalog-v1",
        designTemplateVersion: null
      }
    };
  }
}

export type RevisionListResponse = {
  designId: string;
  revisions: Array<{
    revision: number;
    changeType: "CREATED" | "UPDATED" | "RESTORED" | "AI_OPTIMIZED";
    changeReason: string | null;
    createdAt: string;
    design: ReturnType<typeof toPublicDesign>;
  }>;
};

export interface DesignApiService {
  generate(actorId: string, request: GenerateDesignRequest): Promise<GenerateDesignResponse>;
  update(actorId: string, request: UpdateDesignRequest): Promise<UpdateDesignResponse>;
  price(actorId: string, request: PriceDesignRequest): Promise<PriceDesignResponse>;
  save(actorId: string, request: SaveDesignRequest): Promise<SaveDesignResponse>;
  get(actorId: string, designId: string): Promise<ReturnType<typeof toPublicDesign>>;
  materials(actorId: string, currency: "CNY" | "TWD"): Promise<ListCatalogMaterialsResponse>;
  revisions(actorId: string, designId: string): Promise<RevisionListResponse>;
  publish(actorId: string, request: PublishDesignRequest): Promise<PublishDesignResponse>;
  createOrder(
    actorId: string,
    request: CreateOrderFromDesignRequest
  ): Promise<CreateOrderFromDesignResponse>;
}

export type DesignApplicationDependencies = {
  designs: DesignStore;
  catalog: CatalogStore;
  pricing: PriceStore;
  inventory: InventoryStore;
  publications: PublicationStore;
  orders: OrderStore;
  generator: DesignGenerationAdapter;
  now?: () => Date;
  createId?: (prefix: string) => string;
};

function quantitiesByProduct(design: DesignV1): Map<string, number> {
  const quantities = new Map<string, number>();
  for (const bead of design.beads) {
    quantities.set(bead.beadProductId, (quantities.get(bead.beadProductId) ?? 0) + 1);
  }
  for (const accessory of design.accessories) {
    quantities.set(
      accessory.accessoryProductId,
      (quantities.get(accessory.accessoryProductId) ?? 0) + 1
    );
  }
  return quantities;
}

function rebuildDerived(input: DesignV1): DesignV1 {
  const ring = [
    ...input.beads,
    ...input.accessories.filter((item) => item.placementMode === "INLINE")
  ].sort((left, right) => left.positionIndex - right.positionIndex);
  const normalizedRing = ring.map((component, positionIndex) => ({
    ...component,
    positionIndex
  }));
  const beads = normalizedRing
    .filter((component): component is BeadV1 => "beadProductId" in component)
  const inlineAccessories = normalizedRing
    .filter((component): component is Extract<AccessoryV1, { placementMode: "INLINE" }> =>
      "accessoryProductId" in component
    );
  const anchoredAccessories = input.accessories.filter(
    (component): component is Extract<AccessoryV1, { placementMode: "ANCHORED" }> =>
      component.placementMode === "ANCHORED"
  );
  const accessories: AccessoryV1[] = [...inlineAccessories, ...anchoredAccessories];
  const allComponents = [...beads, ...accessories];
  const materialSubtotalMinor = beads.reduce(
    (total, bead) => total + bead.unitPriceMinor,
    0
  );
  const accessorySubtotalMinor = accessories.reduce(
    (total, accessory) => total + accessory.unitPriceMinor,
    0
  );
  const totalPriceMinor =
    materialSubtotalMinor +
    accessorySubtotalMinor +
    input.pricing.laborFeeMinor +
    input.pricing.designFeeMinor +
    input.pricing.packagingFeeMinor +
    input.pricing.platformFeeEstimateMinor +
    input.pricing.logisticsFeeEstimateMinor -
    input.pricing.discountMinor +
    input.pricing.adjustments.reduce((total, adjustment) => total + adjustment.amountMinor, 0);
  const billOfMaterials = allComponents.map((component) => {
    if ("beadProductId" in component) {
      return {
        productId: component.beadProductId,
        specification: `${component.shape} ${component.diameterMm}mm`,
        quantity: 1,
        sourceComponentIds: [component.componentId]
      };
    }
    const dimensions = Object.entries(component.dimensions)
      .map(([key, value]) => `${key}=${value}`)
      .join(", ");
    return {
      productId: component.accessoryProductId,
      specification: `${component.material} ${dimensions}`,
      quantity: 1,
      sourceComponentIds: [component.componentId]
    };
  });
  return DesignV1Schema.parse({
    ...input,
    bracelet: { ...input.bracelet, totalBeadCount: beads.length },
    beads,
    accessories,
    pricing: {
      ...input.pricing,
      materialSubtotalMinor,
      accessorySubtotalMinor,
      totalPriceMinor
    },
    production: {
      ...input.production,
      wristCircumferenceMm: input.bracelet.wristCircumferenceMm,
      billOfMaterials,
      componentSequence: normalizedRing.map(({ componentId }) => componentId),
      anchoredComponents: anchoredAccessories.map((component) => ({
        componentId: component.componentId,
        anchorComponentId: component.anchorComponentId,
        anchorSlot: component.anchorSlot
      }))
    }
  });
}

function requireAsset(value: string | null, productId: string, field: string): string {
  if (!value) {
    throw new DomainApiError(
      "INVENTORY_CHANGED",
      `Catalog product ${productId} is missing required ${field}.`
    );
  }
  return value;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function buildGeneratedDesign(
  request: GenerateDesignRequest,
  candidateInput: unknown,
  catalog: readonly CatalogProduct[],
  timestamp: string,
  designId: string,
  createComponentId: (prefix: string) => string
): DesignV1 {
  const candidate = AiDesignCandidateSchema.parse(candidateInput);
  const byId = new Map(catalog.map((product) => [product.id, product]));
  const materials = candidate.materialProductIds.map((productId) => {
    const product = byId.get(productId);
    if (!product || product.productType !== "MATERIAL" || product.currency !== request.currency) {
      throw new DomainApiError("INVENTORY_CHANGED", `Material ${productId} is unavailable.`);
    }
    return product;
  });
  const accessoryProducts = candidate.accessoryProductIds.map((productId) => {
    const product = byId.get(productId);
    if (!product || product.productType !== "ACCESSORY" || product.currency !== request.currency) {
      throw new DomainApiError("INVENTORY_CHANGED", `Accessory ${productId} is unavailable.`);
    }
    return product;
  });
  const beads: BeadV1[] = materials.map((product, positionIndex) => ({
    componentId: createComponentId("component"),
    positionIndex,
    beadProductId: product.id,
    crystalId: z.string().min(1).parse(product.crystalId),
    materialKey: z.string().min(1).parse(product.materialKey),
    shape: BeadShapeSchema.parse(product.shape),
    diameterMm: z.number().positive().parse(product.diameterMm),
    ...(product.lengthAlongStringMm === null || product.lengthAlongStringMm === undefined
      ? {}
      : { lengthAlongStringMm: product.lengthAlongStringMm }),
    quantity: 1,
    role: positionIndex === 0 ? "FOCAL" : "MAIN",
    modelAssetKey: requireAsset(product.modelAssetKey, product.id, "modelAssetKey"),
    textureAssetKey: requireAsset(product.textureAssetKey, product.id, "textureAssetKey"),
    unitPriceMinor: product.unitPriceMinor
  }));
  let inlineAccessoryIndex = 0;
  const accessories: AccessoryV1[] = accessoryProducts.map((product) => {
    const accessoryType = AccessoryTypeSchema.parse(product.accessoryType);
    const common = {
      componentId: createComponentId("component"),
      accessoryType,
      accessoryProductId: product.id,
      material: z.string().min(1).parse(product.material),
      finish: z.string().min(1).parse(product.finish),
      dimensions: AccessoryDimensionsSchema.parse(product.dimensions),
      quantity: 1 as const,
      unitPriceMinor: product.unitPriceMinor,
      modelAssetKey: requireAsset(product.modelAssetKey, product.id, "modelAssetKey"),
      ...(product.textureAssetKey ? { textureAssetKey: product.textureAssetKey } : {})
    };
    if (accessoryType === "PENDANT") {
      return {
        ...common,
        placementMode: "ANCHORED" as const,
        anchorComponentId: beads[0]!.componentId,
        anchorSlot: 0
      };
    }
    return {
      ...common,
      placementMode: "INLINE" as const,
      positionIndex: beads.length + inlineAccessoryIndex++
    };
  });
  const materialSubtotalMinor = beads.reduce((sum, item) => sum + item.unitPriceMinor, 0);
  const accessorySubtotalMinor = accessories.reduce(
    (sum, item) => sum + item.unitPriceMinor,
    0
  );
  const design = {
    schemaVersion: "1.0.0" as const,
    designId,
    designName: candidate.designName,
    designMode: "AI_GENERATED" as const,
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    locale: request.locale,
    currency: request.currency,
    bracelet: {
      wristCircumferenceMm: request.wristCircumferenceMm,
      targetInnerCircumferenceMm:
        request.targetInnerCircumferenceMm ?? request.wristCircumferenceMm + 7,
      elasticAllowanceMm: 7,
      braceletLayout: "CIRCLE" as const,
      beadGapMm: 0.4,
      totalBeadCount: beads.length
    },
    beads,
    accessories,
    story: {
      emotionTags: request.emotionTags,
      styleTags: request.styleTags,
      colorPalette: request.colorTags,
      culturalInspiration: candidate.culturalInspiration,
      designStory: candidate.designStory,
      recommendationReasons: candidate.recommendationReasons,
      sourceTemplateIds: candidate.sourceTemplateIds
    },
    pricing: {
      materialSubtotalMinor,
      accessorySubtotalMinor,
      laborFeeMinor: 0,
      designFeeMinor: 0,
      packagingFeeMinor: 0,
      platformFeeEstimateMinor: 0,
      logisticsFeeEstimateMinor: 0,
      discountMinor: 0,
      adjustments: [],
      totalPriceMinor: materialSubtotalMinor + accessorySubtotalMinor,
      pricingVersion: "catalog-pending",
      priceCalculatedAt: timestamp
    },
    production: {
      wristCircumferenceMm: request.wristCircumferenceMm,
      billOfMaterials: [],
      componentSequence: [],
      anchoredComponents: [],
      productionNotes: [],
      substitutionRules: []
    },
    compliance: {
      complianceStatus: "PASSED" as const,
      restrictedClaims: [],
      disclaimerKeys: [],
      reviewRequired: false
    },
    provenance: {
      generatedBy: "AI" as const,
      modelProvider: candidate.providerMetadata.modelProvider,
      modelName: candidate.providerMetadata.modelName,
      promptVersion: candidate.providerMetadata.promptVersion,
      knowledgeBaseVersion: candidate.providerMetadata.knowledgeBaseVersion,
      designTemplateVersion: candidate.providerMetadata.designTemplateVersion,
      pricingRuleVersion: "catalog-pending",
      sourceDesignId: null
    },
    community: {
      visibility: "PRIVATE" as const,
      publishConsent: false,
      allowRemix: false,
      creatorDisplayMode: "ANONYMOUS" as const
    }
  };
  const withEmptyDerivedPricing = {
    ...design,
    production: {
      ...design.production,
      billOfMaterials: [...beads, ...accessories].map((component) => ({
        productId:
          "beadProductId" in component
            ? component.beadProductId
            : component.accessoryProductId,
        specification: "Catalog item",
        quantity: 1,
        sourceComponentIds: [component.componentId]
      })),
      componentSequence: [
        ...beads,
        ...accessories.filter((item) => item.placementMode === "INLINE")
      ]
        .sort((left, right) => left.positionIndex - right.positionIndex)
        .map(({ componentId }) => componentId),
      anchoredComponents: accessories
        .filter((item) => item.placementMode === "ANCHORED")
        .map((item) => ({
          componentId: item.componentId,
          anchorComponentId: item.anchorComponentId,
          anchorSlot: item.anchorSlot
        }))
    }
  } as DesignV1;
  return rebuildDerived(withEmptyDerivedPricing);
}

function applyOperations(current: DesignV1, operations: readonly UpdateDesignOperation[]): DesignV1 {
  let ring: Array<BeadV1 | Extract<AccessoryV1, { placementMode: "INLINE" }>> = [
    ...current.beads,
    ...current.accessories.filter(
      (item): item is Extract<AccessoryV1, { placementMode: "INLINE" }> =>
        item.placementMode === "INLINE"
    )
  ].sort((left, right) => left.positionIndex - right.positionIndex);
  let anchored = current.accessories.filter(
    (item): item is Extract<AccessoryV1, { placementMode: "ANCHORED" }> =>
      item.placementMode === "ANCHORED"
  );

  const allIds = () => new Set([...ring, ...anchored].map(({ componentId }) => componentId));
  for (const operation of operations) {
    if (operation.operation === "MOVE_COMPONENT") {
      const index = ring.findIndex(({ componentId }) => componentId === operation.componentId);
      if (index < 0 || operation.targetPositionIndex >= ring.length) {
        throw new DomainApiError("VALIDATION_ERROR", "MOVE_COMPONENT references an invalid component or position.");
      }
      const [component] = ring.splice(index, 1);
      ring.splice(operation.targetPositionIndex, 0, component!);
      continue;
    }
    if (operation.operation === "REMOVE_COMPONENT") {
      if (!allIds().has(operation.componentId)) {
        throw new DomainApiError("VALIDATION_ERROR", "REMOVE_COMPONENT references an unknown componentId.");
      }
      if (anchored.some(({ anchorComponentId }) => anchorComponentId === operation.componentId)) {
        throw new DomainApiError("VALIDATION_ERROR", "Cannot remove a component that anchors an accessory.");
      }
      ring = ring.filter(({ componentId }) => componentId !== operation.componentId);
      anchored = anchored.filter(({ componentId }) => componentId !== operation.componentId);
      continue;
    }
    if (operation.operation === "ADD_COMPONENT") {
      if (allIds().has(operation.component.componentId)) {
        throw new DomainApiError("VALIDATION_ERROR", "ADD_COMPONENT componentId already exists.");
      }
      if ("beadProductId" in operation.component || operation.component.placementMode === "INLINE") {
        const target = Math.min(operation.component.positionIndex, ring.length);
        ring.splice(target, 0, operation.component);
      } else {
        anchored.push(operation.component);
      }
      continue;
    }
    if (operation.operation === "REPLACE_COMPONENT") {
      if (operation.replacement.componentId !== operation.componentId) {
        throw new DomainApiError("VALIDATION_ERROR", "Replacement must preserve componentId.");
      }
      const ringIndex = ring.findIndex(({ componentId }) => componentId === operation.componentId);
      const anchoredIndex = anchored.findIndex(
        ({ componentId }) => componentId === operation.componentId
      );
      if (ringIndex < 0 && anchoredIndex < 0) {
        throw new DomainApiError("VALIDATION_ERROR", "REPLACE_COMPONENT references an unknown componentId.");
      }
      const replacement = operation.replacement;
      if (ringIndex >= 0) ring.splice(ringIndex, 1);
      if (anchoredIndex >= 0) anchored.splice(anchoredIndex, 1);
      if ("beadProductId" in replacement || replacement.placementMode === "INLINE") {
        ring.splice(Math.max(0, ringIndex), 0, replacement);
      } else {
        anchored.push(replacement);
      }
      continue;
    }
  }
  const braceletOperation = [...operations]
    .reverse()
    .find((operation) => operation.operation === "UPDATE_BRACELET");
  const normalizedRing = ring.map((component, positionIndex) => ({
    ...component,
    positionIndex
  }));
  const beads = normalizedRing.filter((item): item is BeadV1 => "beadProductId" in item);
  if (beads.length === 0) {
    throw new DomainApiError("VALIDATION_ERROR", "A design must retain at least one bead.");
  }
  return rebuildDerived(
    {
      ...current,
      bracelet:
        braceletOperation?.operation === "UPDATE_BRACELET"
          ? { ...braceletOperation.bracelet, totalBeadCount: beads.length }
          : { ...current.bracelet, totalBeadCount: beads.length },
      beads,
      accessories: [
        ...normalizedRing.filter(
          (item): item is Extract<AccessoryV1, { placementMode: "INLINE" }> =>
            "accessoryProductId" in item
        ),
        ...anchored
      ],
      production: {
        ...current.production,
        wristCircumferenceMm:
          braceletOperation?.operation === "UPDATE_BRACELET"
            ? braceletOperation.bracelet.wristCircumferenceMm
            : current.bracelet.wristCircumferenceMm,
        billOfMaterials: [...normalizedRing, ...anchored].map((component) => ({
          productId:
            "beadProductId" in component
              ? component.beadProductId
              : component.accessoryProductId,
          specification: "Pending catalog validation",
          quantity: 1,
          sourceComponentIds: [component.componentId]
        })),
        componentSequence: normalizedRing.map(({ componentId }) => componentId),
        anchoredComponents: anchored.map((component) => ({
          componentId: component.componentId,
          anchorComponentId: component.anchorComponentId,
          anchorSlot: component.anchorSlot
        }))
      }
    } as DesignV1
  );
}

export class DesignApplicationService implements DesignApiService {
  private readonly generator: DesignGenerationAdapter;
  private readonly now: () => Date;
  private readonly createId: (prefix: string) => string;

  constructor(private readonly dependencies: DesignApplicationDependencies) {
    this.generator = dependencies.generator;
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? ((prefix) => `${prefix}-${randomUUID()}`);
  }

  async generate(
    actorId: string,
    request: GenerateDesignRequest
  ): Promise<GenerateDesignResponse> {
    const catalog = await this.dependencies.catalog.listActiveCatalogProducts(
      request.currency,
      request.excludedProductIds
    );
    const providerOutput = await this.generator.generate(request, catalog);
    const timestamp = this.now().toISOString();
    const draft = buildGeneratedDesign(
      request,
      providerOutput,
      catalog,
      timestamp,
      this.createId("design"),
      this.createId
    );
    const priced = DesignV1Schema.parse(
      await this.dependencies.pricing.recalculateDesignPrice(draft)
    );
    await this.dependencies.inventory.validateAvailability(quantitiesByProduct(priced));
    const persisted = await this.dependencies.designs.createDesign(actorId, priced);
    return { requestId: request.requestId, design: toPublicDesign(persisted.snapshot), warnings: [] };
  }

  async update(actorId: string, request: UpdateDesignRequest): Promise<UpdateDesignResponse> {
    const current = await this.dependencies.designs.getDesign(actorId, request.designId);
    if (current.currentRevision !== request.expectedRevision) {
      throw new DomainApiError("CONFLICT", "Design revision conflict");
    }
    const operated = applyOperations(current.snapshot, request.operations);
    const timestamp = this.now().toISOString();
    const next = DesignV1Schema.parse({
      ...(await this.dependencies.pricing.recalculateDesignPrice({
        ...operated,
        revision: request.expectedRevision + 1,
        updatedAt: timestamp
      })),
      revision: request.expectedRevision + 1,
      updatedAt: timestamp
    });
    await this.dependencies.inventory.validateAvailability(quantitiesByProduct(next));
    const persisted = await this.dependencies.designs.updateDesign(
      actorId,
      request.designId,
      request.expectedRevision,
      next,
      request.operations.map(({ operation }) => operation).join(",")
    );
    return { requestId: request.requestId, design: toPublicDesign(persisted.snapshot), warnings: [] };
  }

  async price(actorId: string, request: PriceDesignRequest): Promise<PriceDesignResponse> {
    void actorId;
    const priced = DesignV1Schema.parse(
      await this.dependencies.pricing.recalculateDesignPrice(request.design)
    );
    const warnings: ContractWarning[] = [];
    if (
      priced.pricing.totalPriceMinor !== request.design.pricing.totalPriceMinor ||
      priced.pricing.pricingVersion !== request.design.pricing.pricingVersion ||
      priced.beads.some(
        (bead, index) => bead.unitPriceMinor !== request.design.beads[index]?.unitPriceMinor
      ) ||
      priced.accessories.some(
        (item, index) =>
          item.unitPriceMinor !== request.design.accessories[index]?.unitPriceMinor
      )
    ) {
      warnings.push({ code: "PRICE_CHANGED", message: "Catalog pricing changed." });
    }
    try {
      await this.dependencies.inventory.validateAvailability(quantitiesByProduct(priced));
    } catch (error) {
      if (errorCode(error) === "INVENTORY_CHANGED") {
        warnings.push({
          code: "INVENTORY_CHANGED",
          message: error instanceof Error ? error.message : "Catalog inventory changed."
        });
      } else {
        throw error;
      }
    }
    return { requestId: request.requestId, design: toPublicDesign(priced), warnings };
  }

  async save(actorId: string, request: SaveDesignRequest): Promise<SaveDesignResponse> {
    const validated = DesignV1Schema.parse(request.design);
    const current = await this.dependencies.designs.getDesign(actorId, validated.designId);
    if (
      current.currentRevision !== validated.revision ||
      !isDeepStrictEqual(current.snapshot, validated)
    ) {
      throw new DomainApiError("CONFLICT", "Saved design does not match the current revision");
    }
    const saved = await this.dependencies.designs.saveDesign(
      actorId,
      validated.designId,
      validated.revision
    );
    return {
      requestId: request.requestId,
      design: toPublicDesign(saved.snapshot),
      warnings: [],
      savedAt: this.now().toISOString()
    };
  }

  async get(actorId: string, designId: string): Promise<ReturnType<typeof toPublicDesign>> {
    return toPublicDesign((await this.dependencies.designs.getDesign(actorId, designId)).snapshot);
  }

  async materials(
    actorId: string,
    currency: "CNY" | "TWD"
  ): Promise<ListCatalogMaterialsResponse> {
    void actorId;
    const catalog = await this.dependencies.catalog.listActiveCatalogProducts(currency);
    const materials: CatalogMaterialProduct[] = catalog.flatMap((product) => {
      if (
        product.productType !== "MATERIAL" ||
        !product.crystalId ||
        !product.shape ||
        product.diameterMm === undefined ||
        !product.materialKey ||
        !product.modelAssetKey ||
        !product.textureAssetKey
      ) {
        return [];
      }
      return [{
        beadProductId: product.id,
        sku: product.sku,
        displayName: product.name,
        crystalId: product.crystalId,
        crystalNameCn: product.crystalNameCn ?? product.name,
        crystalNameEn: product.crystalNameEn ?? product.name,
        colorTags: product.colorTags ?? [],
        materialKey: product.materialKey,
        shape: BeadShapeSchema.parse(product.shape),
        diameterMm: product.diameterMm,
        ...(product.lengthAlongStringMm === null || product.lengthAlongStringMm === undefined
          ? {}
          : { lengthAlongStringMm: product.lengthAlongStringMm }),
        ...(product.visualProfile
          ? { visualProfile: VisualProfileSchema.parse(product.visualProfile) }
          : {}),
        modelAssetKey: product.modelAssetKey,
        textureAssetKey: product.textureAssetKey,
        currency: product.currency,
        unitPriceMinor: product.unitPriceMinor
      }];
    });
    return { materials };
  }

  async revisions(actorId: string, designId: string): Promise<RevisionListResponse> {
    const revisions = await this.dependencies.designs.listDesignRevisions(actorId, designId);
    return {
      designId,
      revisions: revisions.map((revision) => ({
        revision: revision.revisionNumber,
        changeType: revision.changeType,
        changeReason: revision.changeReason,
        createdAt: revision.createdAt.toISOString(),
        design: toPublicDesign(revision.snapshot)
      }))
    };
  }

  async publish(
    actorId: string,
    request: PublishDesignRequest
  ): Promise<PublishDesignResponse> {
    if (!request.publishConsent) {
      throw new DomainApiError("CONSENT_REQUIRED", "Publication requires explicit consent.");
    }
    if (request.visibility === "PRIVATE") {
      throw new DomainApiError("VALIDATION_ERROR", "Private designs cannot be published.");
    }
    const publication = await this.dependencies.publications.publishDesign(
      actorId,
      request.design.designId,
      request.design.revision,
      {
        visibility: request.visibility,
        publishConsent: true,
        allowRemix: request.allowRemix,
        creatorDisplayMode: request.creatorDisplayMode
      }
    );
    return {
      requestId: request.requestId,
      design: publication.design,
      warnings: [],
      publicationId: publication.id,
      publishedAt: publication.publishedAt.toISOString()
    };
  }

  async createOrder(
    actorId: string,
    request: CreateOrderFromDesignRequest
  ): Promise<CreateOrderFromDesignResponse> {
    const order = await this.dependencies.orders.createOrderFromDesign(
      actorId,
      request.design.designId,
      request.expectedRevision,
      request.expectedTotalPriceMinor,
      request.expectedPricingVersion
    );
    return {
      requestId: request.requestId,
      design: toPublicDesign(order.designSnapshot),
      warnings: [],
      orderId: order.id,
      orderStatus: order.status === "CONFIRMED" ? "CONFIRMED" : "PENDING",
      snapshot: toOrderSnapshot(order.designSnapshot, order.createdAt.toISOString()),
      createdAt: order.createdAt.toISOString()
    };
  }
}
