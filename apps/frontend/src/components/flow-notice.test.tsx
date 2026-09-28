/**
 * FlowNotice action contract (TASK-FE-P0-002).
 *
 * A notice may only offer the action its caller can actually perform: a
 * caller-supplied button (label + handler) or link (label + href). With no
 * `action` prop the notice renders no control and no destination, so a
 * dismiss-only advisory can never wear retry copy such as "重新生成方案".
 *
 * FlowNotice is hook-free, so it is called directly to inspect the exact
 * element tree handed to React. Markup assertions use renderToStaticMarkup.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FRONTEND_ERROR_CODES } from "../lib/api/frontend-api-error";
import { FlowNotice, type NoticeAction } from "./flow-notice";

const NON_AUTH_CODES = FRONTEND_ERROR_CODES.filter((code) => code !== "UNAUTHORIZED");

function findElement(
  node: React.ReactNode,
  type: string
): React.ReactElement<Record<string, unknown>> | null {
  if (!React.isValidElement(node)) return null;
  if (node.type === type) return node as React.ReactElement<Record<string, unknown>>;
  const children = (node.props as { children?: React.ReactNode }).children;
  for (const child of React.Children.toArray(children)) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return null;
}

test("a caller-supplied button action renders its own label and handler", () => {
  let calls = 0;
  const action: NoticeAction = {
    kind: "button",
    label: "重新加载设计",
    onAction: () => {
      calls += 1;
    }
  };

  const markup = renderToStaticMarkup(<FlowNotice code="NETWORK_ERROR" action={action} />);
  assert.match(markup, /重新加载设计/);
  assert.doesNotMatch(markup, /href=/);
  assert.equal(calls, 0, "rendering must never invoke the caller handler");

  const tree = FlowNotice({ code: "NETWORK_ERROR", action }) as React.ReactElement;
  const button = findElement(tree, "button");
  assert.ok(button, "a button action must render a real <button>");
  assert.equal(button.props.children, "重新加载设计");
  assert.equal(
    button.props.onClick,
    action.onAction,
    "the button must invoke the caller handler itself, not a wrapper"
  );
  (button.props.onClick as () => void)();
  assert.equal(calls, 1);
});

test("a caller-supplied link action renders its own label and href", () => {
  const action: NoticeAction = { kind: "link", label: "返回设计入口", href: "/design-entry" };
  const markup = renderToStaticMarkup(<FlowNotice code="NOT_FOUND" action={action} />);

  assert.match(markup, /href="\/design-entry"/);
  assert.match(markup, /返回设计入口/);
  assert.doesNotMatch(markup, /<button/);
});

test("without an action prop no notice renders a control or an invented destination", () => {
  const advisory = renderToStaticMarkup(<FlowNotice code="INVENTORY_CHANGED" />);
  assert.doesNotMatch(advisory, /<button/);
  assert.doesNotMatch(advisory, /href=/);
  assert.doesNotMatch(advisory, /重新生成方案/);

  for (const code of NON_AUTH_CODES) {
    const perCode = renderToStaticMarkup(<FlowNotice code={code} />);
    assert.doesNotMatch(perCode, /<button/, `${code} must not render a control without a caller action`);
    assert.doesNotMatch(perCode, /href=/, `${code} must not invent a destination without a caller action`);
  }
});

test("UNAUTHORIZED keeps the auth dialog and never renders a caller action", () => {
  const action: NoticeAction = { kind: "button", label: "不应出现的操作", onAction: () => undefined };
  const markup = renderToStaticMarkup(<FlowNotice code="UNAUTHORIZED" action={action} />);

  assert.match(markup, /data-auth-required-dialog="true"/);
  assert.doesNotMatch(markup, /不应出现的操作/);
});

test("DIY network failure retries the failed load while a passive advisory only dismisses", async () => {
  const { diyNoticeAction } = await import("../features/design/components/diy-editor");

  let loadDesignCalls = 0;
  let synchronizeCalls = 0;
  let dismissCalls = 0;
  const handlers = {
    loadDesign: () => {
      loadDesignCalls += 1;
    },
    synchronize: () => {
      synchronizeCalls += 1;
    },
    dismiss: () => {
      dismissCalls += 1;
    }
  };

  const network = diyNoticeAction("NETWORK_ERROR", handlers);
  assert.equal(network.kind, "button");
  assert.ok(network.label.length > 0);
  assert.notEqual(network.label, "重新生成方案");
  network.onAction();
  assert.equal(loadDesignCalls, 1, "a DIY network failure must re-run the failed load");
  assert.equal(synchronizeCalls, 0);
  assert.equal(dismissCalls, 0);

  const advisory = diyNoticeAction("INVENTORY_CHANGED", handlers);
  assert.equal(advisory.kind, "button");
  assert.equal(advisory.label, "知道了");
  assert.notEqual(advisory.label, "重新生成方案");
  advisory.onAction();
  assert.equal(dismissCalls, 1, "a passive advisory only dismisses");
  assert.equal(loadDesignCalls, 1);
  assert.equal(synchronizeCalls, 0);
});

test("FlowNotice source derives no action or destination from the error code", () => {
  const source = readFileSync(new URL("./flow-notice.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /actionHref/);
  assert.doesNotMatch(source, /content\.action/);
  assert.doesNotMatch(source, /onAction\?:/);
});