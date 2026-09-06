import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProcessingPanel, type ProcessingGroupCard } from "./processing-panel";

const SOURCE = readFileSync(join(__dirname, "processing-panel.tsx"), "utf8");

const FORBIDDEN_CLAIMS = ["功效", "疗效", "治疗", "保证", "转运", "招财", "辟邪", "旺财", "命理"];
const FORBIDDEN_LEAKS = ["archiveKey", "storageKey", "x-admin-key", "127.0.0.1", "localhost", "/Users/", "approved:"];

function group(overrides: Partial<ProcessingGroupCard> = {}): ProcessingGroupCard {
  return {
    groupId: "group-1",
    crystalName: "白水晶",
    state: "PROCESSED",
    revision: 5,
    processedAssets: [
      { processedAssetId: "pa-1", processingVersion: 1, state: "QC_PENDING", isCurrent: true, qcIssues: [] },
      { processedAssetId: "pa-2", processingVersion: 2, state: "QC_FAILED", isCurrent: false, qcIssues: ["主体缺失"] }
    ],
    stale: false,
    inFlight: false,
    failureMessage: null,
    ...overrides
  };
}

function render(groups: ProcessingGroupCard[] = [group()], overrides: Partial<Parameters<typeof ProcessingPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <ProcessingPanel
      sessionState="NEEDS_REVIEW"
      groups={groups}
      canStartProcessing={false}
      processingInFlight={false}
      locked={false}
      blockedByConflict={false}
      conflictMessage=""
      publishBlockers={[]}
      onStartProcessing={() => {}}
      onReprocess={() => {}}
      onSelectVersion={() => {}}
      onReview={() => {}}
      onAcknowledgeConflict={() => {}}
      {...overrides}
    />
  );
}

test("QC state is shown as text, never only as color", () => {
  const html = render();
  assert.ok(html.includes("待人工审核"));
  assert.ok(html.includes("质检未通过"));
  assert.ok(html.includes("主体缺失"), "the QC issue must reach the operator");
  assert.ok(html.includes("当前版本"));
});

test("a QC_FAILED asset can be rejected but never approved", () => {
  const html = render();
  assert.ok(html.includes("批准"));
  assert.ok(html.includes("拒绝"));
  assert.ok(html.includes("审核备注（必填）"));
  assert.ok(html.includes("提交拒绝"));
});

test("an approval demands the full human consent surface", () => {
  const html = render();
  assert.ok(html.includes("权利持有人（必填）"));
  assert.ok(html.includes("使用授权"));
  assert.ok(html.includes("这些照片是实拍，未由图像生成或合成"));
  assert.ok(html.includes("允许用于 AI 训练"));
  assert.ok(html.includes("允许商业用途"));
  assert.ok(html.includes("允许公开展示"));
  assert.ok(html.includes("允许用于 AI 推荐"));
  assert.ok(html.includes("提交批准"));
});

test("reprocess and version selection are offered and bounded", () => {
  const html = render();
  assert.ok(html.includes("maskThreshold（0–1，可留空）"));
  assert.ok(html.includes("edgeFeatherPx（0–8，可留空）"));
  assert.ok(html.includes("提交重新处理"));
  assert.ok(html.includes("设为当前版本"));
});

test("start processing and publish blockers surface honestly", () => {
  const html = render([group()], {
    canStartProcessing: true,
    publishBlockers: ["贴图素材尚未由服务端写入，控制台无法代为填写。"]
  });
  assert.ok(html.includes("启动处理"));
  assert.ok(html.includes("发布前仍待满足"));
  assert.ok(html.includes("贴图素材尚未由服务端写入"));
});

test("the panel never invents a QC verdict, an approved key or an effect", () => {
  const html = render();
  for (const claim of FORBIDDEN_CLAIMS) {
    assert.ok(!html.includes(claim), `the processing step must not mention ${claim}`);
  }
  for (const leak of FORBIDDEN_LEAKS) {
    assert.ok(!html.includes(leak), `the processing step must not mention ${leak}`);
  }
  assert.equal(SOURCE.includes("approved:"), false, "an approved key must never be assembled here");
  for (const forbidden of ["fetch(", "process.env", "localStorage"]) {
    assert.equal(SOURCE.includes(forbidden), false, `the panel must not reach for ${forbidden}`);
  }
});
