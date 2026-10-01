import assert from "node:assert/strict";
import test from "node:test";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  deriveDesignOrderState,
  deriveDesignSaveState,
  designOrderStateLabel,
  type DesignDetailReads,
  type LocalOrderRecord
} from "./components/design-results";
import { DesignSummary, formatDesignUtcMinute } from "./components/design-summary";
import { mockPublicDesign } from "./fixtures/mock-public-design";

test("design summary exposes identity, revision, source and update time as text", () => {
  const markup = renderToStaticMarkup(<DesignSummary design={mockPublicDesign} />);

  assert.match(markup, /Rain After Blue/);
  assert.match(markup, /design-ai-standard/);
  assert.match(markup, /AI 生成/);
  assert.match(markup, /v1/);
  assert.match(markup, /2026-07-21 06:05 UTC/);
  assert.match(markup, /data-design-summary-facts="true"/);
});

test("design summary reports privacy visibility as text and never implies a public design", () => {
  const markup = renderToStaticMarkup(<DesignSummary design={mockPublicDesign} />);

  assert.match(markup, /Private（仅自己可见）/);
  assert.doesNotMatch(markup, /Public|Unlisted|Published/);
});

test("update time formats in UTC without a local timezone leak", () => {
  assert.equal(formatDesignUtcMinute("2026-07-21T06:05:00.000Z"), "2026-07-21 06:05 UTC");
  assert.equal(formatDesignUtcMinute("2026-12-31T23:59:59.999Z"), "2026-12-31 23:59 UTC");
  assert.equal(formatDesignUtcMinute("not-a-date"), "时间不可确认");
});

function readsWith(overrides: Partial<DesignDetailReads> = {}): DesignDetailReads {
  return {
    designs: [],
    budget: null,
    savedDesigns: [],
    orders: [],
    savedDesignsRead: "OK",
    ordersRead: "OK",
    ...overrides
  };
}

function savedEntry(design: PublicDesignV1, status: "DRAFT" | "GENERATED" | "SAVED" | "ARCHIVED", revision = design.revision) {
  return { status, design: { designId: design.designId, revision } };
}

test("save state reports the design library status for the current revision", () => {
  const state = deriveDesignSaveState(mockPublicDesign, readsWith({ savedDesigns: [savedEntry(mockPublicDesign, "SAVED")] }));

  assert.deepEqual(state, { kind: "CONFIRMED", status: "SAVED", serverRevision: 1 });
});

test("save state reports an unsaved recommendation instead of a false saved label", () => {
  assert.deepEqual(deriveDesignSaveState(mockPublicDesign, readsWith()), { kind: "NOT_SAVED" });
});

test("save state distinguishes a newer library revision from the page revision", () => {
  const state = deriveDesignSaveState(mockPublicDesign, readsWith({ savedDesigns: [savedEntry(mockPublicDesign, "SAVED", 4)] }));

  assert.deepEqual(state, { kind: "STALE_VIEW", status: "SAVED", serverRevision: 4 });
});

test("save state stays unknown when the library read failed or mock mode is active", () => {
  assert.deepEqual(deriveDesignSaveState(mockPublicDesign, readsWith({ savedDesignsRead: "FAILED" })), { kind: "UNKNOWN", reason: "FAILED" });
  assert.deepEqual(deriveDesignSaveState(mockPublicDesign, readsWith({ savedDesignsRead: "MOCK", savedDesigns: [] })), { kind: "UNKNOWN", reason: "MOCK" });
});

test("save state refuses to claim unsaved when the library list hit its 200 entry cap", () => {
  const capped = Array.from({ length: 200 }, (_, index) => ({
    status: "SAVED" as const,
    design: { designId: `other-${index}`, revision: 1 }
  }));

  assert.deepEqual(deriveDesignSaveState(mockPublicDesign, readsWith({ savedDesigns: capped })), { kind: "UNKNOWN", reason: "LIMIT" });
});

test("order state reports the current revision order with its server status", () => {
  const state = deriveDesignOrderState(mockPublicDesign, readsWith({
    orders: [{ orderId: "order-9", status: "IN_PRODUCTION", createdAt: "2026-07-22T01:00:00.000Z", design: { designId: "design-ai-standard", revision: 1 } }]
  }));

  assert.deepEqual(state, {
    kind: "ORDERED",
    orderId: "order-9",
    status: "IN_PRODUCTION",
    orderedRevision: 1,
    createdAt: "2026-07-22T01:00:00.000Z",
    source: "SERVER"
  });
});

test("order state keeps an older revision order separate from the current revision", () => {
  const state = deriveDesignOrderState(mockPublicDesign, readsWith({
    orders: [
      { orderId: "order-2", status: "COMPLETED", createdAt: "2026-07-20T01:00:00.000Z", design: { designId: "design-ai-standard", revision: 1 } },
      { orderId: "order-7", status: "CONFIRMED", createdAt: "2026-07-21T01:00:00.000Z", design: { designId: "design-ai-standard", revision: 1 } }
    ]
  }));

  assert.equal(state.kind, "ORDERED");
  assert.equal(state.orderedRevision, 1);
  assert.equal(state.orderId, "order-7");
  assert.equal(designOrderStateLabel(state, 3), "v1 已下单（已确认），当前 v3 未下单");
});

test("order state falls back to the durable local record keyed by the current revision", () => {
  const local: LocalOrderRecord = {
    orderId: "order-local-1",
    orderStatus: "PENDING",
    createdAt: "2026-07-21T07:00:00.000Z",
    design: { designId: "design-ai-standard", revision: 1 }
  };
  const state = deriveDesignOrderState(mockPublicDesign, readsWith(), () => local);

  assert.equal(state.kind, "ORDERED");
  assert.equal(state.source, "LOCAL");
  assert.equal(designOrderStateLabel(state, 1), "本机已记录该版本下单（待确认），等待设计库列表确认");
});

test("order state never claims a local order for a different revision", () => {
  const seen: Array<[string, number]> = [];
  const state = deriveDesignOrderState(mockPublicDesign, readsWith(), (designId, revision) => {
    seen.push([designId, revision]);
    return null;
  });

  assert.deepEqual(state, { kind: "NOT_ORDERED" });
  assert.deepEqual(seen, [["design-ai-standard", 1]]);
});

test("order state stays unknown on read failure, mock mode, and the 100 entry cap", () => {
  assert.deepEqual(deriveDesignOrderState(mockPublicDesign, readsWith({ ordersRead: "FAILED" }), () => null), { kind: "UNKNOWN", reason: "FAILED" });
  assert.deepEqual(deriveDesignOrderState(mockPublicDesign, readsWith({ ordersRead: "MOCK" }), () => null), { kind: "UNKNOWN", reason: "MOCK" });
  const capped = Array.from({ length: 100 }, (_, index) => ({
    orderId: `order-${index}`,
    status: "COMPLETED" as const,
    createdAt: "2026-07-20T01:00:00.000Z",
    design: { designId: `other-${index}`, revision: 1 }
  }));
  assert.deepEqual(deriveDesignOrderState(mockPublicDesign, readsWith({ orders: capped }), () => null), { kind: "UNKNOWN", reason: "LIMIT" });
});
