import type {
  DatabaseClient,
  KnowledgeRepository,
  StoredKnowledgeSource
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
  duplicateCandidates: number;
};

export type CoverageReportCandidateByDomain = {
  domain: string;
  sourceCount: number;
  sources: string[];
};

/** `collect` output: §27 coverage report after a real crawl (requires DB). */
export type CoverageReport = {
  reportId: string;
  phase: "coverage-report";
  generatedAt: string;
  dryRun: false;
  sourcesCrawled: number;
  documentsAdded: number;
  documentsSkippedDuplicates: number;
  candidatesInserted: number;
  candidatesSkippedDuplicates: number;
  review: ReviewPipelineSummary;
  sources: CoverageReportSource[];
  candidatesByDomain: CoverageReportCandidateByDomain[];
  coverageGaps: CoverageAnalysisDomain[];
};

const REPORT_DATE = "2026-08-22";

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
  service: KnowledgeReviewService
): Promise<CoverageReport> {
  // Deferred so the ingestion bundle (crawlee, fetchers) is only loaded when a
  // real crawl runs — `collect --dry-run` and every other CLI command stay
  // lightweight and DB-free.
  const { runIngestionPipeline } = await import("@mystcrag/knowledge-ingestion");

  const crawlable = await repository.listCrawlableSources();

  const sourceResults: CoverageReportSource[] = [];
  let documentsAdded = 0;
  let documentsSkippedDuplicates = 0;
  let candidatesInserted = 0;
  let candidatesSkippedDuplicates = 0;

  for (const source of crawlable) {
    const run: IngestionRunResult = await runIngestionPipeline(source, {
      database,
      repository
    });
    documentsAdded += run.createdDocuments;
    documentsSkippedDuplicates += run.duplicateDocuments;
    candidatesInserted += run.insertedCandidates;
    candidatesSkippedDuplicates += run.duplicateCandidates;
    sourceResults.push({
      sourceId: run.sourceId,
      createdDocuments: run.createdDocuments,
      duplicateDocuments: run.duplicateDocuments,
      insertedCandidates: run.insertedCandidates,
      duplicateCandidates: run.duplicateCandidates
    });
  }

  const review = await service.runReviewPipeline();

  const crawledIds = new Set(crawlable.map((source: StoredKnowledgeSource) => source.id));
  const candidatesByDomain: CoverageReportCandidateByDomain[] = COVERAGE_DOMAINS.map(
    (domain) => {
      const sources = domain.sources.filter((id) => crawledIds.has(id));
      return { domain: domain.domain, sourceCount: sources.length, sources };
    }
  );
  const coverageGaps: CoverageAnalysisDomain[] = COVERAGE_DOMAINS.map((domain) => ({
    domain: domain.domain,
    target: domain.target,
    current: domain.current,
    missing: domain.missing
  }));

  return {
    reportId: `coverage-report-${REPORT_DATE}`,
    phase: "coverage-report",
    generatedAt: new Date().toISOString(),
    dryRun: false,
    sourcesCrawled: crawlable.length,
    documentsAdded,
    documentsSkippedDuplicates,
    candidatesInserted,
    candidatesSkippedDuplicates,
    review,
    sources: sourceResults,
    candidatesByDomain,
    coverageGaps
  };
}
