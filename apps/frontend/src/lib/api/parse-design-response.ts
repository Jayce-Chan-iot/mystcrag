import {
  GenerateDesignResponseSchema,
  type GenerateDesignResponse
} from "@mystcrag/design-contract";

export function parseGenerateDesignResponse(payload: unknown): GenerateDesignResponse {
  return GenerateDesignResponseSchema.parse(payload);
}
