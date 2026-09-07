import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BeadImportWorkflow } from "./bead-import-workflow";

const CONTAINER_SOURCE = readFileSync(join(__dirname, "bead-import-workflow.tsx"), "utf8");
const PROCESSING_PANEL_SOURCE = readFileSync(join(__dirname, "processing-panel.tsx"), "utf8");
const PAGE_SOURCE = readFileSync(
  join(__dirname, "../../../../app/admin/bead-import/[sessionId]/page.tsx"),
  "utf8"
);

const FORBIDDEN_LEAKS = [
  "archiveKey",
  "asset-archive",
  "storageKey",
  "x-admin-key",
  "MYSTCRAG_ASSET_ADMIN_KEY",
  "ASSET_ADMIN_API_KEY",
  "MYSTCRAG_BACKEND_ORIGIN",
  "MYSTCRAG_ASSET_ARCHIVE_ROOT",
  "127.0.0.1",
  "localhost",
  "/Users/",
  "document.cookie"
];

test("the session page guards first, then renders the workflow container", () => {
  assert.ok(PAGE_SOURCE.includes("requireBeadImportConsoleAccess()"), "the page must re-verify the admin cookie");
  assert.ok(PAGE_SOURCE.includes("<BeadImportWorkflow sessionId={sessionId} />"));
  assert.ok(PAGE_SOURCE.includes("force-dynamic"));
  assert.ok(PAGE_SOURCE.includes("await params"), "Next.js dynamic route params are awaited");
});

test("the container's first paint shows a loading workflow and invents no session", () => {
  const html = renderToStaticMarkup(<BeadImportWorkflow sessionId="session-1" />);
  assert.ok(html.includes("正在载入导入任务…"), "the first paint must not claim an empty or loaded task");
  assert.ok(html.includes("第 1 步"), "the four-step stepper must be present");
});

test("the container wires the session lifecycle and every loader", () => {
  assert.ok(CONTAINER_SOURCE.includes('"use client"'));
  assert.ok(CONTAINER_SOURCE.includes("React.useReducer(workflowReducer"));
  assert.ok(CONTAINER_SOURCE.includes("createSessionLifecycle("));
  assert.ok(CONTAINER_SOURCE.includes("createGroupLoader("));
  assert.ok(CONTAINER_SOURCE.includes("createDraftLoader("));
  assert.ok(CONTAINER_SOURCE.includes("createProcessingLoader("));
  assert.ok(CONTAINER_SOURCE.includes("createUploadQueue("));
  assert.ok(CONTAINER_SOURCE.includes("createBeadImportClient("));
  assert.ok(CONTAINER_SOURCE.includes("<WorkflowView"));
});

test("the container stops the lifecycle, queue and loaders when it unmounts", () => {
  assert.ok(CONTAINER_SOURCE.includes("lifecycle.stop()"));
  assert.ok(CONTAINER_SOURCE.includes("uploadQueue.cancel()"));
  assert.ok(CONTAINER_SOURCE.includes("groupLoader.cancel()"));
  assert.ok(CONTAINER_SOURCE.includes("draftLoader.cancel()"));
  assert.ok(CONTAINER_SOURCE.includes("processingLoader.cancel()"));
});

test("the container talks to the Backend only through the contract client", () => {
  assert.ok(!CONTAINER_SOURCE.includes("fetch("), "no hand-rolled request may skip the contract client");
  assert.ok(!CONTAINER_SOURCE.includes("/api/admin/bead-import"), "the browser must use the cookie-scoped proxy prefix");
  for (const forbidden of FORBIDDEN_LEAKS) {
    assert.ok(!CONTAINER_SOURCE.includes(forbidden), `container must not mention ${forbidden}`);
  }
});

test("the container reads no server configuration and holds no key material", () => {
  assert.ok(!CONTAINER_SOURCE.includes("process.env"));
  assert.ok(!CONTAINER_SOURCE.includes("localStorage"));
  assert.ok(!CONTAINER_SOURCE.includes("sessionStorage"));
});

test("the container derives the step from the session, never from React memory", () => {
  assert.ok(CONTAINER_SOURCE.includes("currentWorkflowStep(state)"), "the step must come from the reducer");
  assert.ok(CONTAINER_SOURCE.includes("lifecycle.start(sessionId)"), "the container must re-read the session on mount");
});

test("an upload that settles re-reads the authoritative session so the flow never stalls on step 1", () => {
  assert.match(
    CONTAINER_SOURCE,
    /uploadQueue\.start\([\s\S]*?\)\s*\.\s*then\(\s*\(\)\s*=>\s*lifecycle\.refresh\(\)\s*\)/,
    "the queue's terminal state must be followed by an authoritative session read"
  );
  assert.match(
    CONTAINER_SOURCE,
    /retryRegistered\([\s\S]*?\)\s*\.\s*then\(\s*\(\)\s*=>\s*lifecycle\.refresh\(\)\s*\)/,
    "a registered-file retry must also end in an authoritative read"
  );
});

test("a re-picked folder retries registered failed files instead of re-registering a manifest", () => {
  assert.ok(
    CONTAINER_SOURCE.includes("decideUploadRecovery"),
    "the container must decide between registration and registered retry through the recovery model"
  );
});

test("the processing step wires the approved-key publish and the preview comparison", () => {
  assert.ok(
    CONTAINER_SOURCE.includes("onPublish"),
    "the processing panel must receive a publish action"
  );
  assert.ok(
    CONTAINER_SOURCE.includes("preview={previewContext}"),
    "the container must hand the preview loader context to the processing step"
  );
  assert.ok(
    PROCESSING_PANEL_SOURCE.includes("AssetPreview") &&
      PROCESSING_PANEL_SOURCE.includes("rendition=\"thumbnail\""),
    "the processing step must render the original-vs-processed comparison"
  );
  assert.ok(
    PROCESSING_PANEL_SOURCE.includes("onPublish"),
    "the processing panel must offer the publish action"
  );
});

test("the naming step offers existing-crystal search and selection", () => {
  assert.ok(
    CONTAINER_SOURCE.includes("CrystalSearch") || CONTAINER_SOURCE.includes("crystal-search"),
    "the operator must be able to search and select an existing Crystal"
  );
});
