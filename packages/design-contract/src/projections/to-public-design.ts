import type { DesignV1 } from "../schemas/design.schema";
import { InternalCommercialDesignV1Schema } from "../schemas/internal-commercial.schema";
import { PublicDesignV1Schema, type PublicDesignV1 } from "../schemas/public-design.schema";

export function toPublicDesign(input: unknown): PublicDesignV1 {
  const commercialResult = InternalCommercialDesignV1Schema.safeParse(input);
  if (commercialResult.success) {
    return PublicDesignV1Schema.parse(commercialResult.data.design);
  }

  return PublicDesignV1Schema.parse(input as DesignV1);
}
