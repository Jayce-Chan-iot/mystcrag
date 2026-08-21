import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GenerateDesignRequestSchema, PublicDesignV1Schema, RecommendDesignRequestSchema, type PublicDesignV1 } from "@mystcrag/design-contract";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FlowNotice } from "../../components/flow-notice";
import { FRONTEND_ERROR_CODES, FrontendApiError } from "../../lib/api/frontend-api-error";
import { MOCK_MATERIALS, mockGetDesignOptions, mockReplaceBead } from "../../lib/api/mock-design-api";
import { BraceletPreview } from "./components/bracelet-preview";
import { BraceletSequenceEditor } from "./components/bracelet-sequence-editor";
import { DIY_LAYOUT_CLASS } from "./components/diy-editor";
import { connectedRingRadiusPercent, FlatBraceletEditor } from "./components/flat-bracelet-editor";
import { mockDesignOptions } from "./fixtures/mock-design-options";
import { calculateBraceletCircumferenceMm, evaluateBraceletFit } from "./model/bracelet-fit";
import { resolveSelectedDesign } from "./model/design-selection";
import {
  getNextStepIndex,
  getPreviousStepIndex,
  INITIAL_ANSWERS,
  QUESTIONNAIRE_STEPS,
  toGenerateDesignRequest,
  toRecommendDesignRequest,
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
  const request = toGenerateDesignRequest({ state: "quiet", color: "mist-blue", style: "minimal", budget: "signature", wrist: "155", culture: "landscape", excludedProductIds: ["product-quartz-round-10"], personalizationConsent: true });
  assert.equal(GenerateDesignRequestSchema.safeParse(request).success, true);
  assert.equal(request.wristCircumferenceMm, 155);
  assert.equal(request.personalizationConsent, true);
  assert.deepEqual(request.excludedProductIds, ["product-quartz-round-10"]);
  assert.equal(request.minBudgetMinor, 50_000);
  assert.equal(request.maxBudgetMinor, 89_900);
});

test("questionnaire derives a single schema-valid recommend request for the deterministic engine", () => {
  const answers = { state: "quiet", color: "mist-blue", style: "minimal", budget: "entry", wrist: "155", culture: "landscape", excludedProductIds: ["product-quartz-round-10"], personalizationConsent: true };
  const request = toRecommendDesignRequest(answers);
  assert.equal(RecommendDesignRequestSchema.safeParse(request).success, true);
  assert.deepEqual(request.emotionTags, ["quiet"]);
  assert.equal(request.styleTags.includes("minimal"), true);
  assert.equal(request.styleTags.includes("landscape"), true);
  assert.equal(request.colorTags.includes("mist-blue"), true);
  assert.equal(request.maxBudgetMinor, 49_900);
  assert.equal(request.minBudgetMinor, 29_900);
  assert.equal(request.wristCircumferenceMm, 155);
  assert.deepEqual(request.excludedProductIds, ["product-quartz-round-10"]);
  assert.equal(request.personalizationConsent, true);
});

test("questionnaire issues one recommend call instead of concurrent generate fan-out", () => {
  const source = readFileSync(new URL("../questionnaire/components/questionnaire-wizard.tsx", import.meta.url), "utf8");
  assert.match(source, /designApi\.recommend\(/);
  assert.match(source, /response\.candidates\.length === 0/);
  assert.doesNotMatch(source, /Promise\.allSettled/);
  assert.doesNotMatch(source, /designApi\.generate/);
});

test("renders three schema-valid design choices and selects each by public designId", () => {
  assert.equal(mockDesignOptions.length, 3);
  for (const design of mockDesignOptions) {
    assert.equal(PublicDesignV1Schema.safeParse(design).success, true);
    assert.equal(resolveSelectedDesign(mockDesignOptions, design.designId)?.designName, design.designName);
  }
  assert.equal(resolveSelectedDesign(mockDesignOptions, "missing"), null);
  const source = readFileSync(new URL("./components/design-results.tsx", import.meta.url), "utf8");
  assert.match(source, /data-results-layout="comparison-grid"/);
  assert.match(source, /data-results-action-bar="true"/);
  assert.match(source, /进入 DIY 调整/);
  assert.match(source, /results\[0\]\?\.designId/);
  assert.match(source, /designs\.length === 1/);
  assert.match(source, /min-w-0 flex-col/);
  assert.doesNotMatch(source, /<div className="hidden xl:block">\s*<ComplianceNotice/);
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
  const forbiddenMarkup = renderToStaticMarkup(<FlowNotice code="FORBIDDEN" />);
  assert.match(forbiddenMarkup, /href="\/ai-design"/);
  assert.match(forbiddenMarkup, /重新生成/);
});

test("mock result API exposes AI failure, network error and empty state paths", async () => {
  assert.deepEqual(await mockGetDesignOptions("empty"), []);
  await assert.rejects(mockGetDesignOptions("ai-failed"), (error: unknown) => error instanceof FrontendApiError && error.code === "AI_GENERATION_FAILED");
  await assert.rejects(mockGetDesignOptions("network-error"), (error: unknown) => error instanceof FrontendApiError && error.code === "NETWORK_ERROR");
});

test("DIY editor keeps the focused mobile column and adds the desktop workbench", () => {
  assert.match(DIY_LAYOUT_CLASS, /max-w-\[70rem\]/);
  const source = readFileSync(new URL("./components/diy-editor.tsx", import.meta.url), "utf8");
  assert.match(source, /data-desktop-diy-workspace="true"/);
  assert.match(source, /导出设计图/);
  assert.match(source, /完成设计/);
  assert.match(source, /data-design-completion-page="true"/);
  assert.match(source, /你的设计已经完成/);
  assert.match(source, /下一步/);
  assert.match(source, /返回继续调整/);
  assert.match(source, /清空设计/);
  assert.match(source, /收缩成串/);
  assert.match(source, /散开查看/);
  assert.match(source, /h-\[calc\(100dvh-4\.75rem\)\]/);
  assert.match(source, /grid-rows-\[minmax\(0,1fr\)_clamp/);
  assert.match(source, /fitDesktopViewport/);
});

test("flat bracelet editor exposes the touch-first 2D ring", () => {
  const design = mockDesignOptions[0]!;
  const markup = renderToStaticMarkup(
    <FlatBraceletEditor
      busy={false}
      design={design}
      fitDesktopViewport
      onMove={() => undefined}
      onRemove={() => undefined}
      onSelect={() => undefined}
      selectedComponentId={design.beads[0]!.componentId}
    />
  );
  assert.match(markup, /data-flat-bracelet-editor="true"/);
  assert.match(markup, /data-bracelet-layout="spread"/);
  assert.match(markup, /2D 手串编辑预览/);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /100dvh-20\.5rem/);
  assert.equal(connectedRingRadiusPercent(140) < 39, true);
  assert.equal(connectedRingRadiusPercent(200), 39);
  const source = readFileSync(new URL("./components/flat-bracelet-editor.tsx", import.meta.url), "utf8");
  assert.match(source, /data-remove-drop-zone-active=/);
  assert.match(source, /拖到这里删除/);
  assert.match(source, /overDeleteZone && canRemove/);
  assert.match(source, /calculateSizeAwareRingLayout/);
  assert.match(source, /transition-none/);
  assert.doesNotMatch(source, /dragging \? "z-30 scale-110 opacity-90 drop-shadow-xl"/);
  assert.doesNotMatch(source, /outsideRing/);
  const beadImageSource = readFileSync(new URL("./components/crystal-bead-image.tsx", import.meta.url), "utf8");
  assert.match(beadImageSource, /data-photo-real-bead="true"/);
  assert.match(beadImageSource, /drop-shadow-\[0_7px_6px/);
  assert.match(beadImageSource, /scale-\[1\.34\]/);
  assert.match(beadImageSource, /loading="eager"/);
  assert.match(source, /silver-star-ring-charm\.png/);
  assert.match(source, /loading="eager"/);
});

test("bracelet circumference follows component sizes and gates the 13–20cm completion range", () => {
  const base = mockDesignOptions[0]!;
  const withLength = (diameterMm: number): PublicDesignV1 => ({
    ...base,
    accessories: [],
    beads: [{ ...base.beads[0]!, diameterMm }]
  });

  assert.equal(calculateBraceletCircumferenceMm(withLength(129)), 129);
  assert.deepEqual(evaluateBraceletFit(withLength(129)).status, "TOO_SMALL");
  assert.equal(evaluateBraceletFit(withLength(130)).canComplete, true);
  assert.equal(evaluateBraceletFit(withLength(200)).canComplete, true);
  assert.deepEqual(evaluateBraceletFit(withLength(201)).status, "TOO_LARGE");

  const editorSource = readFileSync(new URL("./components/diy-editor.tsx", import.meta.url), "utf8");
  assert.match(editorSource, /!braceletFit\.canComplete/);
  assert.match(editorSource, /调整到 13\.0–20\.0cm 后即可完成/);
});

test("DIY entry bypasses the AI questionnaire and the mobile questionnaire uses direct touch buttons", () => {
  const diyRoute = readFileSync(new URL("../../../app/diy/page.tsx", import.meta.url), "utf8");
  const questionnaire = readFileSync(new URL("../questionnaire/components/questionnaire-wizard.tsx", import.meta.url), "utf8");
  assert.match(diyRoute, /redirect\("\/diy\/design-diy-private"\)/);
  assert.doesNotMatch(diyRoute, /redirect\("\/ai-design"\)/);
  assert.match(questionnaire, /touch-manipulation/);
  assert.match(questionnaire, /role="radio"/);
  assert.match(questionnaire, /aria-checked=/);
});

test("bracelet sequence editor exposes drag ordering, removal drop zone and touch-safe controls", () => {
  const design = mockDesignOptions[0]!;
  const markup = renderToStaticMarkup(
    <BraceletSequenceEditor
      busy={false}
      design={design}
      onMove={() => undefined}
      onRemove={() => undefined}
      onSelect={() => undefined}
      selectedComponentId={design.beads.at(-1)!.componentId}
    />
  );
  assert.match(markup, /data-sequence-editor="true"/);
  assert.match(markup, /draggable="true"/);
  assert.match(markup, /data-remove-drop-zone="true"/);
  assert.match(markup, /拖动珠子调整顺序/);
  assert.match(markup, /把珠子拖到这里移除/);
});

test("mobile toolbar exposes real undo and redo instead of relabeling movement", () => {
  const editorSource = readFileSync(new URL("./components/diy-editor.tsx", import.meta.url), "utf8");
  assert.match(editorSource, /runHistory\("undo"\)/);
  assert.match(editorSource, /↶ 撤销/);
  assert.match(editorSource, /↷ 重做/);
  assert.match(editorSource, /moveSelectedBy\(-1\)/);
});

test("completed order state survives a refresh and the 404 page is localized", () => {
  const sessionSource = readFileSync(new URL("../../lib/api/design-session.ts", import.meta.url), "utf8");
  const editorSource = readFileSync(new URL("./components/diy-editor.tsx", import.meta.url), "utf8");
  const notFoundSource = readFileSync(new URL("../../../app/not-found.tsx", import.meta.url), "utf8");
  assert.match(sessionSource, /window\.localStorage\.setItem/);
  assert.match(sessionSource, /CreateOrderFromDesignResponseSchema\.parse/);
  assert.match(editorSource, /setOrder\(loadCompletedOrder\(response\.designId, response\.revision\)\)/);
  assert.match(editorSource, /saveCompletedOrder\(response\)/);
  assert.match(notFoundSource, /没有找到这个页面/);
  assert.match(notFoundSource, /返回首页/);
});
