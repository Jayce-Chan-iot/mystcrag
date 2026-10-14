/**
 * The single server-side publication predicate for the Mystcrag showroom
 * (TASK-COMMERCE-GATE-001).
 *
 * Every anonymous public read — list, product detail, designer detail and
 * collection detail — is decided here, by one pure predicate. A resource is
 * served only when the live Medusa facts, the versioned authorization, the
 * manually approved price, the editorially reviewed copy for the requested
 * locale and at least one approved, non-withdrawn media asset all agree.
 *
 * The module is deliberately free of I/O: it receives what the projection
 * already read from Medusa and the approval records, and it either grants a
 * strictly parsed Design Contract DTO or names the exact fail-closed reason.
 * Nothing here can fall back to another locale's copy, another market's
 * currency, or a raw Medusa Store response; a shape that does not parse is a
 * denial, never a partially served product.
 */

import { createHash } from "node:crypto";

import {
  SHOWROOM_MARKET_CURRENCY,
  ShowroomPublicCollectionSchema,
  ShowroomPublicDesignerSchema,
  ShowroomPublicProductSchema,
  type ShowroomLocale,
  type ShowroomMarket,
  type ShowroomPublicCollection,
  type ShowroomPublicDesigner,
  type ShowroomPublicProduct
} from "@mystcrag/design-contract";

export const SHOWROOM_SUBJECT_KINDS = ["PRODUCT", "DESIGNER", "COLLECTION"] as const;
export type ShowroomSubjectKind = (typeof SHOWROOM_SUBJECT_KINDS)[number];

export const SHOWROOM_APPROVAL_STATUSES = ["APPROVED", "REVOKED"] as const;
export type ShowroomApprovalStatus = (typeof SHOWROOM_APPROVAL_STATUSES)[number];

export const SHOWROOM_AVAILABILITY_STATES = [
  "AVAILABLE",
  "INQUIRY_ONLY",
  "OUT_OF_STOCK",
  "COMING_SOON"
] as const;
export type ShowroomAvailabilityState = (typeof SHOWROOM_AVAILABILITY_STATES)[number];

export const SHOWROOM_AUDIT_ACTIONS = ["APPROVED", "REVOKED", "MEDIA_WITHDRAWN"] as const;
export type ShowroomAuditAction = (typeof SHOWROOM_AUDIT_ACTIONS)[number];

/**
 * One audited decision. Besides who decided and when, every event carries the
 * facts needed to reconstruct the public response at that decision: the public
 * revision it applied to, the resulting authorization status, markets and
 * effective window, the display availability, the approved price facts, the
 * whole approved copy per reviewed locale, and the media it affected. The
 * history is therefore traceable without reading any live Medusa row again.
 */
export type ShowroomAuditEvent = {
  action: ShowroomAuditAction;
  at: string;
  actorId: string;
  reason?: string;
  /** The public revision this decision applied to. */
  publicRevision?: number;
  /** The authorization status after this decision. */
  authorizationStatus?: ShowroomApprovalStatus;
  /** The markets the authorization covered after this decision. */
  markets?: ShowroomMarket[];
  /** The start of the authorization window after this decision. */
  effectiveFrom?: string;
  /** The expiry of the authorization window after this decision. */
  expiresAt?: string;
  /** The display availability state after this decision. */
  availability?: ShowroomAvailabilityState | null;
  /** The approved price facts after this decision, one per approved market. */
  approvedPrices?: ShowroomApprovedPriceFact[];
  /**
   * The whole approved copy after this decision, one fact per reviewed locale.
   * It is a snapshot, not a fingerprint: the public response a locale served at
   * this decision is rebuildable from the event alone even after a later
   * decision overwrote the record's live copy.
   */
  approvedCopy?: ShowroomApprovedCopyFact[];
  /** The approved media facts after this decision, one per servable asset. */
  approvedMedia?: ShowroomApprovedMediaFact[];
  /** The single media asset withdrawn by this MEDIA_WITHDRAWN. */
  withdrawnMedia?: ShowroomApprovedMediaFact;
  /**
   * The live product handle — its public slug — observed at this decision, so
   * the `slug` the public response served is rebuildable from the event.
   */
  handle?: string;
  /** The live Medusa product status observed at this decision. */
  productStatus?: string;
};

/** The approved price fact a decision is audited against, per market. */
export type ShowroomApprovedPriceFact = {
  market: ShowroomMarket;
  currency: string;
  amountMinor: number;
  regionId: string;
  fingerprint: string;
};

/**
 * The approved-copy fact a decision is audited against, per display locale. It
 * carries the whole reviewed copy — not merely a fingerprint — so the public
 * response that locale served at this decision can be rebuilt from the audit
 * event alone, including after a later decision overwrote the live copy.
 */
export type ShowroomApprovedCopyFact = {
  locale: string;
  copy: ShowroomLocaleCopy;
};

/**
 * The approved-media fact a decision is audited against, per servable asset. It
 * carries the url, alt and intrinsic dimensions the public response rendered,
 * not only a checksum.
 */
export type ShowroomApprovedMediaFact = {
  checksum: string;
  url: string;
  alt: string;
  width?: number;
  height?: number;
};

/**
 * The facts that describe the public state a decision established. The service
 * spreads these into each audit event so the public state at any decision can be
 * rebuilt from the audit trail alone, including the authorization window, the
 * display state, the approved price fingerprints and the approved copy.
 */
export type ShowroomPublicStateFacts = {
  publicRevision: number;
  authorizationStatus: ShowroomApprovalStatus;
  markets: ShowroomMarket[];
  effectiveFrom: string;
  expiresAt: string;
  availability: ShowroomAvailabilityState | null;
  approvedPrices: ShowroomApprovedPriceFact[];
  approvedCopy: ShowroomApprovedCopyFact[];
  /**
   * The servable media set after this decision — the remaining approved,
   * non-withdrawn assets with their url, alt and dimensions. It is what a
   * `WITHDRAW_MEDIA` or `REVOKE` leaves servable, not only what an `APPROVE`
   * authorized.
   */
  approvedMedia: ShowroomApprovedMediaFact[];
};

export type ShowroomDesignerRefInput = {
  slug: string;
  displayName: string;
};

export type ShowroomSpecificationInput = {
  label: string;
  value: string;
};

/**
 * The editorially reviewed copy for exactly one display locale. A locale key
 * exists only after that locale's copy was reviewed at `reviewedRevision`;
 * there is no partial or fallback copy, and a copy whose `reviewedRevision`
 * trails the record's `publicRevision` is stale and fails closed.
 */
export type ShowroomLocaleCopy = {
  reviewedRevision: number;
  title: string;
  summary: string;
  story?: string;
  materials?: string[];
  specifications?: ShowroomSpecificationInput[];
  designer?: ShowroomDesignerRefInput;
  designers?: ShowroomDesignerRefInput[];
  /**
   * Fingerprint of the live Medusa translation this copy was reviewed against.
   * When the live translation for the locale changes in Medusa Admin without a
   * new editorial review, the recomputed fingerprint no longer matches and the
   * locale fails closed.
   */
  translationFingerprint?: string;
};

export type ShowroomMediaRecord = {
  url: string;
  alt: string;
  /** Provenance checksum recorded when the asset was authorized. */
  checksum: string;
  approved: boolean;
  withdrawn: boolean;
  width?: number;
  height?: number;
};

export type ShowroomApprovedPrice = {
  market: ShowroomMarket;
  currency: string;
  amountMinor: number;
  regionId: string;
  /** Fingerprint of the price row this approval was granted for. */
  fingerprint: string;
};

export type ShowroomAuthorization = {
  status: ShowroomApprovalStatus;
  markets: ShowroomMarket[];
  effectiveFrom: string;
  expiresAt: string;
};

/**
 * One versioned publication approval. Products, designers and collections
 * share the record; `subjectKind` and `subjectRef` identify the subject, and
 * the kind-specific parts of `locales` are the only place editorial copy lives.
 */
export type ShowroomApprovalRecord = {
  subjectKind: ShowroomSubjectKind;
  subjectRef: string;
  publicRevision: number;
  authorization: ShowroomAuthorization;
  availability: ShowroomAvailabilityState | null;
  /**
   * One manually approved price fingerprint per market. `CN` publishes `CNY`
   * and `TW` publishes `TWD`; a market has no approved price until an admin
   * records its exact fingerprint, and the map never lets one market's
   * approval serve another.
   */
  prices: Partial<Record<ShowroomMarket, ShowroomApprovedPrice>>;
  locales: Partial<Record<ShowroomLocale, ShowroomLocaleCopy>>;
  media: ShowroomMediaRecord[];
  audit: ShowroomAuditEvent[];
};

/** The live Medusa price row for one variant. */
export type ShowroomLivePrice = {
  regionId: string | null;
  currencyCode: string;
  amountMinor: number;
};

export type ShowroomLiveProduct = {
  id: string;
  handle: string | null;
  status: string | null;
  collectionId: string | null;
  createdAt?: string | null;
  categoryHandles?: string[];
  variants: { id: string; prices: ShowroomLivePrice[] }[];
  /**
   * Live per-locale translation fingerprints read from the Medusa translation
   * module, one entry per display locale. When present, the reviewed copy's
   * pinned fingerprint must match it or the locale fails closed.
   */
  translations?: Record<string, string>;
};

export type ShowroomMarketContext = {
  market: ShowroomMarket;
  locale: ShowroomLocale;
  /** The Medusa region that publishes the requested market. */
  regionId: string | null;
  now: string;
};

export type ShowroomDenialReason =
  | "NO_APPROVAL"
  | "NOT_PUBLISHED"
  | "INVALID_PUBLIC_REVISION"
  | "AUTHORIZATION_REVOKED"
  | "AUTHORIZATION_NOT_YET_EFFECTIVE"
  | "AUTHORIZATION_EXPIRED"
  | "MARKET_NOT_AUTHORIZED"
  | "NO_AVAILABILITY_STATE"
  | "NO_REVIEWED_COPY"
  | "STALE_REVIEW"
  | "TRANSLATION_CHANGED_SINCE_REVIEW"
  | "NO_APPROVED_PRICE"
  | "PRICE_NOT_APPROVED_FOR_MARKET"
  | "NO_LIVE_PRICE"
  | "PRICE_CHANGED_SINCE_APPROVAL"
  | "NO_APPROVED_MEDIA"
  | "INVALID_PUBLIC_SHAPE";

export type ShowroomGateGrant<T> = { ok: true; value: T };
export type ShowroomGateDenial = { ok: false; reason: ShowroomDenialReason };
export type ShowroomGateResult<T> = ShowroomGateGrant<T> | ShowroomGateDenial;

const grant = <T>(value: T): ShowroomGateGrant<T> => ({ ok: true, value });
const deny = (reason: ShowroomDenialReason): ShowroomGateDenial => ({ ok: false, reason });

/**
 * The approved-price fingerprint. The approval stores the fingerprint of the
 * exact price row that was approved; if the row's region, currency or amount
 * later changes in Medusa Admin without a new approval, the recomputed
 * fingerprint no longer matches and the product fails closed.
 */
export function computePriceFingerprint(
  regionId: string,
  currencyCode: string,
  amountMinor: number
): string {
  return createHash("sha256")
    .update(`${regionId}|${currencyCode.toLowerCase()}|${amountMinor}`)
    .digest("hex");
}

/**
 * Canonicalises a translation payload so the fingerprint depends only on the
 * translated values, never on JSON key order as stored by the database.
 */
function canonicaliseTranslation(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicaliseTranslation);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicaliseTranslation((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

/**
 * The live-translation fingerprint. It is derived from the translation module's
 * own `translations` payload for the locale; a locale with no stored translation
 * uses the constant fingerprint of an empty payload, so creating a translation
 * later is itself a change. Because the fingerprint depends only on the
 * translated values, an Admin edit changes it and the reviewed copy fails closed.
 */
export function computeTranslationFingerprint(translations: unknown): string {
  const normalised = translations === null || translations === undefined ? {} : translations;
  return createHash("sha256").update(JSON.stringify(canonicaliseTranslation(normalised))).digest("hex");
}

/**
 * Shared authorization predicate: the versioned authorization must be
 * `APPROVED`, cover the requested market, and be inside its effective window
 * at `now`.
 */
function evaluateAuthorization(
  authorization: ShowroomAuthorization | undefined,
  market: ShowroomMarket,
  now: string
): ShowroomDenialReason | undefined {
  if (!authorization || authorization.status !== "APPROVED") {
    return "AUTHORIZATION_REVOKED";
  }
  if (!authorization.markets.includes(market)) {
    return "MARKET_NOT_AUTHORIZED";
  }
  const nowMs = Date.parse(now);
  const fromMs = Date.parse(authorization.effectiveFrom);
  const untilMs = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(fromMs) || !Number.isFinite(untilMs)) {
    return "AUTHORIZATION_EXPIRED";
  }
  if (nowMs < fromMs) {
    return "AUTHORIZATION_NOT_YET_EFFECTIVE";
  }
  if (nowMs >= untilMs) {
    return "AUTHORIZATION_EXPIRED";
  }
  return undefined;
}

/**
 * Shared editorial-copy predicate for the requested locale. When the live
 * translation fingerprint for that locale is supplied, the reviewed copy must
 * pin the same fingerprint; a copy with no pinned fingerprint, or one whose
 * pinned fingerprint no longer matches a translation edited in Medusa Admin
 * without a new review, fails closed.
 */
function evaluateReviewedCopy(
  record: ShowroomApprovalRecord,
  locale: ShowroomLocale,
  liveTranslationFingerprint?: string | null
): ShowroomGateResult<ShowroomLocaleCopy> {
  const copy = record.locales?.[locale];
  if (!copy) {
    return deny("NO_REVIEWED_COPY");
  }
  if (copy.reviewedRevision !== record.publicRevision) {
    return deny("STALE_REVIEW");
  }
  if (liveTranslationFingerprint !== undefined && liveTranslationFingerprint !== null) {
    if (copy.translationFingerprint !== liveTranslationFingerprint) {
      return deny("TRANSLATION_CHANGED_SINCE_REVIEW");
    }
  }
  return grant(copy);
}

/**
 * Merges a new approval's media set with the withdrawal facts already recorded.
 * A withdrawal is a tombstone: a checksum withdrawn under any earlier decision
 * stays withdrawn across every later approval. Two facts are carried forward:
 *   - an incoming asset whose checksum was withdrawn before is forced withdrawn,
 *     so a replayed or re-submitted APPROVE never revives it; and
 *   - a withdrawn checksum the incoming set no longer carries is retained as a
 *     tombstone, so an approval that omits the asset and a still later approval
 *     that reintroduces it both keep the withdrawal effective.
 */
export function mergeWithdrawalFacts(
  previousMedia: ShowroomMediaRecord[],
  incomingMedia: ShowroomMediaRecord[]
): ShowroomMediaRecord[] {
  const previous = previousMedia ?? [];
  const incoming = incomingMedia ?? [];
  const withdrawnChecksums = new Set(
    previous
      .filter((asset) => asset.withdrawn && asset.checksum.trim().length > 0)
      .map((asset) => asset.checksum.trim())
  );
  const incomingChecksums = new Set(
    incoming
      .filter((asset) => asset.checksum.trim().length > 0)
      .map((asset) => asset.checksum.trim())
  );
  const merged = incoming.map((asset) =>
    withdrawnChecksums.has(asset.checksum.trim()) ? { ...asset, withdrawn: true } : { ...asset }
  );
  const tombstones = previous
    .filter(
      (asset) =>
        asset.withdrawn && asset.checksum.trim().length > 0 && !incomingChecksums.has(asset.checksum.trim())
    )
    .map((asset) => ({ ...asset, withdrawn: true }));
  return [...merged, ...tombstones];
}

/**
 * A deep copy of one reviewed copy. The audit trail keeps its own snapshot: a
 * stored event is never aliased to the live record's objects, so a later decision
 * that overwrites the record cannot rewrite history.
 */
function cloneLocaleCopy(copy: ShowroomLocaleCopy): ShowroomLocaleCopy {
  return {
    reviewedRevision: copy.reviewedRevision,
    title: copy.title,
    summary: copy.summary,
    ...(copy.story === undefined ? {} : { story: copy.story }),
    ...(copy.materials === undefined ? {} : { materials: [...copy.materials] }),
    ...(copy.specifications === undefined
      ? {}
      : { specifications: copy.specifications.map((spec) => ({ label: spec.label, value: spec.value })) }),
    ...(copy.designer === undefined ? {} : { designer: { ...copy.designer } }),
    ...(copy.designers === undefined ? {} : { designers: copy.designers.map((designer) => ({ ...designer })) }),
    ...(copy.translationFingerprint === undefined ? {} : { translationFingerprint: copy.translationFingerprint })
  };
}

/**
 * The facts that let the audit trail alone rebuild the public response a decision
 * established: the public revision, the resulting authorization status and
 * markets, the effective window, the display availability, the approved price
 * fingerprints and the whole approved copy per reviewed locale.
 */
export function publicStateFacts(record: ShowroomApprovalRecord): ShowroomPublicStateFacts {
  const prices = record.prices ?? {};
  const locales = record.locales ?? {};
  return {
    publicRevision: record.publicRevision,
    authorizationStatus: record.authorization.status,
    markets: [...(record.authorization.markets ?? [])],
    effectiveFrom: record.authorization.effectiveFrom,
    expiresAt: record.authorization.expiresAt,
    availability: record.availability ?? null,
    approvedPrices: Object.values(prices)
      .filter((price): price is ShowroomApprovedPrice => Boolean(price))
      .map((price) => ({
        market: price.market,
        currency: price.currency,
        amountMinor: price.amountMinor,
        regionId: price.regionId,
        fingerprint: price.fingerprint
      })),
    approvedCopy: Object.entries(locales).map(([locale, copy]) => ({
      locale,
      copy: cloneLocaleCopy(copy)
    })),
    approvedMedia: approvedMediaFacts(record)
  };
}

/** Raised when a decision targets a subject that has no approval record. */
export class ShowroomApprovalNotFoundError extends Error {
  constructor(subjectKind: string, subjectRef: string) {
    super(`No showroom approval exists for ${subjectKind} "${subjectRef}"`);
    this.name = "ShowroomApprovalNotFoundError";
  }
}

/**
 * Raised when a media withdrawal names a checksum the subject's approved media
 * set never carried. It is a not-found, never a silent success.
 */
export class ShowroomMediaWithdrawalTargetError extends Error {
  constructor(subjectKind: string, subjectRef: string, checksum: string) {
    super(
      `The showroom approval for ${subjectKind} "${subjectRef}" carries no media asset with checksum "${checksum}"`
    );
    this.name = "ShowroomMediaWithdrawalTargetError";
  }
}

/**
 * Only approved, non-withdrawn assets that still carry a provenance checksum
 * are servable. A withdrawn asset is dropped; if nothing remains the subject
 * fails closed rather than showing unapproved media.
 */
function approvedMedia(record: ShowroomApprovalRecord): ShowroomMediaRecord[] {
  return (record.media ?? []).filter(
    (asset) => asset.approved && !asset.withdrawn && asset.checksum.trim().length > 0
  );
}

/**
 * The servable media facts of a decision: the approved, non-withdrawn assets,
 * each with the url, alt and intrinsic dimensions the public response rendered.
 * This is the snapshot every audit event records — for an `APPROVE` it is the
 * authorized set, and for a `WITHDRAW_MEDIA` or `REVOKE` it is what remains
 * servable after the decision.
 */
function approvedMediaFacts(record: ShowroomApprovalRecord): ShowroomApprovedMediaFact[] {
  return approvedMedia(record).map((asset) => ({
    checksum: asset.checksum,
    url: asset.url,
    alt: asset.alt,
    ...(asset.width === undefined ? {} : { width: asset.width }),
    ...(asset.height === undefined ? {} : { height: asset.height })
  }));
}

/**
 * The approved price for the requested market. The market is never inferred
 * from the locale: `CN` publishes `CNY` and `TW` publishes `TWD`, and a price
 * approved for any other market is refused instead of converted. A subject with
 * no approved price at all denies `NO_APPROVED_PRICE`; a price approved only for
 * another market denies `PRICE_NOT_APPROVED_FOR_MARKET`.
 */
function evaluateApprovedPrice(
  record: ShowroomApprovalRecord,
  market: ShowroomMarket
): ShowroomGateResult<ShowroomApprovedPrice> {
  const prices = record.prices ?? {};
  const approved = prices[market];
  if (!approved) {
    return deny(Object.keys(prices).length > 0 ? "PRICE_NOT_APPROVED_FOR_MARKET" : "NO_APPROVED_PRICE");
  }
  const expectedCurrency = SHOWROOM_MARKET_CURRENCY[market];
  if (approved.market !== market || approved.currency !== expectedCurrency) {
    return deny("PRICE_NOT_APPROVED_FOR_MARKET");
  }
  return grant(approved);
}

function evaluateLivePrice(
  product: ShowroomLiveProduct,
  context: ShowroomMarketContext,
  approved: ShowroomApprovedPrice
): ShowroomGateResult<ShowroomLivePrice> {
  const expectedCurrency = SHOWROOM_MARKET_CURRENCY[context.market];
  const live = (product.variants ?? [])
    .flatMap((variant) => variant.prices ?? [])
    .find(
      (price) =>
        price.regionId === context.regionId &&
        price.currencyCode.toLowerCase() === expectedCurrency.toLowerCase()
    );
  if (!live) {
    return deny("NO_LIVE_PRICE");
  }
  const fingerprint = computePriceFingerprint(
    String(context.regionId),
    expectedCurrency,
    live.amountMinor
  );
  if (fingerprint !== approved.fingerprint) {
    return deny("PRICE_CHANGED_SINCE_APPROVAL");
  }
  return grant(live);
}

/** Shared: an approval must carry a display-only availability state. */
function evaluateAvailability(
  record: ShowroomApprovalRecord
): ShowroomGateResult<ShowroomAvailabilityState> {
  if (!record.availability) {
    return deny("NO_AVAILABILITY_STATE");
  }
  return grant(record.availability);
}

function toMediaDto(assets: ShowroomMediaRecord[]) {
  return assets.map((asset) => ({
    url: asset.url,
    alt: asset.alt,
    ...(asset.width === undefined ? {} : { width: asset.width }),
    ...(asset.height === undefined ? {} : { height: asset.height })
  }));
}

/**
 * Product predicate. Reuses the live Medusa Product/Variant/Price facts and the
 * single Showroom DTO; the result is only a grant when the strict runtime
 * `safeParse` succeeds.
 */
export function evaluateShowroomProduct(
  product: ShowroomLiveProduct,
  record: ShowroomApprovalRecord | null,
  context: ShowroomMarketContext
): ShowroomGateResult<ShowroomPublicProduct> {
  if (!record || record.subjectKind !== "PRODUCT") {
    return deny("NO_APPROVAL");
  }
  if (product.status !== "published") {
    return deny("NOT_PUBLISHED");
  }
  if (!Number.isSafeInteger(record.publicRevision) || record.publicRevision < 1) {
    return deny("INVALID_PUBLIC_REVISION");
  }
  const authorization = evaluateAuthorization(record.authorization, context.market, context.now);
  if (authorization) {
    return deny(authorization);
  }
  const availability = evaluateAvailability(record);
  if (!availability.ok) {
    return availability;
  }
  const copy = evaluateReviewedCopy(record, context.locale, product.translations?.[context.locale] ?? null);
  if (!copy.ok) {
    return copy;
  }
  const approvedPrice = evaluateApprovedPrice(record, context.market);
  if (!approvedPrice.ok) {
    return approvedPrice;
  }
  const livePrice = evaluateLivePrice(product, context, approvedPrice.value);
  if (!livePrice.ok) {
    return livePrice;
  }
  const media = approvedMedia(record);
  if (media.length === 0) {
    return deny("NO_APPROVED_MEDIA");
  }
  const productCopy = copy.value;
  if (!productCopy.designer) {
    return deny("INVALID_PUBLIC_SHAPE");
  }

  const candidate = {
    slug: product.handle ?? "",
    publicRevision: record.publicRevision,
    title: productCopy.title,
    summary: productCopy.summary,
    availability: availability.value,
    media: toMediaDto(media),
    materials: productCopy.materials ?? [],
    specifications: productCopy.specifications ?? [],
    price: {
      currency: SHOWROOM_MARKET_CURRENCY[context.market],
      amountMinor: livePrice.value.amountMinor
    },
    designer: {
      slug: productCopy.designer.slug,
      displayName: productCopy.designer.displayName
    }
  };

  const parsed = ShowroomPublicProductSchema.safeParse(candidate);
  if (!parsed.success) {
    return deny("INVALID_PUBLIC_SHAPE");
  }
  return grant(parsed.data);
}

/** Designer predicate over the same authorization and copy predicates. */
export function evaluateShowroomDesigner(
  record: ShowroomApprovalRecord | null,
  context: ShowroomMarketContext
): ShowroomGateResult<ShowroomPublicDesigner> {
  if (!record || record.subjectKind !== "DESIGNER") {
    return deny("NO_APPROVAL");
  }
  if (!Number.isSafeInteger(record.publicRevision) || record.publicRevision < 1) {
    return deny("INVALID_PUBLIC_REVISION");
  }
  const authorization = evaluateAuthorization(record.authorization, context.market, context.now);
  if (authorization) {
    return deny(authorization);
  }
  const copy = evaluateReviewedCopy(record, context.locale);
  if (!copy.ok) {
    return copy;
  }
  const media = approvedMedia(record);

  const candidate = {
    slug: record.subjectRef,
    publicRevision: record.publicRevision,
    displayName: copy.value.title,
    summary: copy.value.summary,
    story: copy.value.story ?? "",
    media: toMediaDto(media)
  };
  const parsed = ShowroomPublicDesignerSchema.safeParse(candidate);
  if (!parsed.success) {
    return deny("INVALID_PUBLIC_SHAPE");
  }
  return grant(parsed.data);
}

/** Collection predicate; the collection identity comes from live Medusa. */
export function evaluateShowroomCollection(
  handle: string | null,
  record: ShowroomApprovalRecord | null,
  context: ShowroomMarketContext
): ShowroomGateResult<ShowroomPublicCollection> {
  if (!record || record.subjectKind !== "COLLECTION") {
    return deny("NO_APPROVAL");
  }
  if (!Number.isSafeInteger(record.publicRevision) || record.publicRevision < 1) {
    return deny("INVALID_PUBLIC_REVISION");
  }
  const authorization = evaluateAuthorization(record.authorization, context.market, context.now);
  if (authorization) {
    return deny(authorization);
  }
  const copy = evaluateReviewedCopy(record, context.locale);
  if (!copy.ok) {
    return copy;
  }
  const media = approvedMedia(record);

  const candidate = {
    slug: handle ?? "",
    publicRevision: record.publicRevision,
    title: copy.value.title,
    summary: copy.value.summary,
    media: toMediaDto(media),
    designers: (copy.value.designers ?? []).map((designer) => ({
      slug: designer.slug,
      displayName: designer.displayName
    }))
  };
  const parsed = ShowroomPublicCollectionSchema.safeParse(candidate);
  if (!parsed.success) {
    return deny("INVALID_PUBLIC_SHAPE");
  }
  return grant(parsed.data);
}

/**
 * Builds a fresh, audited approval record. The service uses this so a
 * re-import of the same approved revision is idempotent and every state change
 * appends exactly one audit event.
 */
export function appendAuditEvent(
  record: ShowroomApprovalRecord,
  event: ShowroomAuditEvent
): ShowroomApprovalRecord {
  return { ...record, audit: [...(record.audit ?? []), event] };
}
