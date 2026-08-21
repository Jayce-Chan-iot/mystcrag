import { Engine, Rule, type TopLevelCondition } from "json-rules-engine";

import type { DecisionRule, RulePriority } from "@mystcrag/design-contract";

import type { DesignFacts } from "./facts.js";
import type { ConstraintViolation } from "./types.js";

const PRIORITY_RANK: Record<RulePriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
  P5: 5,
  P6: 6,
  P7: 7,
  P8: 8
};

/** Relations whose firing marks the design as violating a hard rule. */
const NEGATIVE_RELATIONS = new Set([
  "conflicts-with",
  "avoid",
  "forbidden-claims"
]);

export type RuleEvaluation = {
  firedRuleIds: string[];
  /** Σ weight × confidence over fired SOFT rules (ADR-6 typed scoring layer). */
  softScore: number;
  hardRequirementsMet: number;
  violations: ConstraintViolation[];
};

function toEngineRule(rule: DecisionRule): Rule {
  const conditions =
    "fact" in rule.conditions ? { all: [rule.conditions] } : rule.conditions;
  return new Rule({
    name: rule.id,
    priority: 8 - PRIORITY_RANK[rule.priority],
    conditions: conditions as TopLevelCondition,
    event: {
      type: "rule-fired",
      params: { ruleId: rule.id, hardness: rule.hardness }
    }
  });
}

/**
 * ADR-6 typed scoring layer: runs the compiled rule set through
 * json-rules-engine and joins fired event rule ids back to the rule set to
 * compute Σ SoftRuleScore and detect hard-rule violations. Deterministic:
 * identical facts and rule sets always produce identical output.
 */
export async function evaluateRuleSet(
  rules: readonly DecisionRule[],
  facts: DesignFacts
): Promise<RuleEvaluation> {
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]));

  const engine = new Engine();
  for (const rule of rules) engine.addRule(toEngineRule(rule));
  const result = await engine.run(facts as unknown as Record<string, unknown>);

  const firedRuleIds: string[] = [];
  let softScore = 0;
  let hardRequirementsMet = 0;
  const violations: ConstraintViolation[] = [];

  for (const event of result.events) {
    const params = (event as { params?: { ruleId?: string } }).params ?? {};
    const rule = params.ruleId !== undefined ? rulesById.get(params.ruleId) : undefined;
    if (rule === undefined) continue;
    firedRuleIds.push(rule.id);
    if (rule.hardness === "HARD") {
      if (NEGATIVE_RELATIONS.has(rule.action.kind)) {
        violations.push({
          code: "HARD_RULE",
          message: `Hard rule ${rule.id} (${rule.action.kind}) fired for this design`,
          ruleId: rule.id
        });
      } else {
        hardRequirementsMet += 1;
      }
    } else {
      softScore += rule.weight * rule.confidence;
    }
  }

  return {
    firedRuleIds: [...new Set(firedRuleIds)].sort(),
    softScore: Number(softScore.toFixed(6)),
    hardRequirementsMet,
    violations
  };
}

export { NEGATIVE_RELATIONS };
