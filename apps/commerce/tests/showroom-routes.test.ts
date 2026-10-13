import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { computePriceFingerprint, type ShowroomApprovalRecord } from "../src/showroom/publication-gate";
import { publicShowroomPolicy } from "../src/api/middlewares";
import { GET as listRoute } from "../src/api/api/showroom/products/route";
import { GET as detailRoute } from "../src/api/api/showroom/products/[slug]/route";
import { GET as designerRoute } from "../src/api/api/showroom/designers/[slug]/route";
import { GET as collectionRoute } from "../src/api/api/showroom/collections/[slug]/route";

// TASK-COMMERCE-GATE-001 public route contract.
//
// These tests drive the real route handlers through a fake Medusa container and
// prove: only approved DTOs leave the surface, a failing product is excluded or
// 404, an upstream failure is a 500, the request boundary is strict, and the
// native Store entry cannot bypass the gate (no route returns raw store data and
// the public bypass policy refuses relayed credentials).

const commerceRoot = path.resolve(__dirname, "..");
const REGION_CN = "region_cn";
const CN_PRICE_MINOR = 128_000;
const NOW = new Date("2026-10-13T00:00:00.000Z");

type Res = {
  statusCode: number;
  body: any;
  headers: Record<string, string>;
  setHeader: (key: string, value: string) => void;
  status: (code: number) => Res;
  json: (body: any) => Res;
};

function fakeRes(): Res {
  const res: Res = {
    statusCode: 0,
    body: undefined,
    headers: {},
    setHeader(key, value) {
      res.headers[key] = value;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(body) {
      res.body = body;
      return res;
    }
  };
  return res;
}

function reviewedCopy(reviewedRevision = 1) {
  return {
    reviewedRevision,
    title: "无野 · 静水手链",
    summary: "天然的静水石与黄铜细节。",
    materials: ["天然静水石"],
    specifications: [{ label: "内径", value: "16cm" }],
    designer: { slug: "designer-lin", displayName: "林也" }
  };
}

function approvalFor(subjectRef: string, overrides: Partial<ShowroomApprovalRecord> = {}): ShowroomApprovalRecord {
  const base: ShowroomApprovalRecord = {
    subjectKind: "PRODUCT",
    subjectRef,
    publicRevision: 1,
    authorization: {
      status: "APPROVED",
      markets: ["CN", "TW"],
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z"
    },
    availability: "AVAILABLE",
    prices: {
      CN: {
        market: "CN",
        currency: "CNY",
        amountMinor: CN_PRICE_MINOR,
        regionId: REGION_CN,
        fingerprint: computePriceFingerprint(REGION_CN, "CNY", CN_PRICE_MINOR)
      }
    },
    locales: { "zh-CN": reviewedCopy(1), "zh-TW": reviewedCopy(1), "en-US": reviewedCopy(1) },
    media: [
      { url: "/showroom/wuye/hero.webp", alt: "正视图", checksum: "sha256:aaa", approved: true, withdrawn: false }
    ],
    audit: []
  };
  return { ...base, ...overrides };
}

function liveProduct(id: string, handle: string, status = "published") {
  return {
    id,
    handle,
    status,
    collection_id: null,
    created_at: "2026-09-01T00:00:00.000Z",
    categories: [],
    variants: [
      { id: `${id}_v1`, prices: [{ amount: CN_PRICE_MINOR, currency_code: "cny", rules: { region_id: REGION_CN } }] }
    ]
  };
}

function container({
  productRows,
  approvals,
  collectionRows = [],
  failProducts = false
}: {
  productRows: any[];
  approvals: ShowroomApprovalRecord[];
  collectionRows?: any[];
  failProducts?: boolean;
}) {
  return {
    resolve(key: string) {
      if (key === "product") {
        return {
          async listProducts(filter: any = {}) {
            if (failProducts) {
              throw new Error("upstream catalog read failed");
            }
            const handle = filter?.handle;
            if (handle === undefined) {
              return productRows;
            }
            const handles = Array.isArray(handle) ? handle : [handle];
            return productRows.filter((row) => handles.includes(row.handle));
          },
          async listCollections(filter: any = {}) {
            const handle = filter?.handle;
            return handle === undefined
              ? collectionRows
              : collectionRows.filter((row) => row.handle === handle);
          }
        };
      }
      if (key === "query") {
        // Mirrors the delivered projection: live products (with their variant
        // prices and region rules) are read through the Query layer's graph.
        return {
          async graph({ filters }: any = {}) {
            if (failProducts) {
              throw new Error("upstream catalog read failed");
            }
            const handle = filters?.handle;
            if (handle === undefined) {
              return { data: productRows };
            }
            const handles = Array.isArray(handle) ? handle : [handle];
            return { data: productRows.filter((row) => handles.includes(row.handle)) };
          }
        };
      }
      if (key === "region") {
        return { async listRegions() {
          return [{ id: REGION_CN, currency_code: "cny" }];
        } };
      }
      if (key === "showroom_publication") {
        return {
          async listApprovalRecordsByKind(kind: string) {
            return approvals.filter((record) => record.subjectKind === kind);
          },
          async findApproval(kind: string, ref: string) {
            return approvals.find((record) => record.subjectKind === kind && record.subjectRef === ref) ?? null;
          }
        };
      }
      throw new Error(`unexpected container key ${key}`);
    }
  } as any;
}

// --- list --------------------------------------------------------------------

test("the public list serves only approved DTOs and excludes every failing product", async () => {
  const rows = [
    liveProduct("prod_ok", "approved-bracelet"),
    liveProduct("prod_draft", "draft-bracelet", "draft"),
    liveProduct("prod_media", "no-media-bracelet")
  ];
  const approvals = [
    approvalFor("prod_ok"),
    approvalFor("prod_draft"),
    approvalFor("prod_media", {
      media: [{ url: "/x.webp", alt: "a", checksum: "", approved: true, withdrawn: false }]
    })
  ];
  const res = fakeRes();
  await listRoute(
    { query: { market: "CN", locale: "zh-CN" }, params: {}, scope: container({ productRows: rows, approvals }) } as any,
    res as any
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(res.body.items.length, 1, "only the fully approved product appears");
  assert.equal(res.body.items[0].slug, "approved-bracelet");
  assert.equal(res.body.market, "CN");
  assert.equal(res.body.locale, "zh-CN");
  // The body is the strict DTO: no raw store fields leak.
  for (const forbidden of ["variants", "calculated_price", "sales_channels", "status", "description", "categories"]) {
    assert.equal(forbidden in res.body.items[0], false, `the DTO must not carry ${forbidden}`);
  }
});

test("filtering by an unapproved designer slug returns an empty page, not that designer's work", async () => {
  const res = fakeRes();
  await listRoute(
    {
      query: { market: "CN", locale: "zh-CN", designer: "designer-other" },
      params: {},
      scope: container({ productRows: [liveProduct("prod_ok", "approved-bracelet")], approvals: [approvalFor("prod_ok")] })
    } as any,
    res as any
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items, []);
  assert.equal(res.body.total, 0);
});

test("the list boundary rejects an unknown market, locale and any extra query parameter", async () => {
  for (const query of [
    { market: "US", locale: "zh-CN" },
    { market: "CN", locale: "fr-FR" },
    { market: "CN" },
    { market: "CN", locale: "zh-CN", currency: "USD" },
    { market: "CN", locale: "zh-CN", page: "abc" }
  ]) {
    const res = fakeRes();
    await listRoute(
      { query, params: {}, scope: container({ productRows: [], approvals: [] }) } as any,
      res as any
    );
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(query)}`);
    assert.equal(res.body.code, "VALIDATION_ERROR");
    assert.ok(Array.isArray(res.body.fieldErrors));
  }
});

// --- detail ------------------------------------------------------------------

test("the detail route returns 404 for an unapproved product and 200 for an approved one", async () => {
  const rows = [liveProduct("prod_ok", "approved-bracelet"), liveProduct("prod_draft", "draft-bracelet", "draft")];
  const approvals = [approvalFor("prod_ok"), approvalFor("prod_draft")];
  const scope = container({ productRows: rows, approvals });

  const missing = fakeRes();
  await detailRoute({ query: { market: "CN", locale: "zh-CN" }, params: { slug: "unknown" }, scope } as any, missing as any);
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.code, "NOT_FOUND");

  const unapproved = fakeRes();
  await detailRoute({ query: { market: "CN", locale: "zh-CN" }, params: { slug: "draft-bracelet" }, scope } as any, unapproved as any);
  assert.equal(unapproved.statusCode, 404, "a draft product is 404, identical to an unknown slug");

  const approved = fakeRes();
  await detailRoute({ query: { market: "CN", locale: "zh-CN" }, params: { slug: "approved-bracelet" }, scope } as any, approved as any);
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.product.slug, "approved-bracelet");
  assert.equal(approved.body.product.price.currency, "CNY");
});

test("a detail request missing market or locale is a 400", async () => {
  for (const query of [{ market: "CN" }, { locale: "zh-CN" }, { market: "TW", locale: "zh-CN", page: "2" }]) {
    const res = fakeRes();
    await detailRoute(
      { query, params: { slug: "approved-bracelet" }, scope: container({ productRows: [], approvals: [] }) } as any,
      res as any
    );
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(query)}`);
  }
});

test("designer and collection routes return 404 without an approved record", async () => {
  const scope = container({ productRows: [], approvals: [] });
  for (const handler of [designerRoute, collectionRoute]) {
    const res = fakeRes();
    await handler({ query: { market: "CN", locale: "zh-CN" }, params: { slug: "whatever" }, scope } as any, res as any);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, "NOT_FOUND");
  }
});

// --- upstream failure -------------------------------------------------------

test("an upstream catalog failure is a 500 and never a raw product fallback", async () => {
  const listRes = fakeRes();
  await listRoute(
    {
      query: { market: "CN", locale: "zh-CN" },
      params: {},
      scope: container({ productRows: [], approvals: [], failProducts: true })
    } as any,
    listRes as any
  );
  assert.equal(listRes.statusCode, 500);
  assert.equal(listRes.body.code, "INTERNAL_ERROR");
  assert.equal(listRes.body.items, undefined, "no partial or raw payload is returned");

  const detailRes = fakeRes();
  await detailRoute(
    {
      query: { market: "CN", locale: "zh-CN" },
      params: { slug: "approved-bracelet" },
      scope: container({ productRows: [], approvals: [], failProducts: true })
    } as any,
    detailRes as any
  );
  assert.equal(detailRes.statusCode, 500, "a source read failure is never a 404 or a raw fallback");
});

// --- native Store bypass ----------------------------------------------------

test("the native Store entry cannot bypass the public gate", async () => {
  // The raw row a native /store/products read would return for a published
  // product that has no approved price, no reviewed copy and no approved media.
  const rawStoreRow = liveProduct("prod_raw", "raw-store-bracelet");
  const res = fakeRes();
  await listRoute(
    {
      query: { market: "CN", locale: "zh-CN" },
      params: {},
      scope: container({ productRows: [rawStoreRow], approvals: [] })
    } as any,
    res as any
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items, [], "a product a native store would return is excluded when it is not approved");

  const detail = fakeRes();
  await detailRoute(
    { query: { market: "CN", locale: "zh-CN" }, params: { slug: "raw-store-bracelet" }, scope: container({ productRows: [rawStoreRow], approvals: [] }) } as any,
    detail as any
  );
  assert.equal(detail.statusCode, 404, "the raw store product is not reachable through the public surface");
});

test("the public bypass policy refuses non-GET methods and relayed store/admin credentials", () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const res = fakeRes();
    let nextCalled = false;
    publicShowroomPolicy({ method, headers: {} } as any, res as any, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 405, `method ${method} must be refused`);
    assert.equal(nextCalled, false);
  }
  for (const headers of [{ "x-publishable-api-key": "pk_test" }, { authorization: "Bearer token" }]) {
    const res = fakeRes();
    let nextCalled = false;
    publicShowroomPolicy({ method: "GET", headers } as any, res as any, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 400, `credentials ${JSON.stringify(headers)} must be refused`);
    assert.equal(nextCalled, false);
  }
  const ok = fakeRes();
  let passed = false;
  publicShowroomPolicy({ method: "GET", headers: {} } as any, ok as any, () => {
    passed = true;
  });
  assert.equal(passed, true, "an anonymous read-only request passes");
});

// --- source-level guarantees -------------------------------------------------

test("the public surface validates at runtime and cannot return raw store data", async () => {
  const gate = await readFile(path.join(commerceRoot, "src", "showroom", "publication-gate.ts"), "utf8");
  assert.match(gate, /\.safeParse\(/, "the gate must validate the DTO at runtime, never by type only");
  assert.doesNotMatch(gate, /as\s+ShowroomPublicProduct\b/, "the gate must not cast instead of parsing");

  const projection = await readFile(path.join(commerceRoot, "src", "showroom", "projection.ts"), "utf8");
  for (const schema of [
    "ShowroomProductPageSchema",
    "ShowroomProductDetailSchema",
    "ShowroomDesignerDetailSchema",
    "ShowroomCollectionDetailSchema"
  ]) {
    assert.match(projection, new RegExp(`${schema}\\.safeParse\\(`), `${schema} must be runtime-validated`);
  }

  const routeFiles = [
    "src/api/api/showroom/products/route.ts",
    "src/api/api/showroom/products/[slug]/route.ts",
    "src/api/api/showroom/designers/[slug]/route.ts",
    "src/api/api/showroom/collections/[slug]/route.ts"
  ];
  for (const relative of routeFiles) {
    const source = await readFile(path.join(commerceRoot, relative), "utf8");
    assert.match(source, /createShowroomDeps/, `${relative} must read through the publication projection`);
    assert.doesNotMatch(source, /\/store\/products|\/store\/collections|publishable-api-key/, `${relative} must not read the native Store`);
  }
});
