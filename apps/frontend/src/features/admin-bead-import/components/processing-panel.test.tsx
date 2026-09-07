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
    previewFileId: null,
    hasApprovedTexture: false,
    publishReady: false,
    promotionRequired: false,
    stale: false,
    inFlight: false,
    failureMessage: null,
    ...overrides
  };
}

const SSR_PREVIEW = {
  client: {
    readSourceFileContent: async () => {
      throw new Error("no preview may load during SSR");
    },
    readProcessedAssetContent: async () => {
      throw new Error("no preview may load during SSR");
    }
  },
  objectUrls: {
    createObjectUrl: () => {
      throw new Error("no object url may exist during SSR");
    },
    revokeObjectUrl: () => {}
  }
};

function render(groups: ProcessingGroupCard[] = [group()], overrides: Partial<Parameters<typeof ProcessingPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <ProcessingPanel
      sessionState="NEEDS_REVIEW"
      groups={groups}
      preview={SSR_PREVIEW}
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

test("a current QC_FAILED version is read-only: status, issues and a reprocess path only", () => {
  const html = render([
    group({
      processedAssets: [
        {
          processedAssetId: "pa-failed",
          processingVersion: 2,
          state: "QC_FAILED",
          isCurrent: true,
          qcIssues: ["主体缺失"]
        }
      ]
    })
  ]);
  assert.ok(!html.includes("提交批准"), "a failed QC verdict can never be approved");
  assert.ok(!html.includes("提交拒绝"), "the acceptance gates review to the current QC_PENDING version");
  assert.ok(!html.includes("审核备注（必填）"), "no review form renders for a failed QC");
  assert.ok(html.includes("质检未通过"), "the state is still visible");
  assert.ok(html.includes("主体缺失"), "the QC issue must reach the operator");
  assert.ok(html.includes("重新处理"), "reprocessing stays available");
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

test("APPROVE and REJECT are only offered for the current QC_PENDING version", () => {
  const html = render([group()]);
  assert.ok(html.includes("提交批准"), "the current QC_PENDING version keeps its review form");
  assert.ok(html.includes(">拒绝"), "the reject toggle stays available for a current QC_PENDING version");
  assert.ok(html.includes("人工审核"));
});

test("an old version is read-only: no review form and no approval controls", () => {
  const html = render([
    group({
      processedAssets: [
        { processedAssetId: "pa-old", processingVersion: 1, state: "QC_PENDING", isCurrent: false, qcIssues: [] }
      ]
    })
  ]);
  assert.ok(!html.includes("提交批准"), "an old version must never be approvable");
  assert.ok(!html.includes("提交拒绝"), "an old version must never be rejectable");
  assert.ok(html.includes("待人工审核"), "the state is still visible");
  assert.ok(html.includes("设为当前版本"), "an old version can still be selected");
});

test("the review form never names a rejected-QC or superseded version", () => {
  const html = render([
    group({
      processedAssets: [
        {
          processedAssetId: "pa-failed",
          processingVersion: 2,
          state: "QC_FAILED",
          isCurrent: true,
          qcIssues: ["主体缺失"]
        },
        {
          processedAssetId: "pa-old",
          processingVersion: 1,
          state: "QC_PENDING",
          isCurrent: false,
          qcIssues: []
        }
      ]
    })
  ]);
  assert.ok(!html.includes("提交批准"));
  assert.ok(!html.includes("提交拒绝"));
  assert.ok(html.includes("主体缺失"));
  assert.ok(html.includes("待人工审核"), "the old version's state stays visible as text");
});

test("the source never offers review actions for a version the session marks retired or draft", () => {
  const html = render([
    group({
      processedAssets: [
        { processedAssetId: "pa-draft", processingVersion: 3, state: "DRAFT", isCurrent: true, qcIssues: [] },
        { processedAssetId: "pa-retired", processingVersion: 2, state: "RETIRED", isCurrent: false, qcIssues: [] }
      ]
    })
  ]);
  assert.ok(!html.includes("提交批准"));
  assert.ok(!html.includes("提交拒绝"));
});

test("initial render makes no preview request: previews stay collapsed until asked", () => {
  const html = render([group(), group({ groupId: "group-2", crystalName: "紫水晶" })]);
  assert.ok(html.includes("加载预览"), "the operator must see the on-demand affordance");
  assert.ok(!html.includes("正在加载预览"), "no preview is fetched before the operator asks");
  assert.ok(!html.includes("处理主图") && !html.includes("缩略图"), "no preview is mounted");
});

test("expanding one group loads exactly that group's previews and nothing else", () => {
  const html = render(
    [
      group({ previewFileId: "file-primary" }),
      group({ groupId: "group-2", crystalName: "紫水晶" })
    ],
    { expandedPreviewGroupId: "group-1" }
  );
  assert.ok(html.includes("原图"));
  assert.ok(html.includes("处理主图"));
  assert.ok(html.includes("缩略图"));
  assert.ok(
    (html.match(/正在加载预览/g) ?? []).length === 3,
    "exactly the expanded group's three previews load"
  );
  assert.equal(
    (html.match(/收起预览/g) ?? []).length,
    1,
    "exactly one group is expanded at a time"
  );
  assert.ok(
    html.includes("预览按需加载"),
    "the other group stays collapsed with its own affordance"
  );
});

test("the publish action demands two explicit operator confirmations", () => {
  const html = render([
    group({ publishReady: true, hasApprovedTexture: true, promotionRequired: true })
  ]);
  assert.ok(html.includes("我确认使用该珠子名称发布"), "the name confirmation is explicit");
  assert.ok(
    html.includes("我确认将该水晶资料草稿提升为正式水晶"),
    "the promotion confirmation is explicit and default-unselected"
  );
  assert.match(html, /disabled[^>]*>确认并发布/, "an unconfirmed publish cannot be sent");
});
