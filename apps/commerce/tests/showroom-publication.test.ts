import assert from "node:assert/strict";
import test from "node:test";

import {
  SHOWROOM_MARKET_CURRENCY,
  type ShowroomLocale,
  type ShowroomMarket
} from "@mystcrag/design-contract";

import {
  appendAuditEvent,
  computePriceFingerprint,
  computeTranslationFingerprint,
  evaluateShowroomCollection,
  evaluateShowroomDesigner,
  evaluateShowroomProduct,
  mergeWithdrawalFacts,
  publicStateFacts,
  type ShowroomApprovalRecord,
  type ShowroomLiveProduct,
  type ShowroomMarketContext,
  type ShowroomMediaRecord
} from "../src/showroom/publication-gate";

// TASK-COMMERCE-GATE-001 publication predicate contract.
//
// Every anonymous public read is decided by this one predicate. These tests pin
// the fail-closed boundary: missing translation, missing manually approved
// price, missing approved media, draft, revoked/expired/not-yet-effective
// authorization, wrong market and withdrawn media all deny; a granted result is
// always a strictly parsed Design Contract DTO.

const NOW = "2026-10-13T00:00:00.000Z";
const REGION_CN = "region_cn_mainland";
const REGION_TW = "region_tw_taiwan";

const CN_PRICE_MINOR = 128_000;
const TW_PRICE_MINOR = 560_000;

// The live product handle (its public slug) the approved subject serves under.
const PRODUCT_HANDLE = "wuye-calm-water-bracelet";

const MARKETS: ShowroomMarket[] = ["CN", "TW"];
const LOCALES: ShowroomLocale[] = ["zh-CN", "zh-TW", "en-US"];

const regionFor = (market: ShowroomMarket) => (market === "CN" ? REGION_CN : REGION_TW);
const amountFor = (market: ShowroomMarket) => (market === "CN" ? CN_PRICE_MINOR : TW_PRICE_MINOR);
const currencyFor = (market: ShowroomMarket) => (market === "CN" ? "CNY" : "TWD");

function approvedPriceFor(market: ShowroomMarket) {
  const currency = currencyFor(market);
  return {
    market,
    currency,
    amountMinor: amountFor(market),
    regionId: regionFor(market),
    fingerprint: computePriceFingerprint(regionFor(market), currency, amountFor(market))
  };
}

function contextFor(market: ShowroomMarket, locale: ShowroomLocale): ShowroomMarketContext {
  return { market, locale, regionId: regionFor(market), now: NOW };
}

function reviewedLocaleCopy(reviewedRevision = 1) {
  return {
    reviewedRevision,
    title: "无野 · 静水手链",
    summary: "天然的静水石与黄铜细节，克制而当代。",
    materials: ["天然静水石", "黄铜"],
    specifications: [{ label: "内径", value: "16cm" }],
    designer: { slug: "designer-lin", displayName: "林也" }
  };
}

function approvedMedia() {
  return [
    { url: "/showroom/wuye/hero-1.webp", alt: "手链正视图", checksum: "sha256:aaa", approved: true, withdrawn: false, width: 1200, height: 1200 },
    { url: "https://cdn.example.com/wuye/side-1.webp", alt: "手链侧视图", checksum: "sha256:bbb", approved: true, withdrawn: false }
  ];
}

function makeApproval(overrides: Partial<ShowroomApprovalRecord> = {}): ShowroomApprovalRecord {
  const base: ShowroomApprovalRecord = {
    subjectKind: "PRODUCT",
    subjectRef: "prod_wuye_bracelet",
    publicRevision: 3,
    authorization: {
      status: "APPROVED",
      markets: ["CN", "TW"],
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z"
    },
    availability: "AVAILABLE",
    prices: { CN: approvedPriceFor("CN"), TW: approvedPriceFor("TW") },
    locales: {
      "zh-CN": reviewedLocaleCopy(3),
      "zh-TW": reviewedLocaleCopy(3),
      "en-US": reviewedLocaleCopy(3)
    },
    media: approvedMedia(),
    audit: []
  };
  return { ...base, ...overrides };
}

function makeProduct(overrides: Partial<ShowroomLiveProduct> = {}): ShowroomLiveProduct {
  const base: ShowroomLiveProduct = {
    id: "prod_wuye_bracelet",
    handle: "wuye-calm-water-bracelet",
    status: "published",
    collectionId: "col_wuye_originals",
    createdAt: "2026-09-01T00:00:00.000Z",
    categoryHandles: ["bracelets"],
    variants: [
      {
        id: "variant_1",
        prices: [
          { regionId: REGION_CN, currencyCode: "cny", amountMinor: CN_PRICE_MINOR },
          { regionId: REGION_TW, currencyCode: "twd", amountMinor: TW_PRICE_MINOR }
        ]
      }
    ]
  };
  return { ...base, ...overrides };
}

function expectDenied(result: { ok: boolean; reason?: string }, reason: string) {
  assert.equal(result.ok, false, `expected a denial, got a grant`);
  assert.equal(result.reason, reason);
}

// --- grants across every market x locale ------------------------------------

test("an approved product is served for CN/TW across all three locales with the market's own currency", () => {
  for (const market of MARKETS) {
    for (const locale of LOCALES) {
      const result = evaluateShowroomProduct(makeProduct(), makeApproval(), contextFor(market, locale));
      assert.equal(result.ok, true, `expected a grant for ${market}/${locale}`);
      if (!result.ok) {
        return;
      }
      assert.equal(result.value.price.currency, SHOWROOM_MARKET_CURRENCY[market]);
      assert.equal(result.value.price.amountMinor, amountFor(market));
      assert.equal(result.value.publicRevision, 3);
      assert.ok(result.value.media.length >= 1);
    }
  }
});

// --- fail-closed: the cross-market and cross-locale rules ------------------

test("the display locale never decides the market currency: zh-TW on CN keeps CNY and zh-CN on TW keeps TWD", () => {
  const cn = evaluateShowroomProduct(makeProduct(), cnTwApproval(), contextFor("CN", "zh-TW"));
  assert.equal(cn.ok, true);
  if (cn.ok) {
    assert.equal(cn.value.price.currency, "CNY", "zh-TW must keep the approved CN currency");
  }
  const tw = evaluateShowroomProduct(makeProduct(), cnTwApproval(), contextFor("TW", "zh-CN"));
  assert.equal(tw.ok, true);
  if (tw.ok) {
    assert.equal(tw.value.price.currency, "TWD", "zh-CN must keep the approved TW currency");
  }
});

function cnTwApproval(): ShowroomApprovalRecord {
  // The live rows carry both markets and the record carries one approved price
  // fingerprint per market, as the admin records each market's row separately.
  return makeApproval();
}

test("a price approved for the other market is refused instead of converted", () => {
  const cnOnly = makeApproval({ prices: { CN: approvedPriceFor("CN") } });
  const twRequest = makeApproval({ prices: { TW: approvedPriceFor("TW") } });
  expectDenied(
    evaluateShowroomProduct(makeProduct(), cnOnly, contextFor("TW", "zh-TW")),
    "PRICE_NOT_APPROVED_FOR_MARKET"
  );
  const twGrant = evaluateShowroomProduct(makeProduct(), twRequest, contextFor("TW", "zh-TW"));
  assert.equal(twGrant.ok, true, "the TW-approved price serves TW");
  expectDenied(
    evaluateShowroomProduct(makeProduct(), twRequest, contextFor("CN", "zh-CN")),
    "PRICE_NOT_APPROVED_FOR_MARKET"
  );
});

test("a withdrawn media set fails closed and a partially withdrawn set serves only the remaining assets", () => {
  const allWithdrawn = makeApproval({
    media: [
      { url: "/showroom/wuye/hero-1.webp", alt: "a", checksum: "sha256:aaa", approved: true, withdrawn: true },
      { url: "https://cdn.example.com/b.webp", alt: "b", checksum: "sha256:bbb", approved: true, withdrawn: true }
    ]
  });
  expectDenied(evaluateShowroomProduct(makeProduct(), allWithdrawn, contextFor("CN", "zh-CN")), "NO_APPROVED_MEDIA");

  const oneWithdrawn = makeApproval({
    media: [
      { url: "/showroom/wuye/hero-1.webp", alt: "a", checksum: "sha256:aaa", approved: true, withdrawn: true },
      { url: "https://cdn.example.com/b.webp", alt: "b", checksum: "sha256:bbb", approved: true, withdrawn: false }
    ]
  });
  const result = evaluateShowroomProduct(makeProduct(), oneWithdrawn, contextFor("CN", "zh-CN"));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.media.length, 1, "the withdrawn asset must not be served");
    assert.equal(result.value.media[0].url, "https://cdn.example.com/b.webp");
  }
});

test("an unapproved or checksum-less media asset is never servable", () => {
  const unapproved = makeApproval({
    media: [{ url: "/showroom/wuye/hero-1.webp", alt: "a", checksum: "sha256:aaa", approved: false, withdrawn: false }]
  });
  expectDenied(evaluateShowroomProduct(makeProduct(), unapproved, contextFor("CN", "zh-CN")), "NO_APPROVED_MEDIA");

  const noChecksum = makeApproval({
    media: [{ url: "/showroom/wuye/hero-1.webp", alt: "a", checksum: "  ", approved: true, withdrawn: false }]
  });
  expectDenied(evaluateShowroomProduct(makeProduct(), noChecksum, contextFor("CN", "zh-CN")), "NO_APPROVED_MEDIA");
});

test("missing translation for the requested locale fails closed without falling back", () => {
  const approval = makeApproval({ locales: { "zh-CN": reviewedLocaleCopy(3) } });
  expectDenied(evaluateShowroomProduct(makeProduct(), approval, contextFor("CN", "en-US")), "NO_REVIEWED_COPY");
  assert.equal(
    evaluateShowroomProduct(makeProduct(), approval, contextFor("CN", "zh-CN")).ok,
    true,
    "the reviewed locale still serves"
  );
});

test("copy reviewed at a stale revision fails closed", () => {
  const approval = makeApproval({
    locales: { "zh-CN": reviewedLocaleCopy(2), "zh-TW": reviewedLocaleCopy(3), "en-US": reviewedLocaleCopy(3) }
  });
  expectDenied(evaluateShowroomProduct(makeProduct(), approval, contextFor("CN", "zh-CN")), "STALE_REVIEW");
});

test("a draft product is never public", () => {
  expectDenied(
    evaluateShowroomProduct(makeProduct({ status: "draft" }), makeApproval(), contextFor("CN", "zh-CN")),
    "NOT_PUBLISHED"
  );
  expectDenied(
    evaluateShowroomProduct(makeProduct({ status: null }), makeApproval(), contextFor("CN", "zh-CN")),
    "NOT_PUBLISHED"
  );
});

test("a missing approval fails closed", () => {
  expectDenied(evaluateShowroomProduct(makeProduct(), null, contextFor("CN", "zh-CN")), "NO_APPROVAL");
});

test("a revoked authorization fails closed", () => {
  const revoked = makeApproval({
    authorization: { ...makeApproval().authorization, status: "REVOKED" }
  });
  expectDenied(evaluateShowroomProduct(makeProduct(), revoked, contextFor("CN", "zh-CN")), "AUTHORIZATION_REVOKED");
});

test("an expired or not-yet-effective authorization fails closed", () => {
  const expired = makeApproval({
    authorization: { ...makeApproval().authorization, effectiveFrom: "2025-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:00:00.000Z" }
  });
  expectDenied(evaluateShowroomProduct(makeProduct(), expired, contextFor("CN", "zh-CN")), "AUTHORIZATION_EXPIRED");

  const future = makeApproval({
    authorization: { ...makeApproval().authorization, effectiveFrom: "2026-12-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }
  });
  expectDenied(evaluateShowroomProduct(makeProduct(), future, contextFor("CN", "zh-CN")), "AUTHORIZATION_NOT_YET_EFFECTIVE");
});

test("an authorization that does not cover the requested market fails closed", () => {
  const cnOnly = makeApproval({
    authorization: { ...makeApproval().authorization, markets: ["CN"] }
  });
  expectDenied(evaluateShowroomProduct(makeProduct(), cnOnly, contextFor("TW", "zh-TW")), "MARKET_NOT_AUTHORIZED");
});

test("a missing availability state fails closed", () => {
  expectDenied(
    evaluateShowroomProduct(makeProduct(), makeApproval({ availability: null }), contextFor("CN", "zh-CN")),
    "NO_AVAILABILITY_STATE"
  );
});

test("a missing manually approved price fails closed", () => {
  expectDenied(
    evaluateShowroomProduct(makeProduct(), makeApproval({ prices: {} }), contextFor("CN", "zh-CN")),
    "NO_APPROVED_PRICE"
  );
});

test("an invalid public revision fails closed", () => {
  expectDenied(
    evaluateShowroomProduct(makeProduct(), makeApproval({ publicRevision: 0 }), contextFor("CN", "zh-CN")),
    "INVALID_PUBLIC_REVISION"
  );
});

test("a price changed in Medusa after approval fails closed through its fingerprint", () => {
  const changed = makeProduct({
    variants: [
      {
        id: "variant_1",
        prices: [{ regionId: REGION_CN, currencyCode: "cny", amountMinor: CN_PRICE_MINOR + 1_000 }]
      }
    ]
  });
  expectDenied(evaluateShowroomProduct(changed, makeApproval(), contextFor("CN", "zh-CN")), "PRICE_CHANGED_SINCE_APPROVAL");
});

test("a missing live price row or region fails closed", () => {
  const noPrice = makeProduct({ variants: [{ id: "variant_1", prices: [] }] });
  expectDenied(evaluateShowroomProduct(noPrice, makeApproval(), contextFor("CN", "zh-CN")), "NO_LIVE_PRICE");

  const noRegion: ShowroomMarketContext = { market: "CN", locale: "zh-CN", regionId: null, now: NOW };
  expectDenied(evaluateShowroomProduct(makeProduct(), makeApproval(), noRegion), "NO_LIVE_PRICE");
});

test("the public shape is enforced at runtime, not merely by the TypeScript type", () => {
  // `materials: []` type-checks but violates the DTO's non-empty constraint.
  const approval = makeApproval({
    locales: {
      "zh-CN": { ...reviewedLocaleCopy(3), materials: [] },
      "zh-TW": reviewedLocaleCopy(3),
      "en-US": reviewedLocaleCopy(3)
    }
  });
  expectDenied(evaluateShowroomProduct(makeProduct(), approval, contextFor("CN", "zh-CN")), "INVALID_PUBLIC_SHAPE");
});

// --- designer and collection share the same predicate -----------------------

test("a designer profile is granted only with active authorization and reviewed copy", () => {
  const designer: ShowroomApprovalRecord = {
    subjectKind: "DESIGNER",
    subjectRef: "designer-lin",
    publicRevision: 2,
    authorization: { status: "APPROVED", markets: ["CN", "TW"], effectiveFrom: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" },
    availability: null,
    prices: {},
    locales: {
      "zh-CN": { reviewedRevision: 2, title: "林也", summary: "以天然石为语言的独立设计师。", story: "林也在无野工作室..." },
      "zh-TW": { reviewedRevision: 2, title: "林也", summary: "以天然石為語言的獨立設計師。", story: "林也在無野工作室..." },
      "en-US": { reviewedRevision: 2, title: "Lin Ye", summary: "A designer working in natural stone.", story: "Lin Ye works from..." }
    },
    media: approvedMedia(),
    audit: []
  };
  const granted = evaluateShowroomDesigner(designer, contextFor("TW", "en-US"));
  assert.equal(granted.ok, true);
  if (granted.ok) {
    assert.equal(granted.value.slug, "designer-lin");
    assert.equal(granted.value.story.length > 0, true);
  }
  expectDenied(
    evaluateShowroomDesigner(designer, contextFor("CN", "fr-FR" as ShowroomLocale)),
    "NO_REVIEWED_COPY"
  );
  expectDenied(evaluateShowroomDesigner(null, contextFor("CN", "zh-CN")), "NO_APPROVAL");
  expectDenied(
    evaluateShowroomDesigner({ ...designer, authorization: { ...designer.authorization, markets: ["TW"] } }, contextFor("CN", "zh-CN")),
    "MARKET_NOT_AUTHORIZED"
  );
});

test("a collection is granted only with active authorization and reviewed copy", () => {
  const collection: ShowroomApprovalRecord = {
    subjectKind: "COLLECTION",
    subjectRef: "wuye-originals",
    publicRevision: 1,
    authorization: { status: "APPROVED", markets: ["CN"], effectiveFrom: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" },
    availability: null,
    prices: {},
    locales: {
      "zh-CN": { reviewedRevision: 1, title: "无野原石系列", summary: "来自同一批原石的克制作品。", designers: [{ slug: "designer-lin", displayName: "林也" }] }
    },
    media: approvedMedia(),
    audit: []
  };
  const granted = evaluateShowroomCollection("wuye-originals", collection, contextFor("CN", "zh-CN"));
  assert.equal(granted.ok, true);
  if (granted.ok) {
    assert.equal(granted.value.designers.length, 1);
  }
  expectDenied(evaluateShowroomCollection("wuye-originals", collection, contextFor("CN", "en-US")), "NO_REVIEWED_COPY");
  expectDenied(evaluateShowroomCollection("wuye-originals", collection, contextFor("TW", "zh-TW")), "MARKET_NOT_AUTHORIZED");
});

// --- audit -------------------------------------------------------------------

test("audit events are appended immutably and revoked state reaches the predicate", () => {
  const base = makeApproval();
  const withApproval = appendAuditEvent(base, { action: "APPROVED", at: NOW, actorId: "admin-1" });
  assert.equal(base.audit.length, 0, "the base record is not mutated");
  assert.equal(withApproval.audit.length, 1);

  const revoked = appendAuditEvent(withApproval, { action: "REVOKED", at: NOW, actorId: "admin-2", reason: "授权撤回" });
  assert.equal(revoked.audit.length, 2);
  expectDenied(
    evaluateShowroomProduct(
      makeProduct(),
      { ...revoked, authorization: { ...revoked.authorization, status: "REVOKED" } },
      contextFor("CN", "zh-CN")
    ),
    "AUTHORIZATION_REVOKED"
  );
  assert.equal(evaluateShowroomProduct(makeProduct(), withApproval, contextFor("CN", "zh-CN")).ok, true);
});

// --- live translation version and withdrawal facts --------------------------

test("a translation edited in Medusa Admin after review fails closed through its fingerprint", () => {
  const reviewed = computeTranslationFingerprint({ title: "无野 · 静水手链" });
  const approval = makeApproval({
    locales: {
      "zh-CN": { ...reviewedLocaleCopy(3), translationFingerprint: reviewed },
      "zh-TW": reviewedLocaleCopy(3),
      "en-US": reviewedLocaleCopy(3)
    }
  });
  assert.equal(
    evaluateShowroomProduct(makeProduct({ translations: { "zh-CN": reviewed } }), approval, contextFor("CN", "zh-CN")).ok,
    true,
    "a copy pinned to the live version still serves"
  );

  const edited = computeTranslationFingerprint({ title: "无野 · 静水手链（Admin 改动）" });
  expectDenied(
    evaluateShowroomProduct(makeProduct({ translations: { "zh-CN": edited } }), approval, contextFor("CN", "zh-CN")),
    "TRANSLATION_CHANGED_SINCE_REVIEW"
  );
});

test("a reviewed copy with no pinned live-translation fingerprint fails closed when the live version is available", () => {
  const live = computeTranslationFingerprint({ title: "无野 · 静水手链" });
  expectDenied(
    evaluateShowroomProduct(makeProduct({ translations: { "zh-CN": live } }), makeApproval(), contextFor("CN", "zh-CN")),
    "TRANSLATION_CHANGED_SINCE_REVIEW"
  );
});

test("creating a translation later changes the fingerprint from its empty sentinel", () => {
  const empty = computeTranslationFingerprint(null);
  assert.notEqual(empty, computeTranslationFingerprint({ title: "x" }));
  const approval = makeApproval({
    locales: {
      "zh-CN": { ...reviewedLocaleCopy(3), translationFingerprint: empty },
      "zh-TW": reviewedLocaleCopy(3),
      "en-US": reviewedLocaleCopy(3)
    }
  });
  assert.equal(
    evaluateShowroomProduct(makeProduct({ translations: { "zh-CN": empty } }), approval, contextFor("CN", "zh-CN")).ok,
    true,
    "no stored translation still serves against its sentinel"
  );
  expectDenied(
    evaluateShowroomProduct(
      makeProduct({ translations: { "zh-CN": computeTranslationFingerprint({ title: "新增译文" }) } }),
      approval,
      contextFor("CN", "zh-CN")
    ),
    "TRANSLATION_CHANGED_SINCE_REVIEW"
  );
});

test("re-submitting the original APPROVE never reintroduces a withdrawn media asset", () => {
  const withdrawn = approvedMedia().map((asset) => ({ ...asset, withdrawn: true }));
  const merged = mergeWithdrawalFacts(withdrawn, approvedMedia());
  assert.equal(merged.every((asset) => asset.withdrawn), true, "the withdrawal fact survives a re-approval");
  assert.equal(merged.length, approvedMedia().length, "the incoming approved set is preserved");

  const fresh = mergeWithdrawalFacts(
    [{ url: "/x.webp", alt: "x", checksum: "sha256:old", approved: true, withdrawn: true }],
    [{ url: "/y.webp", alt: "y", checksum: "sha256:new", approved: true, withdrawn: false }]
  );
  assert.equal(fresh[0].withdrawn, false, "an unrelated new asset is not withdrawn");

  const reintroduced = { ...makeApproval({ media: merged }) };
  expectDenied(
    evaluateShowroomProduct(makeProduct(), reintroduced, contextFor("CN", "zh-CN")),
    "NO_APPROVED_MEDIA"
  );
});

test("audit events retain the version, authorization and media facts of each decision", () => {
  const approved = appendAuditEvent(makeApproval(), {
    action: "APPROVED",
    at: NOW,
    actorId: "admin-1",
    publicRevision: 3,
    authorizationStatus: "APPROVED",
    markets: ["CN", "TW"],
    approvedMedia: [{ checksum: "sha256:aaa", url: "/showroom/wuye/hero-1.webp", alt: "手链正视图" }]
  });
  const withdrawn = appendAuditEvent(approved, {
    action: "MEDIA_WITHDRAWN",
    at: NOW,
    actorId: "admin-2",
    publicRevision: 3,
    withdrawnMedia: { checksum: "sha256:aaa", url: "/showroom/wuye/hero-1.webp", alt: "手链正视图" }
  });
  assert.equal(withdrawn.audit.length, 2);
  assert.equal(withdrawn.audit[0].publicRevision, 3);
  assert.deepEqual(withdrawn.audit[0].markets, ["CN", "TW"]);
  assert.equal(withdrawn.audit[0].approvedMedia?.[0].checksum, "sha256:aaa");
  assert.equal(withdrawn.audit[0].approvedMedia?.[0].alt, "手链正视图", "the media alt is part of the recorded fact");
  assert.equal(withdrawn.audit[1].withdrawnMedia?.checksum, "sha256:aaa");
  assert.equal(withdrawn.audit[1].withdrawnMedia?.alt, "手链正视图", "the withdrawn media alt is recorded");
  assert.equal(withdrawn.audit[1].publicRevision, 3);
});

// --- withdrawal facts survive an arbitrary sequence of later approvals ------

test("a withdrawn asset stays withdrawn across an arbitrary sequence of later approvals", () => {
  const [assetA, assetB] = approvedMedia();
  const withdrawn = (assets: ShowroomMediaRecord[]) =>
    assets.map((asset) => (asset.checksum === assetA.checksum ? { ...asset, withdrawn: true } : asset));
  const checksumOfA = assetA.checksum;

  // APPROVE [A, B]
  let media = mergeWithdrawalFacts([], [assetA, assetB]);
  // WITHDRAW_MEDIA A
  media = mergeWithdrawalFacts(media, withdrawn(media));
  assert.equal(
    media.find((asset) => asset.checksum === checksumOfA)?.withdrawn,
    true,
    "the withdrawal takes effect"
  );

  // APPROVE only [B]: the subject must keep the A withdrawal tombstone even
  // though A is absent from the incoming media set.
  media = mergeWithdrawalFacts(media, [assetB]);
  assert.equal(
    media.find((asset) => asset.checksum === checksumOfA)?.withdrawn,
    true,
    "the withdrawal fact must survive an approval that omits A"
  );

  // APPROVE [A, B] again: reintroducing A must not revive it.
  media = mergeWithdrawalFacts(media, [assetA, assetB]);
  assert.equal(
    media.find((asset) => asset.checksum === checksumOfA)?.withdrawn,
    true,
    "the withdrawal fact must survive a later approval that reintroduces A"
  );

  const record = makeApproval({ media });
  const granted = evaluateShowroomProduct(makeProduct(), record, contextFor("CN", "zh-CN"));
  assert.equal(granted.ok, true, "the subject still serves through its remaining approved asset");
  if (granted.ok) {
    assert.equal(granted.value.media.length, 1, "only the surviving asset is servable");
    assert.equal(granted.value.media[0].url, assetB.url);
  }

  const allWithdrawn = makeApproval({ media: withdrawAll(media) });
  expectDenied(evaluateShowroomProduct(makeProduct(), allWithdrawn, contextFor("CN", "zh-CN")), "NO_APPROVED_MEDIA");
});

function withdrawAll(assets: ShowroomMediaRecord[]) {
  return assets.map((asset) => ({ ...asset, withdrawn: true }));
}

// --- audit facts rebuild the public state -----------------------------------

test("the recorded public-state facts carry the authorization window, display state, approved prices and the full approved copy", () => {
  const record = makeApproval({
    locales: {
      "zh-CN": { ...reviewedLocaleCopy(3), translationFingerprint: "fp-reviewed-zh" },
      "zh-TW": reviewedLocaleCopy(3),
      "en-US": reviewedLocaleCopy(3)
    }
  });
  const facts = publicStateFacts(record);

  assert.equal(facts.publicRevision, 3);
  assert.equal(facts.authorizationStatus, "APPROVED");
  assert.deepEqual(facts.markets, ["CN", "TW"]);
  assert.equal(facts.effectiveFrom, record.authorization.effectiveFrom, "the authorization window start is recorded");
  assert.equal(facts.expiresAt, record.authorization.expiresAt, "the authorization expiry is recorded");
  assert.equal(facts.availability, "AVAILABLE", "the display state is recorded");
  assert.equal(facts.approvedPrices.length, 2, "every approved market price is recorded");
  const cn = facts.approvedPrices.find((price) => price.market === "CN");
  assert.equal(cn?.amountMinor, CN_PRICE_MINOR);
  assert.equal(cn?.currency, "CNY");
  assert.equal(cn?.regionId, REGION_CN);
  assert.equal(cn?.fingerprint, record.prices.CN?.fingerprint, "the approved price fingerprint is recorded");
  assert.equal(facts.approvedCopy.length, 3, "every approved locale is recorded");
  const zh = facts.approvedCopy.find((fact) => fact.locale === "zh-CN");
  assert.equal(zh?.copy.reviewedRevision, 3);
  assert.equal(zh?.copy.title, "无野 · 静水手链", "the whole approved copy is recorded, not just a fingerprint");
  assert.equal(zh?.copy.summary, "天然的静水石与黄铜细节，克制而当代。");
  assert.deepEqual(zh?.copy.materials, ["天然静水石", "黄铜"]);
  assert.deepEqual(zh?.copy.specifications, [{ label: "内径", value: "16cm" }]);
  assert.equal(zh?.copy.designer?.slug, "designer-lin");
  assert.equal(zh?.copy.translationFingerprint, "fp-reviewed-zh", "the reviewed translation fingerprint is recorded");
  assert.equal(facts.approvedMedia.length, 2, "the servable media set of the decision is recorded");
  assert.equal(facts.approvedMedia[0].width, 1200, "the recorded media keeps its width");
  assert.equal(facts.approvedMedia[0].height, 1200, "the recorded media keeps its height");
});

test("the recorded public-state facts carry the remaining servable media after a withdrawal", () => {
  const [withdrawnAsset, remainingAsset] = approvedMedia();
  const record = makeApproval({
    media: [
      { ...withdrawnAsset, withdrawn: true },
      { ...remainingAsset, width: 800, height: 600 }
    ]
  });
  const facts = publicStateFacts(record);
  assert.deepEqual(
    facts.approvedMedia.map((fact) => fact.checksum),
    [remainingAsset.checksum],
    "a withdrawn asset is absent from the recorded servable set"
  );
  assert.equal(facts.approvedMedia[0].width, 800, "the remaining media keeps its width");
  assert.equal(facts.approvedMedia[0].height, 600, "the remaining media keeps its height");
});

test("an APPROVE audit event alone rebuilds the copy, media and product facts a later APPROVE overwrote", () => {
  // APPROVE A establishes copy A, media A (with its intrinsic dimensions) and
  // the subject's public handle and product status.
  const copyA = {
    reviewedRevision: 3,
    title: "无野 · 静水手链（A 版）",
    summary: "A 版摘要",
    materials: ["天然静水石", "黄铜"],
    specifications: [{ label: "内径", value: "16cm" }],
    designer: { slug: "designer-lin", displayName: "林也" },
    translationFingerprint: "fp-a"
  };
  const mediaA = [
    {
      url: "/showroom/wuye/hero-a.webp",
      alt: "A 版主图",
      checksum: "sha256:a",
      approved: true,
      withdrawn: false,
      width: 1200,
      height: 900
    }
  ];
  const recordA = makeApproval({ locales: { "zh-CN": copyA }, media: mediaA });
  const afterA = appendAuditEvent(recordA, {
    action: "APPROVED",
    at: NOW,
    actorId: "admin-1",
    ...publicStateFacts(recordA),
    handle: PRODUCT_HANDLE,
    productStatus: "published"
  });

  // APPROVE B overwrites the same subject's live copy, media and revision.
  const copyB = {
    reviewedRevision: 4,
    title: "无野 · 静水手链（B 版）",
    summary: "B 版摘要",
    materials: ["天然静水石"],
    specifications: [{ label: "内径", value: "17cm" }],
    designer: { slug: "designer-lin", displayName: "林也" },
    translationFingerprint: "fp-b"
  };
  const mediaB = [
    {
      url: "/showroom/wuye/hero-b.webp",
      alt: "B 版主图",
      checksum: "sha256:b",
      approved: true,
      withdrawn: false,
      width: 640,
      height: 640
    }
  ];
  const recordB = makeApproval({
    publicRevision: 4,
    locales: { "zh-CN": copyB },
    media: mediaB,
    audit: afterA.audit
  });
  const afterB = appendAuditEvent(recordB, {
    action: "APPROVED",
    at: NOW,
    actorId: "admin-2",
    ...publicStateFacts(recordB),
    handle: PRODUCT_HANDLE,
    productStatus: "published"
  });

  // The live record now serves B; only the audit trail remembers A.
  const eventA = afterB.audit[0];
  const eventB = afterB.audit[1];
  assert.equal(eventA.approvedCopy?.[0].copy.title, copyA.title, "A's event keeps A's own copy");
  assert.equal(eventA.approvedCopy?.[0].copy.summary, copyA.summary);
  assert.equal(eventA.approvedCopy?.[0].copy.reviewedRevision, 3);
  assert.notEqual(
    eventA.approvedCopy?.[0].copy.title,
    eventB.approvedCopy?.[0].copy.title,
    "B's overwrite is a distinct audited fact, not a rewrite of A's"
  );
  assert.equal(eventA.approvedMedia?.[0].checksum, "sha256:a", "A's event keeps A's own media");
  assert.equal(eventA.approvedMedia?.[0].alt, "A 版主图", "A's event keeps A's own media alt");
  assert.equal(eventA.approvedMedia?.[0].width, 1200, "A's event keeps A's own media width");
  assert.equal(eventA.approvedMedia?.[0].height, 900, "A's event keeps A's own media height");
  assert.notEqual(eventA.approvedMedia?.[0].checksum, eventB.approvedMedia?.[0].checksum);

  // Rebuild A's public read strictly from event A's own facts — the copy, media
  // and price facts, plus the live product public facts (handle, status, price
  // rows, translation versions) it recorded. No fabricated product or record is
  // used to supply history the event does not carry.
  const market = (eventA.markets as ShowroomMarket[])[0];
  const locale = eventA.approvedCopy![0].locale as ShowroomLocale;
  const priceFact = eventA.approvedPrices!.find((fact) => fact.market === market)!;
  const rebuiltProduct: ShowroomLiveProduct = {
    id: "prod_wuye_bracelet",
    handle: eventA.handle as string,
    status: eventA.productStatus as string,
    collectionId: null,
    variants: [
      {
        id: "variant-rebuilt-from-audit",
        prices: eventA.approvedPrices!.map((fact) => ({
          regionId: fact.regionId,
          currencyCode: fact.currency,
          amountMinor: fact.amountMinor
        }))
      }
    ],
    translations: Object.fromEntries(
      eventA.approvedCopy!
        .filter((fact) => fact.copy.translationFingerprint !== undefined)
        .map((fact) => [fact.locale, fact.copy.translationFingerprint as string])
    )
  };
  const rebuiltRecord: ShowroomApprovalRecord = {
    subjectKind: "PRODUCT",
    subjectRef: "prod_wuye_bracelet",
    publicRevision: eventA.publicRevision as number,
    authorization: {
      status: eventA.authorizationStatus as ShowroomApprovalRecord["authorization"]["status"],
      markets: eventA.markets as ShowroomApprovalRecord["authorization"]["markets"],
      effectiveFrom: eventA.effectiveFrom as string,
      expiresAt: eventA.expiresAt as string
    },
    availability: eventA.availability ?? null,
    prices: Object.fromEntries(
      (eventA.approvedPrices ?? []).map((fact) => [fact.market, fact])
    ) as ShowroomApprovalRecord["prices"],
    locales: Object.fromEntries(
      (eventA.approvedCopy ?? []).map((fact) => [fact.locale, fact.copy])
    ) as ShowroomApprovalRecord["locales"],
    media: (eventA.approvedMedia ?? []).map((fact) => ({
      ...fact,
      approved: true,
      withdrawn: false
    })),
    audit: []
  };
  const served = evaluateShowroomProduct(rebuiltProduct, rebuiltRecord, {
    market,
    locale,
    regionId: priceFact.regionId,
    now: eventA.at
  });
  assert.equal(served.ok, true, "A is served from the audit event alone");
  if (served.ok) {
    assert.equal(served.value.slug, PRODUCT_HANDLE, "the product handle is rebuilt from the event");
    assert.equal(served.value.title, copyA.title, "the rebuilt public response is A, not B");
    assert.equal(served.value.summary, copyA.summary);
    assert.equal(served.value.price.amountMinor, priceFact.amountMinor);
    assert.equal(served.value.media[0].url, mediaA[0].url);
    assert.equal(served.value.media[0].alt, mediaA[0].alt);
    assert.equal(served.value.media[0].width, 1200, "the rebuilt media keeps the audited width");
    assert.equal(served.value.media[0].height, 900, "the rebuilt media keeps the audited height");
  }
});
