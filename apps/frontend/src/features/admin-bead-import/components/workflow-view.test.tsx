import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { WORKFLOW_STEPS, WORKFLOW_STEP_LABELS } from "../workflow-model";
import { initialWorkflowState, workflowReducer } from "../workflow-state";
import { WorkflowView } from "./workflow-view";

const SOURCE = readFileSync(join(__dirname, "workflow-view.tsx"), "utf8");

const FORBIDDEN_LEAKS = ["archiveKey", "storageKey", "x-admin-key", "127.0.0.1", "localhost", "/Users/"];

function render(state = initialWorkflowState("session-1")) {
  return renderToStaticMarkup(
    <WorkflowView state={state} step="UPLOAD_FOLDER" onSelectStep={() => {}}>
      <p>step-body</p>
    </WorkflowView>
  );
}

test("the stepper lists all four steps with the current one marked", () => {
  const html = render();
  for (const step of WORKFLOW_STEPS) {
    assert.ok(html.includes(WORKFLOW_STEP_LABELS[step].title), `the stepper must include ${WORKFLOW_STEP_LABELS[step].title}`);
  }
  assert.ok(html.includes("第 1 步"));
  assert.ok(html.includes('aria-current="step"'), "the current step must be marked for assistive tech");
});

test("global notices reach the operator with a stable, addressable element", () => {
  const failed = workflowReducer(initialWorkflowState("session-1"), {
    type: "SESSION_FAILED",
    error: { code: "INTERNAL_ERROR", message: "无法载入导入任务，请稍后重试。", retryable: true }
  });
  const html = render(failed);
  assert.ok(html.includes("无法载入导入任务，请稍后重试。"));
  assert.ok(html.includes('aria-live="polite"'));
});

test("the shell stays leak-free and motion-safe", () => {
  const html = render();
  for (const forbidden of FORBIDDEN_LEAKS) {
    assert.ok(!html.includes(forbidden), `the shell must not mention ${forbidden}`);
  }
  assert.ok(html.includes("min-w-0"), "the shell must resist horizontal overflow");
  assert.equal(/animate-spin|animate-bounce|animate-ping/.test(html), false, "no unguarded motion");
  for (const forbidden of ["fetch(", "process.env", "localStorage"]) {
    assert.equal(SOURCE.includes(forbidden), false, `the view must not reach for ${forbidden}`);
  }
});
