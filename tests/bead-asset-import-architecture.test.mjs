import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * TASK-ASSET-QA-001 architecture gate for the bead asset import line.
 *
 * These checks are structural and behavioral, not copy-matching: they resolve
 * real files, real import graphs, real package boundaries and the real Git
 * index, so a rename of user-facing copy never breaks them while a genuine
 * boundary regression (processing inside a request handler, a merged worker, a
 * client-assembled asset URL, a tracked raw photograph) always fails them.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRepo(relativePath) {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function repoGlobDirectoryListing(relativeDir) {
  return execFileSync("ls", ["-1", join(REPO_ROOT, relativeDir)], { encoding: "utf8" })
    .split("\n")
    .filter((entry) => entry !== "");
}

function gitLsFiles() {
  return execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((entry) => entry !== "");
}

/** Every non-test source file under a repo directory, as one string blob per file. */
function sourceFilesUnder(relativeDir, extensions) {
  const tracked = gitLsFiles().filter(
    (path) =>
      path.startsWith(`${relativeDir}/`) &&
      extensions.some((extension) => path.endsWith(extension)) &&
      !/\.(test|spec)\.[jt]sx?$/.test(path)
  );
  return tracked.map((path) => ({ path, content: readRepo(path) }));
}

test("the bead import console is an independent admin entry, walled off from knowledge admin", () => {
  const entryPage = "apps/frontend/app/admin/bead-import/page.tsx";
  const sessionPage = "apps/frontend/app/admin/bead-import/[sessionId]/page.tsx";
  const loginPage = "apps/frontend/app/admin/bead-import/login/page.tsx";
  const layout = "apps/frontend/app/admin/bead-import/layout.tsx";
  for (const page of [entryPage, sessionPage, loginPage, layout]) {
    assert.ok(existsSync(join(REPO_ROOT, page)), `${page} must exist as a dedicated route`);
  }
  for (const page of [entryPage, sessionPage, layout]) {
    assert.ok(
      readRepo(page).includes("requireBeadImportConsoleAccess"),
      `${page} must re-verify the bead-import admin cookie boundary server-side`
    );
  }

  const knowledgeSources = sourceFilesUnder("apps/frontend/app/admin/knowledge", [".tsx", ".ts"]);
  assert.ok(knowledgeSources.length > 0, "the knowledge admin tree is expected to exist");
  for (const file of knowledgeSources) {
    assert.ok(
      !file.content.includes("admin-bead-import"),
      `${file.path} must not embed the bead import console`
    );
  }
  const beadImportSources = sourceFilesUnder("apps/frontend/app/admin/bead-import", [".tsx", ".ts"]);
  for (const file of beadImportSources) {
    assert.ok(
      !file.content.includes("admin/knowledge") && !file.content.includes("features/knowledge"),
      `${file.path} must not reach into the knowledge admin surface`
    );
  }

  const adminHub = readRepo("apps/frontend/app/admin/page.tsx");
  assert.ok(
    adminHub.includes('href: "/admin/bead-import"'),
    "the admin hub must list the bead import console as its own entry"
  );

  const productRoutes = sourceFilesUnder("apps/frontend/app", [".tsx", ".ts"]).filter((file) =>
    file.path.includes("app/admin/")
  );
  assert.ok(productRoutes.length > 0);
});

test("image processing lives outside backend request handlers", () => {
  const backendSources = sourceFilesUnder("apps/backend/src", [".ts"]);
  assert.ok(backendSources.length > 0, "the backend tree is expected to exist");
  for (const file of backendSources) {
    assert.ok(
      !/from\s+"sharp"|require\("sharp"\)/.test(file.content),
      `${file.path} must not decode or process images inside the API process`
    );
  }
  const backendPackage = JSON.parse(readRepo("apps/backend/package.json"));
  const backendDeclaresSharp = [
    ...(Object.keys(backendPackage.dependencies ?? {})),
    ...(Object.keys(backendPackage.devDependencies ?? {}))
  ].includes("sharp");
  assert.equal(backendDeclaresSharp, false, "the backend package must not even depend on sharp");

  const pipelineSources = sourceFilesUnder("packages/asset-pipeline/src", [".ts"]);
  const pipelineUsesSharp = pipelineSources.some((file) => /from\s+"sharp"/.test(file.content));
  assert.ok(pipelineUsesSharp, "the asset pipeline is the canonical image-processing owner");
});

test("the asset worker and the knowledge worker are separate processes with separate contracts", () => {
  const workerPackage = JSON.parse(readRepo("apps/asset-worker/package.json"));
  const knowledgePackage = JSON.parse(readRepo("apps/knowledge-worker/package.json"));
  assert.equal(workerPackage.name, "@mystcrag/asset-worker");
  assert.equal(knowledgePackage.name, "@mystcrag/knowledge-worker");
  assert.notEqual(workerPackage.name, knowledgePackage.name);

  for (const file of sourceFilesUnder("apps/asset-worker/src", [".ts"])) {
    assert.ok(
      !file.content.includes("@mystcrag/knowledge-worker") && !file.content.includes("knowledge-worker"),
      `${file.path} must not couple the asset worker to the knowledge worker`
    );
  }
  for (const file of sourceFilesUnder("apps/knowledge-worker/src", [".ts"])) {
    assert.ok(
      !file.content.includes("@mystcrag/asset-worker") &&
        !file.content.includes("bead-asset-import") &&
        !file.content.includes("claimNextJob"),
      `${file.path} must not claim asset import jobs or import the asset worker`
    );
  }
});

test("dynamic bead visuals resolve only through the approved-key resolver and the same-origin proxy", () => {
  const visualAssets = readRepo("apps/frontend/src/features/design/model/visual-assets.ts");
  assert.ok(visualAssets.includes("APPROVED_ASSET_KEY_PATTERN"), "a strict approved-key pattern must exist");
  assert.ok(
    /export function isApprovedAssetKey/.test(visualAssets),
    "approved keys are recognized by one predicate only"
  );
  assert.ok(
    /export function publicAssetUrlFor/.test(visualAssets),
    "the same-origin public URL is assembled in exactly one place"
  );

  const routePath = join(REPO_ROOT, "apps/frontend/app/api/assets/[assetKey]/route.ts");
  assert.ok(existsSync(routePath), "the same-origin public asset route must exist");
  const route = readRepo("apps/frontend/app/api/assets/[assetKey]/route.ts");
  assert.ok(
    route.includes("handlePublicAssetRequest"),
    "the route must delegate to the validated proxy core"
  );

  const frontendSources = sourceFilesUnder("apps/frontend/src", [".ts", ".tsx"]).concat(
    sourceFilesUnder("apps/frontend/app", [".ts", ".tsx"])
  );
  for (const file of frontendSources) {
    if (file.path.endsWith("features/design/model/visual-assets.ts")) {
      continue;
    }
    assert.ok(
      !file.content.includes('"/api/assets/'),
      `${file.path} must build asset URLs through publicAssetUrlFor, never a hand-written route`
    );
  }

  const gallery = readRepo("apps/frontend/src/features/gallery/components/gallery-page.tsx");
  assert.ok(
    /getBeadVisual\(\s*bead\.materialKey\s*,\s*bead\.textureAssetKey\s*\)/.test(gallery),
    "the exported gallery card must prefer the approved asset through the same resolver"
  );
  const consumersPassingKey = frontendSources.filter((file) =>
    file.content.includes("textureAssetKey={")
  );
  assert.ok(
    consumersPassingKey.length >= 6,
    "every authoritative bead view forwards the DTO's textureAssetKey"
  );
});

test("every implementation dependency of the integration gate is registered DONE", () => {
  const registry = readRepo("docs/tasks/TASK_REGISTRY.md");
  const requiredDone = [
    "TASK-ASSET-DB-001",
    "TASK-ASSET-WORKER-001",
    "TASK-ASSET-BE-001",
    "TASK-ASSET-FE-001",
    "TASK-ASSET-RESOLVER-001"
  ];
  for (const taskId of requiredDone) {
    const row = registry
      .split("\n")
      .find((line) => line.startsWith(`| ${taskId} |`));
    assert.ok(row !== undefined, `${taskId} must have a registry row`);
    const cells = row.split("|").map((cell) => cell.trim());
    // cells[0] is empty (leading pipe), so the status column is cells[4].
    assert.equal(cells[4], "DONE", `${taskId} must be DONE before the QA gate runs`);
  }
});

test("Git tracks no raw camera originals and no undocumented generated-resource directories", () => {
  const tracked = gitLsFiles();

  const rawOriginals = tracked.filter((path) => /\.(arw|cr2|nef|dng)$/i.test(path));
  assert.deepEqual(
    rawOriginals,
    [],
    "raw camera originals must never be committed; synthetic fixtures are generated at runtime"
  );

  // docs/governance/QA_EVIDENCE_RETENTION.md documents exactly which generated
  // evidence directories are retained and why; anything outside those roots is
  // an undocumented leak and fails this gate.
  const retainedGeneratedRoots = [
    "output/playwright/qa-rerun",
    "outputs/bead-catalog-template-20260724",
    "outputs/knowledge-acquisition"
  ];
  const generated = tracked.filter((path) => /^(output|outputs|qa-captures[^/]*)(\/|$)/.test(path));
  const undocumented = generated.filter(
    (path) => !retainedGeneratedRoots.some((root) => path.startsWith(`${root}/`))
  );
  assert.deepEqual(
    undocumented,
    [],
    "generated output outside the documented retention roots must not be tracked"
  );

  const qaScriptDir = repoGlobDirectoryListing("scripts/ui-qa");
  assert.ok(
    qaScriptDir.includes("bead_import_flow.py"),
    "the disposable browser gate script must exist beside the other UI QA scripts"
  );
});

test("finish() runs cleanup before freezing problems/summary so cleanup errors always change the exit code", () => {
  const qaScript = readRepo("scripts/ui-qa/bead_import_flow.py");
  const lines = qaScript.split("\n");
  const finishLine = lines.findIndex((line) => line.trim().startsWith("def finish("));
  assert.ok(finishLine !== -1, "finish() must exist");
  const bodyEnd = lines.findIndex(
    (line, i) => i > finishLine && /^def /.test(line) && !line.startsWith("def finish")
  );
  const body = lines.slice(finishLine + 1, bodyEnd === -1 ? undefined : bodyEnd);

  const indexOfLine = (predicate) => body.findIndex(predicate);
  const cleanupAt = indexOfLine((line) => line.trim() === "cleanup()");
  const foldAt = indexOfLine((line) => line.includes("enumerate(CLEANUP_ERRORS)"));
  const summaryAt = indexOfLine((line) => line.includes("SUMMARY:"));
  const exitAt = indexOfLine((line) => line.includes("sys.exit(1 if problems else 0)"));
  for (const [label, at] of [
    ["cleanup() call", cleanupAt],
    ["cleanup-error fold", foldAt],
    ["SUMMARY print", summaryAt],
    ["sys.exit decision", exitAt]
  ]) {
    assert.ok(at !== -1, `finish() must contain the ${label}`);
  }
  assert.ok(
    cleanupAt < foldAt && foldAt < summaryAt && summaryAt < exitAt,
    "cleanup() must run before CLEANUP_ERRORS are folded into problems, and that fold must precede the " +
      "SUMMARY print and the exit-code decision; otherwise cleanup errors neither change EXIT nor the summary"
  );
});

test("the processing-start 启动处理 click fires inside the expect_response window (no missed-response race)", () => {
  const qaScript = readRepo("scripts/ui-qa/bead_import_flow.py");
  const lines = qaScript.split("\n");

  const clickLine = lines.findIndex((line) =>
    line.includes('get_by_role("button", name="启动处理", exact=True).click()')
  );
  assert.ok(clickLine !== -1, "the 启动处理 button click must exist");
  const clickIndent = (lines[clickLine].match(/^\s*/) ?? [""])[0].length;

  // Anchor the window on its unique closer: the expect_response whose header
  // terminates in `) as processing_start_info:`.
  const asLine = lines.findIndex((line) => line.includes(") as processing_start_info:"));
  assert.ok(asLine !== -1, "the processing-start window must close into processing_start_info");
  const withLine = asLine;
  const withIndent = (lines[withLine].match(/^\s*/) ?? [""])[0].length;
  assert.ok(
    lines.slice(0, withLine).some((line) => line.includes("with page.expect_response(")),
    "the processing-start window must be opened with page.expect_response"
  );

  assert.ok(
    withLine < clickLine && clickIndent > withIndent,
    "the 启动处理 click must be nested inside the expect_response with-block (armed before the click, " +
      "deeper than the with) so the BFF response cannot be missed; a click-then-listen ordering is a race"
  );
});
