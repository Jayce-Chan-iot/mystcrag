import type {
  DatabaseClient,
  KnowledgeRepository,
  StoredKnowledgeDocument,
  StoredKnowledgeRule
} from "@mystcrag/database";
import type { KnowledgeType } from "@mystcrag/design-contract";

import type { EmbeddingProvider } from "./search/embedding-provider.js";
import { vectorToPgLiteral } from "./search/embedding-provider.js";
import { reciprocalRankFusion } from "./search/rrf.js";

export type KnowledgeSearchQuery = {
  /** Free text; drives the keyword channel and (when configured) the vector channel. */
  text?: string;
  knowledgeTypes?: KnowledgeType[];
  knowledgeDomains?: string[];
  /** Canonical taxonomy ids, e.g. "color:blue" or "material:labradorite". */
  subjects?: string[];
  /** Default true: only APPROVED rules of the current PUBLISHED knowledge version. */
  productionOnly?: boolean;
  limit?: number;
};

export type KnowledgeSearchHit = {
  rule: StoredKnowledgeRule;
  score: number;
  channels: { structured: boolean; keyword: boolean; vector: boolean };
};

export type KnowledgeSearchStrategy = "structured" | "keyword" | "vector" | "hybrid";

export type KnowledgeSearchResult = {
  knowledgeVersion: string;
  strategy: KnowledgeSearchStrategy;
  hits: KnowledgeSearchHit[];
};

export type KnowledgeCoreOptions = {
  database: DatabaseClient;
  repository: KnowledgeRepository;
  /**
   * Optional semantic vector provider. When absent (or when it fails at
   * runtime) retrieval degrades to structured + keyword channels only.
   */
  embeddings?: EmbeddingProvider;
};

const KEYWORD_CHANNEL_LIMIT = 50;
const VECTOR_CHANNEL_LIMIT = 50;

export class KnowledgeCore {
  private readonly database: DatabaseClient;
  private readonly repository: KnowledgeRepository;
  private readonly embeddings: EmbeddingProvider | undefined;

  constructor(options: KnowledgeCoreOptions) {
    this.database = options.database;
    this.repository = options.repository;
    this.embeddings = options.embeddings;
  }

  async searchKnowledge(query: KnowledgeSearchQuery): Promise<KnowledgeSearchResult> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const productionOnly = query.productionOnly !== false;
    const production = productionOnly
      ? await this.repository.getLatestPublishedVersion()
      : null;
    const knowledgeVersion = production?.version ?? "any";

    const hasStructuralFilters =
      (query.knowledgeTypes?.length ?? 0) > 0 ||
      (query.knowledgeDomains?.length ?? 0) > 0 ||
      (query.subjects?.length ?? 0) > 0;
    const text = query.text?.trim() ?? "";

    const structuredRanks: string[] = [];
    if (hasStructuralFilters && productionOnly) {
      const rules = await this.repository.listProductionRules({
        knowledgeTypes: query.knowledgeTypes,
        knowledgeDomains: query.knowledgeDomains,
        subjects: query.subjects,
        limit: 2000
      });
      structuredRanks.push(...rules.map((rule) => rule.id));
    }

    const keywordRanks: string[] = [];
    if (text.length > 0) {
      const documents = await this.repository.searchDocuments(text, {
        limit: KEYWORD_CHANNEL_LIMIT
      });
      if (documents.length > 0) {
        const rules = await this.repository.listRulesByDocumentIds(
          documents.map((document) => document.documentId),
          { productionOnly }
        );
        keywordRanks.push(...rules.map((rule) => rule.id));
      }
    }

    const vectorRanks: string[] = [];
    if (text.length > 0 && this.embeddings !== undefined) {
      try {
        vectorRanks.push(...(await this.vectorDocumentSearch(text)));
      } catch {
        // Embedding/vector failures must never break retrieval (spec section 25):
        // structured + keyword channels remain fully usable.
      }
    }

    const channels = {
      structured: structuredRanks,
      keyword: keywordRanks,
      vector: vectorRanks
    };
    const activeLists = Object.values(channels).filter((list) => list.length > 0);

    let strategy: KnowledgeSearchStrategy = "structured";
    if (activeLists.length === 0) {
      if (productionOnly) {
        const rules = await this.repository.listProductionRules({ limit });
        return {
          knowledgeVersion,
          strategy,
          hits: rules.map((rule) => ({
            rule,
            score: 1 / 61,
            channels: { structured: true, keyword: false, vector: false }
          }))
        };
      }
      return { knowledgeVersion, strategy, hits: [] };
    }

    const activeCount = activeLists.length;
    const activeNames = (Object.keys(channels) as Array<keyof typeof channels>).filter(
      (name) => channels[name].length > 0
    );
    strategy =
      activeCount > 1 ? "hybrid" : (activeNames[0] as KnowledgeSearchStrategy);

    const fused = reciprocalRankFusion(activeLists, { limit });
    if (fused.length === 0) {
      return { knowledgeVersion, strategy, hits: [] };
    }

    const rulesById = new Map(
      (await this.repository.listRulesByIds(fused.map((entry) => entry.id))).map((rule) => [
        rule.id,
        rule
      ])
    );

    const hits: KnowledgeSearchHit[] = [];
    for (const entry of fused) {
      const rule = rulesById.get(entry.id);
      if (rule === undefined) continue;
      hits.push({
        rule,
        score: Number(entry.score.toFixed(6)),
        channels: {
          structured: structuredRanks.includes(entry.id),
          keyword: keywordRanks.includes(entry.id),
          vector: vectorRanks.includes(entry.id)
        }
      });
    }
    return { knowledgeVersion, strategy, hits };
  }

  /** Production rules matching a filter, ordered deterministically by id. */
  async getRules(filter?: {
    knowledgeTypes?: KnowledgeType[];
    knowledgeDomains?: string[];
    subjects?: string[];
    limit?: number;
  }): Promise<StoredKnowledgeRule[]> {
    return this.repository.listProductionRules(filter);
  }

  /** COLOR_THEORY rules whose subject is the given color taxonomy id. */
  async getColorRules(colorTaxonomyId: string): Promise<StoredKnowledgeRule[]> {
    return this.repository.listProductionRules({
      knowledgeTypes: ["COLOR_THEORY"],
      subjects: [colorTaxonomyId]
    });
  }

  /** MATERIAL_COMPATIBILITY rules for a material taxonomy id. */
  async getMaterialCompatibility(materialTaxonomyId: string): Promise<StoredKnowledgeRule[]> {
    return this.repository.listProductionRules({
      knowledgeTypes: ["MATERIAL_COMPATIBILITY"],
      subjects: [materialTaxonomyId]
    });
  }

  /** Composition/proportion/transition/focal rules ("what layout to prefer"). */
  async getDesignFormula(): Promise<StoredKnowledgeRule[]> {
    return this.repository.listProductionRules({
      knowledgeTypes: ["COMPOSITION_RULE", "PROPORTION_RULE", "TRANSITION_RULE", "FOCAL_RULE"]
    });
  }

  /**
   * Generate and persist embeddings for documents that lack one for the
   * configured provider. Returns the number of newly indexed documents.
   */
  async indexEmbeddings(limit = 500): Promise<{ indexed: number; model: string | null }> {
    if (this.embeddings === undefined) return { indexed: 0, model: null };
    const model = this.embeddings.modelId;

    const documents = await this.database.$queryRawUnsafe<
      Array<{ id: string; title: string; content_text: string }>
    >(
      `SELECT d."id", d."title", d."content_text"
       FROM "knowledge_documents" d
       LEFT JOIN "knowledge_embeddings" e ON e."document_id" = d."id" AND e."model" = $1
       WHERE e."id" IS NULL
       ORDER BY d."id" ASC
       LIMIT $2`,
      model,
      Math.min(Math.max(limit, 1), 2000)
    );
    if (documents.length === 0) return { indexed: 0, model };

    const vectors = await this.embeddings.embed(
      documents.map((document) => `${document.title}\n${document.content_text}`)
    );

    for (let index = 0; index < documents.length; index++) {
      const document = documents[index];
      const vector = vectors[index];
      if (document === undefined || vector === undefined) continue;
      await this.database.$executeRawUnsafe(
        `INSERT INTO "knowledge_embeddings" ("id", "document_id", "model", "embedding")
         VALUES ($1, $2, $3, $4::vector)
         ON CONFLICT ("document_id", "model")
         DO UPDATE SET "embedding" = EXCLUDED."embedding"`,
        `emb-${model}-${document.id}`,
        document.id,
        model,
        vectorToPgLiteral(vector)
      );
    }
    return { indexed: documents.length, model };
  }

  private async vectorDocumentSearch(text: string): Promise<string[]> {
    if (this.embeddings === undefined) return [];
    const [queryVector] = await this.embeddings.embed([text]);
    if (queryVector === undefined) return [];
    const rows = await this.database.$queryRawUnsafe<Array<{ document_id: string }>>(
      `SELECT e."document_id"
       FROM "knowledge_embeddings" e
       WHERE e."model" = $1
       ORDER BY e."embedding" <=> $2::vector
       LIMIT $3`,
      this.embeddings.modelId,
      vectorToPgLiteral(queryVector),
      VECTOR_CHANNEL_LIMIT
    );
    const documentIds = rows.map((row) => row.document_id);
    if (documentIds.length === 0) return [];
    const rules = await this.repository.listRulesByDocumentIds(documentIds);
    return rules.map((rule) => rule.id);
  }
}

export type { StoredKnowledgeDocument, StoredKnowledgeRule };
