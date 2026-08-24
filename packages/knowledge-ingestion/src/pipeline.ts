import { createHash } from "node:crypto";

import {
  PersistenceError,
  type DatabaseClient,
  type KnowledgeRepository,
  type StoredKnowledgeSource
} from "@mystcrag/database";
import { SourceCrawlStrategySchema } from "@mystcrag/design-contract";

import { structuredRuleToSeed, type StructuredFeed } from "./extract/candidates.js";
import { GemProfileExtractor } from "./extract/gem-profile-extractor.js";
import { PatternExtractor } from "./extract/pattern-extractor.js";
import { createSemanticExtractorFromEnv } from "./extract/semantic-extractor.js";
import { StructuredExtractor } from "./extract/structured-extractor.js";
import type { ExtractorInput, KnowledgeExtractor, KnowledgeRuleSeed } from "./extract/extractor.js";
import { fetchStructuredFeed } from "./fetchers/json-api.js";
import { fetchHtmlDocuments } from "./fetchers/static-html.js";
import { contentHash } from "./security.js";

export type IngestionDocumentRecord = {
  documentId: string;
  url: string;
  contentHash: string;
  parser: string;
  status: "FETCHED" | "PARSED" | "FAILED";
  created: boolean;
  candidateRuleIds: string[];
};

export type IngestionRunResult = {
  sourceId: string;
  fetchedAt: string;
  documents: IngestionDocumentRecord[];
  createdDocuments: number;
  duplicateDocuments: number;
  insertedCandidates: number;
  /** Same-fact candidates whose sourceRef was merged into an existing rule (§19). */
  corroboratedCandidates: number;
  duplicateCandidates: number;
};

export type IngestionOptions = {
  database: DatabaseClient;
  repository: KnowledgeRepository;
  /** SSRF guard escape hatch for local fixture servers; production keeps it off. */
  allowPrivateNetworks?: boolean;
  /** Optional temp directory for Crawlee's request storage. */
  crawlerStorageDir?: string;
  maxPages?: number;
  /**
   * Extractor composition (Quality Phase Q2, extended for Batch B). Default:
   * StructuredExtractor + PatternExtractor + GemProfileExtractor +
   * env-configured SemanticExtractor. Structured documents run the
   * `structured` extractors; free-text documents run the rest. A failing
   * free-text extractor degrades to the remaining ones.
   */
  extractors?: readonly KnowledgeExtractor[];
};

type PendingDocument = {
  url: string;
  title: string;
  contentText: string;
  parser: string;
  rules: Array<Parameters<typeof structuredRuleToSeed>[0]>;
};

/**
 * The E2E-1 chain: Discover (enabled source) -> Fetch -> Parse ->
 * Deduplicate (content hash) -> KnowledgeCandidate (rules with provenance).
 * Re-running against unchanged content creates no duplicate documents and no
 * duplicate candidate rules.
 */
export async function runIngestionPipeline(
  source: StoredKnowledgeSource,
  options: IngestionOptions
): Promise<IngestionRunResult> {
  if (!source.enabled) {
    throw new Error(`SOURCE_DISABLED: ${source.id}`);
  }
  const fetchedAt = new Date().toISOString();

  let pending: PendingDocument[];
  if (source.sourceType === "OFFICIAL_API") {
    const feed: StructuredFeed = await fetchStructuredFeed(source, {
      allowPrivateNetworks: options.allowPrivateNetworks
    });
    pending = feed.documents.map((document) => ({
      url: document.url,
      title: document.title,
      contentText: document.contentText,
      parser: "structured-json-v1",
      rules: document.rules
    }));
  } else if (source.sourceType === "STATIC_HTML" || source.sourceType === "BROWSER_AUTOMATION") {
    // An absent crawlStrategy must NOT parse as "all defaults": the schema
    // defaults followLinks to false, which would silently disable discovery
    // for legacy sources stored without a strategy row.
    const strategy =
      source.crawlStrategy === undefined || source.crawlStrategy === null
        ? undefined
        : SourceCrawlStrategySchema.safeParse(source.crawlStrategy);
    const strategyData = strategy?.success ? strategy.data : undefined;
    const runMaxPages = options.maxPages ?? strategyData?.maxPages ?? 10;
    const maxPages =
      strategyData === undefined ? runMaxPages : Math.min(runMaxPages, strategyData.maxPages);
    const documents = await fetchHtmlDocuments(source, {
      allowPrivateNetworks: options.allowPrivateNetworks,
      maxPages,
      followLinks: strategyData?.followLinks ?? source.sourceType === "STATIC_HTML",
      pathPatterns: strategyData?.pathPatterns,
      maxDepth: strategyData?.maxDepth,
      seedPaths: strategyData?.seedPaths,
      storageDir: options.crawlerStorageDir
    });
    pending = documents.map((document) => ({
      url: document.url,
      title: document.title,
      contentText: document.contentText,
      parser: "static-html-basic",
      rules: []
    }));
  } else {
    throw new Error(`UNSUPPORTED_SOURCE_TYPE: ${source.id} (${source.sourceType})`);
  }

  const extractors = options.extractors ?? [
    new StructuredExtractor(),
    new PatternExtractor(),
    new GemProfileExtractor(),
    createSemanticExtractorFromEnv()
  ];

  const records: IngestionDocumentRecord[] = [];
  let createdDocuments = 0;
  let duplicateDocuments = 0;
  let insertedCandidates = 0;
  let corroboratedCandidates = 0;
  let duplicateCandidates = 0;

  for (const document of pending) {
    const hash = contentHash(`${document.title}\n${document.contentText}`);
    const documentId = `doc-ing-${hash.slice(0, 16)}`;
    const { created } = await options.repository.upsertDocument({
      id: documentId,
      sourceId: source.id,
      url: document.url,
      contentHash: hash,
      title: document.title,
      contentText: document.contentText,
      fetchedAt,
      parser: document.parser,
      language: source.language,
      status: "PARSED"
    });
    if (created) {
      createdDocuments += 1;
    } else {
      duplicateDocuments += 1;
    }

    const extractorInput: ExtractorInput = {
      documentId,
      title: document.title,
      contentText: document.contentText,
      fetchedAt,
      source: {
        sourceId: source.id,
        sourceCategory: source.sourceCategory,
        reliabilityLevel: source.reliabilityLevel,
        allowedKnowledgeDomains: source.allowedKnowledgeDomains
      }
    };

    let seeds: KnowledgeRuleSeed[] = [];
    if (document.rules.length > 0) {
      for (const extractor of extractors.filter((e) => e.method === "structured")) {
        seeds.push(
          ...(await extractor.extract({ ...extractorInput, structuredRules: document.rules }))
        );
      }
    } else if (created) {
      for (const extractor of extractors.filter((e) => e.method !== "structured")) {
        try {
          seeds.push(...(await extractor.extract(extractorInput)));
        } catch {
          // One degraded extractor (e.g. an unreachable LLM endpoint) must not
          // drop the deterministic candidates of the others.
        }
      }
    }

    const candidateRuleIds: string[] = [];
    for (const seed of seeds) {
      try {
        await options.repository.insertRule(seed);
        insertedCandidates += 1;
        candidateRuleIds.push(seed.id);
      } catch (error) {
        if (
          error instanceof PersistenceError &&
          error.code === "DUPLICATE_KNOWLEDGE"
        ) {
          // Task book §19: an independent source reporting the same value
          // corroborates the existing rule instead of being dropped.
          const ref = seed.sourceRefs[0];
          let merged: Awaited<ReturnType<typeof options.repository.corroborateRule>> = null;
          if (ref !== undefined) {
            try {
              merged = await options.repository.corroborateRule(
                seed.fingerprint,
                { sourceId: seed.sourceId, documentId: ref.documentId },
                seedEvidence(seed)
              );
            } catch (corroborationError) {
              if (
                !(
                  corroborationError instanceof PersistenceError &&
                  corroborationError.code === "NOT_FOUND"
                )
              ) {
                throw corroborationError;
              }
            }
          }
          if (merged !== null) {
            corroboratedCandidates += 1;
            candidateRuleIds.push(merged.id);
          } else {
            duplicateCandidates += 1;
          }
        } else {
          throw error;
        }
      }
    }

    records.push({
      documentId,
      url: document.url,
      contentHash: hash,
      parser: document.parser,
      status: "PARSED",
      created,
      candidateRuleIds
    });
  }

  return {
    sourceId: source.id,
    fetchedAt,
    documents: records,
    createdDocuments,
    duplicateDocuments,
    insertedCandidates,
    corroboratedCandidates,
    duplicateCandidates
  };
}

/** Sentence-level evidence carried inside a seed's payload, if any (Q2). */
function seedEvidence(seed: KnowledgeRuleSeed): ReadonlyArray<{
  documentId: string;
  sentence: string;
  startOffset: number;
  endOffset: number;
}> | undefined {
  const extraction = (seed.payload as { extraction?: { evidence?: unknown } }).extraction;
  if (
    typeof seed.payload !== "object" ||
    seed.payload === null ||
    Array.isArray(seed.payload) ||
    typeof extraction !== "object" ||
    extraction === null ||
    !Array.isArray(extraction.evidence)
  ) {
    return undefined;
  }
  return extraction.evidence.filter(
    (
      entry
    ): entry is { documentId: string; sentence: string; startOffset: number; endOffset: number } =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { documentId?: unknown }).documentId === "string" &&
      typeof (entry as { sentence?: unknown }).sentence === "string" &&
      typeof (entry as { startOffset?: unknown }).startOffset === "number" &&
      typeof (entry as { endOffset?: unknown }).endOffset === "number"
  );
}

export function documentIdForContent(title: string, contentText: string): string {
  const hash = createHash("sha256").update(`${title}\n${contentText}`).digest("hex");
  return `doc-ing-${hash.slice(0, 16)}`;
}
