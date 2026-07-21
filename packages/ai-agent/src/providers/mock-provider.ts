import type { AgentContext } from "../contracts/agent";
import type { RecommendationRequest } from "../contracts/recommendation";
import type { LLMProvider } from "./llm-provider";

export class MockProvider implements LLMProvider {
  readonly providerId = "mock-provider";
  readonly providerVersion = "1.0.0";

  constructor(private readonly output: unknown) {}

  async generate(_request: RecommendationRequest, _context: AgentContext): Promise<unknown> {
    return structuredClone(this.output);
  }
}
