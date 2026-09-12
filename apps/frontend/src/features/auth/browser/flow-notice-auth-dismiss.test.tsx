/**
 * FlowNotice authentication-dismiss contract.
 *
 * Migrated from the shallow `src/components/flow-notice.test.tsx` so the package
 * `src/**` test glob expands correctly and these cases live inside the auth feature
 * that owns the dialog.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FlowNotice } from "../../../components/flow-notice";
import {
  AUTH_REQUIRED_COPY,
  AuthRequiredDialog,
  dismissDialog,
  resolveReturnFocusTarget
} from "./auth-required-dialog";

test("UNAUTHORIZED renders the auth-required dialog and not an onAction retry button", () => {
  let onActionCalls = 0;
  const markup = renderToStaticMarkup(
    <FlowNotice code="UNAUTHORIZED" onAction={() => { onActionCalls += 1; }} />
  );

  assert.match(markup, /data-auth-required-dialog="true"/);
  assert.match(markup, new RegExp(AUTH_REQUIRED_COPY.title));
  assert.match(markup, new RegExp(AUTH_REQUIRED_COPY.secondaryAction.replace("/", "\\/")));
  assert.match(markup, /登录 \/ 注册/);

  assert.doesNotMatch(markup, /data-error-code="UNAUTHORIZED"/);
  assert.doesNotMatch(markup, /onClick/);
  assert.equal(onActionCalls, 0);
});

test("FlowNotice UNAUTHORIZED wires onDismissAuthRequired and never onAction as onDismiss", () => {
  const source = readFileSync(new URL("../../../components/flow-notice.tsx", import.meta.url), "utf8");
  assert.match(source, /onDismissAuthRequired/);
  assert.match(source, /<AuthRequiredDialog onDismiss=\{onDismissAuthRequired\} \/>/);
  assert.doesNotMatch(source, /AuthRequiredDialog onDismiss=\{onAction\}/);
});

test("dismissing the auth dialog invokes only the auth cleanup callback, not business onAction", () => {
  let businessCalls = 0;
  let authCleanupCalls = 0;

  // Mirrors the FlowNotice wiring: onAction is a business retry; onDismiss is auth-only.
  const onAction = () => { businessCalls += 1; };
  const onDismissAuthRequired = () => { authCleanupCalls += 1; };

  const markup = renderToStaticMarkup(
    <FlowNotice code="UNAUTHORIZED" onAction={onAction} onDismissAuthRequired={onDismissAuthRequired} />
  );
  assert.match(markup, /data-auth-required-dialog="true"/);

  // Rendering never fires either callback.
  assert.equal(businessCalls, 0);
  assert.equal(authCleanupCalls, 0);

  // Behavioral: the dialog's dismiss primitive only calls onDismiss.
  dismissDialog(() => {}, { focus: () => {} }, onDismissAuthRequired);
  assert.equal(authCleanupCalls, 1);
  assert.equal(businessCalls, 0, "auth dismiss must never invoke the business onAction");
});

test("clearing the parent auth error then writing UNAUTHORIZED again remounts an open dialog", () => {
  // Parent state machine: UNAUTHORIZED mounts FlowNotice/dialog; dismiss clears the
  // parent code so the dialog unmounts; a later 401 writes UNAUTHORIZED again and
  // React mounts a fresh AuthRequiredDialog whose initial open state is true.
  let parentCode: "UNAUTHORIZED" | null = "UNAUTHORIZED";
  const first = renderToStaticMarkup(
    parentCode === "UNAUTHORIZED" ? <FlowNotice code={parentCode} /> : <span />
  );
  assert.match(first, /data-auth-required-dialog="true"/);

  // onDismissAuthRequired clears only the parent auth error (no business retry).
  parentCode = null;
  const afterDismiss = renderToStaticMarkup(
    parentCode === "UNAUTHORIZED" ? <FlowNotice code={parentCode} /> : <span data-cleared="true" />
  );
  assert.doesNotMatch(afterDismiss, /data-auth-required-dialog/);
  assert.match(afterDismiss, /data-cleared="true"/);

  // A fresh 401 writes the same code; because the previous dialog unmounted, this is
  // a new mount and AuthRequiredDialog starts open.
  parentCode = "UNAUTHORIZED";
  const second = renderToStaticMarkup(<FlowNotice code={parentCode} />);
  assert.match(second, /data-auth-required-dialog="true"/);
  assert.match(second, /登录后继续/);
});

test("explicit returnFocusRef takes priority over the document.activeElement fallback", () => {
  const trigger = { focus: () => {} };
  const body = { focus: () => {} };

  assert.equal(resolveReturnFocusTarget({ current: trigger as HTMLElement }, body as HTMLElement), trigger);
  assert.equal(resolveReturnFocusTarget({ current: null }, body as HTMLElement), body);
  assert.equal(resolveReturnFocusTarget(undefined, body as HTMLElement), body);
  assert.equal(resolveReturnFocusTarget(undefined, null), null);
  assert.equal(resolveReturnFocusTarget({ current: null }, null), null);
});

test("AuthRequiredDialog source accepts returnFocusRef and prefers it on dismiss and unmount", () => {
  const source = readFileSync(new URL("./auth-required-dialog.tsx", import.meta.url), "utf8");
  assert.match(source, /returnFocusRef\?: React\.RefObject<HTMLElement \| null>/);
  assert.match(source, /resolveReturnFocusTarget\(returnFocusRef, previouslyFocusedRef\.current\)/);
});

test("returnTo, focus trap, Escape and approved copy remain intact on the dialog", () => {
  const markup = renderToStaticMarkup(
    <AuthRequiredDialog loginHref="/auth/login?returnTo=%2Ftarot%2Fsetup" onDismiss={() => undefined} />
  );
  assert.equal((markup.match(/role="dialog"/g) ?? []).length, 1);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /href="\/auth\/login\?returnTo=%2Ftarot%2Fsetup"/);
  assert.match(markup, /登录 \/ 注册/);
  assert.match(markup, /暂不登录/);
  assert.match(markup, /min-h-11/);
});

test("non-auth FlowNotice codes still render inline notices with onAction", () => {
  let actionCalls = 0;
  const markup = renderToStaticMarkup(
    <FlowNotice code="NETWORK_ERROR" onAction={() => { actionCalls += 1; }} />
  );
  assert.match(markup, /data-error-code="NETWORK_ERROR"/);
  assert.doesNotMatch(markup, /data-auth-required-dialog/);
  assert.equal(actionCalls, 0, "rendering must not invoke onAction");
});
