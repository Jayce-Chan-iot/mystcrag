import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  computePriceFingerprint,
  computeTranslationFingerprint,
  ShowroomApprovalNotFoundError,
  ShowroomMediaWithdrawalTargetError,
  type ShowroomApprovalRecord
} from "../src/showroom/publication-gate";
import { publicShowroomPolicy } from "../src/api/middlewares";
import { GET as listRoute } from "../src/api/api/showroom/products/route";
import { GET as detailRoute } from "../src/api/api/showroom/products/[slug]/route";
import { GET as designerRoute } from "../src/api/api/showroom/designers/[slug]/route";
import { GET as collectionRoute } from "../src/api/api/showroom/collections/[slug]/route";
import { POST as adminApprovalRoute } from "../src/api/admin/showroom-approvals/[productId]/route";

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
// The single live translation payload the fabricated products carry, and the
// fingerprint a reviewed copy pins against it.
const TRANSLATION_TITLE = "无野 · 静水手链";
const LIVE_TRANSLATION_FINGERPRINT = computeTranslationFingerprint({ title: TRANSLATION_TITLE });

const LOCALES = ["zh-CN", "zh-TW", "en-US"] as const;

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
    title: TRANSLATION_TITLE,
    summary: "天然的静水石与黄铜细节。",
    materials: ["天然静水石"],
    specifications: [{ label: "内径", value: "16cm" }],
    designer: { slug: "designer-lin", displayName: "林也" },
    translationFingerprint: LIVE_TRANSLATION_FINGERPRINT
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
  failProducts = false,
  failTranslations = false,
  translations
}: {
  productRows: any[];
  approvals: ShowroomApprovalRecord[];
  collectionRows?: any[];
  failProducts?: boolean;
  failTranslations?: boolean;
  translations?: Record<string, Record<string, unknown>>;
}) {
  const defaultTranslations = Object.fromEntries(
    productRows.map((row) => [
      row.id,
      Object.fromEntries(LOCALES.map((locale) => [locale, { title: TRANSLATION_TITLE }]))
    ])
  );
  const translationPayloads = translations ?? defaultTranslations;
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
      if (key === "translation") {
        return {
          async listTranslations(filter: any = {}, config: any = {}) {
            if (failTranslations) {
              throw new Error("upstream translation read failed");
            }
            const referenceId = filter?.reference_id;
            const ids = referenceId === undefined
              ? Object.keys(translationPayloads)
              : Array.isArray(referenceId)
                ? referenceId
                : [referenceId];
            const rows = [];
            for (const id of ids) {
              const byLocale = translationPayloads[id];
              for (const locale of LOCALES) {
                rows.push({
                  reference: "product",
                  reference_id: id,
                  locale_code: locale,
                  translations: byLocale?.[locale] ?? {}
                });
              }
            }
            const select = config?.select ?? [];
            return rows.map((row) =>
              select.length ? Object.fromEntries(select.map((field: string) => [field, (row as any)[field]])) : row
            );
          }
        };
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
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
    assert.ok(Array.isArray(res.body.error.fieldErrors));
    assert.equal(typeof res.body.error.requestId, "string");
    assert.ok(res.body.error.requestId.length > 0, "the shared envelope carries a requestId");
  }
});

// --- detail ------------------------------------------------------------------

test("the detail route returns 404 for an unapproved product and 200 for an approved one", async () => {
  const rows = [liveProduct("prod_ok", "approved-bracelet"), liveProduct("prod_draft", "draft-bracelet", "draft")];
  const approvals = [approvalFor("prod_ok"), approvalFor("prod_draft")];
  const scope = container({ productRows: rows, approvals });

  const missing = fakeRes();
  await detailRoute(
    { query: { market: "CN", locale: "zh-CN" }, params: { slug: "unknown" }, scope, requestId: "req-detail-404" } as any,
    missing as any
  );
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.body.error.code, "NOT_FOUND");
  assert.equal(missing.body.error.requestId, "req-detail-404", "the route threads Medusa's requestId into the envelope");
  assert.equal(missing.body.code, undefined, "the legacy flat envelope is gone");

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
    assert.equal(res.body.error.code, "NOT_FOUND");
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
  assert.equal(listRes.body.error.code, "INTERNAL_ERROR");
  assert.equal(typeof listRes.body.error.requestId, "string");
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
    publicShowroomPolicy({ method, headers: {}, requestId: "req-method" } as any, res as any, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 405, `method ${method} must be refused`);
    assert.equal(nextCalled, false);
    assert.equal(res.body.error.code, "METHOD_NOT_ALLOWED", "the middleware answers with the shared envelope");
    assert.equal(res.body.error.requestId, "req-method");
  }
  for (const headers of [{ "x-publishable-api-key": "pk_test" }, { authorization: "Bearer token" }]) {
    const res = fakeRes();
    let nextCalled = false;
    publicShowroomPolicy({ method: "GET", headers, requestId: "req-cred" } as any, res as any, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 400, `credentials ${JSON.stringify(headers)} must be refused`);
    assert.equal(nextCalled, false);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
    assert.equal(res.body.error.requestId, "req-cred");
  }
  const ok = fakeRes();
  let passed = false;
  publicShowroomPolicy({ method: "GET", headers: {} } as any, ok as any, () => {
    passed = true;
  });
  assert.equal(passed, true, "an anonymous read-only request passes");
});

// --- live price amount mapping -----------------------------------------------

/**
 * The Medusa Query price row the projection reads. `price` is deliberately
 * unconstrained so a test can hand it a null amount, an absent key, a
 * non-finite value or an unsafe integer — exactly as a partial or broken read
 * would.
 */
function liveProductWithPriceAmount(id: string, handle: string, price: Record<string, unknown>) {
  return {
    id,
    handle,
    status: "published",
    collection_id: null,
    created_at: "2026-09-01T00:00:00.000Z",
    categories: [],
    variants: [{ id: `${id}_v1`, prices: [{ currency_code: "cny", rules: { region_id: REGION_CN }, ...price }] }]
  };
}

/** An approval for one genuine zero price: a manual approval of `0` is legal. */
function zeroPriceApproval(subjectRef: string): ShowroomApprovalRecord {
  return approvalFor(subjectRef, {
    prices: {
      CN: {
        market: "CN",
        currency: "CNY",
        amountMinor: 0,
        regionId: REGION_CN,
        fingerprint: computePriceFingerprint(REGION_CN, "CNY", 0)
      }
    }
  });
}

const ZERO_PRICE_HANDLE = "zero-price-bracelet";

test("a live price amount that is missing or not a safe integer fails closed instead of publishing a zero price", async () => {
  const approval = zeroPriceApproval("prod_zero");
  // Approving a legal zero is never a licence to publish a vanishable amount: a
  // row whose amount is null, absent, non-finite, fractional or outside the safe
  // integer range carries no price, so the subject must be excluded and 404.
  const brokenAmounts: Array<[string, Record<string, unknown>]> = [
    ["null", { amount: null }],
    ["absent", {}],
    ["NaN", { amount: Number.NaN }],
    ["Infinity", { amount: Number.POSITIVE_INFINITY }],
    ["unsafe integer", { amount: Number.MAX_SAFE_INTEGER + 2 }],
    ["fractional", { amount: 0.5 }]
  ];
  for (const [label, price] of brokenAmounts) {
    const scope = container({
      productRows: [liveProductWithPriceAmount("prod_zero", ZERO_PRICE_HANDLE, price)],
      approvals: [approval]
    });
    const list = fakeRes();
    await listRoute({ query: { market: "CN", locale: "zh-CN" }, params: {}, scope } as any, list as any);
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.body.items, [], `a ${label} amount must not be published as a zero price`);
    const detail = fakeRes();
    await detailRoute(
      { query: { market: "CN", locale: "zh-CN" }, params: { slug: ZERO_PRICE_HANDLE }, scope } as any,
      detail as any
    );
    assert.equal(detail.statusCode, 404, `a ${label} amount must close the public detail`);
    assert.equal(detail.body.error.code, "NOT_FOUND");
  }

  // A genuinely zero amount that was manually approved is a real price and still serves.
  const zeroScope = container({
    productRows: [liveProductWithPriceAmount("prod_zero", ZERO_PRICE_HANDLE, { amount: 0 })],
    approvals: [approval]
  });
  const zeroList = fakeRes();
  await listRoute({ query: { market: "CN", locale: "zh-CN" }, params: {}, scope: zeroScope } as any, zeroList as any);
  assert.equal(zeroList.statusCode, 200);
  assert.equal(zeroList.body.items.length, 1, "an approved zero price is a real price and still serves");
  assert.equal(zeroList.body.items[0].price.amountMinor, 0);
  const zeroDetail = fakeRes();
  await detailRoute(
    { query: { market: "CN", locale: "zh-CN" }, params: { slug: ZERO_PRICE_HANDLE }, scope: zeroScope } as any,
    zeroDetail as any
  );
  assert.equal(zeroDetail.statusCode, 200, "the approved zero-price detail serves");
  assert.equal(zeroDetail.body.product.price.amountMinor, 0);
});

// --- live translation version changes ---------------------------------------

test("an Admin translation edit after approval fails closed on the next public read", async () => {
  const rows = [liveProduct("prod_ok", "approved-bracelet")];
  const approvals = [approvalFor("prod_ok")];

  const matching = fakeRes();
  await listRoute(
    { query: { market: "CN", locale: "zh-CN" }, params: {}, scope: container({ productRows: rows, approvals }) } as any,
    matching as any
  );
  assert.equal(matching.statusCode, 200);
  assert.equal(matching.body.items.length, 1, "the approved product serves while its translation is unchanged");

  const edited = fakeRes();
  await listRoute(
    {
      query: { market: "CN", locale: "zh-CN" },
      params: {},
      scope: container({
        productRows: rows,
        approvals,
        translations: { prod_ok: { "zh-CN": { title: "无野 · 静水手链（Admin 改动）" } } }
      })
    } as any,
    edited as any
  );
  assert.equal(edited.statusCode, 200);
  assert.deepEqual(edited.body.items, [], "a translation edited after review excludes the product");

  const editedDetail = fakeRes();
  await detailRoute(
    {
      query: { market: "CN", locale: "zh-CN" },
      params: { slug: "approved-bracelet" },
      scope: container({
        productRows: rows,
        approvals,
        translations: { prod_ok: { "zh-CN": { title: "无野 · 静水手链（Admin 改动）" } } }
      })
    } as any,
    editedDetail as any
  );
  assert.equal(editedDetail.statusCode, 404, "the edited translation closes the detail too");
});

test("a failed translation read is a 500 and never a partially served page", async () => {
  const res = fakeRes();
  await listRoute(
    {
      query: { market: "CN", locale: "zh-CN" },
      params: {},
      scope: container({ productRows: [liveProduct("prod_ok", "approved-bracelet")], approvals: [approvalFor("prod_ok")], failTranslations: true })
    } as any,
    res as any
  );
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, "INTERNAL_ERROR");
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

// --- admin approval decision route -------------------------------------------

function approveBody(overrides: Record<string, unknown> = {}) {
  return {
    action: "APPROVE",
    publicRevision: 1,
    authorization: {
      status: "APPROVED",
      markets: ["CN", "TW"],
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z"
    },
    availability: "AVAILABLE",
    prices: { CN: { currency: "CNY", amountMinor: CN_PRICE_MINOR, regionId: REGION_CN } },
    locales: { "zh-CN": { reviewedRevision: 1, title: "无野 · 静水手链", summary: "天然的静水石。" } },
    media: [{ url: "/showroom/wuye/hero.webp", alt: "正视图", checksum: "sha256:aaa", approved: true, withdrawn: false }],
    ...overrides
  };
}

function adminContainer({
  service,
  failTranslations = false,
  productRows = []
}: {
  service: any;
  failTranslations?: boolean;
  productRows?: any[];
}) {
  return {
    resolve(key: string) {
      if (key === "translation") {
        return {
          async listTranslations() {
            if (failTranslations) {
              throw new Error("Failed to read the live product translations");
            }
            return [];
          }
        };
      }
      if (key === "query") {
        return {
          async graph({ filters }: any = {}) {
            const id = filters?.id;
            return { data: id === undefined ? productRows : productRows.filter((row: any) => row.id === id) };
          }
        };
      }
      if (key === "showroom_publication") {
        return service;
      }
      throw new Error(`unexpected container key ${key}`);
    }
  } as any;
}

test("an admin approval whose live-translation read fails is a 500 that never leaks the internal failure", async () => {
  const service = {
    async approve() {
      throw new Error("approve must not be reached while the translation read is failing");
    }
  };
  const res = fakeRes();
  await adminApprovalRoute(
    {
      params: { productId: "prod_admin" },
      requestId: "req-admin-500",
      body: approveBody(),
      scope: adminContainer({ service, failTranslations: true })
    } as any,
    res as any
  );

  assert.equal(res.statusCode, 500, "an internal module failure is a server error, not a client validation error");
  assert.equal(res.body.error.code, "INTERNAL_ERROR");
  assert.equal(res.body.error.requestId, "req-admin-500");
  assert.equal(
    /translation|live product|Failed to read/i.test(JSON.stringify(res.body)),
    false,
    "the internal failure message must never leak to the client"
  );
});

test("a database failure on an admin decision is a 500 that never leaks the internal failure", async () => {
  const service = {
    async revoke() {
      throw new Error("connection terminated unexpectedly");
    }
  };
  const res = fakeRes();
  await adminApprovalRoute(
    { params: { productId: "prod_admin" }, requestId: "req-admin-db", body: { action: "REVOKE" }, scope: adminContainer({ service }) } as any,
    res as any
  );

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error.code, "INTERNAL_ERROR");
  assert.equal(/connection terminated|terminated unexpectedly/i.test(JSON.stringify(res.body)), false);
});

test("withdrawing an unknown media checksum is refused, never silently accepted", async () => {
  const service = {
    async withdrawMedia() {
      throw new ShowroomMediaWithdrawalTargetError("PRODUCT", "prod_admin", "sha256:absent");
    }
  };
  const res = fakeRes();
  await adminApprovalRoute(
    {
      params: { productId: "prod_admin" },
      requestId: "req-withdraw",
      body: { action: "WITHDRAW_MEDIA", checksum: "sha256:absent" },
      scope: adminContainer({ service })
    } as any,
    res as any
  );

  assert.equal(res.statusCode, 404, "a withdrawal target that does not exist is a not-found, not a silent 200");
  assert.equal(res.body.error.code, "NOT_FOUND");
});

test("a decision against a subject with no approval is a 404", async () => {
  const service = {
    async revoke() {
      throw new ShowroomApprovalNotFoundError("PRODUCT", "prod_missing");
    }
  };
  const res = fakeRes();
  await adminApprovalRoute(
    { params: { productId: "prod_missing" }, body: { action: "REVOKE" }, scope: adminContainer({ service }) } as any,
    res as any
  );

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error.code, "NOT_FOUND");
});

test("an approval records the live product handle and status it read from the catalog", async () => {
  let received: any = null;
  const service = {
    async approve(input: any) {
      received = input;
      return { subjectKind: "PRODUCT", subjectRef: input.subjectRef, audit: [] };
    }
  };
  const res = fakeRes();
  await adminApprovalRoute(
    {
      params: { productId: "prod_ok" },
      requestId: "req-admin-approve",
      body: approveBody(),
      scope: adminContainer({
        service,
        productRows: [{ id: "prod_ok", handle: "approved-bracelet", status: "published" }]
      })
    } as any,
    res as any
  );

  assert.equal(res.statusCode, 200, "the approval is recorded");
  assert.equal(received.handle, "approved-bracelet", "the live product handle is passed to the decision");
  assert.equal(received.productStatus, "published", "the live product status is passed to the decision");
});

test("an approval for a product that does not exist is a 404 and records nothing", async () => {
  const service = {
    async approve() {
      throw new Error("approve must not be reached for a product that does not exist");
    }
  };
  const res = fakeRes();
  await adminApprovalRoute(
    {
      params: { productId: "prod_missing" },
      requestId: "req-admin-404",
      body: approveBody(),
      scope: adminContainer({ service, productRows: [] })
    } as any,
    res as any
  );

  assert.equal(res.statusCode, 404, "an approval for an unknown product is a not-found");
  assert.equal(res.body.error.code, "NOT_FOUND");
  assert.equal(res.body.error.requestId, "req-admin-404");
});
