import assert from "node:assert/strict";
import test from "node:test";

import { GenerateDesignRequestSchema, PublicDesignV1Schema } from "@mystcrag/design-contract";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FlowNotice } from "../../components/flow-notice";
import { FRONTEND_ERROR_CODES, FrontendApiError } from "../../lib/api/frontend-api-error";
import { MOCK_MATERIALS, mockGetDesignOptions, mockReplaceBead } from "../../lib/api/mock-design-api";
import { BraceletPreview } from "./components/bracelet-preview";
import { DIY_LAYOUT_CLASS } from "./components/diy-editor";
import { mockDesignOptions } from "./fixtures/mock-design-options";
import { resolveSelectedDesign } from "./model/design-selection";
import {
  getNextStepIndex,
  getPreviousStepIndex,
  INITIAL_ANSWERS,
  QUESTIONNAIRE_STEPS,
  toGenerateDesignRequest,
  validateQuestionnaireStep
} from "../questionnaire/model/questionnaire";

test("AI questionnaire defines all six required steps and validates input", () => {
  assert.deepEqual(QUESTIONNAIRE_STEPS.map((step) => step.id), ["state", "color", "style", "budget", "wrist", "culture"]);
  assert.equal(validateQuestionnaireStep("state", INITIAL_ANSWERS), "请选择一项后继续。");
  assert.equal(validateQuestionnaireStep("wrist", { ...INITIAL_ANSWERS, wrist: "90" }), "请输入 120–220 mm 之间的有效手围。");
  assert.equal(validateQuestionnaireStep("wrist", { ...INITIAL_ANSWERS, wrist: "155" }), null);
});

test("questionnaire can move forward and return to the previous step without underflow", () => {
  assert.equal(getNextStepIndex(0), 1);
  assert.equal(getPreviousStepIndex(1), 0);
  assert.equal(getPreviousStepIndex(0), 0);
  assert.equal(getNextStepIndex(5), 5);
});

test("questionnaire produces a shared Generate Design request DTO", () => {
  const request = toGenerateDesignRequest({ state: "quiet", color: "mist-blue", style: "minimal", budget: "signature", wrist: "155", culture: "landscape" });
  assert.equal(GenerateDesignRequestSchema.safeParse(request).success, true);
  assert.equal(request.wristCircumferenceMm, 155);
  assert.equal(request.personalizationConsent, false);
  assert.equal(request.minBudgetMinor, 50_000);
  assert.equal(request.maxBudgetMinor, 89_900);
});

test("renders three schema-valid design choices and selects each by public designId", () => {
  assert.equal(mockDesignOptions.length, 3);
  for (const design of mockDesignOptions) {
    assert.equal(PublicDesignV1Schema.safeParse(design).success, true);
    assert.equal(resolveSelectedDesign(mockDesignOptions, design.designId)?.designName, design.designName);
  }
  assert.equal(resolveSelectedDesign(mockDesignOptions, "missing"), null);
});

test("Public DTO fixtures and rendered result data never expose commercial cost", () => {
  const serialized = JSON.stringify(mockDesignOptions);
  assert.doesNotMatch(serialized, /unitCostMinor|supplierReference|costSubtotal/i);
  assert.match(renderToStaticMarkup(<BraceletPreview compact design={mockDesignOptions[0]!} />), /data-component-id/);
});

test("bracelet selection uses componentId for keys, data identity and accessible controls", () => {
  const design = mockDesignOptions[0]!;
  const selectedId = design.beads[1]!.componentId;
  const markup = renderToStaticMarkup(<BraceletPreview design={design} interactive selectedComponentId={selectedId} />);
  assert.match(markup, new RegExp(`data-component-id="${selectedId}"`));
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /aria-label="选择第/);
});

test("replacing one bead preserves componentId and accepts only server-mock recalculated pricing", async () => {
  const design = structuredClone(mockDesignOptions[0]!);
  const selected = design.beads[0]!;
  const replacement = MOCK_MATERIALS.find((material) => material.id === "amethyst")!;
  const response = await mockReplaceBead({ design, componentId: selected.componentId, materialId: replacement.id, expectedRevision: design.revision });
  const updated = response.design.beads.find((bead) => bead.componentId === selected.componentId)!;
  assert.equal(updated.componentId, selected.componentId);
  assert.equal(updated.materialKey, replacement.materialKey);
  assert.equal(response.design.revision, design.revision + 1);
  assert.equal(response.design.pricing.totalPriceMinor, design.pricing.totalPriceMinor + replacement.unitPriceMinor - selected.unitPriceMinor);
  assert.equal(response.warnings[0]?.code, "PRICE_CHANGED");
});

test("revision conflict and inventory changes return stable user-facing errors", async () => {
  const design = structuredClone(mockDesignOptions[0]!);
  await assert.rejects(
    mockReplaceBead({ design, componentId: design.beads[0]!.componentId, materialId: "aquamarine", expectedRevision: design.revision - 1 }),
    (error: unknown) => error instanceof FrontendApiError && error.code === "CONFLICT"
  );
  await assert.rejects(
    mockReplaceBead({ design, componentId: design.beads[0]!.componentId, materialId: "sold-out", expectedRevision: design.revision }),
    (error: unknown) => error instanceof FrontendApiError && error.code === "INVENTORY_CHANGED"
  );
});

test("all required exceptional states have explicit accessible UI", () => {
  const markup = FRONTEND_ERROR_CODES.map((code) => renderToStaticMarkup(<FlowNotice code={code} />)).join("");
  for (const code of FRONTEND_ERROR_CODES) assert.match(markup, new RegExp(`data-error-code="${code}"`));
  assert.match(markup, /role="alert"/);
  assert.match(markup, /价格已更新/);
  assert.match(markup, /库存有变化/);
});

test("mock result API exposes AI failure, network error and empty state paths", async () => {
  assert.deepEqual(await mockGetDesignOptions("empty"), []);
  await assert.rejects(mockGetDesignOptions("ai-failed"), (error: unknown) => error instanceof FrontendApiError && error.code === "AI_GENERATION_FAILED");
  await assert.rejects(mockGetDesignOptions("network-error"), (error: unknown) => error instanceof FrontendApiError && error.code === "NETWORK_ERROR");
});

test("DIY editor emits mobile-first ordering and desktop three-column layout", () => {
  assert.match(DIY_LAYOUT_CLASS, /lg:grid-cols-\[18rem_minmax\(28rem,1fr\)_21rem\]/);
});
