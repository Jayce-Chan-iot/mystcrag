import {
  createPrismaClient,
  KnowledgeRepository,
  type StoredKnowledgeSource
} from "@mystcrag/database";
import type { SourceCrawlStrategy } from "@mystcrag/design-contract";

import { SOURCE_REGISTRY_CANDIDATES } from "../src/fixtures/source-registry-candidates.js";

/**
 * Batch B (crystal core) preparation: pushes the curated crawl strategies
 * (gemdat 84 / GIA 29 / Wikipedia 77 seed paths) into the registered sources,
 * approves Wikipedia, then swaps the enabled set from the Batch A color
 * sources to the three crystal sources. Idempotent — re-running converges.
 */

const BATCH_B_SOURCES = [
  "source-gemdat-gemstone-pages",
  "source-gia-gem-encyclopedia",
  "source-wikipedia-reference"
] as const;

const BATCH_A_SOURCES = [
  "source-cie-color-standards",
  "source-color-matters-education",
  "source-pantone-trend-reports"
] as const;

function summarize(source: StoredKnowledgeSource): string {
  const strategy = source.crawlStrategy as SourceCrawlStrategy | undefined;
  const seeds = strategy?.seedPaths?.length ?? 0;
  const pats = strategy?.pathPatterns?.length ?? 0;
  return (
    `${source.id}: status=${source.reviewStatus} enabled=${source.enabled} ` +
    `domains=${source.allowedKnowledgeDomains.length} seeds=${seeds} patterns=${pats}`
  );
}

async function prepareBatchB(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for prepare-batch-b");
  }
  const database = createPrismaClient(databaseUrl);
  const repository = new KnowledgeRepository(database);
  try {
    for (const id of BATCH_B_SOURCES) {
      const candidate = SOURCE_REGISTRY_CANDIDATES.find((entry) => entry.id === id);
      if (candidate === undefined) {
        throw new Error(`Registry fixture is missing ${id}`);
      }
      const existing = await repository.getSource(id);
      if (existing.reviewStatus !== "APPROVED") {
        const reviewed = await repository.reviewSource(id, "APPROVED");
        console.log(`approved ${reviewed.id} (was ${existing.reviewStatus})`);
      }
      const updated = await repository.updateSourcePolicy(id, {
        allowedKnowledgeDomains: [...candidate.allowedKnowledgeDomains],
        crawlStrategy: candidate.crawlStrategy as SourceCrawlStrategy,
        enabled: true
      });
      console.log(summarize(updated));
    }

    for (const id of BATCH_A_SOURCES) {
      const existing = await repository.getSource(id);
      if (existing.enabled) {
        await repository.setSourceEnabled(id, false);
        console.log(`disabled ${id} (Batch A closed)`);
      }
    }

    const crawlable = await repository.listCrawlableSources();
    console.log(`\ncrawlable now: ${crawlable.map((source) => source.id).join(", ")}`);
  } finally {
    await database.$disconnect();
  }
}

await prepareBatchB();
