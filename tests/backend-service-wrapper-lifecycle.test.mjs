import { access, readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

const BACKEND_SRC = "apps/backend/src";
const DESIGN_SERVICE_PATH = "apps/backend/src/modules/design/design.service.ts";
const BACKEND_INDEX_PATH = "apps/backend/src/index.ts";

const LEGACY_SYMBOLS = [
  "DesignStubOperation",
  "DesignStubService",
  "NotImplementedDesignStubService",
  "DesignService",
  "PricingService",
  "InventoryService",
  "PublicationService",
  "OrderService",
];

// Word-boundary patterns so e.g. DesignService cannot match inside
// DesignApplicationService or RecommendationApplicationService, and
// DesignStubService cannot match inside NotImplementedDesignStubService.
const LEGACY_SYMBOL_PATTERNS = new Map(
  LEGACY_SYMBOLS.map((symbol) => [symbol, new RegExp(`\\b${symbol}\\b`)])
);

// The four retired files must not reappear anywhere in the backend source tree.
// This prevents the eight legacy symbols and the four retired file basenames
// from returning; it does not claim to detect a renamed equivalent class.
const RETIRED_FILE_BASENAMES = [
  "pricing.service.ts",
  "inventory.service.ts",
  "publication.service.ts",
  "order.service.ts",
];

const RETIRED_BARREL_EXPORTS = [
  "pricing.service.js",
  "inventory.service.js",
  "publication.service.js",
  "order.service.js",
];

async function backendSourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return ["node_modules", "dist", "coverage"].includes(entry.name)
          ? []
          : backendSourceFiles(target);
      }
      return /\.(?:ts|tsx|js|mjs|cts|mts)$/.test(entry.name) ? [target] : [];
    })
  );
  return nested.flat();
}

test("legacy wrapper symbols no longer appear in backend production source", async () => {
  const files = await backendSourceFiles(BACKEND_SRC);
  const hits = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const [symbol, pattern] of LEGACY_SYMBOL_PATTERNS) {
      if (pattern.test(source)) hits.push(`${file}: ${symbol}`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    `retired wrapper symbols must not appear in backend source: ${hits.join("; ")}`
  );
});

test("the four pure-delegation wrapper files are retired", async () => {
  const files = await backendSourceFiles("apps/backend/src/modules");
  for (const basename of RETIRED_FILE_BASENAMES) {
    const found = files.filter((file) => path.basename(file) === basename);
    assert.deepEqual(
      found,
      [],
      `${basename} must not reappear anywhere under apps/backend/src/modules`
    );
    await assert.rejects(
      () => access(path.join("apps/backend/src/modules", dirFor(basename), basename)),
      `${basename} must be deleted`
    );
  }
});

function dirFor(basename) {
  if (basename === "publication.service.ts") return "community";
  if (basename === "order.service.ts") return "order";
  return "design";
}

test("module barrels no longer re-export the retired wrapper files", async () => {
  const barrels = [
    "apps/backend/src/modules/design/index.ts",
  ];
  for (const barrel of barrels) {
    const source = await readFile(barrel, "utf8");
    for (const retired of RETIRED_BARREL_EXPORTS) {
      assert.ok(
        !source.includes(retired),
        `${barrel} must not re-export ${retired}`
      );
    }
  }
});

test("design.service.ts still exports both production composition factories", async () => {
  const source = await readFile(DESIGN_SERVICE_PATH, "utf8");
  assert.match(
    source,
    /export\s+function\s+createDesignApplicationService\s*\(/,
    "createDesignApplicationService must remain implemented"
  );
  assert.match(
    source,
    /export\s+function\s+createRecommendationApplicationService\s*\(/,
    "createRecommendationApplicationService must remain implemented"
  );
  assert.match(
    source,
    /new\s+DesignApplicationService\s*\(/,
    "DesignApplicationService composition must remain"
  );
  assert.match(
    source,
    /new\s+RecommendationApplicationService\s*\(/,
    "RecommendationApplicationService composition must remain"
  );
});

test("backend production startup still imports and calls both factories", async () => {
  const source = await readFile(BACKEND_INDEX_PATH, "utf8");
  for (const factory of [
    "createDesignApplicationService",
    "createRecommendationApplicationService",
  ]) {
    assert.match(
      source,
      new RegExp(`\\b${factory}\\b`),
      `apps/backend/src/index.ts must still reference ${factory}`
    );
  }
  assert.match(
    source,
    /createDesignApplicationService\s*\(\s*database\s*\)/,
    "production composition of createDesignApplicationService must be unchanged"
  );
  assert.match(
    source,
    /createRecommendationApplicationService\s*\(\s*database\s*\)/,
    "production composition of createRecommendationApplicationService must be unchanged"
  );
});

test("the detector itself recognizes every legacy symbol and ignores production symbols (guard against an always-green guard)", () => {
  const samples = {
    DesignStubOperation: `type Op = DesignStubOperation;`,
    DesignStubService: `const stub: DesignStubService = null;`,
    NotImplementedDesignStubService: `new NotImplementedDesignStubService()`,
    DesignService: `import { DesignService } from "./design.service.js";`,
    PricingService: `export class PricingService {}`,
    InventoryService: `new InventoryService(inventory)`,
    PublicationService: `const p: PublicationService | undefined;`,
    OrderService: `OrderService.prototype.getOrder`,
  };
  for (const [symbol, sample] of Object.entries(samples)) {
    assert.ok(
      LEGACY_SYMBOL_PATTERNS.get(symbol).test(sample),
      `detector failed to recognize legacy symbol: ${symbol}`
    );
  }
  const productionSample = `import { DesignApplicationService } from "./design-api.service.js";
import { RecommendationApplicationService } from "./recommendation.service.js";
const service = createDesignApplicationService(database);
const other = createRecommendationApplicationService(database);
export class DesignStubServiceGate {}`;
  for (const [symbol, pattern] of LEGACY_SYMBOL_PATTERNS) {
    assert.ok(
      !pattern.test(productionSample),
      `detector falsely flagged production code for symbol: ${symbol}`
    );
  }
});
