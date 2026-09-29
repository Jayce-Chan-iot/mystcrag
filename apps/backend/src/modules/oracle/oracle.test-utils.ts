import {
  PersistenceError,
  type CreateOrGetOracleSessionRecord,
  type MarkOracleSessionSavedRecord,
  type OracleSessionRecord,
  type OracleSessionRepository,
  type SaveOracleRecommendationsRecord
} from "@mystcrag/database";

const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryOracleRepository implements OracleSessionRepository {
  private readonly records = new Map<string, OracleSessionRecord>();
  private readonly byOperation = new Map<string, string>();
  private sequence = 0;
  lastCreateInput?: CreateOrGetOracleSessionRecord;

  private owned(ownerId: string, sessionId: string): OracleSessionRecord {
    const record = this.records.get(sessionId);
    if (!record || record.ownerId !== ownerId) {
      throw new PersistenceError("NOT_FOUND", "Oracle session not found");
    }
    return record;
  }

  async createOrGet(input: CreateOrGetOracleSessionRecord): Promise<OracleSessionRecord> {
    this.lastCreateInput = clone(input);
    if (input.parentSessionId !== undefined) this.owned(input.ownerId, input.parentSessionId);
    const key = `${input.ownerId}\u0000${input.operationId}`;
    const existingId = this.byOperation.get(key);
    if (existingId) {
      const existing = this.owned(input.ownerId, existingId);
      if (
        existing.locale !== input.locale ||
        existing.currency !== input.currency ||
        existing.wristCircumferenceMm !== (input.wristCircumferenceMm ?? null) ||
        existing.parentSessionId !== (input.parentSessionId ?? null)
      ) {
        throw new PersistenceError("CONFLICT", "Oracle operation ID was reused with different input");
      }
      return clone(existing);
    }
    const createdAt = new Date(`2026-09-29T12:00:0${this.sequence}.000Z`);
    const record: OracleSessionRecord = {
      id: `oracle-session-${++this.sequence}`,
      ownerId: input.ownerId,
      operationId: input.operationId,
      status: "CAST",
      stateRevision: 1,
      locale: input.locale,
      currency: input.currency,
      wristCircumferenceMm: input.wristCircumferenceMm ?? null,
      cast: clone(input.cast),
      signal: clone(input.signal),
      interpretation: clone(input.interpretation),
      algorithmVersion: input.cast.algorithm.version,
      ruleVersion: input.signal.ruleVersion,
      recommendationOperationId: null,
      saveOperationId: null,
      selectedDesignId: null,
      parentSessionId: input.parentSessionId ?? null,
      recommendations: [],
      createdAt,
      updatedAt: createdAt
    };
    this.records.set(record.id, record);
    this.byOperation.set(key, record.id);
    return clone(record);
  }

  async getOwned(ownerId: string, sessionId: string): Promise<OracleSessionRecord> {
    return clone(this.owned(ownerId, sessionId));
  }

  async findOwnedByOperation(ownerId: string, operationId: string): Promise<OracleSessionRecord | null> {
    const existingId = this.byOperation.get(`${ownerId}\u0000${operationId}`);
    if (existingId === undefined) return null;
    const record = this.records.get(existingId);
    if (!record || record.ownerId !== ownerId) return null;
    return clone(record);
  }

  async saveRecommendations(input: SaveOracleRecommendationsRecord): Promise<OracleSessionRecord> {
    const record = this.owned(input.ownerId, input.sessionId);
    if (record.status !== "CAST" || record.stateRevision !== input.expectedRevision) {
      throw new PersistenceError("CONFLICT", "Oracle recommendation revision conflict");
    }
    const updated: OracleSessionRecord = {
      ...record,
      status: "RECOMMENDED",
      stateRevision: 2,
      recommendationOperationId: input.operationId,
      recommendations: input.recommendations.map((item, index) => ({
        id: `oracle-recommendation-${index + 1}`,
        ...item,
        createdAt: record.updatedAt
      })),
      updatedAt: new Date(record.updatedAt.getTime() + 1_000)
    };
    this.records.set(record.id, updated);
    return clone(updated);
  }

  async markSaved(input: MarkOracleSessionSavedRecord): Promise<OracleSessionRecord> {
    const record = this.owned(input.ownerId, input.sessionId);
    if (record.status !== "RECOMMENDED" || record.stateRevision !== input.expectedRevision) {
      throw new PersistenceError("CONFLICT", "Oracle save revision conflict");
    }
    if (!record.recommendations.some(({ designId }) => designId === input.selectedDesignId)) {
      throw new PersistenceError("VALIDATION_ERROR", "Selected design is not linked to this Oracle session");
    }
    const updated: OracleSessionRecord = {
      ...record,
      status: "SAVED",
      stateRevision: 3,
      saveOperationId: input.operationId,
      selectedDesignId: input.selectedDesignId,
      updatedAt: new Date(record.updatedAt.getTime() + 1_000)
    };
    this.records.set(record.id, updated);
    return clone(updated);
  }
}
