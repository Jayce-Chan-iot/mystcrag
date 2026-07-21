import type { AgentContext } from "../contracts/agent";
import type { RecommendationRequest } from "../contracts/recommendation";

/**
 * Replaceable provider boundary. Implementations must be treated as producing
 * untrusted unknown values, including deterministic local implementations.
 */
export interface LLMProvider {
  readonly providerId: string;
  readonly providerVersion: string;
  generate(request: RecommendationRequest, context: AgentContext): Promise<unknown>;
}
