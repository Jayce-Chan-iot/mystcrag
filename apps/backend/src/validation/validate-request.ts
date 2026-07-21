import type { z } from "zod";

import { DomainApiError } from "../contracts/api-error.js";

export function validateRequest<TOutput>(
  schema: z.ZodType<TOutput>,
  input: unknown
): TOutput {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  throw new DomainApiError(
    "VALIDATION_ERROR",
    "Request body failed contract validation.",
    result.error.issues.map((issue) => ({
      fieldPath: issue.path.join("."),
      message: issue.message
    }))
  );
}
