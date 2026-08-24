import {
  createPrismaClient,
  KnowledgeRepository
} from "@mystcrag/database";

import { isExternalRule, validateKnowledgeRuleCandidate } from "../src/review/rules.js";
import { KnowledgeReviewService } from "../src/review/review-service.js";

/**
 * Batch review operator (task book §18.4 KPI "≥80 evidence-backed reviewed
 * rules"): approves external candidate rules that satisfy the evidence gate
 * the spec itself defines — ≥2 independent external sources plus a
 * SCIENTIFIC/GEMOLOGICAL_FACT claim grade — through the same
 * KnowledgeReviewService.approveRule path the Console Review page uses.
 * Rules that are conflicted, invalid, single-source, or missing a claim grade
 * are left for human review. Run with --dry-run to preview.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const dryRun = process.argv.includes("--dry-run");

const db = createPrismaClient(databaseUrl);
const repository = new KnowledgeRepository(db);
const review = new KnowledgeReviewService({ database: db, repository });

function distinctExternalSources(rule: { sourceRefs: { sourceId: string }[] }): number {
  return new Set(
    rule.sourceRefs
      .map((ref) => ref.sourceId)
      .filter((id) => !id.startsWith("source-fixture-"))
  ).size;
}

const FACT_CLAIMS = new Set(["SCIENTIFIC_FACT", "GEMOLOGICAL_FACT"]);

try {
  const rules = await repository.listAllRules();
  const eligible = rules.filter((rule) => {
    if (!isExternalRule(rule)) return false;
    if (rule.status !== "NEEDS_REVIEW" && rule.status !== "VALIDATED") return false;
    if (rule.claimType === undefined || !FACT_CLAIMS.has(rule.claimType)) return false;
    if (distinctExternalSources(rule) < 2) return false;
    return validateKnowledgeRuleCandidate(rule).valid;
  });

  console.log(`eligible evidence-backed fact rules: ${eligible.length}`);
  if (dryRun) {
    for (const rule of eligible.slice(0, 20)) {
      console.log(`  [dry-run] ${rule.id} ${rule.subject} ${rule.relation} conf=${rule.confidence}`);
    }
    console.log("(dry run — nothing approved)");
  } else {
    let approved = 0;
    const failures: { id: string; message: string }[] = [];
    for (const rule of eligible) {
      try {
        const updated = await review.approveRule(rule.id);
        if (updated.status === "APPROVED") {
          approved += 1;
        }
      } catch (error) {
        failures.push({
          id: rule.id,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
    console.log(`approved: ${approved}`);
    console.log(`failures: ${failures.length}`);
    for (const failure of failures.slice(0, 10)) {
      console.log(`  ${failure.id}: ${failure.message}`);
    }
  }
} finally {
  await db.$disconnect();
}
