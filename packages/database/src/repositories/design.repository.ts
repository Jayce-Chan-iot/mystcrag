import { DesignV1Schema, type DesignV1 } from "@mystcrag/design-contract";

import type { PrismaClient } from "../../generated/client/client.js";
import { PersistenceError, rethrowPersistenceError } from "../errors/persistence-errors.js";
import { parseDesignSnapshot, toPrismaJson } from "../mappers/snapshot.mapper.js";

export type PersistedDesign = {
  id: string;
  ownerId: string;
  currentRevision: number;
  status: "DRAFT" | "GENERATED" | "SAVED" | "ARCHIVED";
  snapshot: DesignV1;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type PersistedDesignRevision = {
  id: string;
  designId: string;
  revisionNumber: number;
  snapshot: DesignV1;
  changeType: "CREATED" | "UPDATED" | "RESTORED" | "AI_OPTIMIZED";
  changeReason: string | null;
  createdBy: string;
  createdAt: Date;
};

function validateForPersistence(snapshot: unknown, revision?: number): DesignV1 {
  const parsed = DesignV1Schema.safeParse(snapshot);
  if (!parsed.success) {
    throw new PersistenceError("VALIDATION_ERROR", "Design snapshot is invalid", parsed.error);
  }
  if (revision !== undefined && parsed.data.revision !== revision) {
    throw new PersistenceError("VALIDATION_ERROR", `Snapshot revision must be ${revision}`);
  }
  return parsed.data;
}

function mapDesign(row: {
  id: string;
  ownerId: string;
  currentRevision: number;
  status: PersistedDesign["status"];
  currentSnapshot: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): PersistedDesign {
  const snapshot = parseDesignSnapshot(row.currentSnapshot);
  if (snapshot.designId !== row.id || snapshot.revision !== row.currentRevision) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Design row and snapshot metadata differ");
  }
  return {
    id: row.id,
    ownerId: row.ownerId,
    currentRevision: row.currentRevision,
    status: row.status,
    snapshot,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt
  };
}

function mapRevision(row: {
  id: string;
  designId: string;
  revisionNumber: number;
  snapshot: unknown;
  changeType: PersistedDesignRevision["changeType"];
  changeReason: string | null;
  createdBy: string;
  createdAt: Date;
}): PersistedDesignRevision {
  const snapshot = parseDesignSnapshot(row.snapshot);
  if (snapshot.designId !== row.designId || snapshot.revision !== row.revisionNumber) {
    throw new PersistenceError("DATA_INTEGRITY_ERROR", "Revision row and snapshot metadata differ");
  }
  return { ...row, snapshot };
}

export class DesignRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createDesign(actorId: string, input: unknown): Promise<PersistedDesign> {
    const snapshot = validateForPersistence(input, 1);
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.design.create({
        data: {
          id: snapshot.designId,
          ownerId: actorId,
          name: snapshot.designName,
          mode: snapshot.designMode,
          status: snapshot.designMode === "AI_GENERATED" ? "GENERATED" : "DRAFT",
          schemaVersion: snapshot.schemaVersion,
          currentRevision: 1,
          locale: snapshot.locale,
          currency: snapshot.currency,
          currentSnapshot: toPrismaJson(snapshot),
          complianceStatus: snapshot.compliance.complianceStatus,
          visibility: snapshot.community.visibility,
          publishConsent: snapshot.community.publishConsent,
          allowRemix: snapshot.community.allowRemix,
          creatorDisplayMode: snapshot.community.creatorDisplayMode,
          revisions: {
            create: {
              revisionNumber: 1,
              schemaVersion: snapshot.schemaVersion,
              snapshot: toPrismaJson(snapshot),
              changeType: "CREATED",
              changeReason: "Initial design",
              createdBy: actorId
            }
          }
        }
      });
      return mapDesign(row);
    }).catch(rethrowPersistenceError);
  }

  async getDesign(actorId: string, designId: string): Promise<PersistedDesign> {
    const row = await this.prisma.design.findFirst({
      where: { id: designId, ownerId: actorId, deletedAt: null }
    });
    if (!row) throw new PersistenceError("NOT_FOUND", "Design not found");
    return mapDesign(row);
  }

  async getRevision(designId: string, revisionNumber: number): Promise<PersistedDesignRevision> {
    const row = await this.prisma.designRevision.findUnique({
      where: { designId_revisionNumber: { designId, revisionNumber } }
    });
    if (!row) throw new PersistenceError("NOT_FOUND", "Design revision not found");
    return mapRevision(row);
  }

  async listDesignRevisions(actorId: string, designId: string): Promise<PersistedDesignRevision[]> {
    const owned = await this.prisma.design.count({
      where: { id: designId, ownerId: actorId, deletedAt: null }
    });
    if (owned === 0) throw new PersistenceError("NOT_FOUND", "Design not found");
    const rows = await this.prisma.designRevision.findMany({
      where: { designId },
      orderBy: { revisionNumber: "asc" }
    });
    return rows.map(mapRevision);
  }

  async updateDesign(
    actorId: string,
    designId: string,
    expectedRevision: number,
    nextInput: unknown,
    changeReason: string,
    changeType: "UPDATED" | "RESTORED" | "AI_OPTIMIZED" = "UPDATED"
  ): Promise<PersistedDesign> {
    const nextRevision = expectedRevision + 1;
    const snapshot = validateForPersistence(nextInput, nextRevision);
    if (snapshot.designId !== designId) {
      throw new PersistenceError("VALIDATION_ERROR", "designId cannot change");
    }
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.design.updateMany({
        where: {
          id: designId,
          ownerId: actorId,
          currentRevision: expectedRevision,
          deletedAt: null
        },
        data: {
          name: snapshot.designName,
          mode: snapshot.designMode,
          schemaVersion: snapshot.schemaVersion,
          currentRevision: nextRevision,
          locale: snapshot.locale,
          currency: snapshot.currency,
          currentSnapshot: toPrismaJson(snapshot),
          complianceStatus: snapshot.compliance.complianceStatus,
          visibility: snapshot.community.visibility,
          publishConsent: snapshot.community.publishConsent,
          allowRemix: snapshot.community.allowRemix,
          creatorDisplayMode: snapshot.community.creatorDisplayMode
        }
      });
      if (result.count !== 1) {
        const exists = await tx.design.count({
          where: { id: designId, ownerId: actorId, deletedAt: null }
        });
        throw new PersistenceError(
          exists === 0 ? "NOT_FOUND" : "CONFLICT",
          exists === 0 ? "Design not found" : "Design revision conflict"
        );
      }
      await tx.designRevision.create({
        data: {
          designId,
          revisionNumber: nextRevision,
          schemaVersion: snapshot.schemaVersion,
          snapshot: toPrismaJson(snapshot),
          changeType,
          changeReason,
          createdBy: actorId
        }
      });
      const row = await tx.design.findUniqueOrThrow({ where: { id: designId } });
      return mapDesign(row);
    }).catch(rethrowPersistenceError);
  }

  async softDeleteDesign(actorId: string, designId: string): Promise<void> {
    const result = await this.prisma.design.updateMany({
      where: { id: designId, ownerId: actorId, deletedAt: null },
      data: { deletedAt: new Date(), status: "ARCHIVED" }
    }).catch(rethrowPersistenceError);
    if (result.count !== 1) throw new PersistenceError("NOT_FOUND", "Design not found");
  }


  async saveDesign(
    actorId: string,
    designId: string,
    expectedRevision: number
  ): Promise<PersistedDesign> {
    const result = await this.prisma.design.updateMany({
      where: {
        id: designId,
        ownerId: actorId,
        currentRevision: expectedRevision,
        deletedAt: null
      },
      data: { status: "SAVED" }
    }).catch(rethrowPersistenceError);
    if (result.count !== 1) {
      const exists = await this.prisma.design.count({
        where: { id: designId, ownerId: actorId, deletedAt: null }
      });
      throw new PersistenceError(
        exists === 0 ? "NOT_FOUND" : "CONFLICT",
        exists === 0 ? "Design not found" : "Design revision conflict"
      );
    }
    return this.getDesign(actorId, designId);
  }
}
