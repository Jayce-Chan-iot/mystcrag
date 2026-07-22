import {
  GenerateDesignRequestSchema,
  GenerateDesignResponseSchema,
  PublicDesignV1Schema,
  UpdateDesignResponseSchema,
  type GenerateDesignRequest,
  type GenerateDesignResponse,
  type PublicDesignV1,
  type UpdateDesignResponse
} from "@mystcrag/design-contract";

import { mockDesignOptions } from "../../features/design/fixtures/mock-design-options";
import { FrontendApiError } from "./frontend-api-error";

export type MockMaterial = {
  id: string;
  name: string;
  note: string;
  color: string;
  productId: string;
  crystalId: string;
  materialKey: string;
  textureAssetKey: string;
  unitPriceMinor: number;
};

export const MOCK_MATERIALS: MockMaterial[] = [
  { id: "aquamarine", name: "海蓝宝", note: "清透雾蓝 · 8mm", color: "#9fcbd5", productId: "product-aquamarine-round-8", crystalId: "crystal-aquamarine", materialKey: "aquamarine-clear-v1", textureAssetKey: "aquamarine-clear-texture-v1", unitPriceMinor: 2400 },
  { id: "moonstone", name: "月光石", note: "柔白虹光 · 8mm", color: "#e9e6de", productId: "product-moonstone-round-8", crystalId: "crystal-moonstone", materialKey: "moonstone-soft-v1", textureAssetKey: "moonstone-soft-texture-v1", unitPriceMinor: 2200 },
  { id: "amethyst", name: "紫水晶", note: "浅暮紫 · 8mm", color: "#a995bb", productId: "product-amethyst-round-8", crystalId: "crystal-amethyst", materialKey: "amethyst-mist-v1", textureAssetKey: "amethyst-mist-texture-v1", unitPriceMinor: 2800 },
  { id: "smoky", name: "烟晶", note: "温柔烟褐 · 8mm", color: "#8c817b", productId: "product-smoky-quartz-round-8", crystalId: "crystal-smoky-quartz", materialKey: "smoky-quartz-v1", textureAssetKey: "smoky-quartz-texture-v1", unitPriceMinor: 2100 }
];

const wait = async () => new Promise<void>((resolve) => setTimeout(resolve, 180));
const mockDesignStore = new Map(mockDesignOptions.map((design) => [design.designId, structuredClone(design)]));

export async function mockGenerateDesigns(input: GenerateDesignRequest): Promise<GenerateDesignResponse[]> {
  await wait();
  const request = GenerateDesignRequestSchema.parse(input);
  return mockDesignOptions.map((design, index) => {
    const response = GenerateDesignResponseSchema.parse({
    requestId: `${request.requestId}-${index + 1}`,
    design: PublicDesignV1Schema.parse({
      ...design,
      bracelet: { ...design.bracelet, wristCircumferenceMm: request.wristCircumferenceMm },
      production: { ...design.production, wristCircumferenceMm: request.wristCircumferenceMm }
    }),
    warnings: []
    });
    mockDesignStore.set(response.design.designId, structuredClone(response.design));
    return response;
  });
}

export async function mockGetDesignOptions(sessionId: string): Promise<PublicDesignV1[]> {
  await wait();
  if (sessionId === "empty") return [];
  if (sessionId === "network-error") throw new FrontendApiError("NETWORK_ERROR", "Mock network unavailable");
  if (sessionId === "ai-failed") throw new FrontendApiError("AI_GENERATION_FAILED", "Mock AI generation failed");
  if (sessionId === "compliance-blocked") throw new FrontendApiError("COMPLIANCE_BLOCKED", "Mock compliance block");
  return mockDesignOptions.map((design) => structuredClone(design));
}

export function getMockDesign(designId: string): PublicDesignV1 | null {
  const design = mockDesignStore.get(designId);
  return design ? structuredClone(design) : null;
}

export async function mockReplaceBead({
  design,
  componentId,
  materialId,
  expectedRevision
}: {
  design: PublicDesignV1;
  componentId: string;
  materialId: string;
  expectedRevision: number;
}): Promise<UpdateDesignResponse> {
  await wait();
  if (expectedRevision !== design.revision) throw new FrontendApiError("CONFLICT", "Stale design revision");
  const material = MOCK_MATERIALS.find((item) => item.id === materialId || item.materialKey === materialId || item.productId === materialId);
  if (!material) throw new FrontendApiError("INVENTORY_CHANGED", "Material is no longer available");
  const current = design.beads.find((bead) => bead.componentId === componentId);
  if (!current) throw new FrontendApiError("VALIDATION_ERROR", "Selected component is not replaceable");

  const priceDifference = material.unitPriceMinor - current.unitPriceMinor;
  const now = new Date(Math.max(Date.now(), Date.parse(design.updatedAt) + 1)).toISOString();
  const updated = PublicDesignV1Schema.parse({
    ...design,
    revision: design.revision + 1,
    updatedAt: now,
    beads: design.beads.map((bead) => bead.componentId === componentId ? {
      ...bead,
      beadProductId: material.productId,
      crystalId: material.crystalId,
      materialKey: material.materialKey,
      textureAssetKey: material.textureAssetKey,
      unitPriceMinor: material.unitPriceMinor
    } : bead),
    pricing: {
      ...design.pricing,
      materialSubtotalMinor: design.pricing.materialSubtotalMinor + priceDifference,
      totalPriceMinor: design.pricing.totalPriceMinor + priceDifference,
      priceCalculatedAt: now
    },
    production: {
      ...design.production,
      billOfMaterials: design.production.billOfMaterials.map((item) => item.sourceComponentIds.includes(componentId) ? {
        ...item,
        productId: material.productId,
        specification: `ROUND ${current.diameterMm}mm`
      } : item)
    }
  });

  const response = UpdateDesignResponseSchema.parse({
    requestId: `replace-${componentId}-${updated.revision}`,
    design: updated,
    warnings: priceDifference === 0 ? [] : [{ code: "PRICE_CHANGED", message: "Server mock recalculated the design price." }]
  });
  mockDesignStore.set(response.design.designId, structuredClone(response.design));
  return response;
}
