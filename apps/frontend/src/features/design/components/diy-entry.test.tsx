import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";

import type { ListMyDesignsResponse, PublicDesignV1 } from "@mystcrag/design-contract";

import { FrontendApiError } from "../../../lib/api/frontend-api-error";
import { mockDesignOptions } from "../fixtures/mock-design-options";
import { DiyHistoryChoice, DiyEntryScreen, DIY_ENTRY_PATH, isContinuableDesignStatus, loadDiyEntryView, toDiyHistoryItems } from "./diy-entry";

function designAt(index: number, designId: string): PublicDesignV1 {
  const candidate = structuredClone(mockDesignOptions[index % mockDesignOptions.length]!);
  candidate.designId = designId;
  return candidate;
}

function historyResponse(entries: Array<{ designId: string; status: string; updatedAt: string }>): ListMyDesignsResponse {
  return {
    designs: entries.map((entry, index) => ({
      design: designAt(index, entry.designId),
      status: entry.status as ListMyDesignsResponse["designs"][number]["status"],
      updatedAt: entry.updatedAt
    }))
  };
}

function listApi(response: ListMyDesignsResponse, onFailure?: unknown) {
  const calls: unknown[][] = [];
  return {
    calls,
    api: {
      listDesigns: async (...args: unknown[]) => {
        calls.push(args);
        if (onFailure) throw onFailure;
        return response;
      }
    }
  };
}

function hostButton(element: React.ReactNode, marker: string): { props: Record<string, unknown> } | null {
  if (typeof element !== "object" || element === null) return null;
  const node = element as { props?: { children?: React.ReactNode } & Record<string, unknown> };
  if (node.props && marker in node.props) return node as { props: Record<string, unknown> };
  const children = node.props?.children;
  const list = Array.isArray(children) ? children : children === undefined ? [] : [children];
  for (const child of list) {
    const found = hostButton(child, marker);
    if (found) return found;
  }
  return null;
}

const savedEntry = { designId: "design-saved-1", status: "SAVED", updatedAt: "2026-10-01T10:00:00.000Z" };
const draftEntry = { designId: "design-draft-2", status: "DRAFT", updatedAt: "2026-10-03T10:00:00.000Z" };
const archivedEntry = { designId: "design-archived-3", status: "ARCHIVED", updatedAt: "2026-10-05T10:00:00.000Z" };

function screenMarkup(view: Parameters<typeof DiyEntryScreen>[0]["view"]): string {
  return renderToStaticMarkup(
    <DiyEntryScreen
      view={view}
      navigate={() => undefined}
      onNewDesign={() => undefined}
      onRetry={() => undefined}
      onDismissAuthRequired={() => undefined}
    />
  );
}

test("only DRAFT, GENERATED and SAVED designs can be continued", () => {
  assert.equal(isContinuableDesignStatus("DRAFT"), true);
  assert.equal(isContinuableDesignStatus("GENERATED"), true);
  assert.equal(isContinuableDesignStatus("SAVED"), true);
  assert.equal(isContinuableDesignStatus("ARCHIVED"), false);
});

test("a customer with no history goes straight to the empty tray", async () => {
  const { api, calls } = listApi({ designs: [] });
  const view = await loadDiyEntryView(api);

  assert.deepEqual(view, { kind: "empty-tray" });
  assert.equal(calls.length, 1, "the history list is read once");
  assert.deepEqual(calls[0], [], "the entry never names a design id, so the server resolves the owner");

  const markup = screenMarkup(view);
  assert.match(markup, /data-diy-entry="empty-tray"/);
  assert.match(markup, /data-diy-empty-tray="true"/);
  assert.doesNotMatch(markup, /继续设计/);
});

test("one editable design offers 继续设计 for exactly that server design", async () => {
  const { api } = listApi(historyResponse([savedEntry]));
  const view = await loadDiyEntryView(api);

  assert.equal(view.kind, "history");
  const markup = screenMarkup(view);
  const continueLinks = markup.match(/继续设计/g) ?? [];
  assert.equal(continueLinks.length, 1);
  assert.match(markup, new RegExp(`href="/diy/${savedEntry.designId}"`));
  assert.match(markup, /data-diy-new-design/);
  assert.doesNotMatch(markup, /design-diy-private/);
});

test("several designs are listed newest first with one entry per own design", async () => {
  const { api } = listApi(historyResponse([savedEntry, draftEntry]));
  const items = toDiyHistoryItems(await api.listDesigns());

  assert.deepEqual(items.map((item) => item.designId), [draftEntry.designId, savedEntry.designId]);
  assert.deepEqual(items.map((item) => item.continuable), [true, true]);

  const markup = renderToStaticMarkup(
    <DiyHistoryChoice items={items} onNewDesign={() => undefined} />
  );
  assert.equal((markup.match(/继续设计/g) ?? []).length, 2);
});

test("an archived design is never presented as continuable", async () => {
  const { api } = listApi(historyResponse([archivedEntry, savedEntry]));
  const items = toDiyHistoryItems(await api.listDesigns());

  assert.deepEqual(items.map((item) => item.designId), [archivedEntry.designId, savedEntry.designId]);
  assert.deepEqual(items.map((item) => item.continuable), [false, true]);

  const markup = renderToStaticMarkup(<DiyHistoryChoice items={items} onNewDesign={() => undefined} />);
  assert.equal((markup.match(/继续设计/g) ?? []).length, 1, "only the editable design may be continued");
  assert.ok(!markup.includes(`href="/diy/${archivedEntry.designId}"`), "an archived record must not pretend to be editable");
  assert.match(markup, /已归档/);
});

test("a history list that only holds archived records still offers a new empty design", async () => {
  const { api } = listApi(historyResponse([archivedEntry]));
  const view = await loadDiyEntryView(api);

  assert.equal(view.kind, "history");
  const markup = screenMarkup(view);
  assert.equal((markup.match(/继续设计/g) ?? []).length, 0);
  assert.match(markup, /data-diy-new-design/);
});

test("新建设计 is a real control that switches to the empty tray", () => {
  let newDesignCalls = 0;
  const element = DiyHistoryChoice({
    items: toDiyHistoryItems(historyResponse([savedEntry])),
    onNewDesign: () => {
      newDesignCalls += 1;
    }
  });
  const button = hostButton(element, "data-diy-new-design");
  assert.ok(button, "the new-design control must be a host element");
  (button.props.onClick as () => void)();
  assert.equal(newDesignCalls, 1);
});

test("an unauthenticated visit keeps the login gate and never invents history", async () => {
  const { api } = listApi(
    { designs: [] },
    new FrontendApiError("UNAUTHORIZED", "Authentication is required.")
  );
  const view = await loadDiyEntryView(api);

  assert.deepEqual(view, { kind: "error", code: "UNAUTHORIZED" });
  const markup = screenMarkup(view);
  assert.match(markup, /data-auth-required-dialog="true"/);
  assert.doesNotMatch(markup, /继续设计/);
  assert.doesNotMatch(markup, /data-first-bead-product/, "a signed-out visit must not reach the creation control");
});

test("a rejected design list surfaces as an error instead of a silent empty tray", async () => {
  for (const code of ["FORBIDDEN", "NOT_FOUND"] as const) {
    const { api } = listApi({ designs: [] }, new FrontendApiError(code, "nope"));
    const view = await loadDiyEntryView(api);
    assert.deepEqual(view, { kind: "error", code });
    const markup = screenMarkup(view);
    assert.match(markup, new RegExp(`data-error-code="${code}"`));
    assert.doesNotMatch(markup, /data-diy-empty-tray/, "an error must not masquerade as an empty tray");
  }
});

test("a network failure is retryable and stays on the entry", async () => {
  const { api } = listApi({ designs: [] }, new FrontendApiError("NETWORK_ERROR", "offline"));
  const view = await loadDiyEntryView(api);

  assert.deepEqual(view, { kind: "error", code: "NETWORK_ERROR" });
  const markup = screenMarkup(view);
  assert.match(markup, /data-diy-entry-retry="true"/);
});

test("only the signed-in caller's own designs are rendered", async () => {
  const { api } = listApi(historyResponse([savedEntry, draftEntry]));
  const items = toDiyHistoryItems(await api.listDesigns());
  const markup = renderToStaticMarkup(<DiyHistoryChoice items={items} onNewDesign={() => undefined} />);

  const hrefs = [...markup.matchAll(/href="(\/diy\/[^"]*)"/g)].map((match) => match[1]!);
  assert.deepEqual(hrefs, [
    `/diy/${draftEntry.designId}`,
    `/diy/${savedEntry.designId}`
  ]);
  assert.ok(!hrefs.some((href) => href.includes("design-other-user")), "another user's design id never appears");
});

test("the /diy route renders the entry instead of a fixed demo design", () => {
  const routeSource = readFileSync(new URL("../../../../app/diy/page.tsx", import.meta.url), "utf8");
  const entrySource = readFileSync(new URL("./diy-entry.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(routeSource, /design-diy-private/, "the fixed demo design id is retired");
  assert.doesNotMatch(routeSource, /redirect\(/, "/diy must not redirect to any design id");
  assert.match(routeSource, /DiyEntry/);
  assert.doesNotMatch(entrySource, /design-diy-private/);
  assert.equal(DIY_ENTRY_PATH, "/diy");
});

test("a stranger's deep link recovers back to the owner-scoped entry", () => {
  const editorSource = readFileSync(new URL("./diy-editor.tsx", import.meta.url), "utf8");

  assert.match(editorSource, /data-diy-deep-link-recovery="true"/);
  assert.match(editorSource, /href: "\/diy"/);
  assert.doesNotMatch(editorSource, /design-diy-private/);
});
