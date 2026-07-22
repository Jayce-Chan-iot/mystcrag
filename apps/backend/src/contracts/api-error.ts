import { z } from "zod";

export const ApiErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "VALIDATION_ERROR",
  "NOT_IMPLEMENTED",
  "NOT_FOUND",
  "CONFLICT",
  "COMPLIANCE_BLOCKED",
  "CONSENT_REQUIRED",
  "INVENTORY_CHANGED",
  "PRICE_CHANGED",
  "INTERNAL_ERROR"
]);

export const ApiFieldErrorSchema = z.strictObject({
  fieldPath: z.string(),
  message: z.string().min(1)
});

export const ApiErrorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    fieldErrors: z.array(ApiFieldErrorSchema).optional(),
    requestId: z.string().min(1)
  })
});

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiFieldError = z.infer<typeof ApiFieldErrorSchema>;
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

const statusByCode: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  VALIDATION_ERROR: 400,
  NOT_IMPLEMENTED: 501,
  NOT_FOUND: 404,
  CONFLICT: 409,
  COMPLIANCE_BLOCKED: 403,
  CONSENT_REQUIRED: 403,
  INVENTORY_CHANGED: 409,
  PRICE_CHANGED: 409,
  INTERNAL_ERROR: 500
};

export class DomainApiError extends Error {
  readonly code: ApiErrorCode;
  readonly fieldErrors?: readonly ApiFieldError[];
  readonly statusCode: number;

  constructor(
    code: ApiErrorCode,
    message: string,
    fieldErrors?: readonly ApiFieldError[]
  ) {
    super(message);
    this.name = "DomainApiError";
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.statusCode = statusByCode[code];
  }
}

export function toApiErrorEnvelope(
  error: DomainApiError,
  requestId: string
): ApiErrorEnvelope {
  return ApiErrorEnvelopeSchema.parse({
    error: {
      code: error.code,
      message: error.message,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      requestId
    }
  });
}
