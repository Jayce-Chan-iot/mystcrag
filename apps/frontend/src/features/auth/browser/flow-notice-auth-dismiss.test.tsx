/**
 * FlowNotice authentication-dismiss contract.
 *
 * Committed tests prove the REAL FlowNotice props wiring without an undeclared
 * DOM package: FlowNotice is a hook-free function component, so calling it
 * yields the exact element handed to AuthRequiredDialog. Click/focus/remount
 * behavior is covered by the ignored Playwright harness
 * (`output/playwright/task-auth-010/`), which mounts FlowNotice with live spies.
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
  resolveReturnFocusTarget
} from "./auth-required-dialog";

type AuthRequiredElement = React.ReactElement<{
  onDismiss?: () => void;
}>;

function renderFlowNoticeTree(
  props: React.ComponentProps<typeof FlowNotice>
): AuthRequiredElement {
  const tree = FlowNotice(props) as AuthRequiredElement;
  assert.ok(tree, "FlowNotice must return an element");
  return tree;
}

test("UNAUTHORIZED renders the auth-required dialog and never the business action", () => {
  let actionCalls = 0;
  const markup = renderToStaticMarkup(
    <FlowNotice code="UNAUTHORIZED" action={{ kind: "button", label: "不应出现的操作", onAction: () => { actionCalls += 1; } }} />
  );

  assert.match(markup, /data-auth-required-dialog="true"/);
  assert.match(markup, new RegExp(AUTH_REQUIRED_COPY.title));
  assert.match(markup, new RegExp(AUTH_REQUIRED_COPY.secondaryAction.replace("/", "\\/")));
  assert.match(markup, /正在检查登录方式/);
  assert.match(markup, /aria-disabled="true"/);

  assert.doesNotMatch(markup, /data-error-code="UNAUTHORIZED"/);
  assert.doesNotMatch(markup, /不应出现的操作/);
  assert.doesNotMatch(markup, /onClick/);
  assert.equal(actionCalls, 0);
});

test("FlowNotice UNAUTHORIZED passes onDismissAuthRequired — never the business action — as the dialog onDismiss", () => {
  const businessAction = { kind: "button" as const, label: "不应出现的操作", onAction: () => { /* business retry spy */ } };
  const onDismissAuthRequired = () => { /* auth-only cleanup spy */ };

  const tree = renderFlowNoticeTree({
    code: "UNAUTHORIZED",
    action: businessAction,
    onDismissAuthRequired
  });

  assert.equal(tree.type, AuthRequiredDialog);
  assert.equal(
    tree.props.onDismiss,
    onDismissAuthRequired,
    "dialog onDismiss must be the auth cleanup spy, not a new wrapper"
  );
  assert.notEqual(tree.props.onDismiss, businessAction.onAction, "dialog onDismiss must never be the business retry spy");

  // If dismiss is invoked the way the dialog does, only the auth spy fires.
  let businessCalls = 0;
  let dismissAuthCalls = 0;
  const wiredAction = () => { businessCalls += 1; };
  const wiredDismiss = () => { dismissAuthCalls += 1; };
  const wired = renderFlowNoticeTree({
    code: "UNAUTHORIZED",
    action: { kind: "button", label: "不应出现的操作", onAction: wiredAction },
    onDismissAuthRequired: wiredDismiss
  });
  wired.props.onDismiss?.();
  assert.equal(dismissAuthCalls, 1, "onDismissAuthRequired exactly once");
  assert.equal(businessCalls, 0, "the business action must stay 0 when FlowNotice dismiss wiring is correct");
});

test("FlowNotice source still forbids wiring onAction as AuthRequiredDialog onDismiss", () => {
  const source = readFileSync(new URL("../../../components/flow-notice.tsx", import.meta.url), "utf8");
  assert.match(source, /onDismissAuthRequired/);
  assert.match(source, /<AuthRequiredDialog onDismiss=\{onDismissAuthRequired\} \/>/);
  assert.doesNotMatch(source, /AuthRequiredDialog onDismiss=\{onAction\}/);
});

test("parent clears only the auth code on dismiss, then a later UNAUTHORIZED remounts a fresh open dialog", () => {
  // Mirrors the production parent state machine without a DOM: UNAUTHORIZED mounts
  // FlowNotice/dialog; onDismissAuthRequired clears the code; a later 401 writes it again.
  type ParentCode = "UNAUTHORIZED" | null;
  let parentCode: ParentCode = "UNAUTHORIZED";
  let businessCalls = 0;
  let dismissAuthCalls = 0;

  const first = renderFlowNoticeTree({
    code: parentCode,
    action: { kind: "button", label: "不应出现的操作", onAction: () => { businessCalls += 1; } },
    onDismissAuthRequired: () => {
      dismissAuthCalls += 1;
      parentCode = null;
    }
  });
  assert.equal(first.type, AuthRequiredDialog);
  first.props.onDismiss?.();
  assert.equal(dismissAuthCalls, 1);
  assert.equal(businessCalls, 0);
  assert.equal(parentCode, null);

  // Parent no longer renders the dialog.
  const afterDismiss = renderToStaticMarkup(
    parentCode === "UNAUTHORIZED"
      ? <FlowNotice code="UNAUTHORIZED" />
      : <span data-cleared="true" />
  );
  assert.doesNotMatch(afterDismiss, /data-auth-required-dialog/);
  assert.match(afterDismiss, /data-cleared="true"/);

  // Later 401 writes UNAUTHORIZED again → fresh open dialog.
  parentCode = "UNAUTHORIZED";
  const second = renderFlowNoticeTree({
    code: parentCode,
    action: { kind: "button", label: "不应出现的操作", onAction: () => { businessCalls += 1; } },
    onDismissAuthRequired: () => { dismissAuthCalls += 1; parentCode = null; }
  });
  assert.equal(second.type, AuthRequiredDialog);
  const secondMarkup = renderToStaticMarkup(
    <FlowNotice code="UNAUTHORIZED" onDismissAuthRequired={() => { parentCode = null; }} />
  );
  assert.match(secondMarkup, /data-auth-required-dialog="true"/);
  assert.match(secondMarkup, /登录后继续/);
});

test("explicit returnFocusRef still wins over the document.activeElement fallback", () => {
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
    <AuthRequiredDialog
      loginHref="/auth/login?returnTo=%2Ftarot%2Fsetup"
      initialPromptMode="oidc"
      onDismiss={() => undefined}
    />
  );
  assert.equal((markup.match(/role="dialog"/g) ?? []).length, 1);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /href="\/auth\/login\?returnTo=%2Ftarot%2Fsetup"/);
  assert.match(markup, /登录 \/ 注册/);
  assert.match(markup, /暂不登录/);
  assert.match(markup, /min-h-11/);
});

test("non-auth FlowNotice codes still render inline notices with a caller action", () => {
  let actionCalls = 0;
  const markup = renderToStaticMarkup(
    <FlowNotice code="NETWORK_ERROR" action={{ kind: "button", label: "重新加载", onAction: () => { actionCalls += 1; } }} />
  );
  assert.match(markup, /data-error-code="NETWORK_ERROR"/);
  assert.doesNotMatch(markup, /data-auth-required-dialog/);
  assert.match(markup, /重新加载/);
  assert.equal(actionCalls, 0, "rendering must not invoke the caller action");
});

test("neither FlowNotice nor the dialog navigates back or reloads on dismiss", () => {
  const flowSource = readFileSync(new URL("../../../components/flow-notice.tsx", import.meta.url), "utf8");
  const dialogSource = readFileSync(new URL("./auth-required-dialog.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(flowSource, /router\.back|history\.back|location\.reload/);
  assert.doesNotMatch(dialogSource, /router\.back|history\.back|location\.reload/);
});
