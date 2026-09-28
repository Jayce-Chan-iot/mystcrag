import {
  OracleCastDtoSchema,
  OracleDesignSignalSchema,
  OracleInterpretationSchema,
  type OracleCastDto,
  type OracleDesignSignal,
  type OracleInterpretation
} from "@mystcrag/design-contract";

import { PersistenceError } from "../errors/persistence-errors.js";

type PersistenceSchema<T> = {
  safeParse(input: unknown):
    | { success: true; data: T }
    | { success: false; error: unknown };
};

function parseForWrite<T>(schema: PersistenceSchema<T>, input: unknown, label: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new PersistenceError("VALIDATION_ERROR", `${label} is invalid`, parsed.error);
  }
  return parsed.data;
}

function parseAfterRead<T>(schema: PersistenceSchema<T>, input: unknown, label: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new PersistenceError(
      "DATA_INTEGRITY_ERROR",
      `${label} failed persisted JSON validation`,
      parsed.error
    );
  }
  return parsed.data;
}

export function validateOracleCastSnapshotForWrite(input: unknown): OracleCastDto {
  return parseForWrite(OracleCastDtoSchema, input, "Oracle cast snapshot");
}

export function parseOracleCastSnapshot(input: unknown): OracleCastDto {
  return parseAfterRead(OracleCastDtoSchema, input, "Oracle cast snapshot");
}

export function validateOracleSignalSnapshotForWrite(input: unknown): OracleDesignSignal {
  return parseForWrite(OracleDesignSignalSchema, input, "Oracle signal snapshot");
}

export function parseOracleSignalSnapshot(input: unknown): OracleDesignSignal {
  return parseAfterRead(OracleDesignSignalSchema, input, "Oracle signal snapshot");
}

export function validateOracleInterpretationSnapshotForWrite(input: unknown): OracleInterpretation {
  return parseForWrite(OracleInterpretationSchema, input, "Oracle interpretation snapshot");
}

export function parseOracleInterpretationSnapshot(input: unknown): OracleInterpretation {
  return parseAfterRead(OracleInterpretationSchema, input, "Oracle interpretation snapshot");
}
