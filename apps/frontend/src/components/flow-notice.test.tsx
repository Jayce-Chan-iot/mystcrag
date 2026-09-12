/**
 * FlowNotice gate tests — Issue 4: the auth-required prompt must be separated from the
 * business retry. Dismissing "暂不登录" must never fire `onAction` (retry/re-submit), and
 * the UNAUTHORIZED branch must render the shared dialog rather than an action button.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AUTH_REQUIRED_COPY } from "../features/auth/browser/auth-required-dialog";
import { FlowNotice } from "./flow-notice";

test("UNAUTHORIZED renders the auth-required dialog and not an onAction retry button", () => {
  let onActionCalls = 0;
  const markup = renderToStaticMarkup(
    <FlowNotice code="UNAUTHORIZED" onAction={() => { onActionCalls += 1; }} />
  );

  assert.match(markup, /data-auth-required-dialog="true"/);
  assert.match(markup, new RegExp(AUTH_REQUIRED_COPY.title));
  assert.match(markup, new RegExp(AUTH_REQUIRED_COPY.secondaryAction.replace("/", "\\/")));
  assert.match(markup, /登录 \/ 注册/);

  // No generic ERROR_PRESENTATION notice container and no retry button is emitted.
  assert.doesNotMatch(markup, /data-error-code="UNAUTHORIZED"/);
  assert.doesNotMatch(markup, /onClick/);

  // Rendering alone never invokes the business action.
  assert.equal(onActionCalls, 0);
});

test("UNAUTHORIZED dialog does not bind onAction as onDismiss in FlowNotice", () => {
  const source = readFileSync(new URL("./flow-notice.tsx", import.meta.url), "utf8");
  assert.match(source, /return <AuthRequiredDialog \/>/);
  assert.doesNotMatch(source, /AuthRequiredDialog onDismiss=\{onAction\}/);
});