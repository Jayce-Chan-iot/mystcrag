import type {
  DatabaseClient,
  KnowledgeRepository
} from "@mystcrag/database";
import {
  KnowledgeCollectionRunRepository,
  type CollectionRunError,
  type CollectionRunSourceResult
} from "@mystcrag/database";
import type { IngestionRunResult } from "@mystcrag/knowledge-ingestion";

import type { KnowledgeReviewService, ReviewPipelineSummary } from "../review/review-service.js";
import { COVERAGE_DOMAINS, COLLECT_BATCHES } from "./coverage-matrix.js";

export type CoverageAnalysisDomain = {
  domain: string;
  target: number;
  current: number;
  missing: number;
};

export type CoverageAnalysisBatch = {
  name: string;
  sourceCount: number;
  sources: string[];
};

/** `collect --dry-run` output: a DB-free coverage analysis. */
export type CoverageAnalysis = {
  reportId: string;
  phase: "coverage-analysis";
  generatedAt: string;
  dryRun: true;
  domains: CoverageAnalysisDomain[];
  sources: string[];
  sourceCount: number;
  batches: CoverageAnalysisBatch[];
  batchCount: number;
};

export type CoverageReportSource = {
  sourceId: string;
  createdDocuments: number;
  duplicateDocuments: number;
  insertedCandidates: number;
  /** Same-fact candidates merged into existing rules (task book §19 corroboration). */
  corroboratedCandidates: number;
  duplicateCandidates: number;
};

export type CoverageReportCandidateByDomain = {
  /** The candidate's verbatim `knowledgeDomain`, e.g. "knowledge-domain:material-compatibility". */
  domain: string;
  candidateCount: number;
  /** Rule ids of the candidates in this domain. */
  candidates: string[];
};

/** `collect` output: §27 coverage report after a real crawl (requires DB). */
export type CoverageReport = {
  reportId: string;
  phase: "coverage-report";
  generatedAt: string;
  dryRun: false;
  /** Id of the persisted CollectionRun row this crawl wrote (task book Track B). */
  collectionRunId: string;
  sourcesCrawled: number;
  documentsAdded: number;
  documentsSkippedDuplicates: number;
  candidatesInserted: number;
  candidatesSkippedDuplicates: number;
  review: ReviewPipelineSummary;
  sources: CoverageReportSource[];
  candidatesByDomain: CoverageReportCandidateByDomain[];
  /** Static Round-1 target matrix, with `current`/`missing` attributed from this run's inserted candidates. */
  coverageTargets: CoverageAnalysisDomain[];
};

const REPORT_DATE = "2026-08-22";

/**
 * Best-effort correspondence from a candidate's `knowledgeDomain` string to a
 * Round-1 coverage-domain name. Coverage domains with no entry here (e.g.
 * CRYSTAL_VISUAL_PROPERTIES) simply stay at their embedded `current` (0)
 * until a candidate with a mapped domain is inserted. Exact mapping is a
 * Round-2 design refinement; this covers every domain a pattern-extracted
 * candidate can currently produce.
 */
export const COVERAGE_BY_KNOWLEDGE_DOMAIN: Readonly<Record<string, string>> = {
  "knowledge-domain:material-compatibility": "MATERIAL_COMPATIBILITY",
  "knowledge-domain:negative-rule": "NEGATIVE_RULE",
  "knowledge-domain:color-theory": "COLOR_THEORY",
  "knowledge-domain:style-rule": "STYLE",
  "knowledge-domain:composition-rule": "COMPOSITION",
  "knowledge-domain:proportion-rule": "PROPORTION",
  "knowledge-domain:focal-rule": "FOCAL",
  "knowledge-domain:transition-rule": "TRANSITION",
  "knowledge-domain:cultural-symbolism": "CRYSTAL_CULTURAL_SYMBOLISM",
  "knowledge-domain:market-observation": "MARKET_OBSERVATION",
  "knowledge-domain:wuxing": "WUXING",
  "knowledge-domain:wuxing-crystal-association": "WUXING_CRYSTAL_ASSOCIATION",
  "knowledge-domain:zodiac": "ZODIAC",
  "knowledge-domain:zodiac-crystal-association": "ZODIAC_CRYSTAL_ASSOCIATION",
  "knowledge-domain:tarot": "TAROT",
  "knowledge-domain:tarot-symbolism": "TAROT_SYMBOLISM",
  "knowledge-domain:tarot-crystal-association": "TAROT_CRYSTAL_ASSOCIATION",
  "knowledge-domain:gemological-fact": "CRYSTAL_GEMOLOGY",
  "knowledge-domain:scientific-fact": "CRYSTAL_GEMOLOGY",
  "knowledge-domain:crystal-gemology": "CRYSTAL_GEMOLOGY",
  "knowledge-domain:crystal-visual-properties": "CRYSTAL_VISUAL_PROPERTIES",
  "knowledge-domain:design-principle": "JEWELRY_DESIGN",
  "knowledge-domain:design-heuristic": "JEWELRY_DESIGN",
  "knowledge-domain:historical-tradition": "CRYSTAL_CULTURAL_SYMBOLISM"
};

function distinctSources(domains: readonly { sources: string[] }[]): string[] {
  return [...new Set(domains.flatMap((domain) => domain.sources))].sort();
}

/**
 * Pure coverage analysis from the embedded matrix. Never reads DATABASE_URL,
 * never constructs a PrismaClient, and never touches the filesystem, so it
 * runs with no database and no fixtures on disk.
 */
export function runCollectDryRun(): CoverageAnalysis {
  const domains: CoverageAnalysisDomain[] = COVERAGE_DOMAINS.map((domain) => ({
    domain: domain.domain,
    target: domain.target,
    current: domain.current,
    missing: domain.missing
  }));

  const sources = distinctSources(COVERAGE_DOMAINS);

  const batches: CoverageAnalysisBatch[] = COLLECT_BATCHES.map((batch) => {
    const batchSources = distinctSources(
      COVERAGE_DOMAINS.filter((domain) => batch.domains.includes(domain.domain))
    );
    return {
      name: batch.name,
      sourceCount: batchSources.length,
      sources: batchSources
    };
  });

  return {
    reportId: `coverage-analysis-${REPORT_DATE}`,
    phase: "coverage-analysis",
    generatedAt: REPORT_DATE,
    dryRun: true,
    domains,
    sources,
    sourceCount: sources.length,
    batches,
    batchCount: batches.length
  };
}

/**
 * §27 orchestration: crawl every approved+enabled source through the
 * ingestion pipeline, classify the extracted candidates through the review
 * pipeline, then emit a coverage report. Never publishes a version.
 */
export async function runCollectBatch(
  database: DatabaseClient,
  repository: KnowledgeRepository,
  service: KnowledgeReviewService,
  options?: {
    /** SSRF guard escape hatch for local fixture servers; production keeps it off. */
    allowPrivateNetworks?: boolean;
    /** Optional temp directory for Crawlee's request storage. */
    crawlerStorageDir?: string;
  }
): Promise<CoverageReport> {
  // Deferred so the ingestion bundle (crawlee, fetchers) is only loaded when a
  // real crawl runs — `collect --dry-run` and every other CLI command stay
  // lightweight and DB-free.
  const { runIngestionPipeline } = await import("@mystcrag/knowledge-ingestion");

  const collectionRuns = new KnowledgeCollectionRunRepository(database);
  const startedRun = await collectionRuns.startRun({ startedAt: new Date() });

  const crawlable = await repository.listCrawlableSources();

  const sourceResults: CoverageReportSource[] = [];
  const runSourceResults: CollectionRunSourceResult[] = [];
  const runErrors: CollectionRunError[] = [];
  let documentsAdded = 0;
  let documentsSkippedDuplicates = 0;
  let candidatesInserted = 0;
  let candidatesSkippedDuplicates = 0;
  let candidatesCorroborated = 0;
  let sourcesCrawled = 0;

  for (const source of crawlable) {
    // One dead source (DNS failure, 5xx, robots block) must not void the whole
    // batch: record the error on the CollectionRun and keep the other sources.
    try {
      const run: IngestionRunResult = await runIngestionPipeline(source, {
        database,
        repository,
        ...(options?.allowPrivateNetworks === undefined
          ? {}
          : { allowPrivateNetworks: options.allowPrivateNetworks }),
        ...(options?.crawlerStorageDir === undefined
          ? {}
          : { crawlerStorageDir: options.crawlerStorageDir })
      });
      documentsAdded += run.createdDocuments;
      documentsSkippedDuplicates += run.duplicateDocuments;
      candidatesInserted += run.insertedCandidates;
      candidatesCorroborated += run.corroboratedCandidates;
      candidatesSkippedDuplicates += run.duplicateCandidates;
      sourcesCrawled += 1;
      sourceResults.push({
        sourceId: run.sourceId,
        createdDocuments: run.createdDocuments,
        duplicateDocuments: run.duplicateDocuments,
        insertedCandidates: run.insertedCandidates,
        corroboratedCandidates: run.corroboratedCandidates,
        duplicateCandidates: run.duplicateCandidates
      });
      runSourceResults.push({
        sourceId: run.sourceId,
        documentsAdded: run.createdDocuments,
        duplicateDocuments: run.duplicateDocuments,
        candidatesInserted: run.insertedCandidates,
        corroboratedCandidates: run.corroboratedCandidates,
        duplicateCandidates: run.duplicateCandidates
      });
    } catch (error) {
      runErrors.push({
        sourceId: source.id,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  try {
    const report = await buildCoverageReport(repository, service, {
      startedRunId: startedRun.id,
      sourcesCrawled,
      documentsAdded,
      documentsSkippedDuplicates,
      candidatesInserted,
      candidatesCorroborated,
      candidatesSkippedDuplicates,
      sourceResults,
      runSourceResults,
      runErrors
    });
    await collectionRuns.completeRun(startedRun.id, {
      finishedAt: new Date(),
      status: "COMPLETED",
      sourcesCrawled,
      documentsAdded,
      documentDuplicates: documentsSkippedDuplicates,
      candidatesInserted,
      corroboratedCandidates: candidatesCorroborated,
      candidateDuplicates: candidatesSkippedDuplicates,
      needsReview: report.review.needsReview,
      conflicts: report.review.conflicted,
      errors: runErrors,
      sourceResults: runSourceResults
    });
    return report;
  } catch (error) {
    // The crawl itself is done, so the counters are final even when the
    // post-crawl classification fails; record what happened before rethrowing.
    await collectionRuns
      .completeRun(startedRun.id, {
        finishedAt: new Date(),
        status: "FAILED",
        sourcesCrawled,
        documentsAdded,
        documentDuplicates: documentsSkippedDuplicates,
        candidatesInserted,
        corroboratedCandidates: candidatesCorroborated,
        candidateDuplicates: candidatesSkippedDuplicates,
        needsReview: 0,
        conflicts: 0,
        errors: [
          ...runErrors,
          {
            sourceId: "collect-pipeline",
            message: error instanceof Error ? error.message : String(error)
          }
        ],
        sourceResults: runSourceResults
      })
      .catch(() => undefined);
    throw error;
  }
}

type CoverageReportInputs = {
  startedRunId: string;
  sourcesCrawled: number;
  documentsAdded: number;
  documentsSkippedDuplicates: number;
  candidatesInserted: number;
  candidatesCorroborated: number;
  candidatesSkippedDuplicates: number;
  sourceResults: CoverageReportSource[];
  runSourceResults: CollectionRunSourceResult[];
  runErrors: CollectionRunError[];
};

async function buildCoverageReport(
  repository: KnowledgeRepository,
  service: KnowledgeReviewService,
  inputs: CoverageReportInputs
): Promise<CoverageReport> {
  const crawledIds = new Set(inputs.sourceResults.map((result) => result.sourceId));

  // Extractors insert ingested candidates directly at NEEDS_REVIEW, so the
  // pipeline's NEW→EXTRACTED→classify flow never sees them. Capture this run's
  // directly-inserted candidates *before* the pipeline runs, so the summary
  // never double-counts a NEW→classify→NEEDS_REVIEW candidate the pipeline
  // itself produces from a structured-source run.
  const runCandidates = (
    await repository.listRules({ status: "NEEDS_REVIEW", limit: 2000 })
  ).filter((rule) => crawledIds.has(rule.sourceRefs[0]?.sourceId ?? rule.sourceId));

  const review = await service.runReviewPipeline();
  review.needsReview += runCandidates.length;

  const byDomain = new Map<string, string[]>();
  for (const rule of runCandidates) {
    const ids = byDomain.get(rule.knowledgeDomain) ?? [];
    ids.push(rule.id);
    byDomain.set(rule.knowledgeDomain, ids);
  }
  const candidatesByDomain: CoverageReportCandidateByDomain[] = [...byDomain.entries()]
    .map(([domain, candidates]) => ({ domain, candidateCount: candidates.length, candidates }))
    .sort((a, b) => a.domain.localeCompare(b.domain));

  const insertedByCoverageDomain = new Map<string, number>();
  for (const rule of runCandidates) {
    const coverage = COVERAGE_BY_KNOWLEDGE_DOMAIN[rule.knowledgeDomain];
    if (coverage === undefined) continue;
    insertedByCoverageDomain.set(coverage, (insertedByCoverageDomain.get(coverage) ?? 0) + 1);
  }
  const coverageTargets: CoverageAnalysisDomain[] = COVERAGE_DOMAINS.map((domain) => {
    const current = insertedByCoverageDomain.get(domain.domain) ?? 0;
    return {
      domain: domain.domain,
      target: domain.target,
      current,
      missing: Math.max(0, domain.target - current)
    };
  });

  return {
    reportId: `coverage-report-${REPORT_DATE}`,
    phase: "coverage-report",
    generatedAt: new Date().toISOString(),
    dryRun: false,
    collectionRunId: inputs.startedRunId,
    sourcesCrawled: inputs.sourcesCrawled,
    documentsAdded: inputs.documentsAdded,
    documentsSkippedDuplicates: inputs.documentsSkippedDuplicates,
    candidatesInserted: inputs.candidatesInserted,
    candidatesSkippedDuplicates: inputs.candidatesSkippedDuplicates,
    review,
    sources: inputs.sourceResults,
    candidatesByDomain,
    coverageTargets
  };
}
