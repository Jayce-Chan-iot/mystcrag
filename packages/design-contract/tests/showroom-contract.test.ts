import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SHOWROOM_MARKET_CURRENCY,
  ShowroomCollectionDetailSchema,
  ShowroomDesignerDetailSchema,
  ShowroomLocaleSchema,
  ShowroomMarketSchema,
  ShowroomPageSchema,
  ShowroomPriceSchema,
  ShowroomProductDetailSchema,
  ShowroomProductPageSchema,
  ShowroomPublicCollectionSchema,
  ShowroomPublicDesignerSchema,
  ShowroomPublicProductSchema,
  ShowroomPublicRequestSchema
} from "../src/index";
import type { ShowroomPage, ShowroomPublicProduct } from "../src/index";

const cnProduct = {
  slug: "wuye-obsidian-calm-bracelet",
  publicRevision: 3,
  title: "无野 · 黑曜石沉稳手链",
  summary: "以黑曜石圆珠为主调，搭配白水晶圆珠与黄铜隔珠，呈现克制而有层次的沉静质感。",
  media: [
    {
      url: "/showroom/wuye/obsidian-calm-01.webp",
      alt: "黑曜石沉稳手链在暖纸色背景上的正面细节照",
      width: 1600,
      height: 1200
    }
  ],
  materials: ["黑曜石圆珠 8mm", "白水晶圆珠 6mm", "黄铜隔珠"],
  specifications: [
    { label: "珠径", value: "8mm" },
    { label: "手围", value: "155mm" }
  ],
  price: { currency: "CNY", amountMinor: 128000 },
  designer: { slug: "wuye-studio", displayName: "无野" }
} as const;

const twProduct = {
  ...cnProduct,
  price: { currency: "TWD", amountMinor: 5800 }
} as const;

const designer = {
  slug: "wuye-studio",
  publicRevision: 2,
  displayName: "无野",
  summary: "独立手作工作室，以天然石与黄铜构建克制、可日常佩戴的层次。",
  story: "无野工作室坚持逐件手作与天然石原貌，作品强调沉稳主调与少量点睛。",
  media: []
} as const;

const collection = {
  slug: "wuye-quiet-series",
  publicRevision: 4,
  title: "无野 · 静水系列",
  summary: "以深色主调与清透层次构成的限量合作系列。",
  media: [
    { url: "/showroom/wuye/quiet-series-cover.webp", alt: "静水系列作品的暖纸色背景陈列照" }
  ],
  designers: [{ slug: "wuye-studio", displayName: "无野" }]
} as const;

test("showroom market and locale enums accept only CN/TW and the three approved display locales", () => {
  for (const market of ["CN", "TW"] as const) {
    assert.equal(ShowroomMarketSchema.safeParse(market).success, true);
  }
  for (const market of ["cn", "tw", "JP", "US", "CN ", "", "CN-TW", 1]) {
    assert.equal(ShowroomMarketSchema.safeParse(market).success, false);
  }

  for (const locale of ["zh-CN", "zh-TW", "en-US"] as const) {
    assert.equal(ShowroomLocaleSchema.safeParse(locale).success, true);
  }
  for (const locale of ["zh", "zh-Hans", "en", "ja-JP", "zh-cn", "en-US ", ""]) {
    assert.equal(ShowroomLocaleSchema.safeParse(locale).success, false);
  }
});

test("showroom public reads require an explicit market and locale and reject unknown query fields", () => {
  const missing = ShowroomPublicRequestSchema.safeParse({});
  assert.equal(missing.success, false);
  if (!missing.success) {
    const paths = missing.error.issues.map((issue) => issue.path.join("."));
    assert.ok(paths.includes("market"));
    assert.ok(paths.includes("locale"));
  }

  assert.equal(ShowroomPublicRequestSchema.safeParse({ market: "CN" }).success, false);
  assert.equal(ShowroomPublicRequestSchema.safeParse({ locale: "zh-CN" }).success, false);
  assert.equal(ShowroomPublicRequestSchema.safeParse({ market: "US", locale: "zh-CN" }).success, false);
  assert.equal(ShowroomPublicRequestSchema.safeParse({ market: "CN", locale: "ja-JP" }).success, false);
  // The market is never inferred from the display language.
  assert.equal(ShowroomPublicRequestSchema.safeParse({ locale: "zh-TW" }).success, false);
  // Unknown query keys, including a currency override, are rejected at the boundary.
  assert.equal(
    ShowroomPublicRequestSchema.safeParse({ market: "CN", locale: "zh-CN", currency: "USD" }).success,
    false
  );
  assert.equal(ShowroomPublicRequestSchema.safeParse({ market: "CN", locale: "zh-CN" }).success, true);
  assert.equal(ShowroomPublicRequestSchema.safeParse({ market: "TW", locale: "en-US" }).success, true);
});

test("CN and TW publish manually approved local currencies across all three display locales", () => {
  assert.deepEqual(SHOWROOM_MARKET_CURRENCY, { CN: "CNY", TW: "TWD" });

  for (const market of ["CN", "TW"] as const) {
    for (const locale of ["zh-CN", "zh-TW", "en-US"] as const) {
      const product = market === "CN" ? cnProduct : twProduct;
      const parsed = ShowroomProductDetailSchema.safeParse({ market, locale, product });
      assert.equal(parsed.success, true, `${market} ${locale}`);
      if (parsed.success) {
        assert.equal(parsed.data.product.price.currency, SHOWROOM_MARKET_CURRENCY[market]);
      }
    }
  }

  // A zh-TW display under the CN market keeps the approved CNY price, and vice versa.
  const twLocaleCnMarket = ShowroomProductDetailSchema.parse({
    market: "CN",
    locale: "zh-TW",
    product: cnProduct
  });
  assert.equal(twLocaleCnMarket.product.price.currency, "CNY");
  const cnLocaleTwMarket = ShowroomProductDetailSchema.parse({
    market: "TW",
    locale: "zh-CN",
    product: twProduct
  });
  assert.equal(cnLocaleTwMarket.product.price.currency, "TWD");
});

test("a market never accepts the other market's currency or any third currency", () => {
  assert.equal(
    ShowroomProductDetailSchema.safeParse({ market: "CN", locale: "zh-CN", product: twProduct }).success,
    false
  );
  assert.equal(
    ShowroomProductDetailSchema.safeParse({ market: "TW", locale: "zh-CN", product: cnProduct }).success,
    false
  );

  for (const currency of ["USD", "EUR", "cny", ""]) {
    assert.equal(ShowroomPriceSchema.safeParse({ currency, amountMinor: 100 }).success, false);
  }
  for (const amountMinor of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
    assert.equal(ShowroomPriceSchema.safeParse({ currency: "CNY", amountMinor }).success, false);
  }
  // Prices are only ever the manual per-market amounts; a converted value is not representable.
  assert.equal(
    ShowroomPriceSchema.safeParse({ currency: "TWD", amountMinor: 5800, convertedFrom: "CNY" }).success,
    false
  );
});

test("showroom product pages reject cross-market or cross-currency item mixes", () => {
  assert.equal(
    ShowroomProductPageSchema.safeParse({
      market: "CN",
      locale: "zh-TW",
      items: [cnProduct, twProduct],
      page: 1,
      pageSize: 24,
      total: 2
    }).success,
    false
  );
  assert.equal(
    ShowroomProductPageSchema.safeParse({
      market: "TW",
      locale: "en-US",
      items: [cnProduct],
      page: 1,
      pageSize: 24,
      total: 1
    }).success,
    false
  );

  const approved = ShowroomProductPageSchema.parse({
    market: "CN",
    locale: "zh-TW",
    items: [cnProduct],
    page: 1,
    pageSize: 24,
    total: 1
  });
  assert.equal(approved.items[0]?.price.currency, "CNY");

  // An honest empty result is representable instead of a fabricated product.
  const empty = ShowroomProductPageSchema.parse({
    market: "TW",
    locale: "zh-TW",
    items: [],
    page: 1,
    pageSize: 24,
    total: 0
  });
  assert.deepEqual(empty.items, []);
});

test("showroom products fail closed when approved copy, media, price, specs, or revision is missing", () => {
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...cnProduct, title: undefined }).success, false);
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...cnProduct, title: "   " }).success, false);
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...cnProduct, summary: undefined }).success, false);
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...cnProduct, media: [] }).success, false);
  assert.equal(
    ShowroomPublicProductSchema.safeParse({
      ...cnProduct,
      media: [{ url: "/showroom/wuye/obsidian-calm-01.webp", alt: "   " }]
    }).success,
    false
  );
  assert.equal(
    ShowroomPublicProductSchema.safeParse({
      ...cnProduct,
      media: [{ url: "", alt: "黑曜石手链细节照" }]
    }).success,
    false
  );
  assert.equal(
    ShowroomPublicProductSchema.safeParse({
      ...cnProduct,
      media: [{ url: "/showroom/wuye/obsidian-calm-01.webp", alt: "黑曜石手链细节照", width: 0 }]
    }).success,
    false
  );
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...cnProduct, materials: [] }).success, false);
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...cnProduct, specifications: [] }).success, false);
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...cnProduct, price: undefined }).success, false);
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...cnProduct, designer: undefined }).success, false);
  assert.equal(
    ShowroomPublicProductSchema.safeParse({
      ...cnProduct,
      designer: { slug: "Wuye Studio", displayName: "无野" }
    }).success,
    false
  );

  for (const publicRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
    assert.equal(
      ShowroomPublicProductSchema.safeParse({ ...cnProduct, publicRevision }).success,
      false
    );
  }
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...cnProduct, publicRevision: undefined }).success, false);

  // Approved media without recorded dimensions is still representable.
  assert.equal(
    ShowroomPublicProductSchema.safeParse({
      ...cnProduct,
      media: [{ url: "/showroom/wuye/obsidian-calm-01.webp", alt: "黑曜石手链细节照" }]
    }).success,
    true
  );
});

test("internal cost, draft, license, and purchase authority fields cannot enter public showroom shapes", () => {
  const forbiddenProductFields: Record<string, unknown> = {
    unitCostMinor: 3200,
    laborCostMinor: 1500,
    supplierReference: "supplier-17",
    internalCommercial: { marginMinor: 900 },
    draftStatus: "DRAFT",
    authorizationStatus: "REVOKED",
    licenseRevokedAt: "2026-10-11T00:00:00.000Z",
    regionRuleId: "region-cn-default",
    stockQuantity: 3,
    availableQuantity: 3,
    purchaseEnabled: true,
    checkoutUrl: "https://example.com/checkout",
    cartId: "cart_01",
    orderId: "order_01"
  };

  for (const [field, value] of Object.entries(forbiddenProductFields)) {
    assert.equal(
      ShowroomPublicProductSchema.safeParse({ ...cnProduct, [field]: value }).success,
      false,
      field
    );
  }

  // Approved media never exposes local source paths or internal checksum metadata.
  assert.equal(
    ShowroomProductDetailSchema.safeParse({
      market: "CN",
      locale: "zh-CN",
      product: {
        ...cnProduct,
        media: [{ ...cnProduct.media[0], sourcePath: "/Users/ops/raw/IMG_0001.ARW" }]
      }
    }).success,
    false
  );

  // Designer and collection shapes never carry prices.
  assert.equal(
    ShowroomPublicDesignerSchema.safeParse({ ...designer, price: { currency: "CNY", amountMinor: 100 } })
      .success,
    false
  );
  assert.equal(
    ShowroomPublicCollectionSchema.safeParse({ ...collection, price: { currency: "CNY", amountMinor: 100 } })
      .success,
    false
  );

  const parsed = ShowroomPublicProductSchema.parse(cnProduct);
  assert.deepEqual(Object.keys(parsed).sort(), [
    "designer",
    "materials",
    "media",
    "price",
    "publicRevision",
    "slug",
    "specifications",
    "summary",
    "title"
  ]);
});

test("collection and designer details embed the same approved product under the same market predicate", () => {
  const collectionDetail = ShowroomCollectionDetailSchema.parse({
    market: "CN",
    locale: "zh-CN",
    collection,
    products: [cnProduct]
  });
  assert.equal(collectionDetail.products[0]?.slug, cnProduct.slug);

  assert.equal(
    ShowroomCollectionDetailSchema.safeParse({
      market: "TW",
      locale: "en-US",
      collection,
      products: [cnProduct]
    }).success,
    false
  );

  // A series with no approved work stays visible as an honest empty state.
  const preparing = ShowroomCollectionDetailSchema.parse({
    market: "TW",
    locale: "zh-TW",
    collection,
    products: []
  });
  assert.deepEqual(preparing.products, []);

  const designerDetail = ShowroomDesignerDetailSchema.parse({
    market: "TW",
    locale: "zh-TW",
    designer,
    products: [twProduct]
  });
  assert.equal(designerDetail.designer.displayName, "无野");

  // A designer without an approved portrait never fabricates one.
  assert.deepEqual(designer.media, []);
  const noPortrait = ShowroomPublicDesignerSchema.parse(designer);
  assert.deepEqual(noPortrait.media, []);

  assert.equal(
    ShowroomDesignerDetailSchema.safeParse({
      market: "TW",
      locale: "zh-TW",
      designer,
      products: [cnProduct]
    }).success,
    false
  );
});

test("showroom list pages carry explicit pagination without inventing items", () => {
  const fullPage = ShowroomProductPageSchema.parse({
    market: "CN",
    locale: "en-US",
    items: [cnProduct],
    page: 2,
    pageSize: 24,
    total: 49
  });
  const typed: ShowroomPage<ShowroomPublicProduct> = fullPage;
  assert.equal(typed.total, 49);

  const viaFactory = ShowroomPageSchema(ShowroomPublicProductSchema).safeParse({
    market: "TW",
    locale: "zh-CN",
    items: [twProduct],
    page: 1,
    pageSize: 12,
    total: 1
  });
  assert.equal(viaFactory.success, true);

  for (const patch of [{ page: 0 }, { pageSize: 0 }, { total: -1 }, { page: 1.5 }, { unexpected: true }]) {
    assert.equal(
      ShowroomProductPageSchema.safeParse({
        market: "CN",
        locale: "en-US",
        items: [],
        page: 1,
        pageSize: 24,
        total: 0,
        ...patch
      }).success,
      false
    );
  }
});

test("showroom public schemas are exported from the package root and frozen in the API specification", () => {
  const indexSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.match(indexSource, /export \* from "\.\/schemas\/showroom\.schema"/);

  const specification = readFileSync(new URL("../../../docs/API_SPECIFICATION.md", import.meta.url), "utf8");
  assert.ok(specification.includes("## Showroom Public Read API"));
  for (const marker of [
    "ShowroomPublicRequestSchema",
    "ShowroomPublicProductSchema",
    "ShowroomPublicDesignerSchema",
    "ShowroomPublicCollectionSchema",
    "ShowroomProductPageSchema"
  ]) {
    assert.ok(specification.includes(marker), marker);
  }
  for (const marker of [
    "/api/showroom/products",
    "/api/showroom/designers",
    "/api/showroom/collections",
    "400",
    "404",
    "INTERNAL_ERROR",
    "manually approved",
    "no automatic conversion"
  ]) {
    assert.ok(specification.includes(marker), marker);
  }
});