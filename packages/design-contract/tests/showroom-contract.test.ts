import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SHOWROOM_MARKET_CURRENCY,
  ShowroomAvailabilitySchema,
  ShowroomCollectionDetailSchema,
  ShowroomDesignerDetailSchema,
  ShowroomListRequestSchema,
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

/**
 * Structural fixtures only. The copy below models the reviewed per-locale
 * projection the publication boundary selects; parsing this contract proves
 * shape, never editorial review, so no locale's copy is ever presented as
 * another locale's approved copy.
 */
const copyByLocale = {
  "zh-CN": {
    title: "无野 · 黑曜石沉稳手链",
    summary: "以黑曜石圆珠为主调，搭配白水晶圆珠与黄铜隔珠，呈现克制而有层次的沉静质感。",
    alt: "黑曜石沉稳手链在暖纸色背景上的正面细节照",
    materials: ["黑曜石圆珠 8mm", "白水晶圆珠 6mm", "黄铜隔珠"],
    specifications: [
      { label: "珠径", value: "8mm" },
      { label: "手围", value: "155mm" }
    ]
  },
  "zh-TW": {
    title: "無野 · 黑曜石沉穩手鍊",
    summary: "以黑曜石圓珠為主調，搭配白水晶圓珠與黃銅隔珠，呈現克制而有層次的沉靜質感。",
    alt: "黑曜石沉穩手鍊在暖紙色背景上的正面細節照",
    materials: ["黑曜石圓珠 8mm", "白水晶圓珠 6mm", "黃銅隔珠"],
    specifications: [
      { label: "珠徑", value: "8mm" },
      { label: "手圍", value: "155mm" }
    ]
  },
  "en-US": {
    title: "Wuye · Obsidian Calm Bracelet",
    summary:
      "Obsidian round beads lead the composition, finished with clear-quartz round beads and brass spacers for a restrained, layered calm.",
    alt: "Front detail photo of the obsidian calm bracelet on a warm paper background",
    materials: ["Obsidian round bead 8mm", "Clear quartz round bead 6mm", "Brass spacer"],
    specifications: [
      { label: "Bead diameter", value: "8mm" },
      { label: "Wrist fit", value: "155mm" }
    ]
  }
} as const;

const designerCopy = {
  "zh-CN": {
    summary: "独立手作工作室，以天然石与黄铜构建克制、可日常佩戴的层次。",
    story: "无野工作室坚持逐件手作与天然石原貌，作品强调沉稳主调与少量点睛。"
  },
  "zh-TW": {
    summary: "獨立手作工作室，以天然石與黃銅構建克制、可日常佩戴的層次。",
    story: "無野工作室堅持逐件手作與天然石原貌，作品強調沉穩主調與少量點睛。"
  },
  "en-US": {
    summary: "An independent handcraft studio building restrained, everyday layers from natural stone and brass.",
    story: "Wuye keeps every piece handcrafted and every stone true to its natural form."
  }
} as const;

const collectionCopy = {
  "zh-CN": { title: "无野 · 静水系列", summary: "以深色主调与清透层次构成的限量合作系列。" },
  "zh-TW": { title: "無野 · 靜水系列", summary: "以深色主調與清透層次構成的限量合作系列。" },
  "en-US": {
    title: "Wuye · Quiet Water Series",
    summary: "A limited collaboration series built from dark tones and clear layers."
  }
} as const;

type ProductLocale = keyof typeof copyByLocale;
type ProductMarket = "CN" | "TW";

const MARKET_AMOUNT_MINOR = { CN: 128_000, TW: 5_800 } as const;

const productFor = (market: ProductMarket, locale: ProductLocale) => {
  // The per-locale copy block also carries the media alt text; alt belongs to
  // media items only and must never leak to the product top level.
  const { alt, ...copy } = copyByLocale[locale];
  return {
    slug: "wuye-obsidian-calm-bracelet",
    publicRevision: 3,
    ...copy,
    media: [
      {
        url: "/showroom/wuye/obsidian-calm-01.webp",
        alt,
        width: 1600,
        height: 1200
      }
    ],
    price: { currency: SHOWROOM_MARKET_CURRENCY[market], amountMinor: MARKET_AMOUNT_MINOR[market] },
    designer: { slug: "wuye-studio", displayName: "无野" },
    availability: "AVAILABLE"
  };
};

const designerFor = (locale: ProductLocale) => ({
  slug: "wuye-studio",
  publicRevision: 2,
  displayName: "无野",
  ...designerCopy[locale],
  media: []
});

const collectionFor = (locale: ProductLocale) => ({
  slug: "wuye-quiet-series",
  publicRevision: 4,
  ...collectionCopy[locale],
  media: [{ url: "/showroom/wuye/quiet-series-cover.webp", alt: collectionCopy[locale].title }],
  designers: [{ slug: "wuye-studio", displayName: "无野" }]
});

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

test("detail requests stay strict while list requests carry bounded pagination, sorting, and filters", () => {
  // Details keep the minimal strict request: the market is never inferred from the language.
  assert.equal(ShowroomPublicRequestSchema.safeParse({ market: "CN", locale: "zh-CN" }).success, true);
  for (const extra of [
    { page: 1 },
    { pageSize: 24 },
    { sort: "NEWEST" },
    { designer: "wuye-studio" },
    { category: "career" },
    { currency: "USD" }
  ]) {
    assert.equal(
      ShowroomPublicRequestSchema.safeParse({ market: "CN", locale: "zh-CN", ...extra }).success,
      false,
      `detail ${JSON.stringify(extra)}`
    );
  }

  const missing = ShowroomListRequestSchema.safeParse({});
  assert.equal(missing.success, false);
  if (!missing.success) {
    const paths = missing.error.issues.map((issue) => issue.path.join("."));
    assert.ok(paths.includes("market"));
    assert.ok(paths.includes("locale"));
  }
  assert.equal(ShowroomListRequestSchema.safeParse({ market: "CN" }).success, false);
  assert.equal(ShowroomListRequestSchema.safeParse({ locale: "zh-CN" }).success, false);
  // The market is never inferred from the display language.
  assert.equal(ShowroomListRequestSchema.safeParse({ locale: "zh-TW" }).success, false);

  // Pagination, sort, and filters are bounded, and the defaults are explicit.
  const defaults = ShowroomListRequestSchema.parse({ market: "TW", locale: "en-US" });
  assert.equal(defaults.page, 1);
  assert.equal(defaults.pageSize, 24);
  assert.equal(defaults.sort, "FEATURED");

  const filtered = ShowroomListRequestSchema.parse({
    market: "CN",
    locale: "zh-TW",
    page: 3,
    pageSize: 12,
    sort: "PRICE_ASC",
    designer: "wuye-studio",
    category: "career"
  });
  assert.equal(filtered.page, 3);
  assert.equal(filtered.pageSize, 12);
  assert.equal(filtered.sort, "PRICE_ASC");
  assert.equal(filtered.designer, "wuye-studio");
  assert.equal(filtered.category, "career");

  for (const invalid of [
    { market: "CN", locale: "zh-CN", page: 0 },
    { market: "CN", locale: "zh-CN", page: 1.5 },
    { market: "CN", locale: "zh-CN", pageSize: 0 },
    { market: "CN", locale: "zh-CN", pageSize: 97 },
    { market: "CN", locale: "zh-CN", sort: "PRICE" },
    { market: "CN", locale: "zh-CN", sort: "price_asc" },
    { market: "CN", locale: "zh-CN", designer: "Wuye Studio" },
    { market: "CN", locale: "zh-CN", designer: "" },
    { market: "CN", locale: "zh-CN", category: "キャリア" },
    { market: "CN", locale: "zh-CN", currency: "USD" },
    { market: "CN", locale: "zh-CN", total: 3 },
    { market: "CN", locale: "zh-CN", fallbackLocale: "zh-TW" },
    { market: "CN", locale: "zh-CN", defaultLocale: "zh-CN" }
  ]) {
    assert.equal(ShowroomListRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
  }
});

test("CN and TW publish manually approved local currencies across all three display locales", () => {
  assert.deepEqual(SHOWROOM_MARKET_CURRENCY, { CN: "CNY", TW: "TWD" });

  for (const market of ["CN", "TW"] as const) {
    for (const locale of ["zh-CN", "zh-TW", "en-US"] as const) {
      const product = productFor(market, locale);
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
    product: productFor("CN", "zh-TW")
  });
  assert.equal(twLocaleCnMarket.product.price.currency, "CNY");
  const cnLocaleTwMarket = ShowroomProductDetailSchema.parse({
    market: "TW",
    locale: "zh-CN",
    product: productFor("TW", "zh-CN")
  });
  assert.equal(cnLocaleTwMarket.product.price.currency, "TWD");
});

test("a market never accepts the other market's currency or any third currency", () => {
  assert.equal(
    ShowroomProductDetailSchema.safeParse({
      market: "CN",
      locale: "zh-CN",
      product: productFor("TW", "zh-CN")
    }).success,
    false
  );
  assert.equal(
    ShowroomProductDetailSchema.safeParse({
      market: "TW",
      locale: "zh-CN",
      product: productFor("CN", "zh-CN")
    }).success,
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

test("approved availability states are display-only and never carry stock or purchase authority", () => {
  for (const availability of ["AVAILABLE", "INQUIRY_ONLY", "OUT_OF_STOCK", "COMING_SOON"] as const) {
    assert.equal(ShowroomAvailabilitySchema.safeParse(availability).success, true);
    assert.equal(
      ShowroomPublicProductSchema.safeParse({ ...productFor("CN", "zh-CN"), availability }).success,
      true,
      availability
    );
  }

  for (const availability of ["SOLD_OUT", "available", "CONSULT", "", 0, null, undefined, {}]) {
    assert.equal(
      ShowroomPublicProductSchema.safeParse({ ...productFor("CN", "zh-CN"), availability }).success,
      false,
      String(availability)
    );
  }

  // A display state never explains itself with a quantity or a purchase permission.
  assert.equal(
    ShowroomPublicProductSchema.safeParse({
      ...productFor("CN", "zh-CN"),
      availability: { status: "OUT_OF_STOCK", quantity: 0 }
    }).success,
    false
  );

  const parsed = ShowroomPublicProductSchema.parse({
    ...productFor("CN", "zh-CN"),
    availability: "OUT_OF_STOCK"
  });
  assert.equal(parsed.availability, "OUT_OF_STOCK");
  assert.equal(Object.keys(parsed).includes("stockQuantity"), false);
  assert.equal(Object.keys(parsed).includes("purchaseEnabled"), false);
});

test("showroom product pages reject cross-market or cross-currency item mixes", () => {
  assert.equal(
    ShowroomProductPageSchema.safeParse({
      market: "CN",
      locale: "zh-TW",
      items: [productFor("CN", "zh-CN"), productFor("TW", "zh-TW")],
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
      items: [productFor("CN", "en-US")],
      page: 1,
      pageSize: 24,
      total: 1
    }).success,
    false
  );

  const approved = ShowroomProductPageSchema.parse({
    market: "CN",
    locale: "zh-TW",
    items: [productFor("CN", "zh-TW")],
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

test("showroom products fail closed when approved copy, media, availability, price, specs, or revision is missing", () => {
  const base = productFor("CN", "zh-CN");
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...base, title: undefined }).success, false);
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...base, title: "   " }).success, false);
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...base, summary: undefined }).success, false);
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...base, availability: undefined }).success, false);
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...base, media: [] }).success, false);
  assert.equal(
    ShowroomPublicProductSchema.safeParse({
      ...base,
      media: [{ url: "/showroom/wuye/obsidian-calm-01.webp", alt: "   " }]
    }).success,
    false
  );
  assert.equal(
    ShowroomPublicProductSchema.safeParse({
      ...base,
      media: [{ url: "", alt: "黑曜石手链细节照" }]
    }).success,
    false
  );
  assert.equal(
    ShowroomPublicProductSchema.safeParse({
      ...base,
      media: [{ url: "/showroom/wuye/obsidian-calm-01.webp", alt: "黑曜石手链细节照", width: 0 }]
    }).success,
    false
  );
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...base, materials: [] }).success, false);
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...base, specifications: [] }).success, false);
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...base, price: undefined }).success, false);
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...base, designer: undefined }).success, false);
  assert.equal(
    ShowroomPublicProductSchema.safeParse({
      ...base,
      designer: { slug: "Wuye Studio", displayName: "无野" }
    }).success,
    false
  );

  for (const publicRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
    assert.equal(ShowroomPublicProductSchema.safeParse({ ...base, publicRevision }).success, false);
  }
  assert.equal(ShowroomPublicProductSchema.safeParse({ ...base, publicRevision: undefined }).success, false);

  // Approved media without recorded dimensions is still representable.
  assert.equal(
    ShowroomPublicProductSchema.safeParse({
      ...base,
      media: [{ url: "/showroom/wuye/obsidian-calm-01.webp", alt: "黑曜石手链细节照" }]
    }).success,
    true
  );
});

test("approved media addresses are site-relative paths or https URLs; dangerous schemes are rejected", () => {
  const base = productFor("CN", "zh-CN");
  const withUrl = (url: string) => ({
    ...base,
    media: [{ url, alt: "obsidian calm bracelet detail" }]
  });

  for (const url of [
    "/showroom/wuye/obsidian-calm-01.webp",
    "/showroom/wuye/nested/obsidian-calm-01.webp",
    "https://cdn.example.com/showroom/wuye/obsidian-calm-01.webp"
  ]) {
    assert.equal(ShowroomPublicProductSchema.safeParse(withUrl(url)).success, true, url);
  }

  for (const url of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "file:///Users/ops/raw/IMG_0001.ARW",
    "vbscript:msgbox(1)",
    "blob:https://example.com/8b1c",
    "http://cdn.example.com/showroom/x.webp",
    "HTTPS://cdn.example.com/showroom/x.webp",
    "//evil.example/x.webp",
    "showroom/wuye/obsidian-calm-01.webp",
    "/",
    "",
    "   "
  ]) {
    assert.equal(ShowroomPublicProductSchema.safeParse(withUrl(url)).success, false, url);
  }

  // Designer and collection media follow the same approved address policy.
  assert.equal(
    ShowroomPublicDesignerSchema.safeParse({
      ...designerFor("zh-CN"),
      media: [{ url: "javascript:alert(1)", alt: "portrait" }]
    }).success,
    false
  );
  assert.equal(
    ShowroomPublicCollectionSchema.safeParse({
      ...collectionFor("zh-CN"),
      media: [{ url: "data:image/png;base64,AAAA", alt: "cover" }]
    }).success,
    false
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
      ShowroomPublicProductSchema.safeParse({ ...productFor("CN", "zh-CN"), [field]: value }).success,
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
        ...productFor("CN", "zh-CN"),
        media: [
          {
            url: "/showroom/wuye/obsidian-calm-01.webp",
            alt: "黑曜石手链细节照",
            sourcePath: "/Users/ops/raw/IMG_0001.ARW"
          }
        ]
      }
    }).success,
    false
  );

  // Designer and collection shapes never carry prices.
  assert.equal(
    ShowroomPublicDesignerSchema.safeParse({
      ...designerFor("zh-CN"),
      price: { currency: "CNY", amountMinor: 100 }
    }).success,
    false
  );
  assert.equal(
    ShowroomPublicCollectionSchema.safeParse({
      ...collectionFor("zh-CN"),
      price: { currency: "CNY", amountMinor: 100 }
    }).success,
    false
  );

  const parsed = ShowroomPublicProductSchema.parse(productFor("CN", "zh-CN"));
  assert.deepEqual(Object.keys(parsed).sort(), [
    "availability",
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

test("editorial review, withdrawal, and missing-translation fallback fail closed at the publication boundary, not in this shape", () => {
  // This contract validates shape, currency, and required fields only. It cannot
  // prove that copy was editorially reviewed for the requested locale, that the
  // publication authorization is still valid, or that a locale has reviewed
  // copy at all; the publication boundary owns those decisions and must exclude
  // or 404 a resource instead of falling back. What the contract does own is
  // that the dishonest shortcuts are unrepresentable: there is no fallback
  // locale, no review or withdrawal authority, and no locale-less copy.
  assert.equal(
    ShowroomProductDetailSchema.safeParse({
      market: "CN",
      locale: "en-US",
      product: productFor("CN", "en-US"),
      fallbackLocale: "zh-CN"
    }).success,
    false
  );
  assert.equal(
    ShowroomProductDetailSchema.safeParse({
      market: "CN",
      locale: "en-US",
      product: { ...productFor("CN", "en-US"), fallbackLocale: "zh-CN" }
    }).success,
    false
  );
  assert.equal(
    ShowroomProductPageSchema.safeParse({
      market: "TW",
      locale: "zh-TW",
      items: [productFor("TW", "zh-TW")],
      page: 1,
      pageSize: 24,
      total: 1,
      defaultLocale: "zh-CN"
    }).success,
    false
  );
  assert.equal(
    ShowroomDesignerDetailSchema.safeParse({
      market: "TW",
      locale: "zh-TW",
      designer: { ...designerFor("zh-TW"), withdrawnAt: "2026-10-11T00:00:00.000Z" },
      products: []
    }).success,
    false
  );
  assert.equal(
    ShowroomPublicCollectionSchema.safeParse({
      ...collectionFor("zh-CN"),
      authorizationStatus: "REVOKED"
    }).success,
    false
  );
  assert.equal(
    ShowroomPublicDesignerSchema.safeParse({ ...designerFor("zh-CN"), reviewStatus: "APPROVED" }).success,
    false
  );
  assert.equal(
    ShowroomPublicProductSchema.safeParse({
      ...productFor("CN", "zh-CN"),
      reviewStatus: "APPROVED",
      reviewedBy: "editor-01"
    }).success,
    false
  );

  // A response can never serve copy without declaring which requested locale it
  // was selected for, so a fallback projection must be an explicit, rejected lie.
  assert.equal(
    ShowroomProductDetailSchema.safeParse({ market: "CN", product: productFor("CN", "zh-CN") }).success,
    false
  );
});

test("collection and designer details embed the same approved product under the same market predicate", () => {
  const collectionDetail = ShowroomCollectionDetailSchema.parse({
    market: "CN",
    locale: "zh-CN",
    collection: collectionFor("zh-CN"),
    products: [productFor("CN", "zh-CN")]
  });
  assert.equal(collectionDetail.products[0]?.slug, "wuye-obsidian-calm-bracelet");

  assert.equal(
    ShowroomCollectionDetailSchema.safeParse({
      market: "TW",
      locale: "en-US",
      collection: collectionFor("en-US"),
      products: [productFor("CN", "en-US")]
    }).success,
    false
  );

  // A series with no approved work stays visible as an honest empty state.
  const preparing = ShowroomCollectionDetailSchema.parse({
    market: "TW",
    locale: "zh-TW",
    collection: collectionFor("zh-TW"),
    products: []
  });
  assert.deepEqual(preparing.products, []);

  const designerDetail = ShowroomDesignerDetailSchema.parse({
    market: "TW",
    locale: "zh-TW",
    designer: designerFor("zh-TW"),
    products: [productFor("TW", "zh-TW")]
  });
  assert.equal(designerDetail.designer.displayName, "无野");

  // A designer without an approved portrait never fabricates one.
  const noPortrait = ShowroomPublicDesignerSchema.parse(designerFor("zh-TW"));
  assert.deepEqual(noPortrait.media, []);

  assert.equal(
    ShowroomDesignerDetailSchema.safeParse({
      market: "TW",
      locale: "zh-TW",
      designer: designerFor("zh-TW"),
      products: [productFor("CN", "zh-TW")]
    }).success,
    false
  );
});

test("showroom list pages carry explicit pagination without inventing items", () => {
  const fullPage = ShowroomProductPageSchema.parse({
    market: "CN",
    locale: "en-US",
    items: [productFor("CN", "en-US")],
    page: 2,
    pageSize: 24,
    total: 49
  });
  const typed: ShowroomPage<ShowroomPublicProduct> = fullPage;
  assert.equal(typed.total, 49);

  const viaFactory = ShowroomPageSchema(ShowroomPublicProductSchema).safeParse({
    market: "TW",
    locale: "zh-CN",
    items: [productFor("TW", "zh-CN")],
    page: 1,
    pageSize: 12,
    total: 1
  });
  assert.equal(viaFactory.success, true);

  for (const patch of [
    { page: 0 },
    { pageSize: 0 },
    { pageSize: 97 },
    { total: -1 },
    { page: 1.5 },
    { unexpected: true }
  ]) {
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
    "ShowroomListRequestSchema",
    "ShowroomPublicProductSchema",
    "ShowroomPublicDesignerSchema",
    "ShowroomPublicCollectionSchema",
    "ShowroomProductPageSchema",
    "ShowroomAvailabilitySchema"
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
    "no automatic conversion",
    "editorially reviewed",
    "publication boundary",
    "no fallback",
    "site-relative",
    "https://"
  ]) {
    assert.ok(specification.includes(marker), marker);
  }
});