import type { PublicDesignV1 } from "@mystcrag/design-contract";

export function resolveSelectedDesign(designs: PublicDesignV1[], selectedDesignId: string): PublicDesignV1 | null {
  return designs.find((design) => design.designId === selectedDesignId) ?? null;
}
