import { PersistenceError } from "../errors/persistence-errors.js";

export function minorToBigInt(value: number, fieldName: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PersistenceError(
      "VALIDATION_ERROR",
      `${fieldName} must be a non-negative safe integer`
    );
  }
  return BigInt(value);
}

export function bigintToMinor(value: bigint, fieldName: string): number {
  const converted = Number(value);
  if (!Number.isSafeInteger(converted) || BigInt(converted) !== value || converted < 0) {
    throw new PersistenceError(
      "DATA_INTEGRITY_ERROR",
      `${fieldName} is outside the non-negative JavaScript safe-integer range`
    );
  }
  return converted;
}
