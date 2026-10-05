import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GenerateDesignRequestSchema, PublicDesignV1Schema, RecommendDesignRequestSchema, type PublicDesignV1, type UpdateDesignOperation } from "@mystcrag/design-contract";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import HomePage, { CREATION_PATH_ASSET_KEYS, getCreationPaths } from "../../../app/page";
import { STAR_PLATFORM_ASSETS } from "./model/star-assets";
import { FlowNotice } from "../../components/flow-notice";
import { FRONTEND_ERROR_CODES, FrontendApiError } from "../../lib/api/frontend-api-error";
import { MOCK_MATERIALS, mockGetDesignOptions, mockReplaceBead } from "../../lib/api/mock-design-api";
import { BraceletPreview } from "./components/bracelet-preview";
import { BraceletSequenceEditor } from "./components/bracelet-sequence-editor";
import { DisplayTray } from "./components/display-tray";
import { DiyEditor, DIY_LAYOUT_CLASS, SyncStatusBanner } from "./components/diy-editor";
import { calculateSizeAwareRingLayout, connectedRingRadiusPercent, dragMetrics, FlatBraceletEditor, targetPositionForAngle } from "./components/flat-bracelet-editor";
import { mockDesignOptions } from "./fixtures/mock-design-options";
import { calculateBraceletCircumferenceMm, evaluateBraceletFit } from "./model/bracelet-fit";
import { resolveSelectedDesign } from "./model/design-selection";
import { createOptimisticState, dismissRecoveryNotice, enqueueEdit, resolveConflict, settleEdit } from "./model/optimistic-design";
import { WristMeasurementGuide } from "../questionnaire/components/wrist-measurement-guide";
import {
  getNextStepIndex,
  getPreviousStepIndex,
  INITIAL_ANSWERS,
  QUESTIONNAIRE_STEPS,
  toGenerateDesignRequest,
  toRecommendDesignRequest,
  validateQuestionnaireStep
} from "../questionnaire/model/questionnaire";

// `app/page.tsx` is outside the frontend tsconfig directory and is transpiled
// with the classic JSX runtime, so rendering it needs React on the global.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

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

test("wrist step shows an inline image guide with accessible measurement instructions", () => {
  const markup = renderToStaticMarkup(<WristMeasurementGuide />);
  assert.match(markup, /wrist-measurement\.webp/);
  assert.match(markup, /软尺贴合手腕一圈的测量示意/);
  assert.match(markup, /贴肤环绕腕骨/);
  assert.match(markup, /不要预留松量/);
  assert.match(markup, /毫米数填入上方/);
  assert.doesNotMatch(markup, /role="dialog"/);
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
  const nonAuthCodes = FRONTEND_ERROR_CODES.filter((code) => code !== "UNAUTHORIZED");
  const markup = nonAuthCodes.map((code) => renderToStaticMarkup(<FlowNotice code={code} />)).join("");
  for (const code of nonAuthCodes) assert.match(markup, new RegExp(`data-error-code="${code}"`));
  assert.match(markup, /role="alert"/);
  assert.match(markup, /价格已更新/);
  assert.match(markup, /库存有变化/);
  const forbiddenMarkup = renderToStaticMarkup(<FlowNotice code="FORBIDDEN" />);
  assert.doesNotMatch(forbiddenMarkup, /href=/);
  assert.doesNotMatch(forbiddenMarkup, /重新生成/);
  const unauthorizedMarkup = renderToStaticMarkup(<FlowNotice code="UNAUTHORIZED" />);
  assert.match(unauthorizedMarkup, /role="dialog"/);
  assert.match(unauthorizedMarkup, /aria-modal="true"/);
  assert.match(unauthorizedMarkup, /登录后继续/);
  assert.match(unauthorizedMarkup, /登录 \/ 注册/);
  assert.match(unauthorizedMarkup, /暂不登录/);
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
  assert.match(source, /设计已确认，订单快照已生成/);
  assert.match(source, /清空设计/);
  assert.match(source, /收缩成串/);
  assert.match(source, /散开到托盘/);
  assert.doesNotMatch(source, /散开查看/);
  assert.doesNotMatch(source, /grid-rows-\[minmax\(0,1fr\)_11\.25rem\]/);
  assert.match(source, /data-desktop-diy-workspace="true"/);
  assert.match(source, /min-h-0 flex-1 grid-cols-/);
  assert.match(source, /fitDesktopViewport/);
});

test("DIY workbench exposes tray choice, current beads, diameter controls and extensible product types", () => {
  const source = readFileSync(new URL("./components/diy-editor.tsx", import.meta.url), "utf8");
  assert.match(source, /DISPLAY_TRAY_OPTIONS/);
  assert.match(source, /loadDisplayTray/);
  assert.match(source, /saveDisplayTray/);
  assert.match(source, /trayMaterial=\{trayMaterial\}/);
  assert.match(source, /data-current-bracelet-materials="true"/);
  assert.match(source, /将选中珠子调整为/);
  assert.match(source, /material\.crystalId === selectedMaterial\.crystalId/);
  assert.match(source, /水晶库/);
  assert.match(source, /天然石/);
  assert.match(source, /配饰/);
  assert.match(source, /max-w-\[30rem\]/);
  assert.match(source, /displayTrayCanvasPalette\(trayMaterial\)/);
  assert.match(source, /展示托盘：/);
  assert.match(source, /launchQueue/);
  assert.match(source, /setLaunchQueue/);
  assert.match(source, /onLaunchConsumed/);
  assert.doesNotMatch(source, /已选用的珠子/);
  assert.match(source, /成品手围与尺寸/);
  assert.match(source, /WearFitSummary/);
  assert.doesNotMatch(source, /预计适配手围|当前组合长度/);
  assert.doesNotMatch(source, /常用水晶/);
  assert.doesNotMatch(source, />已选水晶</);
  assert.doesNotMatch(source, /\["历史方案", false\]/);
  assert.doesNotMatch(source, /\["我的收藏", false\]/);
  assert.match(source, /href="\/profile\?tab=designs"/);
  assert.match(source, /href="\/profile\?tab=favorites"/);
  assert.match(source, /data-workbench-toolrail="true"[\s\S]*?void loadSuggestions\(\)/);
  assert.match(source, /data-workbench-toolrail="true"[\s\S]*?href="\/profile\?tab=designs"/);
  assert.match(source, /data-workbench-status-region="true"/);
  const inspectorTag = source.match(/<aside\b[^>]*data-desktop-inspector="true"[^>]*>/)?.[0]
    ?? source.match(/<aside\b[^>]*data-desktop-inspector="true"/)?.[0];
  assert.ok(inspectorTag, "desktop inspector aside must be present");
  assert.match(inspectorTag, /overflow-y-auto/);
  assert.match(source, /data-desktop-inspector-footer="true"/);
  assert.match(source, /sticky bottom-0/);
});

test("flat bracelet editor exposes the touch-first 2D ring in connected mode", () => {
  const design = mockDesignOptions[0]!;
  const markup = renderToStaticMarkup(
    <FlatBraceletEditor
      busy={false}
      connected
      design={design}
      fitDesktopViewport
      onMove={() => undefined}
      onRemove={() => undefined}
      onSelect={() => undefined}
      selectedComponentId={design.beads[0]!.componentId}
    />
  );
  assert.match(markup, /data-flat-bracelet-editor="true"/);
  assert.match(markup, /data-bracelet-layout="connected"/);
  assert.match(markup, /2D 手串编辑预览/);
  assert.match(markup, /aria-pressed="true"/);
  assert.match(markup, /clamp\(14rem, calc\(100dvh - 20\.5rem\), 35rem\)/);
  assert.equal(connectedRingRadiusPercent(140) < 39, true);
  assert.equal(connectedRingRadiusPercent(200), 39);
  const source = readFileSync(new URL("./components/flat-bracelet-editor.tsx", import.meta.url), "utf8");
  assert.match(source, /data-tray-removal-active=/);
  assert.match(source, /拖出托盘即可删除/);
  assert.match(source, /outsideTray && canRemove/);
  assert.match(source, /onDragEnd=\{\(event\) =>/);
  assert.match(source, /nativeDragIdRef\.current/);
  assert.match(source, /isPointOutsideTray/);
  assert.match(source, /calculateSizeAwareRingLayout/);
  assert.match(source, /transition-none/);
  assert.doesNotMatch(source, /dragging \? "z-30 scale-110 opacity-90 drop-shadow-xl"/);
  assert.doesNotMatch(source, /data-remove-drop-zone/);
  assert.doesNotMatch(source, /overDeleteZone/);
  const beadImageSource = readFileSync(new URL("./components/crystal-bead-image.tsx", import.meta.url), "utf8");
  assert.match(beadImageSource, /data-photo-real-bead="true"/);
  assert.match(beadImageSource, /drop-shadow-\[0_7px_6px/);
  assert.doesNotMatch(beadImageSource, /scale-\[/);
  assert.match(beadImageSource, /loading="eager"/);
  assert.match(source, /silver-star-ring-charm\.png/);
  assert.match(source, /loading="eager"/);
});

test("flat bracelet editor delegates loose mode to LooseBeadStage without business move callbacks", () => {
  const design = mockDesignOptions[0]!;
  let moveCalls = 0;
  const markup = renderToStaticMarkup(
    <FlatBraceletEditor
      busy={false}
      connected={false}
      design={design}
      onMove={() => {
        moveCalls += 1;
      }}
      onRemove={() => undefined}
      onSelect={() => undefined}
      selectedComponentId={design.beads[0]!.componentId}
    />
  );
  assert.equal(moveCalls, 0);
  assert.match(markup, /data-loose-bead-stage="true"/);
  assert.match(markup, /data-bracelet-layout="loose"/);
  assert.doesNotMatch(markup, /拖出托盘即可删除/);
  const source = readFileSync(new URL("./components/flat-bracelet-editor.tsx", import.meta.url), "utf8");
  assert.match(source, /LooseBeadStage/);
  assert.match(source, /launchQueue\?:/);
  assert.match(source, /onLaunchConsumed\?:/);
  assert.match(source, /!visualConnected/);
  assert.match(source, /MODE_TRANSITION_MS/);
  assert.match(source, /data-mode-transition-ghost/);
  assert.match(source, /prefers-reduced-motion/);
  assert.match(source, /duration-300 motion-reduce:transition-none/);
});

test("drag hit resolution maps each pointer position to the slot rendered under it", () => {
  const base = mockDesignOptions[0]!;
  const slotNames = ["a", "b", "c", "d"];
  const ring = base.beads.slice(0, 4).map((bead, index) => ({
    ...bead,
    componentId: `bead-slot-${slotNames[index]}`,
    diameterMm: 10,
    kind: "BEAD" as const,
    lengthAlongStringMm: 10,
    positionIndex: index
  }));
  const layout = calculateSizeAwareRingLayout(ring, false);
  const radiusPercent = layout[0]!.radiusPercent;
  const rect = { bottom: 400, height: 400, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0 } as DOMRect;
  const radiusPx = 400 * (radiusPercent / 100);
  const boundaryOffset = 0.05;
  const pointerCases = [
    { expectedPosition: 0, label: "top pointer over slot A", x: 200, y: 200 - radiusPx },
    { expectedPosition: 1, label: "right pointer over slot B", x: 200 + radiusPx, y: 200 },
    { expectedPosition: 2, label: "bottom pointer over slot C", x: 200, y: 200 + radiusPx },
    { expectedPosition: 3, label: "left pointer over slot D", x: 200 - radiusPx, y: 200 },
    { expectedPosition: 1, label: "pointer just above the 0-radian axis", x: 200 + Math.cos(boundaryOffset) * radiusPx, y: 200 - Math.sin(boundaryOffset) * radiusPx },
    { expectedPosition: 1, label: "pointer just below the 0-radian axis", x: 200 + Math.cos(boundaryOffset) * radiusPx, y: 200 + Math.sin(boundaryOffset) * radiusPx }
  ];
  for (const pointerCase of pointerCases) {
    const metrics = dragMetrics(rect, pointerCase.x, pointerCase.y, radiusPercent);
    assert.equal(metrics.nearRing, true, `${pointerCase.label} should sit inside the ring band`);
    assert.equal(metrics.outsideTray, false, `${pointerCase.label} should stay inside the tray`);
    const resolved = layout[targetPositionForAngle(layout, metrics.angle, -1)]?.component.componentId;
    assert.equal(
      resolved,
      `bead-slot-${slotNames[pointerCase.expectedPosition]}`,
      `${pointerCase.label} must resolve to the slot rendered under the pointer`
    );
  }
});

test("display tray renders the approved switchable presentation materials", () => {
  const markup = renderToStaticMarkup(<DisplayTray material="BONE_CHINA" />);
  assert.match(markup, /data-display-tray="BONE_CHINA"/);
  assert.match(markup, /米白骨瓷/);
  assert.match(markup, /仅改变展示背景，不计入价格/);
});

test("bracelet circumference keeps size advisories without blocking completion", () => {
  const base = mockDesignOptions[0]!;
  const withLength = (diameterMm: number): PublicDesignV1 => ({
    ...base,
    accessories: [],
    beads: [{ ...base.beads[0]!, diameterMm }]
  });

  assert.equal(calculateBraceletCircumferenceMm(withLength(129)), 129);
  assert.deepEqual(evaluateBraceletFit(withLength(129)).status, "TOO_SMALL");
  assert.equal(evaluateBraceletFit(withLength(129)).canComplete, true);
  assert.equal(evaluateBraceletFit(withLength(130)).canComplete, true);
  assert.equal(evaluateBraceletFit(withLength(200)).canComplete, true);
  assert.deepEqual(evaluateBraceletFit(withLength(201)).status, "TOO_LARGE");
  assert.equal(evaluateBraceletFit(withLength(201)).canComplete, true);

  const editorSource = readFileSync(new URL("./components/diy-editor.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(editorSource, /!braceletFit\.canComplete/);
  // The size advisory is owned once by the shared WearFitSummary component.
  assert.doesNotMatch(editorSource, /建议范围 13\.0–20\.0cm/);
  assert.match(editorSource, /WearFitSummary/);
});

test("DIY entry bypasses the AI questionnaire and the mobile questionnaire uses direct touch buttons", () => {
  const diyRoute = readFileSync(new URL("../../../app/diy/page.tsx", import.meta.url), "utf8");
  const questionnaire = readFileSync(new URL("../questionnaire/components/questionnaire-wizard.tsx", import.meta.url), "utf8");
  // TASK-UX-DIY-FE-001 test-only migration: /diy no longer redirects to the retired
  // fixed demo design. It renders the owner-scoped entry (own history or an empty tray).
  assert.match(diyRoute, /<DiyEntry \/>/);
  assert.doesNotMatch(diyRoute, /design-diy-private/);
  assert.doesNotMatch(diyRoute, /redirect\(/);
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

test("the sync state machine renders every status with explicit accessible recovery actions", () => {
  const noop = () => undefined;
  const design = mockDesignOptions[0]!;
  const firstBead = design.beads[0]!;
  const operations: readonly UpdateDesignOperation[] = [
    { operation: "MOVE_COMPONENT", componentId: firstBead.componentId, targetPositionIndex: design.beads.length - 1 }
  ];
  const undoOperations: readonly UpdateDesignOperation[] = [
    { operation: "MOVE_COMPONENT", componentId: firstBead.componentId, targetPositionIndex: firstBead.positionIndex }
  ];
  const renderBanner = (state: Parameters<typeof SyncStatusBanner>[0]["optimistic"]) =>
    renderToStaticMarkup(<SyncStatusBanner onDismiss={noop} onRetry={noop} onSynchronize={noop} optimistic={state} />);

  const savedMarkup = renderBanner(createOptimisticState(design));
  assert.match(savedMarkup, /data-sync-status="saved"/);
  assert.match(savedMarkup, /role="status"/);
  assert.match(savedMarkup, /编辑已同步，服务器为最新版本/);

  const syncingState = enqueueEdit(createOptimisticState(design), { requestId: "banner-edit", operations, undoOperations });
  const syncingMarkup = renderBanner(syncingState);
  assert.match(syncingMarkup, /data-sync-status="syncing"/);
  assert.match(syncingMarkup, /正在同步编辑（1 项）…/);
  assert.match(syncingMarkup, /motion-reduce:animate-none/);

  const failedState = settleEdit(syncingState, "banner-edit", { ok: false, code: "NETWORK_ERROR" });
  const failedMarkup = renderBanner(failedState);
  assert.match(failedMarkup, /data-sync-status="failed"/);
  assert.match(failedMarkup, /role="alert"/);
  assert.match(failedMarkup, /网络连接中断，未同步的编辑已回滚/);
  assert.match(failedMarkup, /data-sync-retry="true"/);
  assert.match(failedMarkup, /重试同步/);

  const conflictState = settleEdit(syncingState, "banner-edit", { ok: false, code: "CONFLICT" });
  const conflictMarkup = renderBanner(conflictState);
  assert.match(conflictMarkup, /data-sync-status="conflict"/);
  assert.match(conflictMarkup, /role="alert"/);
  assert.match(conflictMarkup, /data-sync-resolve-conflict="true"/);
  assert.match(conflictMarkup, /同步最新版本/);

  const recoveredState = resolveConflict(conflictState, { ...structuredClone(design), revision: design.revision + 1 });
  const recoveredMarkup = renderBanner(recoveredState);
  assert.match(recoveredMarkup, /data-sync-status="recovered"/);
  assert.match(recoveredMarkup, /data-sync-dismiss="true"/);
  assert.match(recoveredMarkup, /知道了/);
  assert.match(recoveredMarkup, /1 项未同步编辑已丢弃，不会写入服务器/);
  const dismissedMarkup = renderBanner(dismissRecoveryNotice(recoveredState));
  assert.match(dismissedMarkup, /data-sync-status="saved"/);
  assert.doesNotMatch(dismissedMarkup, /已丢弃/);

  // Failed edit superseded by a new one: a later success must still surface the
  // discard instead of collapsing into the plain saved banner.
  const failedState2 = settleEdit(syncingState, "banner-edit", { ok: false, code: "INVENTORY_CHANGED" });
  const superseded = enqueueEdit(failedState2, { requestId: "banner-edit-2", operations, undoOperations });
  const settledSuperseded = settleEdit(superseded, "banner-edit-2", { ok: true, design });
  assert.equal(settledSuperseded.status, "recovered");
  const supersededMarkup = renderBanner(settledSuperseded);
  assert.match(supersededMarkup, /data-sync-status="recovered"/);
  assert.match(supersededMarkup, /1 项未同步编辑已丢弃，不会写入服务器/);
  assert.doesNotMatch(supersededMarkup, /编辑已同步，服务器为最新版本/);
});

test("pointer cancellation restores the ring and the lifted bead keeps its real photo", () => {
  const source = readFileSync(new URL("./components/flat-bracelet-editor.tsx", import.meta.url), "utf8");
  assert.match(source, /onPointerCancel={clearDrag}/);
  assert.match(source, /onPointerUp={finishDrag}/);
  assert.match(source, /const clearDrag = \(\) => commitDrag\(null\)/);
  assert.match(source, /data-drag-lifted/);
  assert.match(source, /z-30 scale-110 cursor-grabbing transition-none drop-shadow-\[0_16px_20px_rgb\(57_45_67\/0\.32\)\]/);
  assert.match(source, /data-drag-target-slot="true"/);
  assert.match(source, /previewMovedRing\(components, reflowComponentId, reflowTargetIndex\)/);
  assert.match(source, /<CrystalBeadImage/);
});

test("keyboard editing selects, moves and removes beads with prevented defaults and visible focus", () => {
  const design = mockDesignOptions[0]!;
  const markup = renderToStaticMarkup(
    <FlatBraceletEditor
      busy={false}
      connected
      design={design}
      onMove={() => undefined}
      onRemove={() => undefined}
      onSelect={() => undefined}
      selectedComponentId={design.beads[0]!.componentId}
    />
  );
  assert.match(markup, /focus-visible:outline/);
  assert.match(markup, /aria-pressed="true"/);
  const source = readFileSync(new URL("./components/flat-bracelet-editor.tsx", import.meta.url), "utf8");
  assert.match(source, /event\.key === "ArrowLeft"/);
  assert.match(source, /event\.key === "ArrowRight"/);
  assert.match(source, /event\.key === "Delete" \|\| event\.key === "Backspace"/);
  assert.match(source, /onFocus=\{\(\) => \{ if \(isBead\) onSelect\(component\.componentId\); \}\}/);
  assert.equal((source.match(/event\.preventDefault\(\)/g) ?? []).length >= 3, true);
});

test("editor motion stays within the 150–350ms band and honors reduced motion", () => {
  const editorSource = readFileSync(new URL("./components/diy-editor.tsx", import.meta.url), "utf8");
  const braceletSource = readFileSync(new URL("./components/flat-bracelet-editor.tsx", import.meta.url), "utf8");
  assert.match(editorSource, /transition-\[max-height\] duration-300 motion-reduce:transition-none/);
  assert.match(editorSource, /motion-reduce:animate-none/);
  assert.match(braceletSource, /duration-200 motion-reduce:transition-none/);
  assert.match(braceletSource, /duration-300 motion-reduce:transition-none/);
  for (const source of [editorSource, braceletSource]) {
    assert.doesNotMatch(source, /duration-(?:[4-9]\d\d|\d{4,})/);
  }
});

test("the mobile workbench keeps one persistent server-authoritative info strip and clears the fixed bottom nav", () => {
  const source = readFileSync(new URL("./components/diy-editor.tsx", import.meta.url), "utf8");
  assert.match(source, /data-mobile-design-info-strip="true"/);
  assert.match(source, /<WearFitSummary/);
  assert.doesNotMatch(source, /<dt>手围<\/dt>/);
  assert.doesNotMatch(source, /<dt>合身<\/dt>/);
  assert.match(source, /<dt>珠数<\/dt>/);
  assert.match(source, /<dt>合计<\/dt>/);
  assert.match(source, /data-server-authoritative-price="true">\{formatMinorAmount\(\{ amountMinor: design\.pricing\.totalPriceMinor/);
  assert.match(source, /aria-label="导出设计图" className="grid h-11 w-11/);
  assert.equal((source.match(/<SyncStatusBanner/g) ?? []).length, 2);
  assert.match(source, /optimistic\.pending\.length > 0 \? <p className="mt-4 text-center text-sm text-\[var\(--muted\)\]" role="status">正在同步手串、库存与价格…/);
  assert.match(source, /disabled=\{isConflict \|\| optimistic\.undoStack\.length === 0\}/);
  assert.match(source, /disabled=\{isSaving \|\| !editsSettled\}/);
  assert.match(source, /disabled=\{isOrdering \|\| Boolean\(order\) \|\| !editsSettled\}/);

  const markup = renderToStaticMarkup(<DiyEditor designId="mobile-bottom-clearance-contract" />);
  assert.match(markup, /data-diy-editor-page="true"/);
  // Effective bottom-space contract: the mobile column reserves exactly the fixed
  // nav footprint (1px border + min-h-[3.4rem] + env(safe-area-inset-bottom)) so
  // the catalog, action bar and scrollable content never rest behind the nav.
  const navSource = readFileSync(new URL("../../../components/mobile-bottom-nav.tsx", import.meta.url), "utf8");
  assert.match(navSource, /min-h-\[3\.4rem\]/);
  assert.match(navSource, /env\(safe-area-inset-bottom\)/);
  assert.match(source, /pb-\[calc\(3\.4rem_\+_env\(safe-area-inset-bottom\)_\+_1px\)\] lg:hidden/);
  // The catalog sheet must never pin itself to the viewport bottom underneath the nav.
  const catalogSheetTag = source.match(/<section\b[^>]*data-catalog-sheet-state=\{catalogSheetState\}[^>]*>/)?.[0]
    ?? source.match(/<section\b[^>]*data-catalog-sheet-state=/)?.[0];
  assert.ok(catalogSheetTag, "mobile catalog sheet must remain present");
  assert.doesNotMatch(catalogSheetTag, /sticky bottom-0/);
  // Desktop completion footer may use sticky bottom-0; the catalog sheet may not.
  assert.match(source, /data-desktop-inspector-footer="true"/);
  assert.match(source, /data-catalog-sheet-state=\{catalogSheetState\}/);
  // The half/full material grid is a bounded flex-scroll box so its last item can
  // scroll fully above the nav instead of being clipped by the sheet.
  assert.match(source, /mt-3 grid min-h-0 flex-1 grid-cols-3 overflow-y-auto/);
});

function readSource(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

const assetSrcInMarkup = (markup: string, src: string): boolean =>
  markup.includes(src) || markup.includes(encodeURIComponent(src));

test("homepage resolves the hero and every creation entry from the typed Star Platform kit", () => {
  const home = readSource("../../../app/page.tsx");
  // Star surface, texture and count-driven grid stay wired.
  assert.match(home, /data-star-surface="home"/);
  assert.match(home, /data-atelier-surface="home"/);
  assert.match(home, /data-creation-count=\{creationPaths\.length\}/);
  assert.match(home, /data-star-entry-card/);
  // Hero consumes the typed observatory asset for both src and alt.
  assert.match(home, /STAR_PLATFORM_ASSETS\.heroObservatory\.src/);
  assert.match(home, /STAR_PLATFORM_ASSETS\.heroObservatory\.alt/);
  // Cards render the resolved typed asset instead of the frozen photography.
  assert.match(home, /src=\{path\.image\}/);
  assert.match(home, /alt=\{path\.imageAlt\}/);
  // The frozen atelier photography contract survives only as an explicit,
  // labelled legacy block and is never the render source.
  assert.match(home, /LEGACY_ATELIER_PHOTOGRAPHY/);
  assert.match(home, /\/home\/hero-bracelet\.webp/);
  assert.match(home, /data-reference-entry-image="true"/);
});

test("creation path asset keys map one-to-one onto the typed Star Platform entries", () => {
  assert.deepEqual(CREATION_PATH_ASSET_KEYS, {
    ai: "entryAi",
    oracle: "entryOracle",
    tarot: "entryTarot",
    diy: "entryDiy"
  });
  const expectedAsset = {
    ai: STAR_PLATFORM_ASSETS.entryAi,
    oracle: STAR_PLATFORM_ASSETS.entryOracle,
    tarot: STAR_PLATFORM_ASSETS.entryTarot,
    diy: STAR_PLATFORM_ASSETS.entryDiy
  } as const;
  const paths = getCreationPaths({ tarotEnabled: true, oracleEnabled: true });
  assert.deepEqual(paths.map((path) => path.id), ["ai", "oracle", "tarot", "diy"]);
  for (const path of paths) {
    const asset = expectedAsset[path.id];
    assert.equal(path.assetKey, CREATION_PATH_ASSET_KEYS[path.id], `${path.id} must declare its typed asset key`);
    assert.equal(path.image, asset.src, `${path.id} entry must render the typed ${path.id} src`);
    assert.equal(path.imageAlt, asset.alt, `${path.id} entry must render the typed ${path.id} alt`);
  }
  assert.equal(new Set(paths.map((path) => path.image)).size, 4, "entries must not share one asset");
});

test("rendered homepage exposes the typed hero and entry assets and drops the frozen photography", () => {
  const markup = renderToStaticMarkup(<HomePage />);
  const hero = STAR_PLATFORM_ASSETS.heroObservatory;
  assert.ok(assetSrcInMarkup(markup, hero.src), "hero must render the typed observatory src");
  assert.ok(markup.includes(hero.alt), "hero must render the typed observatory alt");
  // AI and DIY entries are capability-independent and always render.
  for (const asset of [STAR_PLATFORM_ASSETS.entryAi, STAR_PLATFORM_ASSETS.entryDiy]) {
    assert.ok(assetSrcInMarkup(markup, asset.src), `entry must render typed src ${asset.src}`);
    assert.ok(markup.includes(asset.alt), `entry must render typed alt ${asset.alt}`);
  }
  // The frozen atelier photography must never reach the rendered page.
  assert.doesNotMatch(markup, /home(?:%2F|\/)hero-bracelet\.webp/);
  assert.doesNotMatch(markup, /home(?:%2F|\/)entry-ai\.webp/);
  assert.doesNotMatch(markup, /home(?:%2F|\/)entry-diy-loose-tray\.webp/);
});

test("rendered homepage maps every gated entry to its own typed src and alt", () => {
  const previousTarot = process.env.MYSTCRAG_TAROT_ENABLED;
  const previousOracle = process.env.MYSTCRAG_ORACLE_ENABLED;
  let markup = "";
  try {
    process.env.MYSTCRAG_TAROT_ENABLED = "true";
    process.env.MYSTCRAG_ORACLE_ENABLED = "true";
    markup = renderToStaticMarkup(<HomePage />);
  } finally {
    if (previousTarot === undefined) delete process.env.MYSTCRAG_TAROT_ENABLED;
    else process.env.MYSTCRAG_TAROT_ENABLED = previousTarot;
    if (previousOracle === undefined) delete process.env.MYSTCRAG_ORACLE_ENABLED;
    else process.env.MYSTCRAG_ORACLE_ENABLED = previousOracle;
  }

  assert.equal((markup.match(/data-creation-path=/g) ?? []).length, 4);
  const entryKeysByPathId = { ai: "entryAi", oracle: "entryOracle", tarot: "entryTarot", diy: "entryDiy" } as const;
  for (const [pathId, assetKey] of Object.entries(entryKeysByPathId)) {
    const card = markup.match(new RegExp(`<article[^>]*data-creation-path="${pathId}"[^>]*>[\\s\\S]*?</article>`))?.[0];
    assert.ok(card, `missing ${pathId} creation card`);
    const asset = STAR_PLATFORM_ASSETS[assetKey as keyof typeof STAR_PLATFORM_ASSETS];
    assert.ok(assetSrcInMarkup(card, asset.src), `${pathId} card must render typed src ${asset.src}`);
    assert.ok(card.includes(asset.alt), `${pathId} card must render typed alt for ${assetKey}`);
    assert.doesNotMatch(card, /home(?:%2F|\/)entry-/, `${pathId} card must not fall back to frozen photography`);
  }
});

test("design results action bar stays opaque without glassmorphism", () => {
  const source = readSource("./components/design-results.tsx");
  const actionBarTag = source.match(/<div\b[^>]*data-results-action-bar="true"[^>]*>/)?.[0];
  assert.ok(actionBarTag, "sticky action bar must remain present");
  assert.doesNotMatch(actionBarTag, /bg-white\/\d+/);
  assert.doesNotMatch(actionBarTag, /backdrop-blur/);
  assert.match(actionBarTag, /bg-\[var\(--star-paper\)\]/);
  assert.doesNotMatch(source, /backdrop-blur/);
});

test("design result selection control keeps a square 44x44 target on both axes", () => {
  const source = readSource("./components/design-results.tsx");
  const selectionButton = source.match(/<button\b[^>]*aria-pressed=\{selected\}[^>]*>/)?.[0];
  assert.ok(selectionButton, "per-card selection button must remain present");
  // Precise contract: the control declares both axes itself at 2.75rem/44px so
  // the hit area is square. A CSS min-height floor alone stretched 32x32 into
  // an ellipse, which `rounded-full` then rendered as a distorted target.
  assert.match(selectionButton, /\bh-11\b/);
  assert.match(selectionButton, /\bw-11\b/);
  assert.doesNotMatch(selectionButton, /\bh-(4|5|6|7|8|9|10)\b/);
  assert.doesNotMatch(selectionButton, /\bw-(4|5|6|7|8|9|10)\b/);
  assert.match(selectionButton, /\bplace-items-center\b/);
  assert.match(selectionButton, /\brounded-full\b/);
  // The star surface still guarantees the 44px floor for every result action.
  const css = readSource("../../../app/styles/star-acquisition.css");
  assert.match(css, /\[data-star-surface="design-results"\] button[^{]*\{[^}]*min-height:\s*2\.75rem/s);
});

test("homepage capability grid is balanced at two, three and four cards with no orphan column", () => {
  const css = readSource("../../../app/styles/star-acquisition.css");
  assert.match(css, /\[data-creation-count="2"\]/);
  assert.match(css, /\[data-creation-count="3"\]/);
  assert.match(css, /\[data-creation-count="4"\]/);
  assert.match(css, /\[data-creation-count="2"\][\s\S]*?grid-template-columns:\s*repeat\(2/);
  assert.match(css, /\[data-creation-count="3"\][\s\S]*?grid-template-columns:\s*repeat\(3/);
  assert.match(css, /\[data-creation-count="4"\][\s\S]*?grid-template-columns:\s*repeat\(4/);
  // Cards must never rely on auto-fit alone, which leaves a hole at 2 or 3 items.
  assert.doesNotMatch(css, /\[data-creation-path-group\][^{]*\{[^}]*repeat\(auto-fit/);
});

test("questionnaire keeps one question per view under the star surface with sticky navigation", () => {
  const source = readSource("../questionnaire/components/questionnaire-wizard.tsx");
  assert.match(source, /data-star-surface="questionnaire"/);
  assert.match(source, /data-atelier-surface="questionnaire"/);
  assert.match(source, /data-questionnaire-stepper="true"/);
  assert.match(source, /data-star-step-panel|data-star-question-panel/);
  assert.match(source, /继续/);
  assert.match(source, /生成设计/);
  assert.match(source, /上一步/);
  // Sticky next action stays reachable on mobile.
  assert.match(source, /fixed inset-x-0 bottom-0/);
});

test("design results keep selection, sticky DIY entry and compliance under the star surface", () => {
  const source = readSource("./components/design-results.tsx");
  assert.match(source, /data-star-surface="design-results"/);
  assert.match(source, /data-atelier-surface="design-results"/);
  assert.match(source, /data-results-action-bar="true"/);
  assert.match(source, /data-results-layout="comparison-grid"/);
  assert.match(source, /进入 DIY 调整/);
  assert.match(source, /data-design-selected/);
  assert.match(source, /data-star-result-card|data-star-entry-card/);
});

test("design summary and compliance notice retain status, privacy and disclaimer semantics", () => {
  const summary = readSource("./components/design-summary.tsx");
  const compliance = readSource("./components/compliance-notice.tsx");
  assert.match(summary, /data-star-surface|data-star-design-summary/);
  assert.match(summary, /Private/);
  assert.match(compliance, /data-compliance-status/);
  assert.match(compliance, /CULTURAL_REFERENCE_NOT_SCIENTIFIC_EFFECT|DESIGN_INSPIRATION_ONLY/);
  assert.match(compliance, /文化意象仅作为设计灵感/);
  assert.match(compliance, /仅用于审美表达与设计灵感/);
  // No deterministic fortune, medical, or efficacy claims.
  for (const source of [summary, compliance]) {
    assert.doesNotMatch(source, /转运|招财|发财|保平安|辟邪|开光|加持|治愈|疗愈|旺|桃花|挽回|命定|注定|一定|必定|大师/);
    assert.doesNotMatch(source, /—|──/);
  }
});

test("star acquisition styles stay on the star token system without AI purple gradients or glass cards", () => {
  const css = readSource("../../../app/styles/star-acquisition.css");
  assert.match(css, /var\(--star-/);
  assert.match(css, /data-star-surface/);
  // No glassmorphism and no generic AI violet gradients.
  assert.doesNotMatch(css, /backdrop-filter:\s*blur/);
  assert.doesNotMatch(css, /(?:linear|radial)-gradient\([^)]*#(?:8b5cf6|a78bfa|7c3aed|6d28d9|c084fc)/i);
  assert.doesNotMatch(css, /(?:linear|radial)-gradient\([^)]*rgb\(\s*124\s+58\s+237/);
  // 44px interaction floor and reduced-motion support.
  assert.match(css, /min-height:\s*2\.75rem|min-height:\s*44px/);
  assert.match(css, /prefers-reduced-motion/);
  // Never tint photographic crystal imagery.
  assert.doesNotMatch(css, /filter:\s*(?:hue-rotate|sepia|saturate)\(/);
});

test("star acquisition scopes home, questionnaire and design results without unscoped layout rules", () => {
  const css = readSource("../../../app/styles/star-acquisition.css");
  assert.match(css, /\[data-star-surface="home"\]/);
  assert.match(css, /\[data-star-surface="questionnaire"\]/);
  assert.match(css, /\[data-star-surface="design-results"\]/);
  assert.match(css, /\[data-star-surface="tarot/);
  assert.match(css, /\[data-star-surface="oracle/);
  // 320px safety: horizontal overflow is clipped at the surface root.
  assert.match(css, /overflow-x:\s*(?:clip|hidden)/);
});
