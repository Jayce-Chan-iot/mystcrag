import assert from "node:assert/strict";
import test from "node:test";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  deriveDesignOrderState,
  deriveDesignSaveState,
  designOrderStateLabel,
  loadDesignDetailReads,
  type DesignDetailReadApi,
  type DesignDetailReads,
  type LocalOrderRecord
} from "./components/design-results";
import { DesignSummary, formatDesignUtcMinute } from "./components/design-summary";
import { mockDesignOptions } from "./fixtures/mock-design-options";
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

function fakeApi(overrides: Partial<DesignDetailReadApi> = {}) {
  const calls = { get: 0, listDesigns: 0, listOrders: 0 };
  const api: DesignDetailReadApi = {
    get: async (designId) => {
      calls.get += 1;
      const match = mockDesignOptions.find((design) => design.designId === designId);
      if (!match) throw new Error(`missing ${designId}`);
      return match;
    },
    listDesigns: async () => {
      calls.listDesigns += 1;
      return { designs: [{ design: mockPublicDesign, status: "SAVED", updatedAt: "2026-07-21T06:05:00.000Z" }] };
    },
    listOrders: async () => {
      calls.listOrders += 1;
      return { orders: [] };
    },
    ...overrides
  };
  return { api, calls };
}

test("detail reads load every option and report the library and order lists", async () => {
  const { api, calls } = fakeApi();
  const reads = await loadDesignDetailReads("rain-after-blue", api, {
    mockApiEnabled: false,
    optionIds: ["rain-after-blue", "mountain-violet"]
  });

  assert.equal(calls.get, 2);
  assert.equal(reads.designs.length, 2);
  assert.equal(reads.savedDesignsRead, "OK");
  assert.equal(reads.ordersRead, "OK");
  assert.equal(reads.savedDesigns[0]?.status, "SAVED");
});

test("a failed library or order list read degrades to unknown instead of throwing", async () => {
  const { api } = fakeApi({
    listDesigns: async () => {
      throw new Error("401");
    },
    listOrders: async () => {
      throw new Error("500");
    }
  });
  const reads = await loadDesignDetailReads("rain-after-blue", api, {
    mockApiEnabled: false,
    optionIds: ["rain-after-blue"]
  });

  assert.equal(reads.savedDesignsRead, "FAILED");
  assert.equal(reads.ordersRead, "FAILED");
  assert.deepEqual(reads.savedDesigns, []);
  assert.deepEqual(reads.orders, []);
});

test("a failed design read still rejects so the route keeps its canonical error notice", async () => {
  const { api } = fakeApi();

  await assert.rejects(() => loadDesignDetailReads("missing-design", api, {
    mockApiEnabled: false,
    optionIds: ["missing-design"]
  }));
});

test("mock mode reads no library or order list because an empty mock list proves nothing", async () => {
  const { api, calls } = fakeApi();
  const reads = await loadDesignDetailReads("rain-after-blue", api, {
    mockApiEnabled: true,
    optionIds: ["rain-after-blue"]
  });

  assert.equal(calls.listDesigns, 0);
  assert.equal(calls.listOrders, 0);
  assert.equal(reads.savedDesignsRead, "MOCK");
  assert.equal(reads.ordersRead, "MOCK");
});
