import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * Consumer-side interop regression.
 *
 * The contract used to expose TypeScript sources only. Node16 CommonJS
 * consumers could not `require` it (ERR_MODULE_NOT_FOUND / ERR_REQUIRE_ESM)
 * and a Node16 `tsc` consumer rejected its extensionless ESM source imports
 * (TS1479 / TS2835). These tests reproduce that failure and then pin the
 * generated, Node-loadable runtime entry points and the Node16 declarations.
 */

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageName = "@mystcrag/design-contract";
const buildScript = path.join(packageDir, "scripts", "build-interop.mjs");
const tsc = path.join(packageDir, "node_modules", ".bin", "tsc");

const NODE16_CONSUMER = `import { ShowroomMarketSchema, ShowroomPublicProductSchema } from "${packageName}";
import { standardAiDesignFixture } from "${packageName}/fixtures";
import { InternalCommercialDesignV1Schema } from "${packageName}/internal";

export const probe: unknown[] = [
  ShowroomMarketSchema,
  ShowroomPublicProductSchema,
  standardAiDesignFixture,
  InternalCommercialDesignV1Schema
];
`;

/** Build is transient and ignored; produce it before any runtime check. */
function ensureBuilt(): void {
  if (!existsSync(buildScript)) {
    return;
  }
  if (existsSync(path.join(packageDir, "dist", "esm", "index.js"))) {
    return;
  }
  const built = spawnSync(process.execPath, [buildScript], {
    cwd: packageDir,
    encoding: "utf8"
  });
  assert.equal(
    built.status,
    0,
    `reproducible contract build failed:\n${built.stdout}\n${built.stderr}`
  );
}

ensureBuilt();

function node(script: string, options: { esm?: boolean } = {}) {
  const args = options.esm ? ["--input-type=module", "-e", script] : ["-e", script];
  return spawnSync(process.execPath, args, { cwd: packageDir, encoding: "utf8" });
}

test("native Node CommonJS require resolves the Showroom schema", () => {
  const result = node(`
    const contract = require(${JSON.stringify(packageName)});
    const schema = contract.ShowroomPublicProductSchema;
    if (typeof schema?.safeParse !== "function") {
      throw new Error("ShowroomPublicProductSchema missing from CJS entry");
    }
    if (schema.safeParse({}).success !== false) {
      throw new Error("runtime safeParse was disabled or neutered");
    }
    console.log("cjs-ok");
  `);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /cjs-ok/);
});

test("native Node ESM import resolves the same Showroom schema", () => {
  const result = node(
    `
    import { ShowroomPublicProductSchema } from ${JSON.stringify(packageName)};
    if (typeof ShowroomPublicProductSchema?.safeParse !== "function") {
      throw new Error("ShowroomPublicProductSchema missing from ESM entry");
    }
    console.log("esm-ok");
  `,
    { esm: true }
  );

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /esm-ok/);
});

test("CommonJS require resolves to generated CommonJS JavaScript, never TS source", () => {
  // This is the exact property that made `ts-node --swc` fail with
  // ERR_REQUIRE_ESM: `require` used to land on an ESM `.ts` file. It now has
  // to land on real CommonJS JavaScript.
  const result = node(`
    const resolved = require.resolve(${JSON.stringify(packageName)});
    if (!/dist[\\\\/]cjs[\\\\/]index\\.js$/.test(resolved)) {
      throw new Error("CommonJS consumers still resolve to a non-CJS entry: " + resolved);
    }
    console.log("resolve-ok");
  `);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /resolve-ok/);
});

test("all three published subpaths resolve under Node", () => {
  for (const subpath of ["", "/fixtures", "/internal"]) {
    const specifier = `${packageName}${subpath}`;
    const result = node(`
      const module = require(${JSON.stringify(specifier)});
      if (Object.keys(module).length === 0) {
        throw new Error("no exports from ${subpath || "."}");
      }
      console.log("subpath-ok");
    `);
    assert.equal(
      result.status,
      0,
      `subpath ${subpath || "."} failed:\n${result.stdout}\n${result.stderr}`
    );
  }
});

test("generated entry points export the same surface as the contract source", async () => {
  const built = node(
    `console.log(Object.keys(require(${JSON.stringify(packageName)})).sort().join(","))`
  );
  assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);

  const source = (await import("../src/index")) as Record<string, unknown>;
  assert.equal(
    built.stdout.trim(),
    Object.keys(source).sort().join(","),
    "generated runtime surface drifted from the contract source"
  );
});

test("a clean Node16 CommonJS TypeScript consumer typechecks", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "mystcrag-node16-"));
  try {
    const scope = path.join(workspace, "node_modules", "@mystcrag");
    mkdirSync(scope, { recursive: true });
    symlinkSync(packageDir, path.join(scope, "design-contract"), "dir");
    writeFileSync(path.join(workspace, "consumer.ts"), NODE16_CONSUMER);

    const result = spawnSync(
      tsc,
      [
        "--noEmit",
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--module",
        "node16",
        "--moduleResolution",
        "node16",
        path.join(workspace, "consumer.ts")
      ],
      { cwd: workspace, encoding: "utf8" }
    );

    assert.equal(
      result.status,
      0,
      `Node16 CommonJS consumer failed to typecheck:\n${result.stdout}\n${result.stderr}`
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
