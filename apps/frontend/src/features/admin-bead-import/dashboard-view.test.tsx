import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ASSET_IMPORT_SESSION_STATES, type AssetImportSessionSummary } from "@mystcrag/design-contract";

import {
  DASHBOARD_BUCKETS,
  DASHBOARD_BUCKET_LABELS,
  DASHBOARD_DEFAULT_LIMIT,
  SESSION_STATE_FILTERS,
  initialDashboardState,
  type DashboardState
} from "./dashboard-model";
import { DashboardView } from "./components/dashboard-view";

const FORBIDDEN_LEAKS = [
  "archiveKey",
  "asset-archive",
  "x-admin-key",
  "MYSTCRAG_ASSET_ADMIN_KEY",
  "ASSET_ADMIN_API_KEY",
  "MYSTCRAG_BACKEND_ORIGIN",
  "127.0.0.1",
  "localhost",
  "/Users/",
  "C:\\",
  "prisma",
  "postgres"
];

const FORBIDDEN_CLAIMS = ["功效", "疗效", "治疗", "保证", "转运", "招财", "辟邪"];

function makeSummary(overrides: Partial<AssetImportSessionSummary> = {}): AssetImportSessionSummary {
  return {
    sessionId: "session-1",
    state: "CREATED",
    lastVerifiedCheckpoint: null,
    declaredFileCount: 12,
    archivedFileCount: 12,
    failedFileCount: 0,
    groupCount: 3,
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:05:00.000Z",
    ...overrides
  };
}

function render(overrides: Partial<DashboardState> = {}): string {
  const state: DashboardState = { ...initialDashboardState(), ...overrides };
  return renderToStaticMarkup(
    <DashboardView
      state={state}
      onCreate={() => {}}
      onRetry={() => {}}
      onLoadMore={() => {}}
      onFilterChange={() => {}}
    />
  );
}

function assertNoLeaks(markup: string): void {
  for (const forbidden of FORBIDDEN_LEAKS) {
    assert.ok(!markup.includes(forbidden), `dashboard markup must not contain ${forbidden}`);
  }
  for (const forbidden of FORBIDDEN_CLAIMS) {
    assert.ok(!markup.includes(forbidden), `dashboard markup must not promise ${forbidden}`);
  }
}

test("the dashboard names itself and offers exactly one create entry", () => {
  const markup = render();
  assert.match(markup, /<h2[^>]*id="bead-import-dashboard-heading"[^>]*>导入任务<\/h2>/);
  assert.match(markup, /aria-labelledby="bead-import-dashboard-heading"/);
  const createButtons = markup.match(/新建导入|正在创建导入任务/g) ?? [];
  assert.equal(createButtons.length, 1);
  assert.match(markup, /<button[^>]*type="button"[^>]*>新建导入<\/button>/);
  assertNoLeaks(markup);
});

test("every bucket is visible with its count even when empty", () => {
  const markup = render({
    status: "READY",
    sessions: [
      makeSummary({ sessionId: "s-1", state: "UPLOADING" }),
      makeSummary({ sessionId: "s-2", state: "PUBLISHED", lastVerifiedCheckpoint: "PUBLISHED" })
    ]
  });
  for (const bucket of DASHBOARD_BUCKETS) {
    assert.ok(markup.includes(DASHBOARD_BUCKET_LABELS[bucket].title), `${bucket} title must render`);
    assert.ok(markup.includes(DASHBOARD_BUCKET_LABELS[bucket].hint), `${bucket} hint must render`);
  }
  assert.match(markup, /aria-labelledby="bead-import-bucket-IN_FLIGHT-title"/);
  assert.match(markup, /id="bead-import-bucket-IN_FLIGHT-count"[^>]*>1</);
  assert.match(markup, /id="bead-import-bucket-PUBLISHED-count"[^>]*>1</);
  assert.match(markup, /id="bead-import-bucket-AWAITING_NAMES-count"[^>]*>0</);
});

test("the state filter is a labelled select covering every contract state", () => {
  const markup = render({ filter: "NEEDS_REVIEW" });
  assert.match(markup, /<label[^>]*for="bead-import-state-filter"[^>]*>按状态筛选<\/label>/);
  assert.match(
    markup,
    /<select[^>]*id="bead-import-state-filter"[^>]*value="NEEDS_REVIEW"|<select[^>]*id="bead-import-state-filter"/
  );
  const options = markup.match(/<option[^>]*value="([A-Z_]+)"/g) ?? [];
  assert.equal(options.length, SESSION_STATE_FILTERS.length);
  for (const state of ASSET_IMPORT_SESSION_STATES) {
    assert.ok(markup.includes(`value="${state}"`), `filter must offer ${state}`);
  }
  assert.ok(markup.includes('value="ALL"'));
});

test("loading is announced as a live status and renders no invented rows", () => {
  for (const status of ["IDLE", "LOADING"] as const) {
    const markup = render({ status, sessions: [] });
    assert.match(markup, /role="status"/);
    assert.match(markup, /正在载入导入任务/);
    assert.match(markup, /aria-busy="true"/);
    assert.ok(!markup.includes("session-1"), "a loading dashboard must not show placeholder sessions");
  }
});

test("loading more keeps the visible rows and disables the pagination button", () => {
  const markup = render({
    status: "LOADING_MORE",
    sessions: [makeSummary({ sessionId: "s-1" })],
    nextCursor: "s-1"
  });
  assert.ok(markup.includes("s-1"));
  assert.match(markup, /<button[^>]*disabled=""[^>]*>正在载入更多任务…<\/button>/);
});

test("pagination appears only while a cursor exists", () => {
  const withCursor = render({ status: "READY", sessions: [makeSummary()], nextCursor: "session-1" });
  assert.match(withCursor, /<button[^>]*type="button"[^>]*>加载更多<\/button>/);
  const withoutCursor = render({ status: "READY", sessions: [makeSummary()], nextCursor: null });
  assert.ok(!withoutCursor.includes("加载更多"));
  assert.ok(!withoutCursor.includes("正在载入更多任务"));
});

test("an empty result says so plainly instead of rendering nothing", () => {
  const markup = render({ status: "READY", sessions: [], syncedAt: "2026-09-06T09:00:00.000Z" });
  assert.match(markup, /还没有导入任务/);
  assert.match(markup, /新建导入/);
  assert.match(markup, /最近同步/);
});

test("a retryable outage keeps the last page and offers a retry", () => {
  const markup = render({
    status: "ERROR",
    sessions: [makeSummary({ sessionId: "s-1" })],
    error: { code: "NETWORK_ERROR", message: "无法连接珠子素材导入服务，请稍后重试。", retryable: true }
  });
  assert.match(markup, /<div[^>]*id="bead-import-dashboard-error"[^>]*role="alert"[^>]*tabindex="-1"|role="alert"[^>]*id="bead-import-dashboard-error"/);
  assert.ok(markup.includes("无法连接珠子素材导入服务"));
  assert.match(markup, /<button[^>]*type="button"[^>]*>重试<\/button>/);
  assert.ok(markup.includes("s-1"), "the last known page must stay visible during an outage");
  assert.match(markup, /aria-describedby="bead-import-dashboard-error"/);
  assertNoLeaks(markup);
});

test("a non retryable failure explains itself without a retry button", () => {
  const markup = render({
    status: "ERROR",
    error: { code: "CONTRACT_VIOLATION", message: "服务返回的数据不符合契约。", retryable: false }
  });
  assert.ok(markup.includes("服务返回的数据不符合契约。"));
  assert.ok(!markup.includes(">重试<"));
});

test("a lost admin session points at the standalone login instead of retrying", () => {
  const markup = render({
    status: "UNAUTHORIZED",
    error: { code: "UNAUTHORIZED", message: "管理员会话已失效，请重新登录。", retryable: false }
  });
  assert.match(markup, /role="alert"/);
  assert.ok(markup.includes("管理员会话已失效"));
  assert.match(markup, /<a[^>]*href="\/admin\/bead-import\/login"[^>]*>重新登录<\/a>/);
  assert.ok(!markup.includes(">重试<"));
  assertNoLeaks(markup);
});

test("a pending session is announced while the console navigates to it", () => {
  const markup = render({ creating: false, pendingSessionId: "session-9" });
  assert.match(markup, /role="status"/);
  assert.ok(markup.includes("导入任务已创建"));
});

test("creating disables the create button and marks it busy", () => {
  const markup = render({ creating: true });
  assert.match(markup, /<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>正在创建导入任务…<\/button>/);
});

test("session rows link to the workflow and report state, counts and recovery", () => {
  const markup = render({
    status: "READY",
    sessions: [
      makeSummary({
        sessionId: "session-77",
        state: "NEEDS_REVIEW",
        lastVerifiedCheckpoint: "GROUPED",
        declaredFileCount: 30,
        archivedFileCount: 30,
        groupCount: 4,
        updatedAt: "2026-09-06T08:05:00.000Z"
      }),
      makeSummary({
        sessionId: "session-88",
        state: "PARTIALLY_FAILED",
        lastVerifiedCheckpoint: "ARCHIVED",
        declaredFileCount: 10,
        archivedFileCount: 8,
        failedFileCount: 2
      }),
      makeSummary({ sessionId: "session-99", state: "FAILED" })
    ]
  });
  assert.match(markup, /<a[^>]*href="\/admin\/bead-import\/session-77"/);
  assert.match(markup, /<a[^>]*href="\/admin\/bead-import\/session-88"/);
  assert.ok(markup.includes("待人工处理"));
  assert.ok(markup.includes("部分失败"));
  assert.ok(markup.includes("已失败"));
  assert.ok(markup.includes("2026-09-06 16:05"));
  assert.ok(markup.includes("继续导入并重试 2 个失败文件"));
  assert.ok(markup.includes("查看失败原因"));
  assert.ok(markup.includes("30"));
  assert.ok(markup.includes("4"));
  // Buckets are grouped under their own heading so a screen reader can navigate them.
  assert.match(markup, /<h3[^>]*id="bead-import-bucket-AWAITING_NAMES-title"[^>]*>待命名/);
  assert.match(markup, /<h3[^>]*id="bead-import-bucket-NEEDS_ATTENTION-title"[^>]*>失败任务/);
  assertNoLeaks(markup);
});

test("rows are grouped under the bucket that matches the backend state", () => {
  const markup = render({
    status: "READY",
    sessions: [makeSummary({ sessionId: "s-pub", state: "PUBLISHED", lastVerifiedCheckpoint: "PUBLISHED" })]
  });
  const publishedSection = markup.slice(markup.indexOf('id="bead-import-bucket-PUBLISHED-list"'));
  assert.ok(publishedSection.includes("s-pub"));
  assert.ok(!markup.includes('id="bead-import-bucket-IN_FLIGHT-list"'), "empty buckets render no list");
});

test("the layout stays single column and wrapping at phone width", () => {
  const markup = render({
    status: "READY",
    sessions: [makeSummary({ sessionId: "a-very-long-session-identifier-0123456789-0123456789" })],
    limit: DASHBOARD_DEFAULT_LIMIT
  });
  assert.ok(!markup.includes("<table"), "a data table would overflow a 390px viewport");
  assert.ok(markup.includes("min-w-0"));
  assert.ok(markup.includes("grid-cols-1"), "buckets must stack on a phone");
  assert.ok(markup.includes("sm:grid-cols-2"));
  assert.ok(markup.includes("break-all") || markup.includes("truncate"));
  const fixedWidths = [...markup.matchAll(/w-\[(\d+)px\]/g)].map((match) => Number(match[1]));
  for (const width of fixedWidths) {
    assert.ok(width <= 320, `fixed width ${width}px would overflow 390px`);
  }
  const minWidths = [...markup.matchAll(/min-w-\[(\d+)px\]/g)].map((match) => Number(match[1]));
  for (const width of minWidths) {
    assert.ok(width <= 320, `min width ${width}px would overflow 390px`);
  }
});

test("animations respect a reduced motion preference", () => {
  const markup = render({ status: "LOADING" });
  const animations = [...markup.matchAll(/(^|\s)((?:[a-z-]+:)*animate-[a-z-]+)/g)].map((match) => match[2] ?? "");
  assert.ok(animations.length > 0, "the loading state may use a subtle pulse");
  for (const animation of animations) {
    assert.ok(
      animation.startsWith("motion-safe:") || animation.startsWith("motion-reduce:"),
      `${animation} must be gated behind a motion preference`
    );
  }
});

test("status is never signalled by colour alone", () => {
  const markup = render({
    status: "READY",
    sessions: ASSET_IMPORT_SESSION_STATES.map((state, index) =>
      makeSummary({ sessionId: `session-${index}`, state })
    )
  });
  for (const state of ASSET_IMPORT_SESSION_STATES) {
    assert.ok(markup.includes(`>${stateLabel(state)}<`), `${state} must be spelled out in text`);
  }
});

function stateLabel(state: string): string {
  const filter = SESSION_STATE_FILTERS.find((candidate) => candidate.value === state);
  assert.ok(filter !== undefined);
  return filter.label;
}

test("the dashboard markup never leaks storage, backend or database detail", () => {
  const markup = render({
    status: "READY",
    sessions: ASSET_IMPORT_SESSION_STATES.map((state, index) =>
      makeSummary({ sessionId: `session-${index}`, state, failedFileCount: index })
    ),
    syncedAt: "2026-09-06T09:00:00.000Z",
    nextCursor: "session-9"
  });
  assertNoLeaks(markup);
});
