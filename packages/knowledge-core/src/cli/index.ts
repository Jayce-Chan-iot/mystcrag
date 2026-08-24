import { createPrismaClient, KnowledgeRepository } from "@mystcrag/database";

import { KnowledgeReviewService, type ReviewQueueItem } from "../review/review-service.js";
import { parseReviewCliArgs } from "./args.js";
import { runCollectBatch, runCollectDryRun } from "./collect.js";

const USAGE = `Usage: pnpm --filter @mystcrag/knowledge-core review:cli <command> [options]

Commands:
  list [--status <status>] [--limit <n>]   List review candidates with evidence
  show <ruleId>                            Show one candidate with evidence and validation
  conflicts                                List conflict groups
  run-pipeline                             Classify extracted candidates and mark conflicts
  approve <ruleId>                         Approve a candidate
  reject <ruleId>                          Reject a candidate
  supersede <ruleId>                       Supersede an approved or conflicted rule
  publish <version>                        Publish APPROVED rules as a knowledge version
  import-fixtures [--publish <version>]    Import the reviewed handbook corpus
  collect [--dry-run]                      Crawl approved sources and emit a coverage report

DATABASE_URL must point at the target PostgreSQL database (not required for
the collect --dry-run command).`;

function printQueueItem(item: ReviewQueueItem): void {
  const { rule, validation, evidence, extraction } = item;
  console.log(`${rule.id}  [${rule.status}]  ${rule.knowledgeType} ${rule.subject} ${rule.relation}`);
  console.log(`  confidence=${rule.confidence}  domain=${rule.knowledgeDomain}`);
  if (!validation.valid) {
    for (const issue of validation.issues) {
      console.log(`  issue: ${issue}`);
    }
  }
  for (const entry of evidence) {
    const document =
      entry.document === null ? "" : ` doc="${entry.document.title}" ${entry.document.url}`;
    console.log(
      `  evidence: source="${entry.source.name}" (${entry.source.sourceType}, authority=${entry.source.authorityScore})${document}`
    );
  }
  if (extraction !== null) {
    console.log(
      `  extraction: ${extraction.extractor} (${extraction.method})`
    );
    for (const proof of extraction.evidence) {
      console.log(`    sentence: "${proof.sentence}" (${proof.startOffset}-${proof.endOffset})`);
    }
  }
}

export async function runReviewCli(argv: readonly string[]): Promise<number> {
  const parsed = parseReviewCliArgs(argv);
  if (parsed === null) {
    console.error(USAGE);
    return 1;
  }

  // Coverage analysis runs with no database: emit the embedded-matrix report
  // and return before any DATABASE_URL check or PrismaClient construction.
  if (parsed.command === "collect" && parsed.dryRun) {
    console.log(JSON.stringify(runCollectDryRun(), null, 2));
    return 0;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    console.error("DATABASE_URL is required.");
    return 1;
  }

  const database = createPrismaClient(databaseUrl);
  const repository = new KnowledgeRepository(database);
  const service = new KnowledgeReviewService({ database, repository });

  try {
    switch (parsed.command) {
      case "list": {
        const items = await service.listReviewQueue({
          status: parsed.status as ReviewQueueItem["rule"]["status"] | undefined,
          limit: parsed.limit
        });
        console.log(`${items.length} rule(s)`);
        for (const item of items) {
          printQueueItem(item);
        }
        return 0;
      }
      case "show": {
        const items = await service.listReviewQueue({ limit: 2000 });
        const item = items.find((candidate) => candidate.rule.id === parsed.ruleId);
        if (item === undefined) {
          console.error(`Rule ${parsed.ruleId} was not found.`);
          return 1;
        }
        printQueueItem(item);
        console.log(`  payload: ${JSON.stringify(item.rule.payload)}`);
        return 0;
      }
      case "conflicts": {
        const groups = await service.listConflictGroups();
        console.log(`${groups.length} conflict group(s)`);
        for (const group of groups) {
          console.log(
            `* ${group.key.knowledgeType} ${group.key.subject} ${group.key.relation}`
          );
          for (const rule of group.rules) {
            console.log(
              `    ${rule.id} [${rule.status}] ${JSON.stringify(rule.payload).slice(0, 160)}`
            );
          }
        }
        return 0;
      }
      case "run-pipeline": {
        const summary = await service.runReviewPipeline();
        console.log(
          `pipeline: extracted=${summary.extracted} validated=${summary.validated} needsReview=${summary.needsReview} conflicted=${summary.conflicted}`
        );
        return 0;
      }
      case "approve":
      case "reject":
      case "supersede": {
        const rule =
          parsed.command === "approve"
            ? await service.approveRule(parsed.ruleId)
            : parsed.command === "reject"
              ? await service.rejectRule(parsed.ruleId)
              : await service.supersedeRule(parsed.ruleId);
        console.log(`${rule.id} is now ${rule.status}`);
        return 0;
      }
      case "publish": {
        const version = await service.publishVersion(parsed.version);
        console.log(
          `published ${version.version} (${version.id}) status=${version.status} rules=${version.ruleCount}`
        );
        return 0;
      }
      case "collect": {
        const report = await runCollectBatch(database, repository, service);
        console.log(JSON.stringify(report, null, 2));
        return 0;
      }
      case "import-fixtures": {
        const summary = await service.importFixtureCorpus();
        console.log(
          `imported sources=${summary.sources} documents=${summary.documents} rules=${summary.rules} (inserted=${summary.inserted}, duplicates=${summary.duplicates})`
        );
        if (parsed.publishVersion !== undefined) {
          const version = await service.publishVersion(parsed.publishVersion);
          console.log(
            `published ${version.version} (${version.id}) status=${version.status} rules=${version.ruleCount}`
          );
        }
        return 0;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await database.$disconnect();
  }
}

if (process.argv[1]?.endsWith("cli/index.ts") || process.argv[1]?.endsWith("cli/index.js")) {
  const exitCode = await runReviewCli(process.argv.slice(2));
  process.exit(exitCode);
}
