import type { z } from "zod";

import { DomainApiError } from "../contracts/api-error.js";

export function validateResponse<TOutput>(
  schema: z.ZodType<TOutput>,
  input: unknown
): TOutput {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw new DomainApiError("INTERNAL_ERROR", "Response failed contract validation.");
}
