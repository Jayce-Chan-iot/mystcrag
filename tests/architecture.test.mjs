import { access, readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const requiredPaths = [
  "apps/frontend/app",
  "apps/backend/src/modules",
  "packages/ui/src",
  "packages/design-contract/src",
  "packages/design-contract/tests",
  "packages/ai-agent/src/adapters",
  "packages/three-engine/src/adapters",
  "packages/knowledge-core/src",
  "packages/context-resolver/src",
  "packages/design-engine/src",
  "apps/backend/src/modules/design",
  "apps/frontend/src/features/design",
  "apps/mcp-server/src",
  "apps/knowledge-worker/src",
  "packages/ai-agent/emotion-agent",
  "packages/ai-agent/crystal-agent",
  "packages/ai-agent/design-agent",
  "packages/ai-agent/pricing-agent",
  "packages/ai-agent/compliance-agent",
  "packages/three-engine/bracelet-generator",
  "packages/three-engine/material-system",
  "packages/three-engine/bead-system",
  "packages/database/prisma/schema.prisma",
  "docs"
];

test("required monorepo boundaries exist", async () => {
  await Promise.all(requiredPaths.map((path) => access(path)));
});

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return ["node_modules", ".next", "dist", ".turbo"].includes(entry.name)
          ? []
          : sourceFiles(target);
      }
      return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [target] : [];
    })
  );
  return nested.flat();
}

async function matchingFiles(roots, pattern, excluded = new Set()) {
  const files = (await Promise.all(roots.map(sourceFiles))).flat();
  const matches = [];
  for (const file of files) {
    if (excluded.has(file)) continue;
    if (pattern.test(await readFile(file, "utf8"))) matches.push(file);
  }
  return matches;
}

test("frontend cannot import server-only contract or database modules", async () => {
  const matches = await matchingFiles(
    ["apps/frontend"],
    /from\s+["'](?:@mystcrag\/design-contract\/internal|@mystcrag\/database|@mystcrag\/knowledge-core|@mystcrag\/knowledge-ingestion|@mystcrag\/design-engine|@mystcrag\/context-resolver)["']/
  );
  assertNoMatches(matches);
});

test("design-engine stays a pure deterministic engine over the contract", async () => {
  const matches = await matchingFiles(
    ["packages/design-engine"],
    /from\s+["'](?:@mystcrag\/database|@mystcrag\/knowledge-core|@mystcrag\/knowledge-ingestion|@mystcrag\/bracelet-engine|@mystcrag\/ai-agent|@mystcrag\/tarot-engine|@mystcrag\/context-resolver)["']/
  );
  assertNoMatches(matches);
});

test("context-resolver only depends on the contract and tarot-engine", async () => {
  const matches = await matchingFiles(
    ["packages/context-resolver"],
    /from\s+["'](?:@mystcrag\/database|@mystcrag\/knowledge-core|@mystcrag\/knowledge-ingestion|@mystcrag\/design-engine|@mystcrag\/bracelet-engine|@mystcrag\/ai-agent)["']/
  );
  assertNoMatches(matches);
});

test("mcp-server projects knowledge-core and design-engine without business copies", async () => {
  const matches = await matchingFiles(
    ["apps/mcp-server"],
    /from\s+["'](?:@mystcrag\/knowledge-ingestion|@mystcrag\/knowledge-worker|@mystcrag\/ai-agent|@mystcrag\/bracelet-engine|@mystcrag\/tarot-engine|@mystcrag\/ui|@mystcrag\/three-engine)["']/
  );
  assertNoMatches(matches);
});

test("mcp-server touches Prisma only inside its composition root", async () => {
  const files = await sourceFiles("apps/mcp-server/src");
  const violations = [];
  for (const file of files) {
    if (path.basename(file) === "runtime.ts") continue;
    const content = await readFile(file, "utf8");
    if (/createPrismaClient|@prisma\/client|PrismaClient/.test(content)) {
      violations.push(file);
    }
  }
  assertNoMatches(violations);
});

test("ai-agent cannot import the database package", async () => {
  const matches = await matchingFiles(
    ["packages/ai-agent"],
    /from\s+["'](?:@prisma\/client|@mystcrag\/database)["']/
  );
  assertNoMatches(matches);
});

test("backend HTTP boundary does not expose Prisma or database package types", async () => {
  const repositoryBackedServices = new Set([
    "apps/backend/src/modules/community/publication.service.ts",
    "apps/backend/src/modules/design/design.service.ts",
    "apps/backend/src/modules/design/inventory.service.ts",
    "apps/backend/src/modules/design/pricing.service.ts",
    "apps/backend/src/modules/design/recommendation.service.ts",
    "apps/backend/src/modules/order/order.service.ts"
  ]);
  const matches = await matchingFiles(
    [
      "apps/backend/src/contracts",
      "apps/backend/src/modules/community",
      "apps/backend/src/modules/design",
      "apps/backend/src/modules/order",
      "apps/backend/src/validation"
    ],
    /from\s+["'](?:@prisma\/client|@mystcrag\/database)["']/,
    repositoryBackedServices
  );
  assertNoMatches(matches);
});

test("consumer modules do not redeclare DesignV1", async () => {
  const matches = await matchingFiles(
    ["apps", "packages/ai-agent", "packages/three-engine"],
    /^(?:export\s+)?(?:interface|type|class)\s+DesignV1\s*(?:=|\{)/m
  );
  assertNoMatches(matches);
});

test("deprecated grouped design types remain isolated in compatibility layers", async () => {
  const allowed = new Set([
    "packages/ai-agent/src/contracts/legacy-design.ts",
    "packages/three-engine/src/legacy/contracts.ts"
  ]);
  const declarations = await matchingFiles(
    ["packages/ai-agent", "packages/three-engine"],
    /(?:interface|type)\s+(?:BeadDesign|BraceletDesignOutput|BraceletBeadConfiguration|BraceletConfiguration)\b/,
    allowed
  );
  assertNoMatches(declarations);
});

test("new adapters do not import deprecated grouped design types", async () => {
  const compatibilityAdapters = new Set([
    "packages/ai-agent/src/adapters/legacy-design-to-ai-candidate.ts"
  ]);
  const matches = await matchingFiles(
    ["packages/ai-agent/src/adapters", "packages/three-engine/src/adapters", "apps/backend/src/modules/design", "apps/frontend/src"],
    /import[\s\S]*?\b(?:BeadDesign|BraceletDesignOutput|BraceletBeadConfiguration|BraceletConfiguration)\b[\s\S]*?from/,
    compatibilityAdapters
  );
  assertNoMatches(matches);
});

test("shared contract dependency direction stays application-independent", async () => {
  const manifest = JSON.parse(await readFile("packages/design-contract/package.json", "utf8"));
  const dependencyNames = Object.keys({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies
  });
  const forbidden = dependencyNames.filter(
    (name) => name.startsWith("@mystcrag/") || ["fastify", "next", "react", "three", "@prisma/client"].includes(name)
  );
  assertNoMatches(forbidden);
});

test("pnpm dev isolates each app's documented environment", () => {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(pnpmCommand, ["exec", "turbo", "run", "dev", "--dry=json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      MYSTCRAG_AUTH_PROVIDER: "signed-test"
    }
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "turbo dry run failed");
  }

  const dryRun = JSON.parse(result.stdout);
  const backend = dryRun.tasks.find((task) => task.taskId === "@mystcrag/backend#dev");
  const frontend = dryRun.tasks.find((task) => task.taskId === "@mystcrag/frontend#dev");
  const backendEnvironment = backend?.environmentVariables?.specified?.passThroughEnv ?? [];
  const frontendEnvironment = frontend?.environmentVariables?.specified?.passThroughEnv ?? [];

  assert.deepEqual(backendEnvironment, [
    "BACKEND_PORT",
    "DATABASE_URL",
    "MYSTCRAG_AUTH_AUDIENCE",
    "MYSTCRAG_AUTH_ISSUER",
    "MYSTCRAG_AUTH_PROVIDER",
    "MYSTCRAG_AUTH_SIGNING_SECRET",
    "MYSTCRAG_ENABLE_SIGNED_TEST_AUTH",
    "MYSTCRAG_TAROT_ENABLED",
    "MYSTCRAG_TAROT_QUESTION_ENCRYPTION_KEY",
    "NODE_ENV"
  ]);
  assert.deepEqual(frontendEnvironment, [
    "MYSTCRAG_BACKEND_ORIGIN",
    "MYSTCRAG_TAROT_ENABLED",
    "NEXT_PUBLIC_API_BASE_URL",
    "NEXT_PUBLIC_MYSTCRAG_ACCESS_TOKEN",
    "NEXT_PUBLIC_MYSTCRAG_MOCK_API",
    "NODE_ENV"
  ]);
  assert.equal(frontendEnvironment.includes("DATABASE_URL"), false);
  assert.equal(frontendEnvironment.includes("MYSTCRAG_AUTH_SIGNING_SECRET"), false);
  assert.equal(frontendEnvironment.includes("MYSTCRAG_TAROT_QUESTION_ENCRYPTION_KEY"), false);
  assert.equal(backend?.resolvedTaskDefinition?.cache, false);
  assert.equal(backend?.resolvedTaskDefinition?.persistent, true);
  assert.equal(frontend?.resolvedTaskDefinition?.cache, false);
  assert.equal(frontend?.resolvedTaskDefinition?.persistent, true);
});

function assertNoMatches(matches) {
  if (matches.length > 0) {
    throw new Error(`Architecture boundary violations:\n${matches.join("\n")}`);
  }
}
