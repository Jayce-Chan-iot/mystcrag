import assert from "node:assert/strict";
import test from "node:test";

import {
  GenerateDesignResponseSchema,
  PublicDesignV1Schema,
  type SupportedCurrency,
  type PublicDesignV1
} from "@mystcrag/design-contract";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ComplianceNotice,
  DesignComponentList,
  DesignSummary,
  PriceSummary
} from "./components";
import { mockPublicDesign } from "./fixtures/mock-public-design";
import { toDesignComponentViewModels } from "./model/design-component-view-model";
import { formatMinorAmount } from "./model/format-minor-amount";
import { parseGenerateDesignResponse } from "../../lib/api/parse-design-response";

function withCompliance(status: PublicDesignV1["compliance"]["complianceStatus"]): PublicDesignV1 {
  return PublicDesignV1Schema.parse({
    ...mockPublicDesign,
    compliance: {
      ...mockPublicDesign.compliance,
      complianceStatus: status,
      reviewRequired: status !== "PASSED"
    }
  });
}

test("renders a schema-validated public design without cost fields", () => {
  const markup = renderToStaticMarkup(
    <>
      <DesignSummary design={mockPublicDesign} />
      <DesignComponentList design={mockPublicDesign} />
      <PriceSummary design={mockPublicDesign} />
    </>
  );

  assert.match(markup, /Rain After Blue/);
  assert.doesNotMatch(JSON.stringify(mockPublicDesign), /cost|supplier/i);
});

test("parses API payloads at the frontend boundary", () => {
  const payload = GenerateDesignResponseSchema.parse({
    requestId: "request-frontend-1",
    design: mockPublicDesign,
    warnings: []
  });
  assert.deepEqual(parseGenerateDesignResponse(payload), payload);
  assert.throws(() => parseGenerateDesignResponse({ design: mockPublicDesign }));
});

test("formats CNY minor units as fen and TWD minor units as whole dollars", () => {
  assert.match(
    formatMinorAmount({ amountMinor: 39_900, currency: "CNY", locale: "zh-CN" }),
    /399\.00/
  );
  assert.equal(
    formatMinorAmount({ amountMinor: 1_680, currency: "TWD", locale: "zh-TW" }),
    "NT$1,680"
  );
});

test("rejects unsupported currency and unsafe amounts", () => {
  assert.throws(() =>
    formatMinorAmount({ amountMinor: 100, currency: "USD" as SupportedCurrency })
  );
  assert.throws(() => formatMinorAmount({ amountMinor: -1, currency: "CNY" }));
});

test("mock data passes the public design schema", () => {
  assert.equal(PublicDesignV1Schema.safeParse(mockPublicDesign).success, true);
});

test("uses componentId as stable list identity and preserves anchored relations", () => {
  const components = toDesignComponentViewModels(mockPublicDesign);
  assert.ok(components.every((component) => component.key === component.componentId));
  assert.match(
    components.find((component) => component.componentId === "accessory-pendant-1")!.placement,
    /accessory-spacer-1/
  );
});

test("does not present a private design as published", () => {
  const markup = renderToStaticMarkup(<DesignSummary design={mockPublicDesign} />);
  assert.match(markup, /Private/);
  assert.doesNotMatch(markup, /Published/);
});

test("renders actionable flagged and rejected compliance states", () => {
  assert.match(
    renderToStaticMarkup(<ComplianceNotice design={withCompliance("FLAGGED")} />),
    /需要人工确认/
  );
  assert.match(
    renderToStaticMarkup(<ComplianceNotice design={withCompliance("REJECTED")} />),
    /暂不可发布或下单/
  );
});
