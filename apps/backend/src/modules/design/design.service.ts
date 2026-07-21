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
