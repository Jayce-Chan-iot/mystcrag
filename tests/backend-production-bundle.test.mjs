import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, lstatSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// TASK-BE-SMOKE-001: the Backend production bundle must start directly under a
// normal pnpm production dependency layout — no NODE_PATH, no test harness, no
// manual/absolute path, and no symlink — for both crawlee's require.resolve("jquery")
// and jsdom's require.resolve("./xhr-sync-worker.js"), and must carry no sharp native
// image-processor binding. The assertions below prove these properties structurally.

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const BACKEND_DIR = path.join(REPO_ROOT, "apps", "backend");
const DIST_DIR = path.join(BACKEND_DIR, "dist");
const DIST_INDEX = path.join(DIST_DIR, "index.js");
const DIST_MAP = path.join(DIST_DIR, "index.js.map");
const DIST_WORKER = path.join(DIST_DIR, "xhr-sync-worker.js");
const METAFILE_PATH = path.join(os.tmpdir(), `be-smoke-001-metafile-${process.pid}.json`);

function childEnv() {
  const env = { ...process.env };
  // Prove the artifact does not depend on pnpm's hoisted store via NODE_PATH.
  delete env.NODE_PATH;
  return env;
}

function listFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const absolute = path.join(dir, entry);
    const stat = lstatSync(absolute);
    if (stat.isDirectory()) files.push(...listFiles(absolute));
    else files.push(absolute);
  }
  return files;
}

// A metafile input path identifies sharp / @img/sharp-* when it references the sharp
// package or an @img native/colour helper by their pnpm directory segments.
function isSharpOrImg(inputPath) {
  return /(?:sharp@|[/\\]sharp[/\\]|[/\\]@img[/\\]|@img\+)/i.test(inputPath);
}

// Explicitly-allowlisted non-machine literals that the bundled Playwright/jsdom source
// hardcodes. Stripping them first keeps the detectors below sharp-only about what they
// flag: a real, machine-specific filesystem path.
const ALLOWED_WINDOWS_LITERALS = [
  "C:\\Program Files\\Google\\Chrome",
  "C:/Program Files/Google/Chrome",
  "C:\\fakepath\\",
  "C:/fakepath/"
];

// Returns every substring that looks like an absolute machine path. Patterns are
// deliberately boundary-anchored so URL schemes (`data:`, `unix:`, `file:`), regex
// flags (`/^data:/i`), JS escape sequences (`\n`, `\x7f`), and the allowlisted
// Playwright/browser literals do not register.
function machinePathHits(text) {
  let stripped = text;
  for (const literal of ALLOWED_WINDOWS_LITERALS) {
    stripped = stripped.replaceAll(literal, " ");
  }
  const hits = [];
  const scan = (label, re) => {
    for (const match of stripped.matchAll(re)) hits.push(`${label}: ${match[0]}`);
  };
  scan("posix abs", /\/Users\//g);
  scan("posix abs", /\/home\//g);
  scan("posix abs", /\/opt\//g);
  scan("posix abs", /\/var\/folders\//g);
  scan("posix abs", /(^|[^\w\/.>-])\/tmp\//g);
  scan("windows drive", /(?<![\w])[A-Za-z]:\\[A-Z0-9_.()]/g);
  scan("windows drive", /(?<![\w])[A-Za-z]:\/[A-Za-z0-9_]/g);
  scan("unc", /(?<![\w])[\\]{2}[A-Za-z][A-Za-z0-9-]+\\[A-Za-z0-9]/g);
  scan("pnpm store", /(^|[^\w\/.\\-])\/(?:[^\/\s"']+\/)*\.pnpm\//g);
  return hits;
}

before(() => {
  const build = spawnSync(process.execPath, ["build.mjs"], {
    cwd: BACKEND_DIR,
    env: { ...childEnv(), BUILD_METAFILE_OUT: METAFILE_PATH },
    encoding: "utf8"
  });
  assert.equal(
    build.status,
    0,
    `backend build.mjs failed (error: ${build.error ? build.error.message : "none"}):\nstdout:\n${build.stdout}\nstderr:\n${build.stderr}`
  );
});

after(() => {
  rmSync(METAFILE_PATH, { force: true });
});

test("dist contains the self-contained worker asset and no symlinks", () => {
  assert.ok(existsSync(DIST_INDEX), `${DIST_INDEX} is missing`);
  assert.ok(existsSync(DIST_WORKER), `${DIST_WORKER} is missing — jsdom runtime asset not emitted`);

  const symlinks = listFiles(DIST_DIR).filter((file) => lstatSync(file).isSymbolicLink());
  assert.deepEqual(
    symlinks,
    [],
    `dist contains symlinks: ${symlinks.map((file) => path.relative(DIST_DIR, file)).join(", ")}`
  );
});

test("every text artifact (index.js, index.js.map, worker) embeds no absolute machine path", () => {
  const forbiddenLiterals = [REPO_ROOT, path.resolve(REPO_ROOT, "..")];

  // Raw-text outputs: the bundled program and the self-contained jsdom worker.
  for (const target of [DIST_INDEX, DIST_WORKER]) {
    const content = readFileSync(target, "utf8");
    const rel = path.relative(REPO_ROOT, target);
    for (const literal of forbiddenLiterals) {
      assert.ok(
        !content.includes(literal),
        `${rel} embeds the machine path ${literal}`
      );
    }
    assert.deepEqual(
      machinePathHits(content),
      [],
      `${rel} embeds an absolute machine path`
    );
  }

  // The sourcemap: its `sources` must all be relative, and its embedded `sourcesContent`
  // (the inlined input text) must likewise carry no machine path.
  assert.ok(existsSync(DIST_MAP), `${DIST_MAP} is missing`);
  const map = JSON.parse(readFileSync(DIST_MAP, "utf8"));

  const absoluteSources = map.sources.filter((source) =>
    /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(source)
  );
  assert.deepEqual(
    absoluteSources,
    [],
    `index.js.map embeds absolute source(s): ${absoluteSources.join(", ")}`
  );

  const sourcesText = map.sourcesContent.filter((s) => s != null).join("\n");
  for (const literal of forbiddenLiterals) {
    assert.ok(
      !sourcesText.includes(literal),
      `index.js.map sourcesContent embeds the machine path ${literal}`
    );
  }
  assert.deepEqual(
    machinePathHits(sourcesText),
    [],
    "index.js.map sourcesContent embeds an absolute machine path"
  );
});

test("sharp and @img/sharp-* inputs contribute zero bytes to the bundle (structural build evidence)", () => {
  assert.ok(existsSync(METAFILE_PATH), "esbuild metafile was not written");
  const metafile = JSON.parse(readFileSync(METAFILE_PATH, "utf8"));

  // sharp must still be resolvable and present in the build's input graph — this proves
  // the zero-byte contribution below is the tree-shake plugin's doing, not sharp having
  // silently dropped out of reach.
  const sharpInputs = Object.keys(metafile.inputs).filter(isSharpOrImg);
  assert.ok(
    sharpInputs.length > 0,
    "sharp/@img must appear in the esbuild input graph (tree-shake path is not exercised); the backend may have regressed to importing sharp-free symbols only without the side-effect-free marking"
  );

  const indexOutput = Object.keys(metafile.outputs).find(
    (output) => output.replace(/\\/g, "/") === "dist/index.js"
  );
  assert.ok(indexOutput, "dist/index.js output not found in the esbuild metafile");

  const contributions = metafile.outputs[indexOutput].inputs;
  for (const inputPath of sharpInputs) {
    const bytes = contributions[inputPath]?.bytesInOutput ?? 0;
    assert.equal(
      bytes,
      0,
      `${inputPath} contributes ${bytes} bytes to dist/index.js — sharp leaked into the API bundle`
    );
  }
});

test("jquery and the jsdom xhr worker resolve and run with NODE_PATH cleared", () => {
  const resolverScript = `
    const { createRequire } = require('node:module');
    const fs = require('node:fs');
    const indexPath = process.env.BUNDLE_INDEX;
    const req = createRequire(indexPath);
    const jquery = req.resolve('jquery');
    if (!fs.existsSync(jquery)) throw new Error('jquery resolves to a missing file: ' + jquery);
    if (!fs.lstatSync(jquery).isFile()) throw new Error('jquery is not a regular file: ' + jquery);
    const worker = req.resolve('./xhr-sync-worker.js');
    if (!fs.existsSync(worker)) throw new Error('worker resolves to a missing file: ' + worker);
    const st = fs.lstatSync(worker);
    if (!st.isFile() || st.isSymbolicLink()) throw new Error('worker is not a regular non-symlink file: ' + worker);
    process.stdout.write(JSON.stringify({ jquery, worker }));
  `;
  const resolve = spawnSync(process.execPath, ["-e", resolverScript], {
    cwd: BACKEND_DIR,
    env: { ...childEnv(), BUNDLE_INDEX: DIST_INDEX },
    encoding: "utf8"
  });
  assert.equal(resolve.status, 0, `runtime resolution failed:\n${resolve.stderr}`);
  const resolved = JSON.parse(resolve.stdout);
  assert.equal(resolved.worker, DIST_WORKER, "worker did not resolve to the sibling self-contained asset");

  // Prove the emitted worker is actually usable: driver it the same way jsdom does
  // (spawn `node <worker>` with a synchronous-XHR flag on stdin) and expect exit 0,
  // HTTP 200, and a parsed response — a missing/unbundled dependency would crash on
  // module load instead of completing the request round-trip.
  const flag = { method: "GET", uri: "data:text/plain,ok" };
  const workerRun = spawnSync(process.execPath, [DIST_WORKER], {
    cwd: BACKEND_DIR,
    env: childEnv(),
    input: JSON.stringify(flag),
    encoding: "utf8",
    // jsdom itself spawns this worker with maxBuffer: Infinity; mirror that so a
    // real response Buffer is not truncated by the default 1MB cap.
    maxBuffer: Infinity
  });
  assert.equal(workerRun.status, 0, `emitted worker exited non-zero:\n${workerRun.stderr}`);
  const response = JSON.parse(workerRun.stdout);
  assert.ok(
    response && typeof response.properties === "object",
    "emitted worker did not return the expected jsdom response payload"
  );
  assert.equal(
    response.status,
    200,
    `emitted worker did not complete a real data: URL request: ${response.statusText}`
  );
});