import { normalizeCandidateCompliance, type ComplianceIssue } from "../../compliance-agent/index";
import type { AgentContext } from "../contracts/agent";
import { RecommendationRequestSchema } from "../contracts/recommendation";
import type { LLMProvider } from "../providers/llm-provider";
import type { AiDesignCandidate } from "../schemas/ai-design-candidate.schema";
import { RecommendationProviderOutputSchema } from "../schemas/recommendation-output.schema";

export type RecommendationIssue = {
  readonly code: "INVALID_REQUEST" | "PROVIDER_ERROR" | "INVALID_PROVIDER_OUTPUT" | "COMPLIANCE_REJECTED";
  readonly message: string;
  readonly fieldPath?: string;
  readonly complianceIssue?: ComplianceIssue;
};

export type RecommendationResult =
  | { readonly status: "READY"; readonly candidates: readonly [AiDesignCandidate, AiDesignCandidate, AiDesignCandidate]; readonly issues: readonly [] }
  | { readonly status: "REJECTED"; readonly issues: readonly RecommendationIssue[] };

export async function generateRecommendations(
  provider: LLMProvider,
  requestInput: unknown,
  context: AgentContext
): Promise<RecommendationResult> {
  const requestResult = RecommendationRequestSchema.safeParse(requestInput);
  if (!requestResult.success) {
    return {
      status: "REJECTED",
      issues: requestResult.error.issues.map((issue) => ({
        code: "INVALID_REQUEST",
        message: issue.message,
        fieldPath: issue.path.join(".") || undefined
      }))
    };
  }

  let providerOutput: unknown;
  try {
    providerOutput = await provider.generate(requestResult.data, context);
  } catch {
    return {
      status: "REJECTED",
      issues: [{ code: "PROVIDER_ERROR", message: "The recommendation provider could not produce a candidate response." }]
    };
  }
  const outputResult = RecommendationProviderOutputSchema.safeParse(providerOutput);
  if (!outputResult.success) {
    return {
      status: "REJECTED",
      issues: outputResult.error.issues.map((issue) => ({
        code: "INVALID_PROVIDER_OUTPUT",
        message: issue.message,
        fieldPath: issue.path.join(".") || undefined
      }))
    };
  }

  const normalized = outputResult.data.candidates.map((candidate) => normalizeCandidateCompliance(candidate));
  const complianceIssues = normalized.flatMap((result) => result.status === "REJECTED" ? result.issues : []);
  if (complianceIssues.length > 0) {
    return {
      status: "REJECTED",
      issues: complianceIssues.map((issue) => ({
        code: "COMPLIANCE_REJECTED",
        message: issue.message,
        fieldPath: issue.fieldPath,
        complianceIssue: issue
      }))
    };
  }

  const candidates = normalized.map((result) => {
    if (result.status !== "PASSED") {
      throw new Error("Compliance result changed after rejection handling.");
    }
    return result.candidate;
  });

  return {
    status: "READY",
    candidates: [candidates[0]!, candidates[1]!, candidates[2]!],
    issues: []
  };
}
