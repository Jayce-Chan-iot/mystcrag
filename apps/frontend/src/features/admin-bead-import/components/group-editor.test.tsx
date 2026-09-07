import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  AssetImportSessionFileView,
  AssetImportSessionGroupView
} from "@mystcrag/design-contract";

import { CONFLICT_NOTICE_MESSAGE } from "../workflow-state";

import {
  GroupEditor,
  groupCardsOf,
  type GroupEditorProps,
  type GroupEditorSelection
} from "./group-editor";

const SOURCE = readFileSync(join(__dirname, "group-editor.tsx"), "utf8");

const FORBIDDEN_LEAKS = [
  "archiveKey",
  "storageKey",
  "x-admin-key",
  "MYSTCRAG_ASSET_ADMIN_KEY",
  "ASSET_ADMIN_API_KEY",
  "MYSTCRAG_BACKEND_ORIGIN",
  "127.0.0.1",
  "localhost",
  "/Users/",
  "C:\\",
  "prisma",
  "postgres",
  "process.env",
  "document.cookie",
  "localStorage",
  "sessionStorage"
];

/** Copy that would claim a health effect, a guarantee or a fixed fortune. */
const FORBIDDEN_CLAIMS = ["治疗", "疗愈", "疗效", "招财", "转运", "辟邪", "保证", "一定能", "必定", "功效"];

/** Copy that would pretend a crystal identity was read off the files. */
const FORBIDDEN_INFERENCE = ["自动识别", "推荐名称", "已为你推断", "根据文件名", "根据文件夹"];

const SERVICE_FAILURE = "珠子素材导入服务暂时不可用，请稍后重试。";

function makeGroup(overrides: Partial<AssetImportSessionGroupView> = {}): AssetImportSessionGroupView {
  return {
    groupId: "group-1",
    state: "SUGGESTED",
    memberFileIds: ["file-1", "file-2"],
    primaryFileId: "file-1",
    revision: 3,
    processedAssets: [],
    crystalDraft: null,
    productDraft: null,
    ...overrides
  };
}

const FILES: AssetImportSessionFileView[] = [
  {
    fileId: "file-1",
    clientFileId: "client-file-1",
    relativePath: "batch-01/bead-01.jpg",
    kind: "JPEG",
    state: "ARCHIVED",
    byteSize: 2048
  },
  {
    fileId: "file-2",
    clientFileId: "client-file-2",
    relativePath: "batch-01/bead-02.png",
    kind: "PNG",
    state: "ARCHIVED",
    byteSize: 4096
  }
];

const EMPTY_SELECTION: GroupEditorSelection = {
  groupIds: [],
  fileIdsByGroup: {},
  moveTargetGroupId: null,
  ignoreReason: ""
};

const TWO_GROUPS = [makeGroup(), makeGroup({ groupId: "group-2" })];

function render(overrides: Partial<GroupEditorProps> = {}): string {
  return renderToStaticMarkup(
    <GroupEditor
      groups={groupCardsOf([makeGroup()], FILES, {}, {})}
      selection={EMPTY_SELECTION}
      locked={false}
      blockedByConflict={false}
      staleGroupIds={[]}
      inFlightGroupIds={[]}
      conflictMessage={CONFLICT_NOTICE_MESSAGE}
      onSelectionChange={() => {}}
      onNameChange={() => {}}
      onDiscardName={() => {}}
      onSubmitName={() => {}}
      onSetPrimary={() => {}}
      onIgnoreFiles={() => {}}
      onMoveFiles={() => {}}
      onSplitGroup={() => {}}
      onMergeGroups={() => {}}
      onAcknowledgeConflict={() => {}}
      {...overrides}
    />
  );
}

function countOf(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

/** The whole element tag that carries `anchor`, so an assertion reads one control. */
function tagOf(markup: string, anchor: string): string {
  const at = markup.indexOf(anchor);
  assert.ok(at >= 0, `the markup must contain ${anchor}`);
  return markup.slice(markup.lastIndexOf("<", at), markup.indexOf(">", at) + 1);
}

function controlOf(markup: string, label: string, open = "<button"): string {
  const at = markup.indexOf(label);
  assert.ok(at >= 0, `the markup must contain ${label}`);
  const start = markup.lastIndexOf(open, at);
  assert.ok(start >= 0, `${label} must sit inside a ${open}`);
  return markup.slice(start, markup.indexOf(">", start) + 1);
}

function isDisabled(markup: string, label: string): boolean {
  return controlOf(markup, label).includes('disabled=""');
}

function assertClean(markup: string, label: string): void {
  for (const forbidden of [...FORBIDDEN_LEAKS, ...FORBIDDEN_CLAIMS, ...FORBIDDEN_INFERENCE]) {
    assert.equal(markup.includes(forbidden), false, `${label} must not mention ${forbidden}`);
  }
}

test("every group is rendered as its own card with its authoritative state", () => {
  const markup = render({
    groups: groupCardsOf(TWO_GROUPS, FILES, {}, {}),
    selection: { ...EMPTY_SELECTION, groupIds: [] }
  });
  const named = render({
    groups: groupCardsOf([makeGroup({ groupId: "group-2", crystalName: "白水晶", revision: 7 })], FILES, {}, {})
  });

  assert.equal(countOf(markup, "<article"), 2);
  assert.ok(markup.includes("bead-import-group-group-1-heading"));
  assert.ok(markup.includes("bead-import-group-group-2-heading"));
  assert.ok(markup.includes("未命名分组"), "an unnamed group says so instead of guessing");
  assert.ok(named.includes("白水晶"));
  assert.ok(markup.includes("batch-01/bead-01.jpg"));
  assert.ok(markup.includes("batch-01/bead-02.png"));
  assert.ok(markup.includes("2 MB") || markup.includes("KB"), "a file row states its declared size");
  assertClean(markup, "the group cards");
});

test("the name field is labelled, required and never presented as a suggestion", () => {
  const markup = render();
  const nameId = "bead-import-group-group-1-name";

  assert.ok(markup.includes(`for="${nameId}"`), "the name input must have a label");
  const input = tagOf(markup, `id="${nameId}"`);
  assert.ok(input.includes('aria-required="true"'));
  assert.ok(input.includes("required"));
  assert.ok(
    /max(?:length|Length)="120"/.test(input),
    "the contract caps the name at 120 characters"
  );
  assert.ok(input.includes('disabled=""') === false);
  assert.ok(markup.includes("人工填写"));
  assertClean(markup, "the name field");
});

test("the editor counts the groups that still need a human name", () => {
  const unnamed = render({
    groups: groupCardsOf(
      [makeGroup(), makeGroup({ groupId: "group-2", crystalName: "白水晶" })],
      FILES,
      {},
      {}
    )
  });
  assert.ok(unnamed.includes("1 个分组尚未命名"));

  const allNamed = render({
    groups: groupCardsOf([makeGroup({ crystalName: "紫水晶" })], FILES, {}, {})
  });
  assert.ok(allNamed.includes("所有分组均已命名"));
});

test("a locally edited name is shown as unsaved and can be discarded", () => {
  const markup = render({ groups: groupCardsOf([makeGroup()], FILES, { "group-1": "紫水晶" }, {}) });

  assert.ok(tagOf(markup, 'id="bead-import-group-group-1-name"').includes('value="紫水晶"'));
  assert.ok(markup.includes("未保存"));
  assert.equal(isDisabled(markup, ">放弃修改<"), false);
  assert.equal(isDisabled(markup, ">保存名称<"), false);
});

test("a group with no unsaved name cannot discard anything", () => {
  const markup = render();
  assert.equal(isDisabled(markup, ">放弃修改<"), true);
});

test("a locked session turns every control into read-only copy", () => {
  const markup = render({ locked: true });

  assert.ok(markup.includes("分组仅供查看"));
  assert.ok(markup.includes('role="status"'));
  assert.ok(tagOf(markup, 'id="bead-import-group-group-1-name"').includes('disabled=""'));
  assert.ok(markup.includes("<fieldset"), "file controls sit in a fieldset that can be disabled");
  assert.ok(tagOf(markup, "<fieldset").includes('disabled=""'));
  assert.equal(isDisabled(markup, ">保存名称<"), true);
  assert.equal(isDisabled(markup, ">合并所选分组<"), true);
});

test("a revision conflict states the fixed copy and offers one way back", () => {
  const markup = render({ blockedByConflict: true });

  assert.ok(markup.includes('id="bead-import-group-conflict"'));
  assert.ok(tagOf(markup, 'id="bead-import-group-conflict"').includes('role="alert"'));
  assert.ok(markup.includes(CONFLICT_NOTICE_MESSAGE));
  assert.ok(markup.includes("我已确认最新数据"));
  assert.equal(countOf(markup, ">合并所选分组<"), 1);
  assert.equal(isDisabled(markup, ">合并所选分组<"), true);
  assert.equal(isDisabled(markup, ">保存名称<"), true, "a conflict stops every local submission");
  assert.equal(isDisabled(markup, ">忽略所选文件<"), true);
});

test("without a conflict the same controls are usable", () => {
  const markup = render({ groups: groupCardsOf([makeGroup()], FILES, { "group-1": "紫水晶" }, {}) });
  assert.equal(markup.includes('id="bead-import-group-conflict"'), false);
  assert.equal(isDisabled(markup, ">保存名称<"), false);
});

test("a stale or in-flight group is announced in words, not colour alone", () => {
  const stale = render({ staleGroupIds: ["group-1"] });
  assert.ok(stale.includes("服务端已更新"));

  const inFlight = render({ inFlightGroupIds: ["group-1"] });
  assert.ok(inFlight.includes("提交中"));
  assert.ok(inFlight.includes('aria-busy="true"'));
  assert.equal(isDisabled(inFlight, ">保存名称<"), true);
});

test("a group failure is reported against that group only", () => {
  const markup = render({
    groups: groupCardsOf([makeGroup({ crystalName: "紫水晶" })], FILES, {}, { "group-1": SERVICE_FAILURE })
  });

  assert.ok(tagOf(markup, SERVICE_FAILURE).includes('role="alert"'));
  assert.equal(isDisabled(markup, ">保存名称<"), false, "a past failure must not block a retry");
  assertClean(markup, "a group failure notice");
});

test("merging needs two groups and says how many are selected", () => {
  const groups = groupCardsOf(TWO_GROUPS, FILES, {}, {});

  const none = render({ groups });
  assert.ok(none.includes("已选择 0 个分组"));
  assert.ok(none.includes("至少选择 2 个"));
  assert.equal(isDisabled(none, ">合并所选分组<"), true);

  const two = render({ groups, selection: { ...EMPTY_SELECTION, groupIds: ["group-1", "group-2"] } });
  assert.ok(two.includes("已选择 2 个分组"));
  assert.equal(isDisabled(two, ">合并所选分组<"), false);
});

test("splitting keeps at least one file in the original group", () => {
  const groups = groupCardsOf([makeGroup()], FILES, {}, {});

  assert.equal(isDisabled(render({ groups }), ">拆分为新分组<"), true);

  const one = render({ groups, selection: { ...EMPTY_SELECTION, fileIdsByGroup: { "group-1": ["file-2"] } } });
  assert.equal(isDisabled(one, ">拆分为新分组<"), false);

  const all = render({
    groups,
    selection: { ...EMPTY_SELECTION, fileIdsByGroup: { "group-1": ["file-1", "file-2"] } }
  });
  assert.equal(isDisabled(all, ">拆分为新分组<"), true);
  assert.ok(all.includes("原分组至少保留一个文件"));
});

test("moving needs a target group and at least one file", () => {
  const groups = groupCardsOf(TWO_GROUPS, FILES, {}, {});

  const noTarget = render({
    groups,
    selection: { ...EMPTY_SELECTION, fileIdsByGroup: { "group-1": ["file-2"] } }
  });
  assert.ok(noTarget.includes('for="bead-import-group-group-1-move-target"'));
  assert.equal(isDisabled(noTarget, ">移动所选文件<"), true);

  const withTarget = render({
    groups,
    selection: { ...EMPTY_SELECTION, fileIdsByGroup: { "group-1": ["file-2"] }, moveTargetGroupId: "group-2" }
  });
  assert.equal(isDisabled(withTarget, ">移动所选文件<"), false);
  const targetAnchor = 'id="bead-import-group-group-1-move-target"';
  const from = withTarget.indexOf(targetAnchor);
  assert.ok(from >= 0, "the move target select must be labelled");
  const selectMarkup = withTarget.slice(from, withTarget.indexOf("</select>", from));
  assert.equal(
    selectMarkup.includes('value="group-1"'),
    false,
    "a group must never offer itself as a move target"
  );
  assert.ok(selectMarkup.includes('value="group-2"'));
});

test("ignoring files needs a reason an operator typed", () => {
  const groups = groupCardsOf([makeGroup()], FILES, {}, {});

  const noReason = render({
    groups,
    selection: { ...EMPTY_SELECTION, fileIdsByGroup: { "group-1": ["file-2"] } }
  });
  assert.ok(noReason.includes('for="bead-import-group-group-1-ignore-reason"'));
  assert.equal(isDisabled(noReason, ">忽略所选文件<"), true);

  const withReason = render({
    groups,
    selection: { ...EMPTY_SELECTION, fileIdsByGroup: { "group-1": ["file-2"] }, ignoreReason: "重复拍摄" }
  });
  assert.equal(isDisabled(withReason, ">忽略所选文件<"), false);
  assert.ok(tagOf(withReason, 'id="bead-import-group-group-1-ignore-reason"').includes('value="重复拍摄"'));
});

test("the current primary is named rather than offered again", () => {
  const markup = render();

  assert.ok(markup.includes("当前主图"));
  assert.ok(markup.includes('aria-label="将 batch-01/bead-02.png 设为主图"'));
  const primaryTag = controlOf(markup, ">当前主图<");
  assert.ok(primaryTag.includes('disabled=""'));
  assert.ok(primaryTag.includes('aria-current="true"'));
  assert.equal(isDisabled(markup, 'aria-label="将 batch-01/bead-02.png 设为主图"'), false);
});

test("an empty session explains what has to happen first", () => {
  const markup = render({ groups: [] });

  assert.ok(markup.includes("还没有分组"));
  assert.equal(markup.includes("<article"), false);
  assertClean(markup, "the empty group editor");
});

test("no interactive element is a plain container, so a keyboard reaches everything", () => {
  assert.equal(/<(div|span|p|li|ul|article|header|footer)[^>]*\sonClick=/.test(SOURCE), false);
  assert.equal(/<(div|span|p|li|ul|article|header|footer)[^>]*\stabIndex=/.test(SOURCE), false);
  for (const handler of [
    "onNameChange(",
    "onSubmitName(",
    "onDiscardName(",
    "onSetPrimary(",
    "onIgnoreFiles(",
    "onMoveFiles(",
    "onSplitGroup(",
    "onMergeGroups(",
    "onAcknowledgeConflict(",
    "onSelectionChange("
  ]) {
    assert.ok(SOURCE.includes(handler), `the view must wire ${handler}`);
  }
});

test("the view is presentational and holds no transport of its own", () => {
  assert.equal(SOURCE.startsWith('"use client"'), false);
  for (const forbidden of ["fetch(", "XMLHttpRequest"]) {
    assert.equal(SOURCE.includes(forbidden), false, `the view must not reach for ${forbidden}`);
  }
  for (const forbidden of FORBIDDEN_LEAKS) {
    assert.equal(SOURCE.includes(forbidden), false, `the view must not mention ${forbidden}`);
  }
  for (const claim of [...FORBIDDEN_CLAIMS, ...FORBIDDEN_INFERENCE]) {
    assert.equal(SOURCE.includes(claim), false, `the view must not claim ${claim}`);
  }
  assert.ok(SOURCE.includes("./control-styles"), "the view shares the admin control tokens");
  assert.ok(SOURCE.includes("formatByteSize"));
});

test("the layout survives a 390px viewport without horizontal overflow", () => {
  assert.equal(SOURCE.includes("<table"), false);
  assert.ok(SOURCE.includes("min-w-0"));
  assert.ok(SOURCE.includes("break-all"));
  assert.ok(SOURCE.includes("flex-col"));
  for (const match of SOURCE.matchAll(/w-\[(\d+)px\]/g)) {
    assert.ok(Number(match[1]) <= 320, `a fixed width of ${match[1]}px overflows a phone`);
  }
  for (const animation of ["animate-spin", "animate-bounce", "animate-ping"]) {
    assert.equal(SOURCE.includes(animation), false);
  }
});

test("group cards are derived from the session and never from a local guess", () => {
  const cards = groupCardsOf(
    [makeGroup({ crystalName: "紫水晶", memberFileIds: ["file-2"], primaryFileId: "file-2" })],
    FILES,
    { "group-1": "本地未保存的名字" },
    {}
  );

  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.ok(card !== undefined);
  assert.equal(card.groupId, "group-1");
  assert.equal(card.crystalName, "紫水晶");
  assert.equal(card.localCrystalName, "本地未保存的名字");
  assert.equal(card.revision, 3);
  assert.equal(card.primaryFileId, "file-2");
  assert.deepEqual(
    card.files.map((file) => file.fileId),
    ["file-2"],
    "only the files the Backend lists in the group are shown"
  );
  assert.equal(card.files[0]?.isPrimary, true);
  assert.equal(card.failureMessage, null);
});

test("a card whose member list names an unknown file drops it instead of inventing a row", () => {
  const cards = groupCardsOf([makeGroup({ memberFileIds: ["file-1", "file-missing"] })], FILES, {}, {});
  assert.deepEqual(
    cards[0]?.files.map((file) => file.fileId),
    ["file-1"]
  );
});

test("a failure message is attached to the group it belongs to", () => {
  const cards = groupCardsOf(TWO_GROUPS, FILES, {}, { "group-2": SERVICE_FAILURE });
  assert.equal(cards[0]?.failureMessage, null);
  assert.equal(cards[1]?.failureMessage, SERVICE_FAILURE);
});
