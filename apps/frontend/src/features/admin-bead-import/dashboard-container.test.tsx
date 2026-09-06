import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BeadImportDashboard } from "./components/bead-import-dashboard";
import { DASHBOARD_BUCKET_LABELS } from "./dashboard-model";

const FORBIDDEN_CLAIMS = ["功效", "疗效", "治疗", "保证", "转运", "招财", "辟邪", "旺财"];
const FORBIDDEN_LEAKS = [
  "archiveKey",
  "asset-archive",
  "x-admin-key",
  "MYSTCRAG_ASSET_ADMIN_KEY",
  "ASSET_ADMIN_API_KEY",
  "MYSTCRAG_BACKEND_ORIGIN",
  "127.0.0.1",
  "/Users/",
  "localhost"
];

const CONTAINER_SOURCE = readFileSync(join(__dirname, "components/bead-import-dashboard.tsx"), "utf8");

test("the server-rendered console shows a loading dashboard and invents no session", () => {
  const html = renderToStaticMarkup(<BeadImportDashboard />);
  assert.ok(html.includes("正在载入导入任务…"));
  assert.ok(!html.includes("还没有导入任务"), "the first paint must not claim the console is empty");
  assert.ok(!html.includes("bead-import-bucket-IN_FLIGHT-list"), "no bucket may list a session it never fetched");
  for (const label of Object.values(DASHBOARD_BUCKET_LABELS)) {
    assert.ok(html.includes(`>${label.title}<`));
  }
  assert.ok(html.includes(">新建导入<"));
});

test("the container renders the presentational dashboard and the shared reducer", () => {
  assert.ok(CONTAINER_SOURCE.includes(`"use client"`));
  assert.ok(CONTAINER_SOURCE.includes("React.useReducer(dashboardReducer"));
  assert.ok(CONTAINER_SOURCE.includes("initialDashboardState("));
  assert.ok(CONTAINER_SOURCE.includes("<DashboardView"));
  assert.ok(CONTAINER_SOURCE.includes("createDashboardLoader("));
});

test("the container talks to the Backend only through the contract client", () => {
  assert.ok(CONTAINER_SOURCE.includes("createBeadImportClient("));
  assert.ok(
    !CONTAINER_SOURCE.includes("/api/admin/bead-import"),
    "the browser must target the cookie-scoped proxy prefix the client owns"
  );
  assert.ok(!CONTAINER_SOURCE.includes("fetch("), "no hand-rolled request may skip the contract client");
  for (const forbidden of FORBIDDEN_LEAKS) {
    assert.ok(!CONTAINER_SOURCE.includes(forbidden), `container must not mention ${forbidden}`);
  }
});

test("the container reads no server configuration and holds no key material", () => {
  assert.ok(!CONTAINER_SOURCE.includes("process.env"));
  assert.ok(!CONTAINER_SOURCE.includes("localStorage"));
  assert.ok(!CONTAINER_SOURCE.includes("sessionStorage"));
  assert.ok(!CONTAINER_SOURCE.includes("document.cookie"));
  for (const claim of FORBIDDEN_CLAIMS) {
    assert.ok(!CONTAINER_SOURCE.includes(claim), `container must not mention ${claim}`);
  }
});

test("the container aborts its in-flight list request when it unmounts", () => {
  assert.ok(
    CONTAINER_SOURCE.includes("return () => loader.cancel()"),
    "an unmounted console must not dispatch into a dead reducer"
  );
});

test("paging appends instead of replacing the page the operator is reading", () => {
  assert.ok(CONTAINER_SOURCE.includes("append: true"));
  assert.ok(CONTAINER_SOURCE.includes("nextCursor"));
  assert.ok(CONTAINER_SOURCE.includes(`{ type: "FILTER_CHANGED"`));
});
