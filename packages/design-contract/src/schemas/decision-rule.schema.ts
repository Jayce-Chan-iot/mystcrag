import { z } from "zod";

import { IdentifierSchema } from "./component.schema";
import { JsonValueSchema, type JsonValue } from "./json.schema";

export const RulePrioritySchema = z.enum([
  "P0",
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
  "P8"
]);

export const RuleHardnessSchema = z.enum(["HARD", "SOFT"]);

export type RuleCondition =
  | { fact: string; operator: string; value?: JsonValue; path?: string }
  | { all: RuleCondition[] }
  | { any: RuleCondition[] }
  | { not: RuleCondition };

export const RuleConditionSchema: z.ZodType<RuleCondition> = z.lazy(() =>
  z.union([
    z.strictObject({
      fact: IdentifierSchema,
      operator: IdentifierSchema,
      value: JsonValueSchema.optional(),
      path: z.string().trim().min(1).optional()
    }),
    z.strictObject({ all: z.array(RuleConditionSchema).min(1) }),
    z.strictObject({ any: z.array(RuleConditionSchema).min(1) }),
    z.strictObject({ not: RuleConditionSchema })
  ])
);

export const RuleActionSchema = z.strictObject({
  kind: IdentifierSchema,
  params: JsonValueSchema.default({})
});

export const DecisionRuleSchema = z.strictObject({
  id: IdentifierSchema,
  type: IdentifierSchema,
  priority: RulePrioritySchema,
  hardness: RuleHardnessSchema,
  conditions: RuleConditionSchema,
  action: RuleActionSchema,
  weight: z.number().min(0).max(1).default(1),
  confidence: z.number().min(0).max(1).default(1),
  knowledgeRefs: z.array(IdentifierSchema).max(100).default([]),
  contextRefs: z.array(IdentifierSchema).max(100).default([])
});

export type RulePriority = z.infer<typeof RulePrioritySchema>;
export type RuleHardness = z.infer<typeof RuleHardnessSchema>;
export type RuleAction = z.infer<typeof RuleActionSchema>;
export type DecisionRule = z.infer<typeof DecisionRuleSchema>;
