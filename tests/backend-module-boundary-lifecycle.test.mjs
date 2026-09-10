import { access, readdir, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

// TASK-BE-002: GET /api/modules must reflect runtime composition rather than
// static folder names. This lifecycle test guards the retirement of the four
// metadata-only module descriptors (user/crystal/community/order) that declared a
// boundary but carried no service or route and were consumed only by the static
// backendModules array. designModule and tarotModule remain because their
// production services are actually composed in apps/backend/src/index.ts; their
// presence in /api/modules is now decided by composition, not by this static array.
const RETIRED_DESCRIPTORS = [
  "userModule",
  "crystalModule",
  "communityModule",
  "orderModule",
  "backendModules",
];

// Word-boundary patterns (case-sensitive) so e.g. the retained BackendModule type
// never matches the retired backendModules array, and a retained descriptor never
// matches a retired one.
const RETIRED_DESCRIPTOR_PATTERNS = new Map(
  RETIRED_DESCRIPTORS.map((symbol) => [symbol, new RegExp(`\\b${symbol}\\b`)])
);

const RETIRED_INDEX_FILES = [
  "apps/backend/src/modules/user/index.ts",
  "apps/backend/src/modules/crystal/index.ts",
  "apps/backend/src/modules/community/index.ts",
  "apps/backend/src/modules/order/index.ts",
];

const RETIRED_SHELL_IMPORTS = [
  "./user/index.js",
  "./crystal/index.js",
  "./community/index.js",
  "./order/index.js",
];

const MODULES_INDEX_PATH = "apps/backend/src/modules/index.ts";

// Code surfaces where a backend module descriptor could plausibly be consumed:
// application code (apps/), shared packages, and root scripts. node_modules, build
// output, and coverage are excluded. The root tests/ tree is intentionally not
// scanned because this file must name the retired symbols as detector samples below.
const SCAN_ROOTS = ["apps", "packages", "scripts"];
const SKIP_DIRS = ["node_modules", "dist", "coverage", ".next"];

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return SKIP_DIRS.includes(entry.name) ? [] : sourceFiles(target);
      }
      return /\.(?:ts|tsx|js|mjs|cts|mts)$/.test(entry.name) ? [target] : [];
    })
  );
  return nested.flat();
}

test("retired metadata-shell descriptors have no consumers in tracked code", async () => {
  const files = (await Promise.all(SCAN_ROOTS.map((root) => sourceFiles(root)))).flat();
  const hits = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const [symbol, pattern] of RETIRED_DESCRIPTOR_PATTERNS) {
      if (pattern.test(source)) hits.push(`${file}: ${symbol}`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    `retired metadata-shell descriptors must have no consumers: ${hits.join("; ")}`
  );
});

test("the four metadata-shell module index files are retired", async () => {
  for (const file of RETIRED_INDEX_FILES) {
    await assert.rejects(
      () => access(file),
      `${file} must be deleted (it was a metadata-only shell with no service or route)`
    );
  }
});

test("modules/index.ts no longer statically aggregates the retired shells", async () => {
  const source = await readFile(MODULES_INDEX_PATH, "utf8");
  for (const imp of RETIRED_SHELL_IMPORTS) {
    assert.ok(!source.includes(imp), `modules/index.ts must not import ${imp}`);
  }
  assert.ok(
    !RETIRED_DESCRIPTOR_PATTERNS.get("backendModules").test(source),
    "modules/index.ts must not declare the static backendModules array"
  );
});

test("modules/index.ts still exposes the two runtime-composed descriptors", async () => {
  const source = await readFile(MODULES_INDEX_PATH, "utf8");
  assert.ok(
    source.includes(`export { designModule } from "./design/index.js";`),
    "modules/index.ts must re-export designModule"
  );
  assert.ok(
    source.includes(`export { tarotModule } from "./tarot/index.js";`),
    "modules/index.ts must re-export tarotModule"
  );
});

test("the detector recognizes every retired descriptor and ignores retained ones", () => {
  const samples = {
    userModule: `export const userModule = { name: "user" };`,
    crystalModule: `const c = crystalModule;`,
    communityModule: `import { communityModule } from "./community/index.js";`,
    orderModule: `backendModules.includes(orderModule);`,
    backendModules: `export const backendModules = [userModule] as const;`,
  };
  for (const [symbol, sample] of Object.entries(samples)) {
    assert.ok(
      RETIRED_DESCRIPTOR_PATTERNS.get(symbol).test(sample),
      `detector failed to recognize retired descriptor: ${symbol}`
    );
  }
  const retainedSample = `export const designModule = { name: "design" };
export const tarotModule: BackendModule = { name: "tarot" };
const boundary: BackendModule = { name: "design", description: "ok" };`;
  for (const [symbol, pattern] of RETIRED_DESCRIPTOR_PATTERNS) {
    assert.ok(
      !pattern.test(retainedSample),
      `detector falsely flagged retained code for symbol: ${symbol}`
    );
  }
});