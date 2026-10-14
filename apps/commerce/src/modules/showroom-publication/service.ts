import { randomUUID } from "node:crypto";

import { MedusaService } from "@medusajs/framework/utils";

import {
  SHOWROOM_SUBJECT_KINDS,
  ShowroomApprovalNotFoundError,
  ShowroomMediaWithdrawalTargetError,
  appendAuditEvent,
  computePriceFingerprint,
  mergeWithdrawalFacts,
  publicStateFacts,
  type ShowroomApprovalRecord as ShowroomApproval,
  type ShowroomApprovalStatus,
  type ShowroomAuditEvent,
  type ShowroomAvailabilityState,
  type ShowroomLocaleCopy,
  type ShowroomMediaRecord,
  type ShowroomApprovedPrice,
  type ShowroomSubjectKind
} from "../../showroom/publication-gate";
import ShowroomApprovalModel from "./models/approval-record";

type ApprovalRow = {
  id: string;
  subject_kind?: string;
  subjectKind?: string;
  subject_ref?: string;
  subjectRef?: string;
  public_revision?: number;
  publicRevision?: number;
  authorization?: unknown;
  availability?: string | null;
  prices?: unknown;
  locales?: unknown;
  media?: unknown;
  audit?: unknown;
};

const pick = <T>(row: ApprovalRow, snake: keyof ApprovalRow, camel: keyof ApprovalRow, fallback: T): T => {
  const value = row[snake] ?? row[camel];
  return (value === undefined || value === null ? fallback : value) as T;
};

/** Maps a persisted row onto the predicate's record shape. */
export function toApprovalRecord(row: ApprovalRow): ShowroomApproval {
  return {
    subjectKind: pick(row, "subject_kind", "subjectKind", "PRODUCT") as ShowroomSubjectKind,
    subjectRef: pick(row, "subject_ref", "subjectRef", ""),
    publicRevision: pick(row, "public_revision", "publicRevision", 0),
    authorization: (pick(row, "authorization", "authorization", {}) ?? {}) as ShowroomApproval["authorization"],
    availability: (pick(row, "availability", "availability", null) as ShowroomAvailabilityState | null) ?? null,
    prices: (pick(row, "prices", "prices", {}) ?? {}) as ShowroomApproval["prices"],
    locales: (pick(row, "locales", "locales", {}) ?? {}) as ShowroomApproval["locales"],
    media: (pick(row, "media", "media", []) ?? []) as ShowroomMediaRecord[],
    audit: (pick(row, "audit", "audit", []) ?? []) as ShowroomAuditEvent[]
  };
}

export type UpsertApprovalInput = {
  subjectKind: ShowroomSubjectKind;
  subjectRef: string;
  publicRevision: number;
  authorization: {
    status: ShowroomApprovalStatus;
    markets: ShowroomApproval["authorization"]["markets"];
    effectiveFrom: string;
    expiresAt: string;
  };
  availability: ShowroomAvailabilityState;
  /**
   * The exact live Medusa price rows the approval is granted for, one per
   * market. A market absent here has no approved price and fails closed.
   */
  prices: Partial<
    Record<
      ShowroomApprovedPrice["market"],
      { currency: string; amountMinor: number; regionId: string }
    >
  >;
  locales: Partial<Record<string, ShowroomLocaleCopy>>;
  media: ShowroomMediaRecord[];
  /**
   * The live product public facts the approval records so the audit event alone
   * can rebuild the public response: the handle (the public slug) and the Medusa
   * status. They are read from the live product at decision time, never inferred.
   */
  handle: string;
  productStatus: string;
};

const isKnownSubjectKind = (value: string): value is ShowroomSubjectKind =>
  (SHOWROOM_SUBJECT_KINDS as readonly string[]).includes(value);

/**
 * Recognises the database's unique-constraint violation for the
 * `subject_kind + subject_ref` index, independent of the driver's wrapping. Two
 * concurrent first approvals race for the same subject; the loser must fall back
 * to updating the winner's row instead of surfacing the constraint error.
 */
function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; errno?: unknown; name?: unknown; message?: unknown; cause?: unknown };
  if (candidate?.code === "23505" || candidate?.errno === "23505") {
    return true;
  }
  if (candidate?.name === "UniqueConstraintViolationException") {
    return true;
  }
  const cause = candidate?.cause as { code?: unknown; name?: unknown; message?: unknown } | undefined;
  if (cause?.code === "23505" || cause?.name === "UniqueConstraintViolationException") {
    return true;
  }
  return /duplicate key value violates unique constraint|unique constraint|UniqueConstraintViolation/i.test(
    String(candidate?.message ?? cause?.message ?? "")
  );
}

/** The generated table backing the approval records. */
const APPROVAL_TABLE = "showroom_approval_record";

/**
 * Reads one subject's row under a `SELECT ... FOR UPDATE` row lock. Two writers
 * — including two independent processes sharing the database — serialise on this
 * lock, and, under READ COMMITTED, a blocked writer re-reads the latest
 * committed row when it finally acquires the lock. A whole-row update that read
 * without this lock can overwrite a concurrent decision and lose its audit.
 */
// Every identifier is double-quoted. The generated migration quotes the column
// names, and one of them — "authorization" — is a PostgreSQL reserved keyword,
// so the unquoted form is a syntax error.
const LOCK_APPROVAL_SQL =
  `select "id", "subject_kind", "subject_ref", "public_revision", "authorization", "availability", "prices", "locales", "media", "audit" ` +
  `from "${APPROVAL_TABLE}" where "subject_kind" = ? and "subject_ref" = ? and "deleted_at" is null for update`;

const INSERT_APPROVAL_SQL =
  `insert into "${APPROVAL_TABLE}" ` +
  `("id", "subject_kind", "subject_ref", "public_revision", "authorization", "availability", "prices", "locales", "media", "audit") ` +
  `values (?, ?, ?, ?, cast(? as jsonb), ?, cast(? as jsonb), cast(? as jsonb), cast(? as jsonb), cast(? as jsonb))`;

const UPDATE_APPROVAL_SQL =
  `update "${APPROVAL_TABLE}" set "subject_kind" = ?, "subject_ref" = ?, "public_revision" = ?, ` +
  `"authorization" = cast(? as jsonb), "availability" = ?, "prices" = cast(? as jsonb), ` +
  `"locales" = cast(? as jsonb), "media" = cast(? as jsonb), "audit" = cast(? as jsonb), "updated_at" = now() ` +
  `where "id" = ? and "deleted_at" is null`;

/** The transactional EntityManager surface used for the raw approvals SQL. */
type TransactionalManager = {
  execute(sql: string, params?: unknown[], method?: string): Promise<any>;
};

/** The injected privileged repository, which owns `transaction`. */
type TransactionalRepository = {
  transaction<T>(task: (manager: TransactionalManager) => Promise<T>): Promise<T>;
};

/**
 * Internal sentinel raised when a first insert loses the race for the
 * `subject_kind + subject_ref` unique index. It is caught inside the service and
 * retried on the update path, so the loser appends its audit event to the
 * winner's row instead of surfacing a constraint error or dropping its decision.
 */
class ShowroomApprovalConflictError extends Error {
  constructor() {
    super("A concurrent showroom approval was written for the same subject.");
    this.name = "ShowroomApprovalConflictError";
  }
}

/**
 * Read/write service for showroom publication approvals. Reads are anonymous
 * and safe; writes are only reachable through the authenticated admin approval
 * route and always append an audit event.
 */
class ShowroomPublicationService extends MedusaService({
  ShowroomApprovalRecord: ShowroomApprovalModel
}) {
  async listApprovalRecordsByKind(subjectKind: ShowroomSubjectKind): Promise<ShowroomApproval[]> {
    const rows = (await this.listShowroomApprovalRecords({
      subject_kind: subjectKind
    })) as unknown as ApprovalRow[];
    return rows
      .map(toApprovalRecord)
      .filter((record) => record.subjectKind === subjectKind && record.subjectRef.length > 0);
  }

  async findApproval(
    subjectKind: ShowroomSubjectKind,
    subjectRef: string
  ): Promise<ShowroomApproval | null> {
    return (await this.readApprovalRow(subjectKind, subjectRef))?.record ?? null;
  }

  /** The single persisted row (id + record) for one subject, or null. */
  private async readApprovalRow(
    subjectKind: ShowroomSubjectKind,
    subjectRef: string
  ): Promise<{ id: string; record: ShowroomApproval } | null> {
    const rows = (await this.listShowroomApprovalRecords({
      subject_kind: subjectKind,
      subject_ref: subjectRef
    })) as unknown as ApprovalRow[];
    const match = rows.find(
      (row) =>
        String(pick(row, "subject_kind", "subjectKind", "")) === subjectKind &&
        String(pick(row, "subject_ref", "subjectRef", "")) === subjectRef
    );
    return match ? { id: match.id, record: toApprovalRecord(match) } : null;
  }

  /** The injected privileged repository, which provides a database transaction. */
  private get transactionRepository(): TransactionalRepository {
    const repository = (this as unknown as { baseRepository_?: unknown }).baseRepository_;
    if (!repository || typeof (repository as { transaction?: unknown }).transaction !== "function") {
      throw new Error("The showroom publication module has no persistence transaction support.");
    }
    return repository as TransactionalRepository;
  }

  /** Reads the subject's row under a row lock, or null when none exists yet. */
  private async lockApprovalRow(
    manager: TransactionalManager,
    subjectKind: ShowroomSubjectKind,
    subjectRef: string
  ): Promise<{ id: string; record: ShowroomApproval } | null> {
    const rows = (await manager.execute(
      LOCK_APPROVAL_SQL,
      [subjectKind, subjectRef],
      "all"
    )) as ApprovalRow[];
    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }
    return { id: String(rows[0].id), record: toApprovalRecord(rows[0]) };
  }

  private async insertApprovalRow(manager: TransactionalManager, record: ShowroomApproval): Promise<void> {
    await manager.execute(INSERT_APPROVAL_SQL, [
      randomUUID(),
      record.subjectKind,
      record.subjectRef,
      record.publicRevision,
      JSON.stringify(record.authorization),
      record.availability,
      JSON.stringify(record.prices),
      JSON.stringify(record.locales),
      JSON.stringify(record.media),
      JSON.stringify(record.audit)
    ]);
  }

  private async updateApprovalRow(
    manager: TransactionalManager,
    id: string,
    record: ShowroomApproval
  ): Promise<void> {
    await manager.execute(UPDATE_APPROVAL_SQL, [
      record.subjectKind,
      record.subjectRef,
      record.publicRevision,
      JSON.stringify(record.authorization),
      record.availability,
      JSON.stringify(record.prices),
      JSON.stringify(record.locales),
      JSON.stringify(record.media),
      JSON.stringify(record.audit),
      id
    ]);
  }

  /**
   * Records (or re-records) one manual approval. Re-importing the same approved
   * revision is idempotent: it updates the existing row and appends exactly one
   * audit event instead of duplicating a subject. Every decision runs inside one
   * database transaction that first takes a `SELECT ... FOR UPDATE` row lock, so
   * a decision by another process or replica can neither overwrite the row nor
   * lose its audit event. Concurrent first approvals race on the unique index;
   * the loser retries on the update path. A media asset withdrawn under any
   * earlier decision stays withdrawn even if the original APPROVE is replayed.
   */
  async approve(input: UpsertApprovalInput, actorId: string): Promise<ShowroomApproval> {
    if (!isKnownSubjectKind(input.subjectKind)) {
      throw new Error(`Unknown showroom subject kind "${input.subjectKind}"`);
    }
    return this.persistApproval(input, actorId);
  }

  private async persistApproval(input: UpsertApprovalInput, actorId: string): Promise<ShowroomApproval> {
    const at = new Date().toISOString();
    const prices: ShowroomApproval["prices"] = {};
    for (const [market, entry] of Object.entries(input.prices ?? {}) as [
      ShowroomApprovedPrice["market"],
      { currency: string; amountMinor: number; regionId: string }
    ][]) {
      prices[market] = {
        market,
        currency: entry.currency,
        amountMinor: entry.amountMinor,
        regionId: entry.regionId,
        fingerprint: computePriceFingerprint(entry.regionId, entry.currency, entry.amountMinor)
      };
    }

    const MAX_ATTEMPTS = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.transactionRepository.transaction(async (manager) => {
          const existing = await this.lockApprovalRow(manager, input.subjectKind, input.subjectRef);
          // Withdrawal facts are tombstones: an asset withdrawn by any earlier
          // decision stays withdrawn in the new media set, and a withdrawn asset
          // the incoming set omits is retained, so a replayed, omitting or
          // reintroducing APPROVE can never revive it.
          const media = mergeWithdrawalFacts(existing?.record.media ?? [], input.media ?? []);
          const base: ShowroomApproval = {
            subjectKind: input.subjectKind,
            subjectRef: input.subjectRef,
            publicRevision: input.publicRevision,
            authorization: { ...input.authorization },
            availability: input.availability,
            prices,
            locales: input.locales as ShowroomApproval["locales"],
            media,
            audit: existing?.record.audit ?? []
          };
          const next = appendAuditEvent(base, {
            action: "APPROVED",
            at,
            actorId,
            ...publicStateFacts(base),
            handle: input.handle,
            productStatus: input.productStatus
          });

          if (existing) {
            await this.updateApprovalRow(manager, existing.id, next);
            return next;
          }
          try {
            await this.insertApprovalRow(manager, next);
            return next;
          } catch (error) {
            if (isUniqueViolation(error)) {
              throw new ShowroomApprovalConflictError();
            }
            throw error;
          }
        });
      } catch (error) {
        if (error instanceof ShowroomApprovalConflictError) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError ?? new Error(`Could not persist the showroom approval for ${input.subjectKind} "${input.subjectRef}"`);
  }

  /**
   * Runs one subject's state change under a database row lock. A missing subject
   * is a typed not-found; a change that names an absent media target is a typed
   * not-found; both are decided inside the transaction, so a concurrent decision
   * cannot slip between the read and the write.
   */
  private async mutateApproval(
    subjectKind: ShowroomSubjectKind,
    subjectRef: string,
    mutate: (record: ShowroomApproval, at: string) => ShowroomApproval
  ): Promise<ShowroomApproval> {
    return this.transactionRepository.transaction(async (manager) => {
      const existing = await this.lockApprovalRow(manager, subjectKind, subjectRef);
      if (!existing) {
        throw new ShowroomApprovalNotFoundError(subjectKind, subjectRef);
      }
      const next = mutate(existing.record, new Date().toISOString());
      await this.updateApprovalRow(manager, existing.id, next);
      return next;
    });
  }

  /** Withdraws one subject's authorization. Public reads close immediately. */
  async revoke(
    subjectKind: ShowroomSubjectKind,
    subjectRef: string,
    actorId: string,
    reason?: string
  ): Promise<ShowroomApproval> {
    return this.mutateApproval(subjectKind, subjectRef, (record, at) => {
      const revoked: ShowroomApproval = {
        ...record,
        authorization: { ...record.authorization, status: "REVOKED" }
      };
      return appendAuditEvent(revoked, {
        action: "REVOKED",
        at,
        actorId,
        ...(reason ? { reason } : {}),
        ...publicStateFacts(revoked)
      });
    });
  }

  /** Withdraws a single media asset; if nothing approved remains the subject closes. */
  async withdrawMedia(
    subjectKind: ShowroomSubjectKind,
    subjectRef: string,
    checksum: string,
    actorId: string,
    reason?: string
  ): Promise<ShowroomApproval> {
    return this.mutateApproval(subjectKind, subjectRef, (record, at) => {
      const target = record.media.find((asset) => asset.checksum === checksum);
      if (!target) {
        throw new ShowroomMediaWithdrawalTargetError(subjectKind, subjectRef, checksum);
      }
      const media = record.media.map((asset) =>
        asset.checksum === checksum ? { ...asset, withdrawn: true } : asset
      );
      const withdrawn: ShowroomApproval = { ...record, media };
      return appendAuditEvent(withdrawn, {
        action: "MEDIA_WITHDRAWN",
        at,
        actorId,
        ...(reason ? { reason } : {}),
        ...publicStateFacts(withdrawn),
        withdrawnMedia: {
          checksum: target.checksum,
          url: target.url,
          alt: target.alt,
          ...(target.width === undefined ? {} : { width: target.width }),
          ...(target.height === undefined ? {} : { height: target.height })
        }
      });
    });
  }

  async auditTrail(subjectKind: ShowroomSubjectKind, subjectRef: string): Promise<ShowroomAuditEvent[]> {
    const existing = await this.findApproval(subjectKind, subjectRef);
    return existing?.audit ?? [];
  }
}

export default ShowroomPublicationService;
