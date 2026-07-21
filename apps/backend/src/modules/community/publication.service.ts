import type { Publication, PublicationRepository } from "@mystcrag/database";

export class PublicationService {
  constructor(private readonly publications: PublicationRepository) {}

  publishDesign(
    actorId: string,
    designId: string,
    revisionNumber: number
  ): Promise<Publication> {
    return this.publications.publishDesign(actorId, designId, revisionNumber);
  }

  unpublishDesign(actorId: string, publicationId: string): Promise<void> {
    return this.publications.unpublishDesign(actorId, publicationId);
  }

  getPublication(publicationId: string): Promise<Publication> {
    return this.publications.getPublication(publicationId);
  }
}
