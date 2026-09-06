import type {
  AssetImportErrorCode,
  AssetImportFieldError,
  AssetImportTransportErrorCode
} from "@mystcrag/design-contract";
import {
  ASSET_IMPORT_ERROR_CATALOG,
  ASSET_IMPORT_ERROR_TRANSPORT_CODES,
  ASSET_IMPORT_TRANSPORT_STATUS_BY_CODE,
  AssetImportErrorEnvelopeSchema
} from "@mystcrag/design-contract";
import { ArchiveStoreError } from "@mystcrag/asset-pipeline";
import { PersistenceError } from "@mystcrag/database";
import { ZodError } from "zod";

export class AssetImportApiError extends Error {
  constructor(
    readonly transportCode: AssetImportTransportErrorCode,
    message: string,
    readonly assetCode?: AssetImportErrorCode,
    readonly fieldErrors?: readonly AssetImportFieldError[]
  ) {
    super(message);
    this.name = "AssetImportApiError";
  }

  get statusCode(): number {
    return ASSET_IMPORT_TRANSPORT_STATUS_BY_CODE[this.transportCode];
  }
}

function errorChainHasCode(error: unknown, expectedCode: string): boolean {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 8 && typeof current === "object" && current !== null; depth += 1) {
    if (seen.has(current)) return false;
    seen.add(current);
    if ("code" in current && (current as { code?: unknown }).code === expectedCode) return true;
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

export function normalizeAssetImportError(error: unknown): AssetImportApiError {
  if (error instanceof AssetImportApiError) return error;
  const frameworkStatus = typeof error === "object" && error !== null && "statusCode" in error
    ? (error as { statusCode?: unknown }).statusCode
    : undefined;
  if (frameworkStatus === 400) {
    return new AssetImportApiError("VALIDATION_ERROR", "Request failed contract validation.");
  }
  if (frameworkStatus === 413) {
    return new AssetImportApiError("PAYLOAD_TOO_LARGE", "The upload exceeds the allowed byte limit.");
  }
  if (error instanceof ZodError) {
    return new AssetImportApiError(
      "VALIDATION_ERROR",
      "Request failed contract validation.",
      undefined,
      error.issues.map((issue) => ({
        fieldPath: issue.path.join(".") || "request",
        message: issue.message
      }))
    );
  }
  if (error instanceof PersistenceError) {
    if (error.code === "NOT_FOUND") {
      return new AssetImportApiError("NOT_FOUND", "The requested asset import resource was not found.");
    }
    if (error.code === "CONFLICT" || error.code === "PRICE_CHANGED" || error.code === "INVENTORY_CHANGED") {
      return new AssetImportApiError("CONFLICT", "The asset import operation conflicts with current state.");
    }
    if (error.code === "VALIDATION_ERROR") {
      return new AssetImportApiError("VALIDATION_ERROR", "Request failed contract validation.");
    }
    if (error.code === "COMPLIANCE_BLOCKED" || error.code === "CONSENT_REQUIRED") {
      return new AssetImportApiError(
        "UNPROCESSABLE_ENTITY",
        "The asset import operation is not eligible in its current review state.",
        error.code === "CONSENT_REQUIRED" ? "MISSING_REFERENCE" : "DRAFT_INCOMPLETE"
      );
    }
    return new AssetImportApiError("INTERNAL_ERROR", "The asset import operation failed unexpectedly.");
  }
  if (error instanceof ArchiveStoreError) {
    if (error.code === "PAYLOAD_TOO_LARGE") {
      return new AssetImportApiError("PAYLOAD_TOO_LARGE", "The upload exceeds the allowed byte limit.");
    }
    if (error.code === "HASH_MISMATCH" || error.code === "SIZE_MISMATCH") {
      return new AssetImportApiError(
        "CONFLICT",
        "The staged upload could not be verified.",
        "ARCHIVE_VERIFICATION_FAILED"
      );
    }
    if (error.code === "KEY_EXISTS_CONTENT_MISMATCH") {
      return new AssetImportApiError("CONFLICT", "The archive contains conflicting content.", "ARCHIVE_CONFLICT");
    }
    if (error.code === "WRITE_FAILED" && errorChainHasCode(error, "ENOSPC")) {
      return new AssetImportApiError("INTERNAL_ERROR", "The archive does not have enough free space.", "STORAGE_FULL");
    }
  }
  return new AssetImportApiError("INTERNAL_ERROR", "The asset import operation failed unexpectedly.");
}

export function assetImportErrorEnvelope(error: AssetImportApiError, requestId: string) {
  const guidance = error.assetCode === undefined ? undefined : ASSET_IMPORT_ERROR_CATALOG[error.assetCode];
  return AssetImportErrorEnvelopeSchema.parse({
    error: {
      code: error.transportCode,
      message: error.message,
      ...(error.assetCode === undefined ? {} : {
        assetCode: error.assetCode,
        retryable: guidance!.retryable,
        recoveryAction: guidance!.recoveryAction
      }),
      ...(error.fieldErrors === undefined ? {} : { fieldErrors: error.fieldErrors }),
      requestId
    }
  });
}

export function assertAssetErrorPair(error: AssetImportApiError): void {
  if (
    error.assetCode !== undefined &&
    ASSET_IMPORT_ERROR_TRANSPORT_CODES[error.assetCode] !== error.transportCode
  ) {
    throw new Error("Asset error transport mapping is invalid.");
  }
}
