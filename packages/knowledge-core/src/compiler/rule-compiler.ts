import { createHash } from "node:crypto";

import {
  RuleConditionSchema,
  type DecisionRule,
  type KnowledgeType,
  type RecommendationContext,
  type RuleCondition,
  type RulePriority
} from "@mystcrag/design-contract";
import type {
  StoredKnowledgeRule,
  StoredKnowledgeSource
} from "@mystcrag/database";

/**
 * Canonical JSON with recursively sorted object keys, so semantically equal
 * condition objects always produce the same string regardless of key order.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * Rule Compiler (task book section 18, spec section 4.1): turns the APPROVED
 * production knowledge set into Active Decision Rules for the design engine.
 * The pipeline is pure and deterministic — same rules, sources, catalog, and
 * options always produce the byte-identical rule set.
 *
 * Priority ladder follows task book section 17:
 * P3 material compatibility, P4 color design, P5 style/visual preference,
 * P6 tarot/cultural context, P7 composition aesthetics, P8 market trends.
 * P0-P2 stay reserved for the engine-level hard constraints (production
 * legality, user hard requirements, inventory/budget) that the design
 * engine injects ahead of the compiled knowledge rules.
 */
export const DEFAULT_MIN_SOURCE_AUTHORITY = 0.6;

const PRIORITY_BY_TYPE: Record<KnowledgeType, RulePriority> = {
  MATERIAL_COMPATIBILITY: "P3",
  COLOR_THEORY: "P4",
  STYLE_RULE: "P5",
  CULTURAL_SYMBOLISM: "P6",
  TAROT: "P6",
  PROPORTION_RULE: "P7",
  COMPOSITION_RULE: "P7",
  TRANSITION_RULE: "P7",
  FOCAL_RULE: "P7",
  MARKET_OBSERVATION: "P8",
  NEGATIVE_RULE: "P4"
};

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

/** Subject prefixes that only ever appear through the user context. */
const CONTEXT_FACT_SUBJECT_PREFIXES = ["tarot:", "style:", "emotion:"];

/** Types whose rules apply structurally regardless of user preferences. */
const STRUCTURAL_TYPES = new Set<KnowledgeType>([
  "MATERIAL_COMPATIBILITY",
  "NEGATIVE_RULE",
  "PROPORTION_RULE",
  "COMPOSITION_RULE",
  "TRANSITION_RULE",
  "FOCAL_RULE"
]);

/** Subjects that must exist in the active catalog for the rule to matter. */
const CATALOG_FEASIBLE_PREFIXES = ["material:", "color:"];

export type CatalogFeasibilitySnapshot = {
  productCatalogVersion: string;
  /** Taxonomy refs (material:*, color:*) present in the active catalog. */
  availableTaxonomyRefs: readonly string[];
};

export type RuleCompileScope = {
  knowledgeTypes?: readonly KnowledgeType[];
  subjects?: readonly string[];
};

export type RuleCompileOptions = {
  scope?: RuleCompileScope;
  context?: RecommendationContext;
  /**
   * When true, preference-driven rules whose subject does not appear in the
   * context are dropped (recommend path). Structural rules always stay.
   */
  contextFilter?: boolean;
  minSourceAuthority?: number;
};

export type RuleCompileStats = {
  input: number;
  statusFiltered: number;
  scopeFiltered: number;
  authorityFiltered: number;
  contextFiltered: number;
  infeasible: number;
  duplicates: number;
  conflictDropped: number;
  output: number;
};

export type CompiledRuleSet = {
  knowledgeVersion: string;
  productCatalogVersion: string;
  decisionRuleSetVersion: string;
  rules: DecisionRule[];
  stats: RuleCompileStats;
  warnings: string[];
};

type RankedRule = {
  rule: StoredKnowledgeRule;
  authority: number;
  weight: number;
  priority: RulePriority;
  hardness: "HARD" | "SOFT";
  contextRefs: string[];
};

function ruleAuthority(
  rule: StoredKnowledgeRule,
  sources: ReadonlyMap<string, StoredKnowledgeSource>
): number {
  let authority = 0;
  for (const ref of rule.sourceRefs) {
    const source = sources.get(ref.sourceId);
    if (source !== undefined && source.authorityScore > authority) {
      authority = source.authorityScore;
    }
  }
  return authority;
}

function rulePriorityAndHardness(rule: StoredKnowledgeRule): {
  priority: RulePriority;
  hardness: "HARD" | "SOFT";
} {
  if (rule.knowledgeType === "NEGATIVE_RULE") {
    // Physical material prohibitions are hard design constraints; visual
    // color clashes stay soft guidance.
    if (rule.subject.startsWith("material:")) {
      return { priority: "P3", hardness: "HARD" };
    }
    return { priority: "P4", hardness: "SOFT" };
  }
  return { priority: PRIORITY_BY_TYPE[rule.knowledgeType], hardness: "SOFT" };
}

function isContextDrivenSubject(subject: string): boolean {
  return CONTEXT_FACT_SUBJECT_PREFIXES.some((prefix) => subject.startsWith(prefix));
}

function buildCondition(rule: StoredKnowledgeRule): RuleCondition {
  const authored = RuleConditionSchema.safeParse(rule.conditions);
  if (authored.success && Object.keys(rule.conditions ?? {}).length > 0) {
    return authored.data;
  }
  return {
    fact: isContextDrivenSubject(rule.subject)
      ? "contextTaxonomyRefs"
      : "designTaxonomyRefs",
    operator: "contains",
    value: rule.subject
  };
}

function contextTaxonomyRefs(context: RecommendationContext): Set<string> {
  return new Set([
    ...context.preferences.emotionTags,
    ...context.preferences.styleTags,
    ...context.preferences.colorPreferences,
    ...context.preferences.visualPreferences,
    ...context.avoidances.materialIds,
    ...context.avoidances.colorFamilyIds
  ]);
}

function avoidanceRefs(context: RecommendationContext): Set<string> {
  return new Set([
    ...context.avoidances.materialIds,
    ...context.avoidances.colorFamilyIds
  ]);
}

function toDecisionRule(ranked: RankedRule): DecisionRule {
  const { rule } = ranked;
  return {
    id: `dr-${rule.id}`,
    type: rule.knowledgeType,
    priority: ranked.priority,
    hardness: ranked.hardness,
    conditions: buildCondition(rule),
    action: { kind: rule.relation, params: rule.payload },
    weight: ranked.weight,
    confidence: rule.confidence,
    knowledgeRefs: [rule.id],
    contextRefs: ranked.contextRefs
  };
}

/**
 * Canonical deterministic ordering (spec conflict-resolution ladder):
 * priority rank, hardness, weight, confidence, then id. Used both to pick
 * conflict winners and to order the compiled output.
 */
function compareRanked(a: RankedRule, b: RankedRule): number {
  const rankDelta = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (rankDelta !== 0) return rankDelta;
  if (a.hardness !== b.hardness) return a.hardness === "HARD" ? -1 : 1;
  if (a.weight !== b.weight) return b.weight - a.weight;
  if (a.rule.confidence !== b.rule.confidence) {
    return b.rule.confidence - a.rule.confidence;
  }
  return a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0;
}

function decisionRuleSetVersion(
  knowledgeVersion: string,
  productCatalogVersion: string,
  rules: readonly RankedRule[]
): string {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        knowledgeVersion,
        productCatalogVersion,
        ruleIds: rules.map((ranked) => ranked.rule.id)
      })
    )
    .digest("hex");
  return `ruleset-${fingerprint.slice(0, 12)}`;
}

/**
 * Compiles production knowledge rules into Active Decision Rules. Pure and
 * deterministic: the caller supplies the (already APPROVED-gated) rules, the
 * source registry, and a catalog feasibility snapshot.
 */
export function compileDecisionRules(input: {
  knowledgeVersion: string;
  rules: readonly StoredKnowledgeRule[];
  sources: ReadonlyMap<string, StoredKnowledgeSource>;
  catalog: CatalogFeasibilitySnapshot;
  options?: RuleCompileOptions;
}): CompiledRuleSet {
  const { knowledgeVersion, rules, sources, catalog } = input;
  const options = input.options ?? {};
  const minAuthority = options.minSourceAuthority ?? DEFAULT_MIN_SOURCE_AUTHORITY;

  const stats: RuleCompileStats = {
    input: rules.length,
    statusFiltered: 0,
    scopeFiltered: 0,
    authorityFiltered: 0,
    contextFiltered: 0,
    infeasible: 0,
    duplicates: 0,
    conflictDropped: 0,
    output: 0
  };

  const context = options.context;
  const contextTags = context !== undefined ? contextTaxonomyRefs(context) : null;
  const avoidedTags = context !== undefined ? avoidanceRefs(context) : null;
  const scope = options.scope;
  const scopeTypes =
    scope?.knowledgeTypes !== undefined ? new Set(scope.knowledgeTypes) : null;
  const scopeSubjects =
    scope?.subjects !== undefined ? new Set(scope.subjects) : null;
  const available = new Set(catalog.availableTaxonomyRefs);

  const warnings: string[] = [];
  const candidates: RankedRule[] = [];

  for (const rule of rules) {
    // Knowledge status: only APPROVED rules may enter production (task book
    // section 12; the repository enforces this for published versions, the
    // compiler defends in depth for direct callers).
    if (rule.status !== "APPROVED") {
      stats.statusFiltered += 1;
      continue;
    }

    // Relevance scope filter.
    if (scopeTypes !== null && !scopeTypes.has(rule.knowledgeType)) {
      stats.scopeFiltered += 1;
      continue;
    }
    if (scopeSubjects !== null && !scopeSubjects.has(rule.subject)) {
      stats.scopeFiltered += 1;
      continue;
    }

    // Source credibility: the strongest cited source must clear the
    // authority threshold.
    const authority = ruleAuthority(rule, sources);
    if (authority < minAuthority) {
      stats.authorityFiltered += 1;
      continue;
    }

    // User context: rules the user explicitly avoided never apply, and with
    // contextFilter on, preference-driven rules must match a context tag.
    if (avoidedTags !== null && avoidedTags.has(rule.subject)) {
      stats.contextFiltered += 1;
      continue;
    }
    const matchedTags =
      contextTags !== null
        ? [...contextTags].filter((tag) => tag === rule.subject)
        : [];
    if (
      options.contextFilter === true &&
      contextTags !== null &&
      !STRUCTURAL_TYPES.has(rule.knowledgeType) &&
      matchedTags.length === 0
    ) {
      stats.contextFiltered += 1;
      continue;
    }

    // Catalog feasibility: a rule about a material or color that no active
    // product covers can never fire.
    if (
      CATALOG_FEASIBLE_PREFIXES.some((prefix) => rule.subject.startsWith(prefix)) &&
      !available.has(rule.subject)
    ) {
      stats.infeasible += 1;
      continue;
    }

    const { priority, hardness } = rulePriorityAndHardness(rule);
    candidates.push({
      rule,
      authority,
      weight: Number((rule.confidence * authority).toFixed(4)),
      priority,
      hardness,
      contextRefs: matchedTags
    });
  }

  // Rule dedup by fingerprint (task book section 18).
  const seenFingerprints = new Set<string>();
  const deduped: RankedRule[] = [];
  for (const ranked of candidates) {
    if (seenFingerprints.has(ranked.rule.fingerprint)) {
      stats.duplicates += 1;
      continue;
    }
    seenFingerprints.add(ranked.rule.fingerprint);
    deduped.push(ranked);
  }

  // Conflict detection and resolution: divergent rules that would apply in
  // the SAME situation (same type, subject, relation, and applicability
  // conditions) keep one deterministic winner. Rules guarded by different
  // conditions apply in different situations — they are complementary, not
  // conflicting — so conditions join the situation key.
  const droppedIds = new Set<string>();
  const situationGroups = new Map<string, RankedRule[]>();
  for (const ranked of deduped) {
    const key = [
      ranked.rule.knowledgeType,
      ranked.rule.subject,
      ranked.rule.relation,
      canonicalJson(ranked.rule.conditions)
    ].join("\u0000");
    const bucket = situationGroups.get(key);
    if (bucket === undefined) situationGroups.set(key, [ranked]);
    else bucket.push(ranked);
  }
  for (const [key, groupRules] of situationGroups) {
    if (groupRules.length <= 1) continue;
    if (new Set(groupRules.map((ranked) => ranked.rule.fingerprint)).size <= 1) {
      continue;
    }
    const ordered = [...groupRules].sort(compareRanked);
    const winner = ordered[0];
    if (winner === undefined) continue;
    const losers = ordered.slice(1);
    const [type, subject, relation] = key.split("\u0000");
    for (const loser of losers) {
      droppedIds.add(loser.rule.id);
      stats.conflictDropped += 1;
      warnings.push(
        `conflict resolved: dropped ${loser.rule.id} in favor of ${winner.rule.id} (${type}/${subject}/${relation})`
      );
    }
  }

  const survived = deduped.filter((ranked) => !droppedIds.has(ranked.rule.id));
  survived.sort(compareRanked);
  const compiled = survived.map(toDecisionRule);
  stats.output = compiled.length;

  return {
    knowledgeVersion,
    productCatalogVersion: catalog.productCatalogVersion,
    decisionRuleSetVersion: decisionRuleSetVersion(
      knowledgeVersion,
      catalog.productCatalogVersion,
      survived
    ),
    rules: compiled,
    stats,
    warnings
  };
}
