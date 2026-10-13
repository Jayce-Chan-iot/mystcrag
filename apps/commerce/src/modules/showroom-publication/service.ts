import { MedusaService } from "@medusajs/framework/utils";

import {
  SHOWROOM_SUBJECT_KINDS,
  appendAuditEvent,
  computePriceFingerprint,
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
    const rows = (await this.listShowroomApprovalRecords({
      subject_kind: subjectKind,
      subject_ref: subjectRef
    })) as unknown as ApprovalRow[];
    const match = rows
      .map(toApprovalRecord)
      .find((record) => record.subjectKind === subjectKind && record.subjectRef === subjectRef);
    return match ?? null;
  }

  /**
   * Records (or re-records) one manual approval. Re-importing the same approved
   * revision is idempotent: it updates the existing row and appends exactly one
   * audit event instead of duplicating a subject.
   */
  async approve(input: UpsertApprovalInput, actorId: string): Promise<ShowroomApproval> {
    if (!isKnownSubjectKind(input.subjectKind)) {
      throw new Error(`Unknown showroom subject kind "${input.subjectKind}"`);
    }
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

    const existing = await this.findApproval(input.subjectKind, input.subjectRef);
    const next: ShowroomApproval = appendAuditEvent(
      {
        subjectKind: input.subjectKind,
        subjectRef: input.subjectRef,
        publicRevision: input.publicRevision,
        authorization: { ...input.authorization },
        availability: input.availability,
        prices,
        locales: input.locales as ShowroomApproval["locales"],
        media: [...input.media],
        audit: existing?.audit ?? []
      },
      { action: "APPROVED", at, actorId }
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
      const rows = (await this.listShowroomApprovalRecords({
        subject_kind: input.subjectKind,
        subject_ref: input.subjectRef
      })) as unknown as ApprovalRow[];
      const row = rows[0];
      await this.updateShowroomApprovalRecords({ id: row.id, ...payload });
    } else {
      await this.createShowroomApprovalRecords(payload);
    }
    return next;
  }

  /** Withdraws one subject's authorization. Public reads close immediately. */
  async revoke(
    subjectKind: ShowroomSubjectKind,
    subjectRef: string,
    actorId: string,
    reason?: string
  ): Promise<ShowroomApproval> {
    const existing = await this.findApproval(subjectKind, subjectRef);
    if (!existing) {
      throw new Error(`No showroom approval exists for ${subjectKind} "${subjectRef}"`);
    }
    const next = appendAuditEvent(
      {
        ...existing,
        authorization: { ...existing.authorization, status: "REVOKED" }
      },
      { action: "REVOKED", at: new Date().toISOString(), actorId, ...(reason ? { reason } : {}) }
    );
    const revokePatch: Record<string, any> = {
      id: await this.rowIdFor(subjectKind, subjectRef),
      authorization: next.authorization,
      audit: next.audit
    };
    await this.updateShowroomApprovalRecords(revokePatch);
    return next;
  }

  /** Withdraws a single media asset; if nothing approved remains the subject closes. */
  async withdrawMedia(
    subjectKind: ShowroomSubjectKind,
    subjectRef: string,
    checksum: string,
    actorId: string,
    reason?: string
  ): Promise<ShowroomApproval> {
    const existing = await this.findApproval(subjectKind, subjectRef);
    if (!existing) {
      throw new Error(`No showroom approval exists for ${subjectKind} "${subjectRef}"`);
    }
    const media = existing.media.map((asset) =>
      asset.checksum === checksum ? { ...asset, withdrawn: true } : asset
    );
    const next = appendAuditEvent(
      { ...existing, media },
      {
        action: "MEDIA_WITHDRAWN",
        at: new Date().toISOString(),
        actorId,
        ...(reason ? { reason } : {})
      }
    );
    const withdrawPatch: Record<string, any> = {
      id: await this.rowIdFor(subjectKind, subjectRef),
      media: next.media,
      audit: next.audit
    };
    await this.updateShowroomApprovalRecords(withdrawPatch);
    return next;
  }

  async auditTrail(subjectKind: ShowroomSubjectKind, subjectRef: string): Promise<ShowroomAuditEvent[]> {
    const existing = await this.findApproval(subjectKind, subjectRef);
    return existing?.audit ?? [];
  }

  private async rowIdFor(subjectKind: ShowroomSubjectKind, subjectRef: string): Promise<string> {
    const rows = (await this.listShowroomApprovalRecords({
      subject_kind: subjectKind,
      subject_ref: subjectRef
    })) as unknown as ApprovalRow[];
    if (!rows[0]) {
      throw new Error(`No showroom approval row exists for ${subjectKind} "${subjectRef}"`);
    }
    return rows[0].id;
  }
}

export default ShowroomPublicationService;
