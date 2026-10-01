import assert from "node:assert/strict";
import test from "node:test";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { deriveDesignSaveState, type DesignDetailReads } from "./components/design-results";
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
