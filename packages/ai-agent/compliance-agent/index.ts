import type { Agent, AgentContext, AgentResult } from "../contracts";
import { AiDesignCandidateSchema, type AiDesignCandidate } from "../src/schemas/ai-design-candidate.schema";

export type RestrictedCopyCategory =
  | "MEDICAL_EFFECT"
  | "PSYCHOLOGICAL_DIAGNOSIS"
  | "GUARANTEED_WEALTH"
  | "GUARANTEED_FORTUNE_CHANGE"
  | "DETERMINISTIC_FORTUNE_PREDICTION";

export type ComplianceIssue = {
  readonly code: string;
  readonly category: RestrictedCopyCategory;
  readonly fieldPath: string;
  readonly message: string;
};

export type ComplianceAgentInput = {
  readonly candidate: unknown;
};

export type ComplianceAgentOutput =
  | { readonly status: "PASSED"; readonly candidate: AiDesignCandidate; readonly issues: readonly [] }
  | { readonly status: "REJECTED"; readonly issues: readonly ComplianceIssue[] };

const restrictedCopyRules: readonly {
  readonly code: string;
  readonly category: RestrictedCopyCategory;
  readonly pattern: RegExp;
}[] = [
  { code: "CLAIM_MEDICAL_EFFECT", category: "MEDICAL_EFFECT", pattern: /(?:cure|heal|treat(?:ment)?|medical effect|治愈|治疗|疗效|治病)/iu },
  { code: "CLAIM_PSYCHOLOGICAL_DIAGNOSIS", category: "PSYCHOLOGICAL_DIAGNOSIS", pattern: /(?:diagnos(?:e|is)|you (?:are|have) (?:depressed|depression|anxious|anxiety)|心理诊断|你有抑郁|你有焦虑)/iu },
  { code: "CLAIM_GUARANTEED_WEALTH", category: "GUARANTEED_WEALTH", pattern: /(?:guarantee(?:d|s)? wealth|guarantee(?:d|s)? fortune|保证招财|必定招财)/iu },
  { code: "CLAIM_GUARANTEED_FORTUNE_CHANGE", category: "GUARANTEED_FORTUNE_CHANGE", pattern: /(?:guarantee(?:d|s)? (?:luck|fortune) change|保证改运|必定转运)/iu },
  { code: "CLAIM_DETERMINISTIC_FORTUNE", category: "DETERMINISTIC_FORTUNE_PREDICTION", pattern: /(?:certain destiny|deterministic fortune|will definitely happen|确定性命运|命中注定|一定会发生)/iu }
];

function candidateTextFields(candidate: AiDesignCandidate): readonly { readonly path: string; readonly value: string }[] {
  return [
    { path: "designName", value: candidate.designName },
    { path: "designStory", value: candidate.designStory },
    ...candidate.recommendationReasons.map((value, index) => ({ path: `recommendationReasons.${index}`, value })),
    ...candidate.culturalInspiration.flatMap((entry, index) => [
      { path: `culturalInspiration.${index}.reference`, value: entry.reference },
      { path: `culturalInspiration.${index}.inspiration`, value: entry.inspiration }
    ])
  ];
}

export function normalizeCandidateCompliance(input: unknown): ComplianceAgentOutput {
  const parsed = AiDesignCandidateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "REJECTED",
      issues: parsed.error.issues.map((issue) => ({
        code: "INVALID_CANDIDATE",
        category: "MEDICAL_EFFECT",
        fieldPath: issue.path.join("."),
        message: issue.message
      }))
    };
  }

  const issues = candidateTextFields(parsed.data).flatMap(({ path, value }) =>
    restrictedCopyRules
      .filter((rule) => rule.pattern.test(value))
      .map((rule) => ({
        code: rule.code,
        category: rule.category,
        fieldPath: path,
        message: "Remove restricted deterministic, diagnostic, medical, or guaranteed-effect wording."
      }))
  );

  return issues.length > 0
    ? { status: "REJECTED", issues }
    : { status: "PASSED", candidate: parsed.data, issues: [] };
}

export class RuleComplianceAgent implements Agent<ComplianceAgentInput, ComplianceAgentOutput> {
  readonly name = "rule-compliance-agent";

  async execute(input: ComplianceAgentInput, _context: AgentContext): Promise<AgentResult<ComplianceAgentOutput>> {
    return { data: normalizeCandidateCompliance(input.candidate), warnings: [] };
  }
}

export type ComplianceAgent = Agent<ComplianceAgentInput, ComplianceAgentOutput>;
