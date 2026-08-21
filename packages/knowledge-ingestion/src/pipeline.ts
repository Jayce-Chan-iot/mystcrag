import { createHash } from "node:crypto";

import {
  PersistenceError,
  type DatabaseClient,
  type KnowledgeRepository,
  type StoredKnowledgeSource
} from "@mystcrag/database";

import {
  extractFreeTextCandidates,
  structuredRuleToSeed,
  type KnowledgeRuleSeed,
  type StructuredFeed
} from "./extract/candidates.js";
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
    const strategy = source.crawlStrategy;
    const runMaxPages = options.maxPages ?? strategy?.maxPages ?? 10;
    const maxPages =
      strategy === undefined ? runMaxPages : Math.min(runMaxPages, strategy.maxPages);
    const documents = await fetchHtmlDocuments(source, {
      allowPrivateNetworks: options.allowPrivateNetworks,
      maxPages,
      followLinks: strategy?.followLinks ?? source.sourceType === "STATIC_HTML",
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

  const records: IngestionDocumentRecord[] = [];
  let createdDocuments = 0;
  let duplicateDocuments = 0;
  let insertedCandidates = 0;
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

    const seeds: KnowledgeRuleSeed[] =
      document.rules.length > 0
        ? document.rules.map((rule) =>
            structuredRuleToSeed(rule, { sourceId: source.id, documentId, fetchedAt })
          )
        : created
          ? extractFreeTextCandidates(document.contentText, {
              documentId,
              sourceId: source.id,
              fetchedAt
            })
          : [];

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
          duplicateCandidates += 1;
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
    duplicateCandidates
  };
}

export function documentIdForContent(title: string, contentText: string): string {
  const hash = createHash("sha256").update(`${title}\n${contentText}`).digest("hex");
  return `doc-ing-${hash.slice(0, 16)}`;
}
