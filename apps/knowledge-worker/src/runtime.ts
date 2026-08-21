import PgBoss from "pg-boss";

import {
  createPrismaClient,
  KnowledgeRepository,
  type DatabaseClient
} from "@mystcrag/database";
import { HashEmbeddingProvider, KnowledgeCore } from "@mystcrag/knowledge-core";
import { runIngestionPipeline } from "@mystcrag/knowledge-ingestion";

import {
  KNOWLEDGE_JOBS,
  type DiscoverSourceJobData,
  type DiscoverSourceJobResult,
  type FetchDocumentJobData,
  type FetchDocumentJobResult,
  type GenerateEmbeddingJobData,
  type GenerateEmbeddingJobResult,
  type PublishKnowledgeJobData,
  type PublishKnowledgeJobResult
} from "./jobs.js";

export type KnowledgeWorkerOptions = {
  databaseUrl: string;
  /**
   * SSRF guard escape hatch for local fixture servers. Production keeps the
   * block on (task book section 46).
   */
  allowPrivateNetworks?: boolean;
  /** Temp directory for Crawlee's request storage. */
  crawlerStorageDir?: string;
  /** Max pages followed per static-HTML crawl. */
  maxPagesPerCrawl?: number;
  /** Queue-level retry policy for every job queue. Default 3. */
  retryLimit?: number;
  /** Base retry delay in seconds. Default 30. */
  retryDelaySeconds?: number;
  /** Exponential retry backoff. Default true. */
  retryBackoff?: boolean;
  /** Worker polling interval in seconds. Default 2. */
  pollingIntervalSeconds?: number;
  /**
   * Singleton window in seconds for fetch-document jobs per source: at most
   * one fetch per source inside the window, so concurrent discover runs and
   * manual re-runs cannot stampede one source. Default 3600.
   */
  fetchSingletonSeconds?: number;
  /** pg-boss schema, kept out of prisma migrate. Default "pgboss". */
  bossSchema?: string;
  /** Enables the pg-boss timekeeper so cron schedules fire. Default false. */
  enableScheduling?: boolean;
};

export type KnowledgeWorkerRuntime = {
  boss: PgBoss;
  database: DatabaseClient;
  repository: KnowledgeRepository;
  knowledgeCore: KnowledgeCore;
  enqueueDiscoverSources(): Promise<string | null>;
  enqueueFetchDocument(sourceId: string): Promise<string | null>;
  enqueueGenerateEmbedding(limit?: number): Promise<string | null>;
  enqueuePublishKnowledge(version: string): Promise<string | null>;
  /** Resolves once the job reaches a terminal state; rejects on timeout. */
  waitForJob<T = object>(
    name: string,
    jobId: string,
    timeoutMs?: number
  ): Promise<PgBoss.JobWithMetadata<T>>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

const DEFAULT_RETRY_LIMIT = 3;
const DEFAULT_RETRY_DELAY_SECONDS = 30;
const DEFAULT_POLLING_SECONDS = 2;
const DEFAULT_FETCH_SINGLETON_SECONDS = 3600;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wires pg-boss queues and workers around the ingestion pipeline. Handlers
 * run with batchSize 1 so one failing job never fails its neighbors; queue
 * retries use exponential backoff and exhausted jobs land in
 * knowledge-dead-letter with the failure message preserved in job output.
 */
export async function createKnowledgeWorkerRuntime(
  options: KnowledgeWorkerOptions
): Promise<KnowledgeWorkerRuntime> {
  const retryLimit = options.retryLimit ?? DEFAULT_RETRY_LIMIT;
  const retryDelay = options.retryDelaySeconds ?? DEFAULT_RETRY_DELAY_SECONDS;
  const retryBackoff = options.retryBackoff ?? true;
  const pollingIntervalSeconds = options.pollingIntervalSeconds ?? DEFAULT_POLLING_SECONDS;
  const fetchSingletonSeconds =
    options.fetchSingletonSeconds ?? DEFAULT_FETCH_SINGLETON_SECONDS;

  const database = createPrismaClient(options.databaseUrl);
  const repository = new KnowledgeRepository(database);
  const knowledgeCore = new KnowledgeCore({
    database,
    repository,
    embeddings: new HashEmbeddingProvider()
  });

  const boss = new PgBoss({
    connectionString: options.databaseUrl,
    schema: options.bossSchema ?? "pgboss",
    supervise: true,
    migrate: true,
    schedule: options.enableScheduling === true
  });

  async function createQueues(): Promise<void> {
    await boss.createQueue(KNOWLEDGE_JOBS.deadLetter);
    for (const name of [
      KNOWLEDGE_JOBS.discoverSource,
      KNOWLEDGE_JOBS.fetchDocument,
      KNOWLEDGE_JOBS.generateEmbedding,
      KNOWLEDGE_JOBS.publishKnowledge
    ]) {
      const options: PgBoss.Queue & { name: string } = {
        name,
        retryLimit,
        retryDelay,
        retryBackoff
      };
      if (name !== KNOWLEDGE_JOBS.discoverSource) {
        options.deadLetter = KNOWLEDGE_JOBS.deadLetter;
      }
      await boss.createQueue(name, options);
    }
  }

  const runtime: KnowledgeWorkerRuntime = {
    boss,
    database,
    repository,
    knowledgeCore,

    async enqueueDiscoverSources() {
      const data: DiscoverSourceJobData = {};
      return boss.send(KNOWLEDGE_JOBS.discoverSource, data, { retryLimit, retryDelay, retryBackoff });
    },

    async enqueueFetchDocument(sourceId: string) {
      const data: FetchDocumentJobData = { sourceId };
      return boss.send(KNOWLEDGE_JOBS.fetchDocument, data, {
        retryLimit,
        retryDelay,
        retryBackoff,
        singletonKey: sourceId,
        singletonSeconds: fetchSingletonSeconds
      });
    },

    async enqueueGenerateEmbedding(limit?: number) {
      const data: GenerateEmbeddingJobData = { limit };
      return boss.send(KNOWLEDGE_JOBS.generateEmbedding, data, {
        retryLimit,
        retryDelay,
        retryBackoff,
        singletonKey: "generate-embedding",
        singletonSeconds: 60
      });
    },

    async enqueuePublishKnowledge(version: string) {
      const data: PublishKnowledgeJobData = { version };
      return boss.send(KNOWLEDGE_JOBS.publishKnowledge, data, {
        retryLimit,
        retryDelay,
        retryBackoff,
        singletonKey: version,
        singletonSeconds: 60
      });
    },

    async waitForJob<T = object>(name: string, jobId: string, timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const job = await boss.getJobById<T>(name, jobId);
        if (job !== null && ["completed", "failed", "cancelled"].includes(job.state)) {
          return job;
        }
        if (Date.now() >= deadline) {
          throw new Error(`TIMEOUT waiting for job ${name}/${jobId}`);
        }
        await sleep(100);
      }
    },

    async start() {
      await boss.start();
      await createQueues();

      await boss.work<DiscoverSourceJobData>(
        KNOWLEDGE_JOBS.discoverSource,
        { batchSize: 1, pollingIntervalSeconds },
        async ([job]) => {
          const sources = await repository.listCrawlableSources();
          const result: DiscoverSourceJobResult = { enqueued: [], skipped: [] };
          for (const source of sources) {
            const jobId = await runtime.enqueueFetchDocument(source.id);
            if (jobId === null) {
              result.skipped.push(source.id);
            } else {
              result.enqueued.push({ sourceId: source.id, jobId });
            }
          }
          return result;
        }
      );

      await boss.work<FetchDocumentJobData>(
        KNOWLEDGE_JOBS.fetchDocument,
        { batchSize: 1, pollingIntervalSeconds },
        async (jobs) => {
          const job = jobs[0];
          if (job === undefined) return;
          const source = await repository.getSource(job.data.sourceId);
          if (!source.enabled) {
            const result: FetchDocumentJobResult = {
              sourceId: source.id,
              createdDocuments: 0,
              duplicateDocuments: 0,
              insertedCandidates: 0,
              duplicateCandidates: 0,
              documentUrls: []
            };
            return result;
          }
          const run = await runIngestionPipeline(source, {
            database,
            repository,
            allowPrivateNetworks: options.allowPrivateNetworks === true,
            crawlerStorageDir: options.crawlerStorageDir,
            maxPages: options.maxPagesPerCrawl
          }).then(
            async (completed) => {
              await repository.recordFetchOutcome(source.id, { success: true });
              return completed;
            },
            async (error: unknown) => {
              await repository
                .recordFetchOutcome(source.id, {
                  success: false,
                  reason: error instanceof Error ? error.message : String(error)
                })
                .catch(() => undefined);
              throw error;
            }
          );
          const result: FetchDocumentJobResult = {
            sourceId: run.sourceId,
            createdDocuments: run.createdDocuments,
            duplicateDocuments: run.duplicateDocuments,
            insertedCandidates: run.insertedCandidates,
            duplicateCandidates: run.duplicateCandidates,
            documentUrls: run.documents.map((document) => document.url)
          };
          return result;
        }
      );

      await boss.work<GenerateEmbeddingJobData>(
        KNOWLEDGE_JOBS.generateEmbedding,
        { batchSize: 1, pollingIntervalSeconds },
        async (jobs) => {
          const job = jobs[0];
          if (job === undefined) return;
          const indexed = await knowledgeCore.indexEmbeddings(job.data.limit);
          const result: GenerateEmbeddingJobResult = {
            indexed: indexed.indexed,
            model: indexed.model
          };
          return result;
        }
      );

      await boss.work<PublishKnowledgeJobData>(
        KNOWLEDGE_JOBS.publishKnowledge,
        { batchSize: 1, pollingIntervalSeconds },
        async (jobs) => {
          const job = jobs[0];
          if (job === undefined) return;
          const id = `kv-${job.data.version}`;
          const created = await repository.createKnowledgeVersion(id, job.data.version);
          const published = await repository.publishKnowledgeVersion(created.id);
          const result: PublishKnowledgeJobResult = {
            versionId: published.id,
            version: published.version,
            status: published.status
          };
          return result;
        }
      );
    },

    async stop() {
      await boss.stop();
      await database.$disconnect();
    }
  };

  return runtime;
}
