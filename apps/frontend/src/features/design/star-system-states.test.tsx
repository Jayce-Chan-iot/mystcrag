/**
 * TASK-QA-STAR-001 system-state and legacy-drift contract.
 *
 * Task 6 of the Star Platform plan owns the canonical loading / error / empty /
 * offline / 404 presentation. Before this task those states were ad-hoc: the app
 * router had no `loading.tsx`/`error.tsx`, `not-found.tsx` hand-rolled its own
 * markup, `FlowNotice` painted its own panel, and `PageScaffold` still shipped
 * the "工程骨架已就绪" placeholder copy.
 *
 * The contracts below fail on that pre-repair state and pass once every state
 * delegates to the one shared `@mystcrag/ui` status-panel primitive with a real
 * next action, correct live-region roles, and no placeholder skeleton copy.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SystemState, systemStateCopy } from "../../../components/page-scaffold";
import { FlowNotice } from "../../components/flow-notice";

// `apps/frontend/tsconfig.json` sets `"jsx": "preserve"`, so tsx compiles every module
// under the classic runtime and `@mystcrag/ui` sources, which import only named hooks,
// need a React global. Same shim as `packages/ui/tests/star-primitives.test.tsx`.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

function source(rel: string): string {
  const url = new URL(rel, import.meta.url);
  if (!existsSync(url)) {
    assert.fail(`missing file: ${rel}`);
  }
  return readFileSync(url, "utf8");
}

type ActionInput = React.ComponentProps<typeof SystemState>["action"];

const NEXT_ACTION: Record<"button" | "link", ActionInput> = {
  button: { kind: "button", label: "重新加载", onAction: () => {} },
  link: { kind: "link", label: "返回首页", href: "/" }
};

const STATE_KINDS = ["loading", "error", "offline", "empty", "not-found"] as const;
type StateKind = (typeof STATE_KINDS)[number];

const ACTIONABLE_KINDS: readonly StateKind[] = ["error", "offline", "empty", "not-found"];

function renderState(kind: StateKind, action?: ActionInput): string {
  return renderToStaticMarkup(<SystemState kind={kind} action={action} />);
}

function countControls(markup: string): number {
  return (markup.match(/data-star-instrument-button=/g) ?? []).length;
}

test("every system state renders the shared star status-panel primitive", () => {
  for (const kind of STATE_KINDS) {
    const markup = renderState(kind, NEXT_ACTION.link);
    assert.match(
      markup,
      /data-star-status-panel="(?:info|success|warning|danger)"/,
      `${kind} must render the shared @mystcrag/ui status panel, not ad-hoc markup`
    );
    assert.match(markup, new RegExp(`data-star-system-state="${kind}"`), `${kind} must tag its state`);
  }
});

test("each actionable system state exposes exactly one real next action", () => {
  for (const kind of ACTIONABLE_KINDS) {
    const withLink = renderState(kind, NEXT_ACTION.link);
    assert.equal(countControls(withLink), 1, `${kind} must render exactly one action control`);
    assert.match(withLink, /href="\/"/, `${kind} must render the caller's real destination`);

    const withButton = renderState(kind, NEXT_ACTION.button);
    assert.equal(countControls(withButton), 1, `${kind} must render exactly one action control`);
    assert.match(withButton, /重新加载/, `${kind} must render the caller's real retry label`);
  }
});

test("system states keep focus and role semantics for assistive technology", () => {
  // Recoverable failures announce assertively; informational states stay polite.
  assert.match(renderState("error", NEXT_ACTION.button), /role="alert"/);
  assert.match(renderState("offline", NEXT_ACTION.button), /role="alert"/);
  for (const kind of ["empty", "not-found"] as const) {
    assert.match(renderState(kind, NEXT_ACTION.link), /role="status"/, `${kind} must stay a polite status`);
  }

  const loading = renderState("loading");
  assert.match(loading, /role="status"/, "loading must be a polite live region");
  assert.match(loading, /aria-live="polite"/, "loading must announce politely");
  assert.match(loading, /aria-busy="true"/, "loading must mark itself busy");
  assert.equal(countControls(loading), 0, "loading is transient and must not offer a dead action");

  // The action control must be reachable and focus-visible via the shared floor.
  for (const kind of ACTIONABLE_KINDS) {
    const markup = renderState(kind, NEXT_ACTION.link);
    assert.match(markup, /<a\b/, `${kind} link action must be a real anchor`);
  }
});

test("no system state ships placeholder skeleton or scaffold copy", () => {
  const banned = [/工程骨架已就绪/, /骨架/, /skeleton/i, /animate-pulse/, /占位/];
  for (const kind of STATE_KINDS) {
    const markup = renderState(kind, NEXT_ACTION.link);
    for (const pattern of banned) {
      assert.doesNotMatch(markup, pattern, `${kind} must not ship placeholder copy (${String(pattern)})`);
    }
  }
  const scaffold = source("../../../components/page-scaffold.tsx");
  assert.doesNotMatch(scaffold, /工程骨架已就绪/, "PageScaffold must drop the placeholder copy");
  assert.doesNotMatch(scaffold, /animate-pulse|skeleton/i, "PageScaffold must not fake a skeleton");
});

test("systemStateCopy reuses the canonical error presentation instead of forking copy", () => {
  const apiError = source("../../lib/api/frontend-api-error.ts");
  for (const kind of ACTIONABLE_KINDS) {
    const copy = systemStateCopy(kind);
    assert.ok(copy.title.length > 0 && copy.message.length > 0, `${kind} must have real copy`);
    assert.ok(
      apiError.includes(copy.title) || copy.title.includes("玄圭"),
      `${kind} copy must come from the canonical presentation table`
    );
  }
  const loading = systemStateCopy("loading");
  assert.equal(loading.busy, true, "only loading is a busy state");
  for (const kind of ACTIONABLE_KINDS) {
    assert.equal(systemStateCopy(kind).busy, false, `${kind} must not be busy`);
  }
});

test("the app router mounts the shared primitive for loading, error and 404", () => {
  const loading = source("../../../app/loading.tsx");
  const error = source("../../../app/error.tsx");
  const notFound = source("../../../app/not-found.tsx");

  for (const [name, text, kind] of [
    ["loading.tsx", loading, "loading"],
    ["error.tsx", error, "error"],
    ["not-found.tsx", notFound, "not-found"]
  ] as const) {
    assert.match(text, /SystemState\b/, `${name} must delegate to the shared system-state primitive`);
    assert.match(text, new RegExp(`kind="${kind}"`), `${name} must declare its canonical kind`);
    assert.match(text, /data-star-surface="system-state"/, `${name} must opt into the star state surface`);
  }

  // A recoverable error boundary must retry, not navigate away or dismiss silently.
  assert.match(error, /reset/, "error.tsx must wire the recoverable reset action");
  assert.match(error, /"use client"/, "error.tsx must be a client error boundary");
  assert.doesNotMatch(error, /router\.back|history\.back|location\.reload/, "error must not fake recovery");
  assert.doesNotMatch(notFound, /router\.back|history\.back/, "404 must not navigate backwards");
});

test("flow notices render the shared star system-state contract for every non-auth code", () => {
  const markup = renderToStaticMarkup(
    <FlowNotice
      code="NETWORK_ERROR"
      action={{ kind: "button", label: "重新加载", onAction: () => {} }}
    />
  );
  assert.match(markup, /data-star-surface="flow-notice"/, "a non-auth notice must opt into the star notice surface");
  assert.match(
    markup,
    /data-star-system-state="NETWORK_ERROR"/,
    "the inline notice must tag the same system-state hook the page states use"
  );
  assert.match(markup, /data-error-code="NETWORK_ERROR"/, "the error code hook must survive the refactor");
  assert.match(markup, /role="alert"/, "a network failure is an assertive alert");
  assert.match(markup, /重新加载/, "the caller action must still render");

  const empty = renderToStaticMarkup(<FlowNotice code="EMPTY_STATE" />);
  assert.match(empty, /data-star-system-state="EMPTY_STATE"/, "the empty state must reuse the shared state contract");
  assert.match(empty, /role="status"/, "the empty state stays a polite status");
  assert.equal(countControls(empty), 0, "a notice with no caller action must not invent a control");

  const source_ = source("../../components/flow-notice.tsx");
  assert.doesNotMatch(source_, /工程骨架已就绪/, "FlowNotice must not reintroduce placeholder copy");
  assert.doesNotMatch(source_, /#[0-9a-fA-F]{6}/, "the notice must read from star tokens, not literal legacy colors");
});

test("every customer route root opts into the star surface contract", () => {
  const surfaces = [
    ["../../../app/page.tsx", "home"],
    ["../questionnaire/components/questionnaire-wizard.tsx", "questionnaire"],
    ["./components/design-results.tsx", "design-results"],
    ["../oracle/components/oracle-setup.tsx", "oracle-setup"],
    ["../oracle/components/oracle-result.tsx", "oracle-result"],
    ["../tarot/components/tarot-setup.tsx", "tarot-setup"],
    ["../tarot/components/tarot-draw.tsx", "tarot-draw"],
    ["../tarot/components/tarot-result.tsx", "tarot-result"],
    ["./components/diy-editor.tsx", "diy-workbench"],
    ["../library/components/crystal-library-page.tsx", "library"],
    ["../gallery/components/gallery-page.tsx", "gallery"],
    ["../profile/components/profile-page.tsx", "profile"],
    ["../../../app/design/[id]/page.tsx", "content"]
  ] as const;

  for (const [rel, surface] of surfaces) {
    assert.match(
      source(rel),
      new RegExp(`data-star-surface="${surface}"`),
      `${rel} must declare data-star-surface="${surface}"`
    );
  }
});

test("customer routes are star-surface driven and the legacy atelier namespace cannot override them", () => {
  const globals = source("../../../app/globals.css");
  const atelier = source("../../../app/atelier.css");

  // The legacy world must never enter the star namespace.
  assert.doesNotMatch(atelier, /\[data-star-surface/, "atelier.css must not declare star selectors");
  assert.match(atelier, /LEGACY/, "atelier.css must stay an explicitly labelled legacy record");

  // Star entries load after atelier so an equal-specificity star rule always wins.
  const atelierIndex = globals.indexOf('@import "./atelier.css"');
  assert.ok(atelierIndex >= 0, "globals.css must keep the legacy baseline import");
  for (const entry of [
    "star-tokens.css",
    "star-shell.css",
    "star-components.css",
    "star-acquisition.css",
    "star-workbench.css",
    "star-content.css"
  ]) {
    assert.ok(
      globals.indexOf(`@import "./styles/${entry}"`) > atelierIndex,
      `${entry} must load after the legacy baseline`
    );
  }

  // Every customer surface's route rules are owned by a star stylesheet.
  const ownership = {
    "star-acquisition.css": [
      "home",
      "questionnaire",
      "design-results",
      "tarot-setup",
      "tarot-draw",
      "tarot-result",
      "oracle-setup",
      "oracle-result"
    ],
    "star-workbench.css": ["diy-workbench"],
    "star-content.css": ["library", "gallery", "profile", "content"]
  } as const;
  for (const [file, surfaces] of Object.entries(ownership)) {
    const css = source(`../../../app/styles/${file}`);
    for (const surface of surfaces) {
      assert.match(
        css,
        new RegExp(`\\[data-star-surface="${surface}"\\]`),
        `${file} must own the ${surface} route rules`
      );
    }
  }

  // No proven-dead legacy page block may survive: the content-shell child rule
  // targeted a `div` while the scaffold renders a `section`, so it never matched.
  assert.doesNotMatch(
    atelier,
    /\[data-atelier-surface="content-shell"\]\s*>\s*div/,
    "the dead content-shell > div legacy rule must be removed"
  );
});

test("the system-state surface styles stay scoped, floored and motion-safe", () => {
  const css = source("../../../app/styles/star-components.css");

  assert.match(css, /\[data-star-surface="system-state"\]/, "the state surface must be star-scoped");
  assert.match(
    css,
    /\[data-star-surface="system-state"\][\s\S]*?min-height:\s*2\.75rem|\[data-star-system-action\][^{]*\{[^}]*min-height:\s*2\.75rem/,
    "the state action must keep the 44px floor"
  );
  assert.match(css, /\[data-star-surface="flow-notice"\]/, "the inline notice surface must be star-scoped too");
  assert.match(
    css,
    /\[data-star-surface="flow-notice"\]\s*(?:button|a)[\s\S]*?min-height:\s*2\.75rem/,
    "the inline notice action must keep the 44px floor"
  );
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, "the state surfaces must read from star tokens, not literal colors");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, "the state surface must honour reduced motion");
  assert.doesNotMatch(css, /(?:^|[;{]\s*)zoom\s*:/m, "the state surface must not use zoom");
  assert.doesNotMatch(
    css,
    /(?:html|body)[^{]*\{[^}]*transform:\s*scale\(/s,
    "the state surface must not scale html/body"
  );
});