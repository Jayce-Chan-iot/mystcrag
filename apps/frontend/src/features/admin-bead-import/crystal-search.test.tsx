import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { CrystalSearchResult } from "@mystcrag/design-contract";

import { CrystalSearch } from "./components/crystal-search";
import { createCrystalSearch, type CrystalSearchClient } from "./crystal-search";

const SOURCE = readFileSync(join(__dirname, "crystal-search.ts"), "utf8");

function makeHarness(results: CrystalSearchResult[] = []) {
  const queries: string[] = [];
  const client: CrystalSearchClient = {
    async listCrystals(query) {
      queries.push(query.q);
      return { crystals: results, nextCursor: null };
    }
  };
  const immediate = (handler: () => void) => handler();
  const search = createCrystalSearch({ client, runDelayed: immediate });
  return { search, queries };
}

const AMETHYST: CrystalSearchResult = {
  crystalId: "crystal-1",
  nameCn: "紫水晶",
  nameEn: "Amethyst",
  mineralName: "石英"
};

test("a query that reaches the minimum length searches the dedicated endpoint once", async () => {
  const { search, queries } = makeHarness([AMETHYST]);
  const results = await search.query("紫水晶");
  assert.deepEqual(queries, ["紫水晶"]);
  assert.deepEqual(results, [AMETHYST]);
});

test("a too-short query is refused locally and never reaches the network", async () => {
  const { search, queries } = makeHarness();
  const results = await search.query("  ");
  assert.deepEqual(results, []);
  assert.deepEqual(queries, [], "an empty query must not search");
});

test("a burst of keystrokes collapses to the latest query", async () => {
  const seen: string[] = [];
  const delayed: (() => void)[] = [];
  const search = createCrystalSearch({
    client: {
      async listCrystals(query) {
        seen.push(query.q);
        return { crystals: [], nextCursor: null };
      }
    },
    runDelayed: (handler) => {
      delayed.push(handler);
    }
  });
  const first = search.query("紫水");
  const second = search.query("紫水晶");
  for (const run of delayed) {
    run();
  }
  await Promise.all([first, second]);
  assert.deepEqual(seen, ["紫水晶"], "only the newest query may fire");
});

test("the search result names and ids are rendered for selection without any storage detail", () => {
  const html = renderToStaticMarkup(
    React.createElement(CrystalSearch, {
      results: [AMETHYST],
      status: "READY",
      onSelect: () => {},
      query: "紫水晶",
      onQueryChange: () => {}
    })
  );
  assert.ok(html.includes("紫水晶"));
  assert.ok(html.includes("Amethyst"));
  assert.ok(!html.includes("crystal-1"), "an internal id must not be the visible label");
  assert.ok(!html.includes("archiveKey") && !html.includes("storageKey"));
  assert.ok(!SOURCE.includes("x-admin-key"));
});
