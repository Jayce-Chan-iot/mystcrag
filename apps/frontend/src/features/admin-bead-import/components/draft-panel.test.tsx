import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { emptyCurationForm, emptyProductDraftForm } from "../draft-form";
import { DraftPanel, type DraftGroupCard } from "./draft-panel";

const SOURCE = readFileSync(join(__dirname, "draft-panel.tsx"), "utf8");

const FORBIDDEN_CLAIMS = ["功效", "疗效", "治疗", "保证", "转运", "招财", "辟邪", "旺财", "命理"];
const FORBIDDEN_LEAKS = ["archiveKey", "storageKey", "x-admin-key", "127.0.0.1", "localhost", "/Users/"];

function card(overrides: Partial<DraftGroupCard> = {}): DraftGroupCard {
  return {
    groupId: "group-1",
    crystalName: "白水晶",
    state: "NAMED",
    productForm: emptyProductDraftForm(),
    productDirty: false,
    canSubmitProduct: true,
    completeness: null,
    completenessCurrent: false,
    crystalDraft: {
      crystalDraftId: "crystal-1",
      curationComplete: false,
      promotionEligible: false,
      missingFields: [],
      form: emptyCurationForm(),
      dirty: false,
      canSubmit: true,
      stale: false,
      inFlight: false
    },
    stale: false,
    inFlightProduct: false,
    failureMessage: null,
    curationFailureMessage: null,
    ...overrides
  };
}

function render(cards: DraftGroupCard[] = [card()], overrides: Partial<Parameters<typeof DraftPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <DraftPanel
      cards={cards}
      locked={false}
      blockedByConflict={false}
      conflictMessage=""
      onProductPatch={() => {}}
      onResetProduct={() => {}}
      onSaveProduct={() => {}}
      onCheckCompleteness={() => {}}
      onCurationPatch={() => {}}
      onResetCuration={() => {}}
      onSaveCuration={() => {}}
      onAcknowledgeConflict={() => {}}
      {...overrides}
    />
  );
}

test("the naming step renders the full product draft form with human-filled fields", () => {
  const html = render();
  assert.ok(html.includes("命名与草稿"));
  assert.ok(html.includes("商品名称"));
  assert.ok(html.includes("SKU 编码"));
  assert.ok(html.includes("珠子形状"));
  assert.ok(html.includes("结算币种"));
  assert.ok(html.includes("使用授权"));
  assert.ok(html.includes("权利与授权决定"));
  assert.ok(html.includes("这些照片是实拍"));
  assert.ok(html.includes("保存草稿"));
  assert.ok(html.includes("核对完整性"));
});

test("the curation form lists the eight human fields once a crystal draft exists", () => {
  const html = render();
  assert.ok(html.includes("水晶资料（八项，人工填写）"));
  assert.ok(html.includes("中文名"));
  assert.ok(html.includes("矿物学名称"));
  assert.ok(html.includes("颜色标签"));
  assert.ok(html.includes("价格档位（1 到 5）"));
  assert.ok(html.includes("保存水晶资料"));
});

test("a group without a crystal draft explains instead of inventing one", () => {
  const html = render([card({ crystalDraft: null })]);
  assert.ok(html.includes("保存商品草稿后，服务端会建立水晶资料草稿"));
});

test("the panel never infers identity or effect from a file or image", () => {
  const html = render();
  for (const claim of FORBIDDEN_CLAIMS) {
    assert.ok(!html.includes(claim), `the naming step must not mention ${claim}`);
  }
  for (const leak of FORBIDDEN_LEAKS) {
    assert.ok(!html.includes(leak), `the naming step must not mention ${leak}`);
  }
  for (const forbidden of ["fetch(", "process.env", "localStorage"]) {
    assert.equal(SOURCE.includes(forbidden), false, `the panel must not reach for ${forbidden}`);
  }
});
