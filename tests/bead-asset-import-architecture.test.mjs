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

test("--self-test dispatches to the full self-test suite, not only the finish-order probe", () => {
  const qaScript = readRepo("scripts/ui-qa/bead_import_flow.py");
  assert.ok(
    qaScript.includes("sys.exit(0 if run_self_tests() else 1)"),
    "--self-test must exit through run_self_tests (aggregate), never only _selftest_finish_order"
  );
  const registry = qaScript.slice(qaScript.indexOf("def run_self_tests()"));
  for (const probe of [
    '("finish-order", _selftest_finish_order)',
    '("cleanup-two-phase", _selftest_cleanup_two_phase)',
    '("cross-pair-ok", _selftest_cross_pair_ok)'
  ]) {
    assert.ok(registry.includes(probe), `run_self_tests() must run ${probe}`);
  }
});

test("cleanup() stays two-phase: live-only signalling, reap, then a deduped port check", () => {
  const qaScript = readRepo("scripts/ui-qa/bead_import_flow.py");
  const lines = qaScript.split("\n");
  const defLine = lines.findIndex((line) => line.trim().startsWith("def cleanup("));
  assert.ok(defLine !== -1, "cleanup() must exist");
  const bodyEnd = lines.findIndex(
    (line, i) => i > defLine && /^def |^class /.test(line) && !line.trim().startsWith("def cleanup")
  );
  const body = lines.slice(defLine + 1, bodyEnd === -1 ? undefined : bodyEnd);

  const bodyText = body.join("\n");
  assert.ok(
    bodyText.includes("live = [(name, proc) for name, proc in PROCS if proc.poll() is None]"),
    "phase 1 must compute the set of still-live process groups only"
  );
  assert.ok(
    bodyText.includes('signalled_pids = {proc.pid for _, proc in live}'),
    "the SIGTERM target set must be recorded so SIGKILL escalation only ever touches groups this run signalled"
  );
  const sigtermIdx = body.findIndex((line) => line.includes("os.killpg(proc.pid, signal.SIGTERM)"));
  const sigkillGuardIdx = body.findIndex((line) => line.includes("if proc.pid in signalled_pids:"));
  const reapIdx = body.findIndex((line) => line.includes("proc.wait(timeout=15)"));
  const portCheckIdx = body.findIndex((line) => line.includes("if port in checked_ports:"));
  assert.ok(
    sigtermIdx !== -1 && sigkillGuardIdx !== -1 && reapIdx !== -1 && portCheckIdx !== -1,
    "cleanup() must contain the phase-1 SIGTERM, the reap loop, the guarded SIGKILL and the deduped port check"
  );
  assert.ok(
    sigtermIdx < reapIdx && reapIdx < portCheckIdx,
    "port closure must be checked only after every process has been reaped, not while a same-port process still lives"
  );
  const checkedPortsDef = body.findIndex((line) => line.includes("checked_ports: set[int] = set()"));
  assert.ok(checkedPortsDef !== -1, "port checks must be deduped across shared-port process names");
  // The SIGKILL escalation must be nested after the signalled_pids guard (only groups this run
  // signalled), so an already-exited old process group is never killpg'd under PID/PGID reuse.
  assert.ok(
    body.findIndex((line, i) => i > sigkillGuardIdx && line.includes("os.killpg(proc.pid, signal.SIGKILL)")) !== -1,
    "the SIGKILL escalation must live inside the signalled_pids guard"
  );
});

test("the real source-set gate attempts the frontend proxy first and never infers failure from file size", () => {
  const qaScript = readRepo("scripts/ui-qa/bead_import_flow.py");
  const phaseIdx = qaScript.indexOf("def run_source_set_phase(");
  assert.ok(phaseIdx !== -1, "run_source_set_phase() must exist");
  const phase = qaScript.slice(phaseIdx);

  assert.ok(
    phase.includes("upload_file(client, src_session_id, file_id, data, attempts=2, label=relative, direct_diag=False)"),
    "every real file, regardless of size, must first genuinely attempt the frontend proxy"
  );
  assert.ok(
    phase.includes("upload_direct_backend(client, src_session_id, file_id, data)"),
    "direct-to-backend must exist only as the diagnostic continuation after an observed proxy failure"
  );
  assert.ok(
    phase.includes("direct_backend_failures"),
    "a direct-backend diagnostic failure (e.g. 409 on a stuck reservation) must be captured, never crash the phase"
  );
  assert.ok(
    phase.includes("if direct_backend_failures:"),
    "a stuck-reservation direct-backend failure must fail fast into sources/import-roundtrip instead of polling archive settlement for 600s"
  );
  assert.ok(
    !phase.includes("NEXT_ROUTE_BODY_CAP_BYTES") && !phase.includes("len(data) >"),
    "the byte-size based unconditional proxy bypass must be gone from the source-set phase"
  );
  assert.ok(
    phase.includes("sources/proxy-large-body-cap") && phase.includes("observed error, never inferred from file size"),
    "the large-body-cap gate must be driven by observed 500/truncation/connection errors and auto-PASS on success"
  );
  assert.ok(
    qaScript.includes('REAL_SOURCE_SET_BASELINE = {"dirs": 26, "files": 127, "jpg": 65, "arw": 62}'),
    "the real desktop source-set baseline (26 dirs / 127 files / 65 JPG / 62 ARW) must be enforced"
  );
  assert.ok(qaScript.includes("def _discover_source_set("), "read-only discovery must be isolated");
  assert.ok(qaScript.includes("def _read_and_sha("), "read+hash must be isolated in a killable unit");
  assert.ok(
    qaScript.includes("timeout_s: int = 5") && qaScript.includes("timeout_s=5"),
    "the source operations must run under a 5s forcibly-terminable timeout"
  );
});

test("curation persistence is re-verified from a fresh session read and survives reload value-for-value", () => {
  const qaScript = readRepo("scripts/ui-qa/bead_import_flow.py");

  assert.ok(
    qaScript.includes("def curation_matches(view: dict | None) -> bool:"),
    "a dedicated judge must re-check the authoritative crystalDraft view after the PATCH"
  );
  assert.ok(
    qaScript.includes('view.get("curationComplete") is True'),
    "the judge must require curationComplete from the re-read, never from the PATCH acknowledgement alone"
  );
  assert.ok(
    qaScript.includes("view.get(\"revision\") == expected_revision + 1"),
    "a successful curation PATCH must be proven to advance revision exactly one step (N -> N+1)"
  );
  assert.ok(
    qaScript.includes("all(view.get(field) == value for field, value in committed_curation.items())"),
    "all eight committed curation fields must match the re-read field-by-field"
  );
  const committedShape = qaScript.slice(
    qaScript.indexOf("committed_curation = {"),
    qaScript.indexOf("def curation_matches(")
  );
  for (const key of ["nameCn", "nameEn", "mineralName", "colorTags", "visualTags", "styleTags", "priceLevel", "complianceNote"]) {
    assert.ok(committedShape.includes(`"${key}"`), `committed_curation must carry ${key}`);
  }
  assert.ok(
    committedShape.includes('"colorTags": ["clear"]') && committedShape.includes('"priceLevel": 2'),
    "the committed shape must be the contract DTO shape (tags as arrays, priceLevel as a number)"
  );
  assert.ok(
    qaScript.includes(
      '"flow/draft-refresh-persistence",\n                draft_persisted and curation_persisted,'
    ),
    "the fresh-session persistence report must require both the productDraft and the curated crystalDraft to persist"
  );
  // After a reload the gate must read the real controls back and re-check completion,
  // not just assert the workflow step heading.
  assert.ok(
    qaScript.includes("readbacks[field] = page.input_value("),
    "after reload the gate must read actual form control values back"
  );
  assert.ok(
    qaScript.includes("readbacks[field] == expected for field, expected in curation_values.items()"),
    "the reload judge must compare every committed form string to the re-rendered input value"
  );
  assert.ok(
    qaScript.includes("completion_matches = curation_matches(after_group.get(\"crystalDraft\") or {})"),
    "completion after reload must come from a fresh authoritative session read, not the page title"
  );
  assert.ok(
    qaScript.includes("form_matches and completion_matches"),
    "the reload render result must require both the input readback and the authoritative completion state"
  );
});

test("the QC-block gate locks exactly HTTP 409 + CONFLICT and proves the UI separately", () => {
  const qaScript = readRepo("scripts/ui-qa/bead_import_flow.py");
  assert.ok(
    !qaScript.includes("400 <= blocked.status_code < 500"),
    "the QC-block PASS must never come from a loose 4xx range, or a 401/400/404 would count as PASS"
  );
  assert.ok(
    qaScript.includes("qc_blocked = blocked.status_code == 409 and blocked_code == \"CONFLICT\""),
    "only the exact HTTP 409 + CONFLICT envelope may count as the QC-block PASS"
  );
  assert.ok(
    qaScript.includes('.get("error", {}).get("code")'),
    "the stable business error code must be read from the normalized {error:{code}} envelope"
  );
  assert.ok(
    qaScript.includes('"browser/qc-blocks-ui-approval-button"'),
    "the browser no-approval-button proof must be its own named check"
  );
  const requiredBlock = qaScript.slice(qaScript.indexOf("REQUIRED_RESULTS = ["));
  assert.ok(
    requiredBlock.includes('"browser/qc-blocks-ui-approval-button"'),
    "the browser no-approval-button proof must be mandatory in the required result set"
  );
  assert.ok(
    qaScript.includes('skipped(\n                    "browser/qc-blocks-ui-approval-button",'),
    "skip-browser must skip the UI proof on its own line, never fold it into the HTTP result"
  );
  assert.ok(
    qaScript.includes('report(\n                    "browser/qc-blocks-ui-approval-button",'),
    "full-browser mode must report the UI proof as its own result"
  );
  const uiProof = qaScript.slice(qaScript.indexOf("ui_shows_failure = False"));
  assert.ok(
    uiProof.includes("ui_shows_failure") &&
      uiProof.includes("ui_shows_issue") &&
      uiProof.includes("ui_no_approval_form = poor_card.get_by_role(\"button\", name=\"提交批准\").count() == 0"),
    "the UI proof must decompose into failure badge + issue text + absence of the approve button on that version"
  );
});

test("process-group termination is proven by killpg(pgid,0) group-liveness, never unconditional SIGKILL on an exited PGID", () => {
  const qaScript = readRepo("scripts/ui-qa/bead_import_flow.py");
  assert.ok(
    qaScript.includes("def _process_group_alive(pgid: int) -> bool:"),
    "a killpg(pgid,0) group-liveness probe must exist"
  );
  assert.ok(qaScript.includes("os.killpg(pgid, 0)"), "the probe must use the no-op signal 0");
  const stop = qaScript.slice(qaScript.indexOf("def stop_process_group("), qaScript.indexOf("def wait_for_http("));
  assert.ok(
    stop.includes("signalled and _process_group_alive(pgid)"),
    "the SIGKILL after leader exit must be guarded by both signalled and group-liveness, never fired unconditionally"
  );
  assert.ok(
    stop.includes("still has live members after SIGTERM+SIGKILL (grandchild survived)"),
    "a surviving grandchild must fail stop_process_group, not be silently ignored"
  );
});

test("a stuck-reservation 409 triggers a bounded wait that re-reads the authoritative session before judging stuck", () => {
  const qaScript = readRepo("scripts/ui-qa/bead_import_flow.py");
  assert.ok(qaScript.includes("def _source_file_state("), "the helper must re-read the authoritative session file state");
  assert.ok(qaScript.includes("def _wait_upload_released("), "a bounded-wait helper must exist");
  const phase = qaScript.slice(qaScript.indexOf("def run_source_set_phase("));
  assert.ok(
    phase.includes("_wait_upload_released(client, src_session_id, relative, timeout_s=20)"),
    "the 409 handler must do a bounded wait, never infer terminal UPLOADING from a single 409"
  );
  assert.ok(
    phase.includes('settled_state in ("FAILED", "PENDING")'),
    "a FAILED/PENDING transition must trigger the allowed real retry"
  );
  assert.ok(
    phase.includes("still {settled_state} after 20s bounded wait"),
    "only timeout-still-UPLOADING may be judged stuck"
  );
});

test("source-set discovery reports is_dir + size/mtime from the subprocess and the manifest reuses them without main-process stat", () => {
  const qaScript = readRepo("scripts/ui-qa/bead_import_flow.py");
  const phase = qaScript.slice(qaScript.indexOf("def run_source_set_phase("));
  assert.ok(
    qaScript.includes("is_dir") && qaScript.includes("int(st.st_mtime*1000)"),
    "discovery must report is_dir and mtime inside the 5s killable subprocess"
  );
  assert.ok(
    phase.includes("size_mtime_by_relative[relative]"),
    "manifest byteSize/lastModifiedMs must reuse discovery size/mtime"
  );
  assert.ok(!phase.includes("stat = path.stat()"), "no main-process per-file stat may remain");
});

test("the full acceptance gate enforces the authoritative source-set path; a custom --source-set is diagnostic-only", () => {
  const qaScript = readRepo("scripts/ui-qa/bead_import_flow.py");
  const phase = qaScript.slice(qaScript.indexOf("def run_source_set_phase("));
  assert.ok(
    phase.includes("if str(source_set) != REAL_SOURCE_SET_PATH:"),
    "the authoritative-path enforcement must gate on the real path"
  );
  assert.ok(
    phase.includes("non-authoritative source set"),
    "a non-authoritative source set must FAIL sources/discovery"
  );
  assert.ok(
    phase.includes("--source-set is diagnostic-only and must not PASS the full gate"),
    "the diagnostic-only FAIL must be explicit, so a custom source set cannot exit 0"
  );
});

test("merge/split/primary/publish PASS are semantic, not count-only or hardcoded", () => {
  const qaScript = readRepo("scripts/ui-qa/bead_import_flow.py");
  const flow = qaScript.slice(qaScript.indexOf("def run_flow("));
  assert.ok(
    flow.includes("expected_merge_union = pre_merge_members[merge_target] | pre_merge_members[merge_source]"),
    "merge must verify the full union of the two source member sets"
  );
  assert.ok(flow.includes("merge_union_ok"), "the merge union check must gate flow/merge");
  assert.ok(
    flow.includes("partition_union == merged_member_set") && flow.includes("split_disjoint"),
    "split must verify partition union completeness and mutual exclusion"
  );
  assert.ok(flow.includes("primary_unconfirmed"), "primary-confirmed must re-read the authoritative session");
  assert.ok(
    !flow.includes('report("flow/primary-confirmed", True,'),
    "primary-confirmed must not be a hardcoded PASS"
  );
  assert.ok(
    qaScript.includes("isinstance(pr_snapshot, str) and bool(pr_snapshot.strip())"),
    "publish-result must require a valid non-empty inventorySnapshotId, never any non-empty error JSON"
  );
});

test("the required result set mandates the large-body-cap gate and separates backend vs worker readiness", () => {
  const qaScript = readRepo("scripts/ui-qa/bead_import_flow.py");
  const requiredBlock = qaScript.slice(
    qaScript.indexOf("REQUIRED_RESULTS = ["),
    qaScript.indexOf("def is_browser_only(")
  );
  assert.ok(requiredBlock.includes('"services/backend"'), "backend readiness must be its own required result");
  assert.ok(requiredBlock.includes('"services/worker"'), "worker readiness must be its own required result");
  assert.ok(!requiredBlock.includes('"services/backend+worker"'), "the combined backend+worker result must be gone");
  assert.ok(requiredBlock.includes('"sources/proxy-large-body-cap"'), "the large-body-cap gate must be mandatory");
  assert.ok(
    qaScript.includes("def worker_ready("),
    "a real worker readiness check (alive + no fatal startup error) must exist for the portless worker"
  );
});
