import {
  KnowledgeCollectionRunRepository,
  type DatabaseClient,
  type KnowledgeRepository,
  type PersistedKnowledgeCollectionRun,
  type StoredKnowledgeRule,
  type StoredKnowledgeSource
} from "@mystcrag/database";
import {
  GEMOLOGY_PROPERTY_KEYS,
  VISUAL_PROPERTY_KEYS
} from "@mystcrag/knowledge-ingestion";
import { listTaxonomyTerms, type TaxonomyTerm } from "@mystcrag/design-contract";

import { COVERAGE_BY_KNOWLEDGE_DOMAIN } from "../cli/collect.js";
import { COVERAGE_DOMAINS } from "../cli/coverage-matrix.js";
import { detectRuleConflicts } from "../review/rules.js";

/**
 * Knowledge Console V1 computations (task book Track B). Everything here reads
 * the live database — a committed JSON report is never the production truth.
 * The heavy lifting is in pure functions over rule lists so the numbers are
 * unit-testable without a database.
 */

export type ConsoleTaxonomyTerm = {
  id: string;
  displayName: { zh: string; en: string };
};

export type ConsoleCoverageDomain = {
  domain: string;
  target: number;
  current: number;
  missing: number;
  percentage: number;
  coveredTaxonomyTerms: ConsoleTaxonomyTerm[];
  missingTaxonomyTerms: ConsoleTaxonomyTerm[];
};

export type ConsoleSourceStats = {
  sourceId: string;
  name: string;
  sourceType: string;
  sourceCategory: string;
  authorityScore: number;
  reliabilityLevel: string;
  reviewStatus: string;
  enabled: boolean;
  documents: number;
  candidateCount: number;
  approvedRuleCount: number;
  lastFetch: string | null;
  failureCount: number;
  yield: number;
};

export type ConsoleCrystalAtlasRow = {
  crystalId: string;
  displayName: { zh: string; en: string };
  gemologyCompleteness: number;
  visualCompleteness: number;
  culturalCompleteness: number;
  associationCount: number;
  conflictCount: number;
};

export type ConsoleCrystalAtlasDetail = {
  row: ConsoleCrystalAtlasRow;
  properties: Array<{
    property: string;
    value: string;
    knowledgeDomain: string;
    ruleId: string;
    status: string;
    confidence: number;
    sourceIds: string[];
  }>;
  relations: Array<{
    relation: string;
    knowledgeDomain: string;
    ruleId: string;
    status: string;
    confidence: number;
    payload: unknown;
    sourceIds: string[];
  }>;
  sources: Array<{ sourceId: string; ruleCount: number }>;
};

/** Rules that count toward coverage: anything not thrown away or retired. */
function isLiveRule(rule: StoredKnowledgeRule): boolean {
  return rule.status !== "REJECTED" && rule.status !== "SUPERSEDED";
}

/** Which taxonomy domain's terms measure a coverage domain's term coverage. */
const COVERAGE_DOMAIN_TAXONOMY: Readonly<Record<string, string>> = {
  CRYSTAL_GEMOLOGY: "MATERIAL",
  CRYSTAL_VISUAL_PROPERTIES: "MATERIAL",
  CRYSTAL_CULTURAL_SYMBOLISM: "MATERIAL",
  MATERIAL_COMPATIBILITY: "MATERIAL",
  NEGATIVE_RULE: "MATERIAL",
  COLOR_THEORY: "COLOR",
  STYLE: "STYLE",
  WUXING: "WUXING",
  WUXING_CRYSTAL_ASSOCIATION: "MATERIAL",
  ZODIAC: "ZODIAC",
  ZODIAC_CRYSTAL_ASSOCIATION: "MATERIAL",
  TAROT: "TAROT",
  TAROT_SYMBOLISM: "TAROT",
  TAROT_CRYSTAL_ASSOCIATION: "MATERIAL"
};

const CULTURAL_DOMAINS = new Set([
  "knowledge-domain:cultural-symbolism",
  "knowledge-domain:historical-tradition"
]);

function toConsoleTerm(term: TaxonomyTerm): ConsoleTaxonomyTerm {
  return { id: term.id, displayName: { zh: term.displayName.zh, en: term.displayName.en } };
}

export function computeCoverageDomains(
  rules: readonly StoredKnowledgeRule[],
  termsByCoverageDomain: ReadonlyMap<string, readonly TaxonomyTerm[]>
): ConsoleCoverageDomain[] {
  const live = rules.filter(isLiveRule);
  const currentByDomain = new Map<string, number>();
  const coveredSubjectsByDomain = new Map<string, Set<string>>();
  for (const rule of live) {
    const coverage = COVERAGE_BY_KNOWLEDGE_DOMAIN[rule.knowledgeDomain];
    if (coverage === undefined) continue;
    currentByDomain.set(coverage, (currentByDomain.get(coverage) ?? 0) + 1);
    const subjects = coveredSubjectsByDomain.get(coverage) ?? new Set<string>();
    subjects.add(rule.subject);
    coveredSubjectsByDomain.set(coverage, subjects);
  }

  return COVERAGE_DOMAINS.map((domain) => {
    const current = currentByDomain.get(domain.domain) ?? 0;
    const terms = termsByCoverageDomain.get(domain.domain) ?? [];
    const coveredSubjects = coveredSubjectsByDomain.get(domain.domain) ?? new Set<string>();
    const covered = terms.filter((term) => coveredSubjects.has(term.id));
    const missing = terms.filter((term) => !coveredSubjects.has(term.id));
    return {
      domain: domain.domain,
      target: domain.target,
      current,
      missing: Math.max(0, domain.target - current),
      percentage: domain.target === 0 ? 0 : Math.min(1, current / domain.target),
      coveredTaxonomyTerms: covered.map(toConsoleTerm),
      missingTaxonomyTerms: missing.map(toConsoleTerm)
    };
  });
}

export function computeSourceStats(
  sources: readonly StoredKnowledgeSource[],
  rules: readonly StoredKnowledgeRule[],
  documentCounts: Readonly<Record<string, number>>,
  failureCounts: Readonly<Record<string, number>>
): ConsoleSourceStats[] {
  const candidatesBySource = new Map<string, number>();
  const approvedBySource = new Map<string, number>();
  const validBySource = new Map<string, number>();
  for (const rule of rules) {
    const sourceId = rule.sourceRefs[0]?.sourceId ?? rule.sourceId;
    candidatesBySource.set(sourceId, (candidatesBySource.get(sourceId) ?? 0) + 1);
    if (rule.status === "APPROVED") {
      approvedBySource.set(sourceId, (approvedBySource.get(sourceId) ?? 0) + 1);
    }
    if (isLiveRule(rule)) {
      validBySource.set(sourceId, (validBySource.get(sourceId) ?? 0) + 1);
    }
  }

  return sources.map((source) => {
    const documents = documentCounts[source.id] ?? 0;
    const valid = validBySource.get(source.id) ?? 0;
    return {
      sourceId: source.id,
      name: source.name,
      sourceType: source.sourceType,
      sourceCategory: source.sourceCategory,
      authorityScore: source.authorityScore,
      reliabilityLevel: source.reliabilityLevel,
      reviewStatus: source.reviewStatus,
      enabled: source.enabled,
      documents,
      candidateCount: candidatesBySource.get(source.id) ?? 0,
      approvedRuleCount: approvedBySource.get(source.id) ?? 0,
      lastFetch: source.lastSuccessfulFetch ?? null,
      failureCount: failureCounts[source.id] ?? 0,
      // Task book definition: validCandidates / documents; a source with no
      // documents has no yield rather than an undefined ratio.
      yield: documents === 0 ? 0 : Number((valid / documents).toFixed(4))
    };
  });
}

function ruleSourceIds(rule: StoredKnowledgeRule): string[] {
  return [...new Set(rule.sourceRefs.map((ref) => ref.sourceId))];
}

function propertyOf(rule: StoredKnowledgeRule): string | null {
  if (rule.relation !== "has-property") return null;
  const payload = rule.payload as { property?: unknown };
  return typeof payload.property === "string" ? payload.property : null;
}

export function computeCrystalAtlas(
  rules: readonly StoredKnowledgeRule[]
): ConsoleCrystalAtlasRow[] {
  const materials = listTaxonomyTerms("MATERIAL");
  const conflicts = detectRuleConflicts(rules.filter(isLiveRule));
  const conflictCounts = new Map<string, number>();
  for (const group of conflicts) {
    conflictCounts.set(
      group.key.subject,
      (conflictCounts.get(group.key.subject) ?? 0) + group.rules.length
    );
  }

  const rows: ConsoleCrystalAtlasRow[] = [];
  for (const material of materials) {
    const own = rules.filter((rule) => rule.subject === material.id);
    const live = own.filter(isLiveRule);

    const gemologyProps = new Set(
      live
        .map((rule) => propertyOf(rule))
        .filter(
          (property): property is string =>
            property !== null && GEMOLOGY_PROPERTY_KEYS.includes(property)
        )
    );
    const visualProps = new Set(
      live
        .map((rule) => propertyOf(rule))
        .filter(
          (property): property is string =>
            property !== null && VISUAL_PROPERTY_KEYS.includes(property)
        )
    );
    const culturalKinds = new Set(
      live.filter((rule) => CULTURAL_DOMAINS.has(rule.knowledgeDomain)).map((rule) => rule.relation)
    );

    rows.push({
      crystalId: material.id,
      displayName: { zh: material.displayName.zh, en: material.displayName.en },
      gemologyCompleteness: gemologyProps.size / GEMOLOGY_PROPERTY_KEYS.length,
      visualCompleteness: visualProps.size / VISUAL_PROPERTY_KEYS.length,
      culturalCompleteness: culturalKinds.size / 2,
      associationCount: live.filter(
        (rule) => rule.relation !== "has-property" && !CULTURAL_DOMAINS.has(rule.knowledgeDomain)
      ).length,
      conflictCount: conflictCounts.get(material.id) ?? 0
    });
  }
  return rows.sort((a, b) => b.gemologyCompleteness - a.gemologyCompleteness);
}

export function computeCrystalAtlasDetail(
  crystalId: string,
  rules: readonly StoredKnowledgeRule[]
): ConsoleCrystalAtlasDetail | null {
  const allRows = computeCrystalAtlas(rules);
  const row = allRows.find((entry) => entry.crystalId === crystalId);
  if (row === undefined) return null;

  const own = rules
    .filter((rule) => rule.subject === crystalId)
    .sort((a, b) => (a.id < b.id ? -1 : 1));

  const properties: ConsoleCrystalAtlasDetail["properties"] = [];
  const relations: ConsoleCrystalAtlasDetail["relations"] = [];
  const sourceRuleCounts = new Map<string, number>();
  for (const rule of own) {
    for (const sourceId of ruleSourceIds(rule)) {
      sourceRuleCounts.set(sourceId, (sourceRuleCounts.get(sourceId) ?? 0) + 1);
    }
    const property = propertyOf(rule);
    const payload = rule.payload as { value?: unknown };
    if (property !== null && typeof payload.value === "string") {
      properties.push({
        property,
        value: payload.value,
        knowledgeDomain: rule.knowledgeDomain,
        ruleId: rule.id,
        status: rule.status,
        confidence: rule.confidence,
        sourceIds: ruleSourceIds(rule)
      });
    } else {
      relations.push({
        relation: rule.relation,
        knowledgeDomain: rule.knowledgeDomain,
        ruleId: rule.id,
        status: rule.status,
        confidence: rule.confidence,
        payload: rule.payload,
        sourceIds: ruleSourceIds(rule)
      });
    }
  }

  return {
    row,
    properties,
    relations,
    sources: [...sourceRuleCounts.entries()]
      .map(([sourceId, ruleCount]) => ({ sourceId, ruleCount }))
      .sort((a, b) => (a.sourceId < b.sourceId ? -1 : 1))
  };
}

export type KnowledgeConsoleServiceOptions = {
  database: DatabaseClient;
  repository: KnowledgeRepository;
};

export class KnowledgeConsoleService {
  private readonly repository: KnowledgeRepository;
  private readonly collectionRuns: KnowledgeCollectionRunRepository;

  constructor(options: KnowledgeConsoleServiceOptions) {
    this.repository = options.repository;
    this.collectionRuns = new KnowledgeCollectionRunRepository(options.database);
  }

  async getCoverage(): Promise<ConsoleCoverageDomain[]> {
    const [rules, termsByCoverageDomain] = await Promise.all([
      this.repository.listAllRules(),
      this.loadTermsByCoverageDomain()
    ]);
    return computeCoverageDomains(rules, termsByCoverageDomain);
  }

  async getSourceStats(): Promise<ConsoleSourceStats[]> {
    const [sources, rules, documentCounts, failureCounts] = await Promise.all([
      this.repository.listSources(),
      this.repository.listAllRules(),
      this.repository.countDocumentsBySource(),
      this.repository.listSourceFailureCounts()
    ]);
    return computeSourceStats(sources, rules, documentCounts, failureCounts);
  }

  async getCrystalAtlas(): Promise<ConsoleCrystalAtlasRow[]> {
    const rules = await this.repository.listAllRules();
    return computeCrystalAtlas(rules);
  }

  async getCrystalAtlasDetail(crystalId: string): Promise<ConsoleCrystalAtlasDetail | null> {
    const rules = await this.repository.listAllRules();
    return computeCrystalAtlasDetail(crystalId, rules);
  }

  async listCollectionRuns(limit?: number): Promise<PersistedKnowledgeCollectionRun[]> {
    return this.collectionRuns.listRuns({ limit });
  }

  private loadTermsByCoverageDomain(): Promise<Map<string, readonly TaxonomyTerm[]>> {
    const taxonomyDomains = new Set(Object.values(COVERAGE_DOMAIN_TAXONOMY));
    const termsByDomain = new Map<string, readonly TaxonomyTerm[]>();
    for (const domain of taxonomyDomains) {
      termsByDomain.set(domain, listTaxonomyTerms(domain as TaxonomyTerm["domain"]));
    }
    const result = new Map<string, readonly TaxonomyTerm[]>();
    for (const [coverageDomain, taxonomyDomain] of Object.entries(COVERAGE_DOMAIN_TAXONOMY)) {
      result.set(coverageDomain, termsByDomain.get(taxonomyDomain) ?? []);
    }
    return Promise.resolve(result);
  }
}
