import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type {
  CatalogMaterialProduct,
  ListCatalogMaterialsResponse,
  PublicDesignV1
} from "@mystcrag/design-contract";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FrontendApiError } from "../../../lib/api/frontend-api-error";
import { mockDesignOptions } from "../../design/fixtures/mock-design-options";
import {
  createLibraryDispatch,
  createLibraryLoadAttempts,
  INITIAL_LIBRARY_PAGE_STATE,
  LibraryDesignUnavailableNotice,
  loadFavorites,
  reduceLibraryPage,
  runDesignLoad,
  runLibraryLoad,
  saveFavorites,
  toggleFavoriteSelection,
  type LibraryPageEvent
} from "./crystal-library-page";

function material(crystalId: string): CatalogMaterialProduct {
  return {
    beadProductId: `product-${crystalId}-8`,
    sku: `SKU-${crystalId}`,
    displayName: "测试",
    crystalId,
    crystalNameCn: "测试水晶",
    crystalNameEn: "Test",
    mineralName: "Quartz",
    colorTags: ["clear"],
    visualTags: ["translucent"],
    styleTags: ["minimal"],
    emotionTags: ["calm-aesthetic"],
    cultureTags: ["design-inspiration-only"],
    materialKey: `${crystalId}-material-v1`,
    shape: "ROUND",
    diameterMm: 8,
    modelAssetKey: "sphere-round-8mm-v1",
    textureAssetKey: `${crystalId}-texture-v1`,
    currency: "CNY",
    unitPriceMinor: 500,
    availableQuantity: 100
  } as CatalogMaterialProduct;
}

const CATALOG: ListCatalogMaterialsResponse = {
  materials: [material("crystal-clear-quartz"), material("crystal-amethyst")],
  accessories: []
};

const STALE_CATALOG: ListCatalogMaterialsResponse = {
  materials: [material("crystal-stale")],
  accessories: []
};

const DESIGN = mockDesignOptions[0] as PublicDesignV1;

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void };

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function replay(events: readonly LibraryPageEvent[]) {
  return events.reduce(reduceLibraryPage, INITIAL_LIBRARY_PAGE_STATE);
}

test("catalog resolution alone exits loading and renders materials while design never settles", async () => {
  const events: LibraryPageEvent[] = [];
  runLibraryLoad(
    {
      get: () => new Promise<PublicDesignV1>(() => undefined),
      materials: async () => CATALOG
    },
    (event) => events.push(event),
    createLibraryLoadAttempts()
  );
  await settle();
  const state = replay(events);
  assert.equal(state.status, "ready");
  assert.deepEqual(
    state.materials.map((item) => item.crystalId),
    ["crystal-clear-quartz", "crystal-amethyst"]
  );
  assert.equal(state.design, null);
  assert.equal(state.designNotice, null);
});

test("fixed design 404 degrades to a design notice while the catalog stays ready", async () => {
  const events: LibraryPageEvent[] = [];
  runLibraryLoad(
    {
      get: async () => {
        throw new FrontendApiError("NOT_FOUND", "design-diy-private is absent in a fresh database");
      },
      materials: async () => CATALOG
    },
    (event) => events.push(event),
    createLibraryLoadAttempts()
  );
  await settle();
  const state = replay(events);
  assert.equal(state.status, "ready");
  assert.equal(state.design, null);
  assert.equal(state.designNotice, "NOT_FOUND");
  assert.equal(state.catalogNotice, null);
  assert.equal(state.materials.length, 2);
});

test("catalog failure keeps the full-page error even when the design loaded", async () => {
  const events: LibraryPageEvent[] = [];
  runLibraryLoad(
    {
      get: async () => DESIGN,
      materials: async () => {
        throw new FrontendApiError("NETWORK_ERROR", "catalog unreachable");
      }
    },
    (event) => events.push(event),
    createLibraryLoadAttempts()
  );
  await settle();
  const state = replay(events);
  assert.equal(state.status, "catalog-error");
  assert.equal(state.catalogNotice, "NETWORK_ERROR");
  assert.equal(state.design, DESIGN);
});

test("operation failure stays inline and never removes the ready catalog or design", () => {
  const ready = replay([
    { type: "design-resolved", design: DESIGN },
    { type: "catalog-resolved", materials: CATALOG.materials, accessories: CATALOG.accessories }
  ]);
  assert.equal(ready.status, "ready");

  const afterFailure = reduceLibraryPage(ready, { type: "operation-failed", code: "CONFLICT" });
  assert.equal(afterFailure.status, "ready");
  assert.equal(afterFailure.design, DESIGN);
  assert.deepEqual(afterFailure.materials, CATALOG.materials);
  assert.equal(afterFailure.operationNotice, "CONFLICT");

  const afterDismiss = reduceLibraryPage(afterFailure, { type: "operation-notice-dismissed" });
  assert.equal(afterDismiss.operationNotice, null);
  assert.equal(afterDismiss.status, "ready");
  assert.equal(afterDismiss.design, DESIGN);
  assert.equal(afterDismiss.materials.length, 2);
});

test("catalog-notice-dismissed clears only the catalog notice so a later 401 can remount the dialog", () => {
  const failed = reduceLibraryPage(INITIAL_LIBRARY_PAGE_STATE, {
    type: "catalog-failed",
    code: "UNAUTHORIZED"
  });
  assert.equal(failed.status, "catalog-error");
  assert.equal(failed.catalogNotice, "UNAUTHORIZED");

  const dismissed = reduceLibraryPage(failed, { type: "catalog-notice-dismissed" });
  assert.equal(dismissed.catalogNotice, null);
  assert.equal(dismissed.status, "catalog-error");
  assert.equal(dismissed.operationNotice, null);

  // A fresh 401 writes the code again; the page can remount the dialog.
  const again = reduceLibraryPage(dismissed, { type: "catalog-failed", code: "UNAUTHORIZED" });
  assert.equal(again.catalogNotice, "UNAUTHORIZED");
});

test("a late design resolution supplements the already-ready catalog", () => {
  const catalogReady = reduceLibraryPage(INITIAL_LIBRARY_PAGE_STATE, {
    type: "catalog-resolved",
    materials: CATALOG.materials,
    accessories: CATALOG.accessories
  });
  assert.equal(catalogReady.status, "ready");
  assert.equal(catalogReady.design, null);

  const supplemented = reduceLibraryPage(catalogReady, { type: "design-resolved", design: DESIGN });
  assert.equal(supplemented.status, "ready");
  assert.equal(supplemented.design, DESIGN);
  assert.deepEqual(supplemented.materials, CATALOG.materials);
});

test("a stale attempt cannot override the newest catalog result", async () => {
  const firstCatalog = defer<ListCatalogMaterialsResponse>();
  const secondCatalog = defer<ListCatalogMaterialsResponse>();
  let materialsCall = 0;
  const events: LibraryPageEvent[] = [];
  const attempts = createLibraryLoadAttempts();

  const api = {
    get: async () => DESIGN,
    materials: () => {
      materialsCall += 1;
      return materialsCall === 1 ? firstCatalog.promise : secondCatalog.promise;
    }
  };

  runLibraryLoad(api, (event) => events.push(event),
 attempts);
  runLibraryLoad(api, (event) => events.push(event),
 attempts);
  secondCatalog.resolve(CATALOG);
  firstCatalog.resolve(STALE_CATALOG);
  await settle();

  const catalogEvents = events.filter((event) => event.type === "catalog-resolved");
  assert.equal(catalogEvents.length, 1);
  const state = replay(events);
  assert.equal(state.status, "ready");
  assert.deepEqual(
    state.materials.map((item) => item.crystalId),
    ["crystal-clear-quartz", "crystal-amethyst"]
  );
});

test("design-unavailable notice explains browsing and offers explicit recovery", () => {
  const markup = renderToStaticMarkup(
    <LibraryDesignUnavailableNotice designNotice="NOT_FOUND" onRetry={() => undefined} />
  );
  assert.match(markup, /data-library-design-notice="unavailable"/);
  assert.match(markup, /当前设计暂不可用/);
  assert.match(markup, /可先浏览与收藏/);
  assert.match(markup, /重新加载设计/);
  assert.match(markup, /role="(alert|status)"/);
});

test("favorites toggle and persist through localStorage without regression", () => {
  assert.deepEqual([...toggleFavoriteSelection(new Set(), "product-a")], ["product-a"]);
  assert.deepEqual([...toggleFavoriteSelection(new Set(["product-a"]), "product-a")], []);
  assert.deepEqual(
    [...toggleFavoriteSelection(new Set(["product-a"]), "product-b")].sort(),
    ["product-a", "product-b"]
  );

  const store = new Map<string, string>();
  const scope = globalThis as { window?: unknown };
  const previousWindow = scope.window;
  scope.window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value)
    }
  };
  try {
    saveFavorites(new Set(["product-a", "product-b"]));
    assert.deepEqual([...loadFavorites()].sort(), ["product-a", "product-b"]);
    store.set("mystcrag:library-favorites", "not-json");
    assert.deepEqual([...loadFavorites()], []);
    store.set("mystcrag:library-favorites", JSON.stringify(["product-a", 3, null]));
    assert.deepEqual([...loadFavorites()], ["product-a"]);
  } finally {
    if (previousWindow === undefined) delete scope.window;
    else scope.window = previousWindow;
  }
  assert.deepEqual([...loadFavorites()], []);
});

test("design-only retry re-fetches the design without re-requesting or clearing the ready catalog", async () => {
  const events: LibraryPageEvent[] = [];
  const attempts = createLibraryLoadAttempts();
  let materialsCalls = 0;
  let designSucceeds = false;
  const api = {
    get: async () => {
      if (designSucceeds) return DESIGN;
      throw new FrontendApiError("NOT_FOUND", "design absent in a fresh database");
    },
    materials: async () => {
      materialsCalls += 1;
      return CATALOG;
    }
  };

  runLibraryLoad(api, (event) => events.push(event), attempts);
  await settle();
  assert.equal(materialsCalls, 1);
  assert.equal(replay(events).status, "ready");

  designSucceeds = true;
  runDesignLoad(api, (event) => events.push(event), attempts);
  await settle();

  assert.equal(materialsCalls, 1, "design-only retry must not re-request the catalog");
  assert.equal(events.filter((event) => event.type === "load-started").length, 1, "design-only retry must not reset page state");
  const state = replay(events);
  assert.equal(state.status, "ready");
  assert.equal(state.design, DESIGN);
  assert.equal(state.designNotice, null);
  assert.equal(state.catalogNotice, null);
  assert.deepEqual(
    state.materials.map((item) => item.crystalId),
    ["crystal-clear-quartz", "crystal-amethyst"]
  );
});

test("design-only retry failure keeps the ready catalog and stays a design-only degradation", async () => {
  const events: LibraryPageEvent[] = [];
  const attempts = createLibraryLoadAttempts();
  const api = {
    get: async () => {
      throw new FrontendApiError("NETWORK_ERROR", "design unreachable");
    },
    materials: async () => CATALOG
  };

  runLibraryLoad(api, (event) => events.push(event), attempts);
  await settle();
  runDesignLoad(api, (event) => events.push(event), attempts);
  await settle();

  const state = replay(events);
  assert.equal(state.status, "ready");
  assert.equal(state.design, null);
  assert.equal(state.designNotice, "NETWORK_ERROR");
  assert.equal(state.catalogNotice, null);
  assert.equal(state.materials.length, 2);
});

test("a stale design result cannot override the newest design attempt", async () => {
  const firstDesign = defer<PublicDesignV1>();
  const retryDesign = defer<PublicDesignV1>();
  let getCall = 0;
  const events: LibraryPageEvent[] = [];
  const attempts = createLibraryLoadAttempts();
  const api = {
    get: () => {
      getCall += 1;
      return getCall === 1 ? firstDesign.promise : retryDesign.promise;
    },
    materials: async () => CATALOG
  };

  runLibraryLoad(api, (event) => events.push(event), attempts);
  runDesignLoad(api, (event) => events.push(event), attempts);
  retryDesign.resolve(DESIGN);
  firstDesign.resolve({ ...DESIGN, designId: "stale-design" });
  await settle();

  assert.equal(events.filter((event) => event.type === "design-resolved").length, 1);
  assert.equal(replay(events).design, DESIGN);
});

test("dispatch is inert once unmounted and side effects only run while mounted", () => {
  let sideEffectCalls = 0;
  let dispatchCalls = 0;
  const dispatcher = createLibraryDispatch(
    () => { dispatchCalls += 1; },
    { onCatalogResolved: () => { sideEffectCalls += 1; } }
  );

  dispatcher.dispatch({ type: "catalog-resolved", materials: CATALOG.materials, accessories: [] });
  assert.equal(sideEffectCalls, 1);
  assert.equal(dispatchCalls, 1);

  dispatcher.setMounted(false);
  dispatcher.dispatch({ type: "catalog-resolved", materials: CATALOG.materials, accessories: [] });
  dispatcher.dispatch({ type: "design-failed", code: "NOT_FOUND" });
  assert.equal(sideEffectCalls, 1, "unmounted dispatch must not touch state or storage");
  assert.equal(dispatchCalls, 1);
});

test("page never awaits the optional design together with the catalog and gates errors on catalog status only", () => {
  const source = readFileSync(new URL("./crystal-library-page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Promise\.all/);
  assert.match(source, /state\.status === "catalog-error"/);
  assert.doesNotMatch(source, /if \(!design\) \{\s*return \(/);
  // The mobile degraded notice must exist outside the desktop-only aside.
  assert.match(source, /lg:hidden"[^>]*data-library-design-notice="mobile"/);
  // Only the catalog error may trigger a full reload; degraded design notices retry the design alone.
  assert.match(source, /onRetry=\{retryDesign\}/);
  assert.match(source, /onAction: retryLoad/);
});
