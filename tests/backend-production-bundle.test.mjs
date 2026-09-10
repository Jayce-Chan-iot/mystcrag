import { before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, lstatSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// TASK-BE-SMOKE-001: the Backend production bundle must start directly under a
// normal pnpm production dependency layout — no NODE_PATH, no test harness, no
// manual/absolute path, and no symlink — for both crawlee's require.resolve("jquery")
// and jsdom's require.resolve("./xhr-sync-worker.js").

const REPO_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const BACKEND_DIR = path.join(REPO_ROOT, "apps", "backend");
const DIST_DIR = path.join(BACKEND_DIR, "dist");
const DIST_INDEX = path.join(DIST_DIR, "index.js");
const DIST_WORKER = path.join(DIST_DIR, "xhr-sync-worker.js");

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

before(() => {
  const build = spawnSync(process.execPath, ["build.mjs"], {
    cwd: BACKEND_DIR,
    env: childEnv(),
    encoding: "utf8"
  });
  assert.equal(
    build.status,
    0,
    `backend build.mjs failed (error: ${build.error ? build.error.message : "none"}):\nstdout:\n${build.stdout}\nstderr:\n${build.stderr}`
  );
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

test("the artifact embeds no absolute machine path", () => {
  for (const target of [DIST_INDEX, DIST_WORKER]) {
    const content = readFileSync(target, "utf8");
    assert.ok(
      !content.includes(REPO_ROOT),
      `${path.relative(REPO_ROOT, target)} embeds the repository absolute path`
    );
    assert.ok(
      !content.includes(path.resolve(REPO_ROOT, "..")),
      `${path.relative(REPO_ROOT, target)} embeds the parent absolute path`
    );
    assert.ok(!/\/Users\//.test(content), `${path.relative(REPO_ROOT, target)} embeds a /Users/ path`);
  }
});

test("the artifact carries no unresolved native image-processor binding", () => {
  // sharp is image-only (asset worker via asset-pipeline); the backend imports only
  // sharp-free symbols. Its eager native loader would throw at import time under a clean
  // layout, so the tree-shake plugin must have removed it from the built artifact.
  const content = readFileSync(DIST_INDEX, "utf8");
  assert.ok(
    !content.includes("@img/sharp"),
    "dist/index.js still embeds sharp's native binding loader"
  );
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