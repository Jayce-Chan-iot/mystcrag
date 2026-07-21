export type PersistenceErrorCode =
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "DATA_INTEGRITY_ERROR"
  | "COMPLIANCE_BLOCKED"
  | "CONSENT_REQUIRED"
  | "PRICE_CHANGED"
  | "INVENTORY_CHANGED";

export class PersistenceError extends Error {
  constructor(
    readonly code: PersistenceErrorCode,
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "PersistenceError";
  }
}

export function rethrowPersistenceError(error: unknown): never {
  if (error instanceof PersistenceError) throw error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (code === "P2002") {
    throw new PersistenceError("CONFLICT", "A persistence uniqueness conflict occurred", error);
  }
  if (code === "P2025") {
    throw new PersistenceError("NOT_FOUND", "The persisted record was not found", error);
  }
  throw new PersistenceError("DATA_INTEGRITY_ERROR", "The database operation failed", error);
}
