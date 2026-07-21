import { access, readFile, readdir } from "node:fs/promises";
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
  "apps/backend/src/modules/design",
  "apps/frontend/src/features/design",
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
    /from\s+["'](?:@mystcrag\/design-contract\/internal|@mystcrag\/database)["']/
  );
  assertNoMatches(matches);
});

test("backend HTTP boundary does not expose Prisma or database package types", async () => {
  const repositoryBackedServices = new Set([
    "apps/backend/src/modules/community/publication.service.ts",
    "apps/backend/src/modules/design/design.service.ts",
    "apps/backend/src/modules/design/inventory.service.ts",
    "apps/backend/src/modules/design/pricing.service.ts",
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

function assertNoMatches(matches) {
  if (matches.length > 0) {
    throw new Error(`Architecture boundary violations:\n${matches.join("\n")}`);
  }
}
