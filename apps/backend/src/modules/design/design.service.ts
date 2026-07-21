import type {
  DesignRepository,
  PersistedDesign,
  PersistedDesignRevision
} from "@mystcrag/database";
import type { DesignV1 } from "@mystcrag/design-contract";

import { DomainApiError } from "../../contracts/api-error.js";

export type DesignStubOperation =
  | "GENERATE"
  | "UPDATE"
  | "PRICE"
  | "SAVE"
  | "PUBLISH"
  | "CREATE_ORDER";

export interface DesignStubService {
  execute(operation: DesignStubOperation, input: unknown): Promise<unknown>;
}

export class NotImplementedDesignStubService implements DesignStubService {
  async execute(operation: DesignStubOperation): Promise<never> {
    throw new DomainApiError(
      "NOT_IMPLEMENTED",
      `${operation} orchestration is not implemented in Phase 2B.`
    );
  }
}

export class DesignService {
  constructor(private readonly designs: DesignRepository) {}

  createDesign(actorId: string, snapshot: DesignV1): Promise<PersistedDesign> {
    return this.designs.createDesign(actorId, snapshot);
  }

  getDesign(actorId: string, designId: string): Promise<PersistedDesign> {
    return this.designs.getDesign(actorId, designId);
  }

  updateDesign(
    actorId: string,
    designId: string,
    expectedRevision: number,
    snapshot: DesignV1,
    changeReason: string
  ): Promise<PersistedDesign> {
    return this.designs.updateDesign(
      actorId,
      designId,
      expectedRevision,
      snapshot,
      changeReason
    );
  }

  createRevision(
    actorId: string,
    designId: string,
    expectedRevision: number,
    snapshot: DesignV1,
    changeReason: string
  ): Promise<PersistedDesign> {
    return this.updateDesign(actorId, designId, expectedRevision, snapshot, changeReason);
  }

  listDesignRevisions(
    actorId: string,
    designId: string
  ): Promise<PersistedDesignRevision[]> {
    return this.designs.listDesignRevisions(actorId, designId);
  }
}
