import assert from "node:assert/strict";
import test from "node:test";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

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
