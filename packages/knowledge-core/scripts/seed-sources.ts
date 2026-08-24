import {
  createPrismaClient,
  KnowledgeRepository
} from "@mystcrag/database";

import { SOURCE_REGISTRY_CANDIDATES } from "../src/fixtures/source-registry-candidates.js";

/**
 * Q0 source-registry bootstrap: registers every curated candidate as
 * NEEDS_REVIEW and disabled. Re-running is a no-op for already-registered
 * sources; approval and enabling stay human decisions (reviewSource /
 * updateSourcePolicy).
 */
async function seedKnowledgeSources(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for seed:sources");
  }
  const database = createPrismaClient(databaseUrl);
  const repository = new KnowledgeRepository(database);
  try {
    let registered = 0;
    let known = 0;
    for (const candidate of SOURCE_REGISTRY_CANDIDATES) {
      const result = await repository.registerSourceCandidate(candidate, {
        submitForReview: true
      });
      if (result.created) {
        registered += 1;
      } else {
        known += 1;
      }
    }
    console.log(
      `Source registry seeded: ${registered} new candidates, ${known} already registered, ` +
        `${SOURCE_REGISTRY_CANDIDATES.length} total (all NEEDS_REVIEW, all disabled).`
    );
  } finally {
    await database.$disconnect();
  }
}

await seedKnowledgeSources();
