import type { PrismaClient } from "../../generated/client/client.js";
import { PersistenceError } from "../errors/persistence-errors.js";
import { parseDesignSnapshot } from "../mappers/snapshot.mapper.js";
import type { PersistedDesignRevision } from "./design.repository.js";

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

// Intentionally read-only. Revision creation remains part of DesignRepository's
// current-design transaction and there is no update/delete method.
export class DesignRevisionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getRevision(designId: string, revisionNumber: number): Promise<PersistedDesignRevision> {
    const row = await this.prisma.designRevision.findUnique({
      where: { designId_revisionNumber: { designId, revisionNumber } }
    });
    if (!row) throw new PersistenceError("NOT_FOUND", "Design revision not found");
    return mapRevision(row);
  }

  async listDesignRevisions(
    actorId: string,
    designId: string
  ): Promise<PersistedDesignRevision[]> {
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
}

export type { PersistedDesignRevision } from "./design.repository.js";
