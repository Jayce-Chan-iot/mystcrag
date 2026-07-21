import { toPublicDesign, type PublicDesignV1 } from "@mystcrag/design-contract";

import type { PrismaClient } from "../../generated/client/client.js";
import { PersistenceError, rethrowPersistenceError } from "../errors/persistence-errors.js";
import { parseDesignSnapshot } from "../mappers/snapshot.mapper.js";

export type Publication = {
  id: string;
  designId: string;
  designRevisionId: string;
  visibility: "UNLISTED" | "PUBLIC";
  allowRemix: boolean;
  creatorDisplayMode: "ANONYMOUS" | "DISPLAY_NAME";
  status: "PUBLISHED" | "UNPUBLISHED";
  publishedAt: Date;
  unpublishedAt: Date | null;
  design: PublicDesignV1;
};

export class PublicationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async publishDesign(
    actorId: string,
    designId: string,
    revisionNumber: number
  ): Promise<Publication> {
    return this.prisma.$transaction(async (tx) => {
      const design = await tx.design.findFirst({
        where: { id: designId, ownerId: actorId, deletedAt: null }
      });
      if (!design) throw new PersistenceError("NOT_FOUND", "Design not found");
      const revision = await tx.designRevision.findUnique({
        where: { designId_revisionNumber: { designId, revisionNumber } }
      });
      if (!revision) throw new PersistenceError("NOT_FOUND", "Design revision not found");
      const snapshot = parseDesignSnapshot(revision.snapshot);
      if (!snapshot.community.publishConsent) {
        throw new PersistenceError("CONSENT_REQUIRED", "Publication requires explicit consent");
      }
      if (snapshot.community.visibility === "PRIVATE") {
        throw new PersistenceError("VALIDATION_ERROR", "Private designs cannot be published");
      }
      if (
        snapshot.compliance.complianceStatus !== "PASSED" ||
        snapshot.compliance.reviewRequired
      ) {
        throw new PersistenceError("COMPLIANCE_BLOCKED", "Design is not cleared for publication");
      }
      const row = await tx.designPublication.create({
        data: {
          designId,
          designRevisionId: revision.id,
          publishedById: actorId,
          visibility: snapshot.community.visibility,
          publishConsent: true,
          allowRemix: snapshot.community.allowRemix,
          creatorDisplayMode: snapshot.community.creatorDisplayMode
        }
      });
      return {
        id: row.id,
        designId: row.designId,
        designRevisionId: row.designRevisionId,
        visibility: row.visibility as "UNLISTED" | "PUBLIC",
        allowRemix: row.allowRemix,
        creatorDisplayMode: row.creatorDisplayMode,
        status: row.publicationStatus,
        publishedAt: row.publishedAt,
        unpublishedAt: row.unpublishedAt,
        design: toPublicDesign({
          ...snapshot,
          production: { ...snapshot.production, productionNotes: [] }
        })
      };
    }).catch(rethrowPersistenceError);
  }

  async unpublishDesign(actorId: string, publicationId: string): Promise<void> {
    const result = await this.prisma.designPublication.updateMany({
      where: { id: publicationId, publishedById: actorId, publicationStatus: "PUBLISHED" },
      data: { publicationStatus: "UNPUBLISHED", unpublishedAt: new Date() }
    }).catch(rethrowPersistenceError);
    if (result.count !== 1) throw new PersistenceError("NOT_FOUND", "Publication not found");
  }

  async getPublication(publicationId: string): Promise<Publication> {
    const row = await this.prisma.designPublication.findUnique({
      where: { id: publicationId },
      include: { designRevision: true }
    });
    if (!row) throw new PersistenceError("NOT_FOUND", "Publication not found");
    const snapshot = parseDesignSnapshot(row.designRevision.snapshot);
    return {
      id: row.id,
      designId: row.designId,
      designRevisionId: row.designRevisionId,
      visibility: row.visibility as "UNLISTED" | "PUBLIC",
      allowRemix: row.allowRemix,
      creatorDisplayMode: row.creatorDisplayMode,
      status: row.publicationStatus,
      publishedAt: row.publishedAt,
      unpublishedAt: row.unpublishedAt,
      design: toPublicDesign({
        ...snapshot,
        production: { ...snapshot.production, productionNotes: [] }
      })
    };
  }
}
