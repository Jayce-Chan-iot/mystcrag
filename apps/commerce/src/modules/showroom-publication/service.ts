import { MedusaService } from "@medusajs/framework/utils";

import {
  SHOWROOM_SUBJECT_KINDS,
  appendAuditEvent,
  computePriceFingerprint,
  mergeWithdrawalFacts,
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

/**
 * Per-subject in-process serialisation of decisions. Two concurrent first
 * approvals for the same subject would otherwise both read "no row" and both
 * insert; the database's unique index is the cross-process backstop, and this
 * queue removes the race inside one server process so the audit trail is never
 * lost to a lost-update.
 */
const subjectQueues = new Map<string, Promise<void>>();

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

  /** Runs `task` with every other decision for the same subject serialised. */
  private async withSubjectLock<T>(
    subjectKind: ShowroomSubjectKind,
    subjectRef: string,
    task: () => Promise<T>
  ): Promise<T> {
    const key = `${subjectKind}:${subjectRef}`;
    const previous = subjectQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = previous.then(() => gate);
    subjectQueues.set(key, held);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (subjectQueues.get(key) === held) {
        subjectQueues.delete(key);
      }
    }
  }

  /**
   * Records (or re-records) one manual approval. Re-importing the same approved
   * revision is idempotent: it updates the existing row and appends exactly one
   * audit event instead of duplicating a subject. Concurrent first approvals for
   * the same subject are serialised in-process and reconciled in the database, so
   * one row survives and no audit event is lost. A media asset withdrawn under an
   * earlier decision stays withdrawn even if the original APPROVE is replayed.
   */
  async approve(input: UpsertApprovalInput, actorId: string): Promise<ShowroomApproval> {
    if (!isKnownSubjectKind(input.subjectKind)) {
      throw new Error(`Unknown showroom subject kind "${input.subjectKind}"`);
    }
    return this.withSubjectLock(input.subjectKind, input.subjectRef, () =>
      this.persistApproval(input, actorId)
    );
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
      const existing = await this.readApprovalRow(input.subjectKind, input.subjectRef);
      // Withdrawal facts are sticky: an asset withdrawn by an earlier decision
      // stays withdrawn in the new media set, so a replayed or stale APPROVE can
      // never reintroduce it at the same version.
      const media = mergeWithdrawalFacts(existing?.record.media ?? [], input.media ?? []);
      const approvedMedia = media
        .filter((asset) => asset.approved && !asset.withdrawn && asset.checksum.trim().length > 0)
        .map((asset) => ({ checksum: asset.checksum, url: asset.url }));
      const next: ShowroomApproval = appendAuditEvent(
        {
          subjectKind: input.subjectKind,
          subjectRef: input.subjectRef,
          publicRevision: input.publicRevision,
          authorization: { ...input.authorization },
          availability: input.availability,
          prices,
          locales: input.locales as ShowroomApproval["locales"],
          media,
          audit: existing?.record.audit ?? []
        },
        {
          action: "APPROVED",
          at,
          actorId,
          publicRevision: input.publicRevision,
          authorizationStatus: input.authorization.status,
          markets: [...input.authorization.markets],
          approvedMedia
        }
      );

      const payload: Record<string, any> = {
        subject_kind: next.subjectKind,
        subject_ref: next.subjectRef,
        public_revision: next.publicRevision,
        authorization: next.authorization,
        availability: next.availability,
        prices: next.prices,
        locales: next.locales,
        media: next.media,
        audit: next.audit
      };

      if (existing) {
        await this.updateShowroomApprovalRecords({ id: existing.id, ...payload });
        return next;
      }
      try {
        await this.createShowroomApprovalRecords(payload);
        return next;
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        // Another writer (another process/replica) inserted first; re-read and
        // take the update path so the merged audit trail is not lost.
        lastError = error;
      }
    }
    throw lastError ?? new Error(`Could not persist the showroom approval for ${input.subjectKind} "${input.subjectRef}"`);
  }

  /** Withdraws one subject's authorization. Public reads close immediately. */
  async revoke(
    subjectKind: ShowroomSubjectKind,
    subjectRef: string,
    actorId: string,
    reason?: string
  ): Promise<ShowroomApproval> {
    return this.withSubjectLock(subjectKind, subjectRef, async () => {
      const existing = await this.readApprovalRow(subjectKind, subjectRef);
      if (!existing) {
        throw new Error(`No showroom approval exists for ${subjectKind} "${subjectRef}"`);
      }
      const next = appendAuditEvent(
        {
          ...existing.record,
          authorization: { ...existing.record.authorization, status: "REVOKED" }
        },
        {
          action: "REVOKED",
          at: new Date().toISOString(),
          actorId,
          ...(reason ? { reason } : {}),
          publicRevision: existing.record.publicRevision,
          authorizationStatus: "REVOKED"
        }
      );
      const revokePatch: Record<string, any> = {
        id: existing.id,
        authorization: next.authorization,
        audit: next.audit
      };
      await this.updateShowroomApprovalRecords(revokePatch);
      return next;
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
    return this.withSubjectLock(subjectKind, subjectRef, async () => {
      const existing = await this.readApprovalRow(subjectKind, subjectRef);
      if (!existing) {
        throw new Error(`No showroom approval exists for ${subjectKind} "${subjectRef}"`);
      }
      const target = existing.record.media.find((asset) => asset.checksum === checksum);
      const media = existing.record.media.map((asset) =>
        asset.checksum === checksum ? { ...asset, withdrawn: true } : asset
      );
      const next = appendAuditEvent(
        { ...existing.record, media },
        {
          action: "MEDIA_WITHDRAWN",
          at: new Date().toISOString(),
          actorId,
          ...(reason ? { reason } : {}),
          publicRevision: existing.record.publicRevision,
          ...(target
            ? { withdrawnMedia: { checksum: target.checksum, url: target.url } }
            : {})
        }
      );
      const withdrawPatch: Record<string, any> = {
        id: existing.id,
        media: next.media,
        audit: next.audit
      };
      await this.updateShowroomApprovalRecords(withdrawPatch);
      return next;
    });
  }

  async auditTrail(subjectKind: ShowroomSubjectKind, subjectRef: string): Promise<ShowroomAuditEvent[]> {
    const existing = await this.findApproval(subjectKind, subjectRef);
    return existing?.audit ?? [];
  }
}

export default ShowroomPublicationService;
