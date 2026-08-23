import { createPrismaClient, KnowledgeRepository } from "@mystcrag/database";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const db = createPrismaClient(databaseUrl);
  const repo = new KnowledgeRepository(db);
  try {
    const crawlable = await repo.listCrawlableSources();
    for (const s of crawlable) {
      const seeds = s.crawlStrategy?.seedPaths?.length ?? 0;
      console.log(
        `${s.id} | ${s.sourceType} | seeds=${seeds} | maxPages=${s.crawlStrategy?.maxPages}`
      );
    }
    const docs = await db.knowledgeDocument.count();
    const rules = await db.knowledgeRule.count();
    const needsReview = await db.knowledgeRule.count({ where: { status: "NEEDS_REVIEW" } });
    console.log("---");
    console.log(`documents=${docs} rules=${rules} needsReview=${needsReview}`);
  } finally {
    await db.$disconnect();
  }
}

await main();
