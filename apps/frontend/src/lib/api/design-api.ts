import {
  CloneDesignResponseSchema,
  CreateOrderFromDesignRequestSchema,
  CreateOrderFromDesignResponseSchema,
  DeleteDesignResponseSchema,
  EvaluateDesignResponseSchema,
  ListCatalogMaterialsResponseSchema,
  ListMyDesignsResponseSchema,
  ListMyOrdersResponseSchema,
  GenerateDesignRequestSchema,
  GenerateDesignResponseSchema,
  MaterialSuggestResponseSchema,
  OptimizeDesignRequestSchema,
  OptimizeDesignResponseSchema,
  PublicDesignV1Schema,
  RecommendDesignRequestSchema,
  RecommendDesignResponseSchema,
  SaveDesignRequestSchema,
  SaveDesignResponseSchema,
  PriceDesignRequestSchema,
  PriceDesignResponseSchema,
  UpdateDesignRequestSchema,
  UpdateDesignResponseSchema,
  type CloneDesignResponse,
  type CreateOrderFromDesignRequest,
  type CreateOrderFromDesignResponse,
  type CatalogMaterialProduct,
  type DeleteDesignResponse,
  type EvaluateDesignResponse,
  type GenerateDesignRequest,
  type GenerateDesignResponse,
  type ListCatalogMaterialsResponse,
  type MaterialSuggestResponse,
  type OptimizeDesignResponse,
  type ListMyDesignsResponse,
  type ListMyOrdersResponse,
  type PublicDesignV1,
  type RecommendDesignRequest,
  type RecommendDesignResponse,
  type SaveDesignRequest,
  type SaveDesignResponse,
  type PriceDesignResponse,
  type UpdateDesignOperation,
  type UpdateDesignRequest,
  type UpdateDesignResponse
} from "@mystcrag/design-contract";
import { FrontendApiError, type FrontendErrorCode } from "./frontend-api-error";
import { isMockApiEnabled } from "./api-runtime";
import {
  getMockDesign,
  MOCK_MATERIALS,
  mockGenerateDesigns,
  mockReplaceBead
} from "./mock-design-api";

type FetchLike = typeof fetch;
type RuntimeSchema<T> = {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
};

const SERVER_CODES = new Set<FrontendErrorCode>([
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PRICE_CHANGED",
  "INVENTORY_CHANGED",
  "COMPLIANCE_BLOCKED",
  "CONSENT_REQUIRED",
  "INTERNAL_ERROR"
]);

function requestId(prefix: string): string {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

async function parseError(response: Response): Promise<FrontendApiError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return new FrontendApiError("NETWORK_ERROR", `Backend returned HTTP ${response.status}.`);
  }
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "object" && error !== null) {
      const record = error as Record<string, unknown>;
      const code = typeof record.code === "string" && SERVER_CODES.has(record.code as FrontendErrorCode)
        ? record.code as FrontendErrorCode
        : "INTERNAL_ERROR";
      return new FrontendApiError(
        code,
        typeof record.message === "string" ? record.message : "Backend request failed.",
        typeof record.requestId === "string" ? record.requestId : undefined
      );
    }
  }
  return new FrontendApiError("INTERNAL_ERROR", `Backend returned HTTP ${response.status}.`);
}

async function callApi<T>(
  path: string,
  schema: RuntimeSchema<T>,
  options: { method?: "GET" | "POST"; body?: unknown },
  fetcher: FetchLike
): Promise<T> {
  // Authorization is handled by the BFF proxy using the Auth0 session cookie.
  let response: Response;
  try {
    response = await fetcher(path, {
      method: options.method ?? "POST",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: "no-store"
    });
  } catch (error) {
    throw new FrontendApiError("NETWORK_ERROR", error instanceof Error ? error.message : "Backend is unavailable.");
  }
  if (!response.ok) throw await parseError(response);
  const payload: unknown = await response.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new FrontendApiError("INTERNAL_ERROR", "Backend response did not match the public Design contract.");
  }
  return parsed.data;
}

export type DesignApiClientOptions = {
  fetcher?: FetchLike;
  accessToken?: string;
  useMock?: boolean;
};

export function createDesignApiClient({
  fetcher = fetch,
  useMock = isMockApiEnabled
}: DesignApiClientOptions = {}) {
  return {
    async generate(input: GenerateDesignRequest): Promise<GenerateDesignResponse> {
      const request = GenerateDesignRequestSchema.parse(input);
      if (useMock) {
        const response = (await mockGenerateDesigns(request))[0];
        if (!response) throw new FrontendApiError("AI_GENERATION_FAILED", "Mock provider returned no design.");
        return GenerateDesignResponseSchema.parse(response);
      }
      return callApi("/api/design/generate", GenerateDesignResponseSchema, { body: request }, fetcher);
    },

    async get(designId: string): Promise<PublicDesignV1> {
      if (useMock) {
        const design = getMockDesign(designId);
        if (!design) throw new FrontendApiError("NOT_FOUND", "Mock design not found.");
        return PublicDesignV1Schema.parse(design);
      }
      return callApi(`/api/design/${encodeURIComponent(designId)}`, PublicDesignV1Schema, { method: "GET" }, fetcher);
    },

    async materials(currency: PublicDesignV1["currency"]): Promise<ListCatalogMaterialsResponse> {
      if (useMock) {
        return ListCatalogMaterialsResponseSchema.parse({
          materials: MOCK_MATERIALS.map((material) => ({
            beadProductId: material.productId,
            sku: `MOCK-${material.id.toUpperCase()}`,
            displayName: material.name,
            crystalId: material.crystalId,
            crystalNameCn: material.name,
            crystalNameEn: material.id,
            mineralName: "Quartz",
            colorTags: [material.id],
            materialKey: material.materialKey,
            shape: "ROUND",
            diameterMm: 8,
            modelAssetKey: "sphere-round-8mm-v1",
            textureAssetKey: material.textureAssetKey,
            currency,
            unitPriceMinor: material.unitPriceMinor,
            availableQuantity: 100
          })),
          accessories: []
        });
      }
      return callApi(
        `/api/catalog/materials?currency=${encodeURIComponent(currency)}`,
        ListCatalogMaterialsResponseSchema,
        { method: "GET" },
        fetcher
      );
    },

    async listDesigns(): Promise<ListMyDesignsResponse> {
      if (useMock) {
        throw new FrontendApiError("VALIDATION_ERROR", "Mock mode does not fabricate design lists.");
      }
      return callApi("/api/designs", ListMyDesignsResponseSchema, { method: "GET" }, fetcher);
    },

    async listOrders(): Promise<ListMyOrdersResponse> {
      if (useMock) {
        throw new FrontendApiError("VALIDATION_ERROR", "Mock mode does not fabricate order lists.");
      }
      return callApi("/api/orders", ListMyOrdersResponseSchema, { method: "GET" }, fetcher);
    },

    async update(input: UpdateDesignRequest): Promise<UpdateDesignResponse> {
      const request = UpdateDesignRequestSchema.parse(input);
      if (useMock) {
        const operation = request.operations[0];
        if (!operation || operation.operation !== "REPLACE_COMPONENT" || !("beadProductId" in operation.replacement)) {
          throw new FrontendApiError("VALIDATION_ERROR", "Mock mode supports bead replacement only.");
        }
        const current = getMockDesign(request.designId);
        if (!current) throw new FrontendApiError("NOT_FOUND", "Mock design not found.");
        return mockReplaceBead({
          design: current,
          componentId: operation.componentId,
          materialId: operation.replacement.materialKey,
          expectedRevision: request.expectedRevision
        });
      }
      return callApi("/api/design/update", UpdateDesignResponseSchema, { body: request }, fetcher);
    },

    async price(design: PublicDesignV1): Promise<PriceDesignResponse> {
      const request = PriceDesignRequestSchema.parse({
        requestId: requestId("price"),
        currency: design.currency,
        design
      });
      if (useMock) {
        return PriceDesignResponseSchema.parse({ requestId: request.requestId, design, warnings: [] });
      }
      return callApi("/api/design/price", PriceDesignResponseSchema, { body: request }, fetcher);
    },

    async save(design: PublicDesignV1): Promise<SaveDesignResponse> {
      const request: SaveDesignRequest = SaveDesignRequestSchema.parse({ requestId: requestId("save"), design });
      if (useMock) {
        return SaveDesignResponseSchema.parse({ requestId: request.requestId, design, warnings: [], savedAt: new Date().toISOString() });
      }
      return callApi("/api/design/save", SaveDesignResponseSchema, { body: request }, fetcher);
    },

    async deleteDesign(designId: string, expectedRevision: number): Promise<DeleteDesignResponse> {
      if (useMock) {
        throw new FrontendApiError("VALIDATION_ERROR", "Mock mode does not fabricate design deletion.");
      }
      return callApi(
        "/api/design/delete",
        DeleteDesignResponseSchema,
        { body: { requestId: requestId("delete"), designId, expectedRevision } },
        fetcher
      );
    },

    async cloneDesign(designId: string, expectedRevision: number): Promise<CloneDesignResponse> {
      if (useMock) {
        throw new FrontendApiError("VALIDATION_ERROR", "Mock mode does not fabricate design cloning.");
      }
      return callApi(
        "/api/design/clone",
        CloneDesignResponseSchema,
        { body: { requestId: requestId("clone"), designId, expectedRevision } },
        fetcher
      );
    },

    async createOrder(design: PublicDesignV1): Promise<CreateOrderFromDesignResponse> {
      const request: CreateOrderFromDesignRequest = CreateOrderFromDesignRequestSchema.parse({
        requestId: requestId("order"),
        design,
        expectedRevision: design.revision,
        expectedPricingVersion: design.pricing.pricingVersion,
        expectedTotalPriceMinor: design.pricing.totalPriceMinor
      });
      if (useMock) {
        throw new FrontendApiError("VALIDATION_ERROR", "Mock mode does not fabricate order success.");
      }
      return callApi("/api/orders/from-design", CreateOrderFromDesignResponseSchema, { body: request }, fetcher);
    },

    async recommend(input: RecommendDesignRequest): Promise<RecommendDesignResponse> {
      const request = RecommendDesignRequestSchema.parse(input);
      if (useMock) {
        const generated = await mockGenerateDesigns({
          ...request,
          personalizationConsent: request.personalizationConsent
        });
        return RecommendDesignResponseSchema.parse({
          requestId: request.requestId,
          candidates: generated.slice(0, 3).map((response) => ({
            designId: response.design.designId,
            layoutStrategy: "SYMMETRIC_BALANCE" as const,
            score: {
              colorScore: 72,
              materialScore: 70,
              styleScore: 68,
              compositionScore: 74,
              constraintScore: 100,
              overallScore: 72,
              formulaVersion: "design-score-v1"
            },
            design: response.design
          })),
          warnings: []
        });
      }
      return callApi("/api/design/recommend", RecommendDesignResponseSchema, { body: request }, fetcher);
    },

    async evaluate(designId: string): Promise<EvaluateDesignResponse> {
      if (useMock) {
        throw new FrontendApiError("VALIDATION_ERROR", "Mock mode does not support design evaluation.");
      }
      return callApi(
        "/api/design/evaluate",
        EvaluateDesignResponseSchema,
        { body: { requestId: requestId("evaluate"), designId } },
        fetcher
      );
    },

    async optimize(
      design: PublicDesignV1,
      lockedComponentIds: readonly string[]
    ): Promise<OptimizeDesignResponse> {
      if (useMock) {
        throw new FrontendApiError("VALIDATION_ERROR", "Mock mode does not support design optimization.");
      }
      const request = OptimizeDesignRequestSchema.parse({
        requestId: requestId("optimize"),
        designId: design.designId,
        expectedRevision: design.revision,
        lockedComponentIds: [...lockedComponentIds]
      });
      return callApi("/api/design/optimize", OptimizeDesignResponseSchema, { body: request }, fetcher);
    },

    async suggestMaterials(
      materialId: string,
      currency: PublicDesignV1["currency"]
    ): Promise<MaterialSuggestResponse> {
      if (useMock) {
        return MaterialSuggestResponseSchema.parse({
          materialId,
          currency,
          suggestions: []
        });
      }
      return callApi(
        `/api/materials/${encodeURIComponent(materialId)}/suggest?currency=${encodeURIComponent(currency)}`,
        MaterialSuggestResponseSchema,
        { method: "GET" },
        fetcher
      );
    }
  };
}

export const designApi = createDesignApiClient();

export function createReplaceRequest(
  design: PublicDesignV1,
  componentId: string,
  replacement: PublicDesignV1["beads"][number]
): UpdateDesignRequest {
  const current = design.beads.find((bead) => bead.componentId === componentId);
  if (!current) throw new FrontendApiError("VALIDATION_ERROR", "Selected component is not a replaceable bead.");
  return UpdateDesignRequestSchema.parse({
    requestId: requestId("update"),
    designId: design.designId,
    expectedRevision: design.revision,
    operations: [{
      operation: "REPLACE_COMPONENT",
      componentId,
      replacement: {
        ...replacement,
        componentId,
        positionIndex: current.positionIndex,
        role: current.role,
        // The shared operation requires a schema-valid amount. Preserve the last
        // server amount only as transport context; Backend catalog repricing is authoritative.
        unitPriceMinor: current.unitPriceMinor
      }
    }]
  });
}

export function createOperationsRequest(
  design: PublicDesignV1,
  operations: UpdateDesignOperation[]
): UpdateDesignRequest {
  return UpdateDesignRequestSchema.parse({
    requestId: requestId("update"),
    designId: design.designId,
    expectedRevision: design.revision,
    operations
  });
}

export function createMoveRequest(
  design: PublicDesignV1,
  componentId: string,
  targetPositionIndex: number
): UpdateDesignRequest {
  const ringLength = design.production.componentSequence.length;
  if (!design.production.componentSequence.includes(componentId)) {
    throw new FrontendApiError("VALIDATION_ERROR", "Only a main-ring component can be moved.");
  }
  if (!Number.isInteger(targetPositionIndex) || targetPositionIndex < 0 || targetPositionIndex >= ringLength) {
    throw new FrontendApiError("VALIDATION_ERROR", "The target bracelet position is invalid.");
  }
  return createOperationsRequest(design, [{
    operation: "MOVE_COMPONENT",
    componentId,
    targetPositionIndex
  }]);
}

export function createAddRequest(
  design: PublicDesignV1,
  material: PublicDesignV1["beads"][number] | CatalogMaterialProduct,
  positionIndex: number,
  componentId = `component-${crypto.randomUUID()}`
): UpdateDesignRequest {
  const ringLength = design.production.componentSequence.length;
  const safePosition = Math.min(Math.max(0, positionIndex), ringLength);
  return createOperationsRequest(design, [{
    operation: "ADD_COMPONENT",
    component: {
      componentId,
      positionIndex: safePosition,
      beadProductId: material.beadProductId,
      crystalId: material.crystalId,
      materialKey: material.materialKey,
      shape: material.shape,
      diameterMm: material.diameterMm,
      ...(material.lengthAlongStringMm === undefined || material.lengthAlongStringMm === null
        ? {}
        : { lengthAlongStringMm: material.lengthAlongStringMm }),
      quantity: 1,
      role: "MAIN",
      modelAssetKey: material.modelAssetKey,
      textureAssetKey: material.textureAssetKey,
      unitPriceMinor: material.unitPriceMinor
    }
  }]);
}

export function createRemoveRequest(
  design: PublicDesignV1,
  componentId: string
): UpdateDesignRequest {
  if (!design.beads.some((bead) => bead.componentId === componentId)) {
    throw new FrontendApiError("VALIDATION_ERROR", "Only a bead can be removed from this editor.");
  }
  if (design.beads.length <= 1) {
    throw new FrontendApiError("VALIDATION_ERROR", "A bracelet must retain at least one bead.");
  }
  return createOperationsRequest(design, [{
    operation: "REMOVE_COMPONENT",
    componentId
  }]);
}

/**
 * Builds the inverse edit script of an optimization against the design state
 * the operations were generated from, so an applied optimization can be
 * undone through the same /api/design/update channel.
 */
export function invertOperations(
  design: PublicDesignV1,
  operations: readonly UpdateDesignOperation[]
): UpdateDesignOperation[] {
  const inverse: UpdateDesignOperation[] = [];
  for (const operation of [...operations].reverse()) {
    switch (operation.operation) {
      case "ADD_COMPONENT":
        inverse.push({ operation: "REMOVE_COMPONENT", componentId: operation.component.componentId });
        break;
      case "REMOVE_COMPONENT": {
        const bead = design.beads.find((item) => item.componentId === operation.componentId);
        if (bead) {
          inverse.push({ operation: "ADD_COMPONENT", component: bead });
          break;
        }
        const accessory = design.accessories.find((item) => item.componentId === operation.componentId);
        if (accessory?.placementMode === "INLINE") {
          inverse.push({ operation: "ADD_COMPONENT", component: accessory });
        }
        break;
      }
      case "MOVE_COMPONENT": {
        const position = design.production.componentSequence.indexOf(operation.componentId);
        if (position >= 0) {
          inverse.push({ operation: "MOVE_COMPONENT", componentId: operation.componentId, targetPositionIndex: position });
        }
        break;
      }
      case "REPLACE_COMPONENT": {
        const original =
          design.beads.find((item) => item.componentId === operation.componentId) ??
          design.accessories.find((item) => item.componentId === operation.componentId);
        if (original) {
          inverse.push({ operation: "REPLACE_COMPONENT", componentId: operation.componentId, replacement: original });
        }
        break;
      }
      case "UPDATE_BRACELET":
        inverse.push({ operation: "UPDATE_BRACELET", bracelet: design.bracelet });
        break;
    }
  }
  return inverse;
}
