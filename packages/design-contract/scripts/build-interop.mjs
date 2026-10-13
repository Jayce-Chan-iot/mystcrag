#!/usr/bin/env node
/**
 * Reproducible Design Contract distribution build.
 *
 * The contract is authored as ESM TypeScript with extensionless relative
 * imports. That is fine for bundler consumers but unloadable for Node16/Node
 * CommonJS consumers (`ERR_MODULE_NOT_FOUND` / `ERR_REQUIRE_ESM`) and
 * unparseable by a Node16 `tsc` consumer (TS1479 / TS2835).
 *
 * This script emits two deterministic, Node-loadable entry point trees from
 * the single contract source (no hand-copied DTOs, runtime `safeParse` intact):
 *
 *   dist/esm/**  ESM runtime + declarations, relative specifiers get explicit
 *                `.js` extensions so Node's ESM resolver accepts them.
 *   dist/cjs/**  CommonJS runtime + declarations, plus a `package.json`
 *                marker so Node loads `.js` files there as CommonJS.
 *
 * `dist/` is ignored build output: it is regenerated, never hand-edited and
 * never committed.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(packageDir, "dist");
const configDir = path.join(distDir, "build");
const tscBin = path.join(packageDir, "node_modules", ".bin", "tsc");

const RELATIVE_SPECIFIER = /((?:from|import)(?:\s*\(\s*|\s+))(["'])(\.\.?\/[^"']+)\2/g;

function writeConfig(name, compilerOptions) {
  const file = path.join(configDir, `${name}.json`);
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        extends: "../../tsconfig.json",
        compilerOptions,
        include: ["../../src/**/*.ts"]
      },
      null,
      2
    )}\n`
  );
  return file;
}

function runTsc(config) {
  const result = spawnSync(tscBin, ["--project", config], {
    cwd: packageDir,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`tsc failed for ${path.relative(packageDir, config)}`);
  }
}

function walk(root, collected = []) {
  for (const entry of readdirSync(root)) {
    const target = path.join(root, entry);
    if (statSync(target).isDirectory()) {
      walk(target, collected);
    } else {
      collected.push(target);
    }
  }
  return collected;
}

/** Resolve an extensionless relative specifier against the emitted tree. */
function resolveSpecifier(fromFile, specifier) {
  const target = path.resolve(path.dirname(fromFile), specifier);
  if (existsSync(`${target}.js`)) {
    return `${specifier}.js`;
  }
  if (existsSync(path.join(target, "index.js"))) {
    return `${specifier}/index.js`;
  }
  return null;
}

function addEsmExtensions() {
  const esmDir = path.join(distDir, "esm");
  const files = walk(esmDir).filter(
    (file) => file.endsWith(".js") || file.endsWith(".d.ts")
  );

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const rewritten = source.replace(
      RELATIVE_SPECIFIER,
      (match, prefix, quote, specifier) => {
        // `.schema`/`.fixture` are file stems, not extensions: only an
        // already-resolvable JavaScript suffix may pass through untouched.
        if (/\.(?:js|mjs|cjs|json)$/.test(specifier)) {
          return match;
        }
        const resolved = resolveSpecifier(file, specifier);
        if (!resolved) {
          throw new Error(
            `could not resolve ${specifier} from ${path.relative(packageDir, file)}`
          );
        }
        return `${prefix}${quote}${resolved}${quote}`;
      }
    );
    if (rewritten !== source) {
      writeFileSync(file, rewritten);
    }
  }
}

function assertArtifact(relativePath) {
  const target = path.join(distDir, relativePath);
  if (!existsSync(target)) {
    throw new Error(`expected build artifact missing: dist/${relativePath}`);
  }
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(configDir, { recursive: true });

runTsc(
  writeConfig("esm", {
    noEmit: false,
    declaration: true,
    removeComments: true,
    rootDir: "../../src",
    outDir: "../esm",
    module: "ESNext",
    moduleResolution: "Bundler"
  })
);

runTsc(
  writeConfig("cjs", {
    noEmit: false,
    declaration: true,
    removeComments: true,
    rootDir: "../../src",
    outDir: "../cjs",
    module: "CommonJS",
    // The contract source deliberately keeps extensionless relative imports;
    // only node10 resolution accepts those while emitting CommonJS.
    moduleResolution: "Node10",
    ignoreDeprecations: "6.0"
  })
);

addEsmExtensions();

// Node must treat dist/cjs/**/*.js as CommonJS: the package itself is ESM.
writeFileSync(
  path.join(distDir, "cjs", "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`
);

for (const artifact of [
  "esm/index.js",
  "esm/index.d.ts",
  "esm/fixtures/index.js",
  "esm/schemas/internal-commercial.schema.js",
  "cjs/index.js",
  "cjs/index.d.ts",
  "cjs/fixtures/index.js",
  "cjs/schemas/internal-commercial.schema.js",
  "cjs/package.json"
]) {
  assertArtifact(artifact);
}

process.stdout.write("design-contract interop build complete (dist/esm, dist/cjs)\n");
