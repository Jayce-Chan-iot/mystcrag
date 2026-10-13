/**
 * The showroom read projection (TASK-COMMERCE-GATE-001).
 *
 * It reads the authoritative live facts from Medusa (Product/Variant/Price,
 * Collection) plus the showroom publication approval records, hands them to the
 * single publication predicate, and returns only strictly parsed Design
 * Contract DTOs. It never returns a raw Medusa Store response, a draft, or a
 * partially approved resource: every public list entry and every detail body
 * passes through the same server-side predicate.
 *
 * Reads are anonymous and read-only. Upstream read failures surface as an
 * explicit error so the route can answer `500`, never a fallback.
 */

import {
  ShowroomCollectionDetailSchema,
  ShowroomDesignerDetailSchema,
  ShowroomListRequestSchema,
  ShowroomLocaleSchema,
  ShowroomProductDetailSchema,
  ShowroomProductPageSchema,
  ShowroomPublicRequestSchema,
  type ShowroomLocale,
  type ShowroomMarket,
  type ShowroomCollectionDetail,
  type ShowroomListRequest,
  type ShowroomProductDetail,
  type ShowroomDesignerDetail,
  type ShowroomPublicRequest
} from "@mystcrag/design-contract";

import {
  computeTranslationFingerprint,
  evaluateShowroomCollection,
  evaluateShowroomDesigner,
  evaluateShowroomProduct,
  type ShowroomApprovalRecord,
  type ShowroomDenialReason,
  type ShowroomLiveProduct,
  type ShowroomMarketContext,
  type ShowroomSubjectKind
} from "./publication-gate";

const SHOWROOM_LOCALES = ShowroomLocaleSchema.options as readonly ShowroomLocale[];

/**
 * A mandatory upstream read failed. The route maps this to `500 INTERNAL_ERROR`
 * and never falls back to raw store data.
 */
export class ShowroomUpstreamError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ShowroomUpstreamError";
    this.cause = cause;
  }
}

export type ShowroomProductPort = {
  listProducts(): Promise<ShowroomLiveProduct[]>;
  retrieveProductByHandle(handle: string): Promise<ShowroomLiveProduct | null>;
  listProductsByHandles(handles: string[]): Promise<ShowroomLiveProduct[]>;
};

export type ShowroomCollectionPort = {
  retrieveCollectionByHandle(
    handle: string
  ): Promise<{ id: string; handle: string | null } | null>;
};

export type ShowroomRegionPort = {
  regionIdForMarket(market: ShowroomMarket): Promise<string | null>;
};

export type ShowroomApprovalPort = {
  getApproval(
    subjectKind: ShowroomSubjectKind,
    subjectRef: string
  ): Promise<ShowroomApprovalRecord | null>;
  listApprovals(subjectKind: ShowroomSubjectKind): Promise<ShowroomApprovalRecord[]>;
};

export type ShowroomDeps = {
  products: ShowroomProductPort;
  collections: ShowroomCollectionPort;
  regions: ShowroomRegionPort;
  approvals: ShowroomApprovalPort;
  now: () => Date;
};

export type ShowroomListResult = {
  status: 200;
  body: unknown;
};

export type ShowroomDetailResult =
  | { status: 200; body: unknown }
  | { status: 404; reason: ShowroomDenialReason };

const marketCurrency = { CN: "CNY", TW: "TWD" } as const;

async function buildContext(
  deps: ShowroomDeps,
  market: ShowroomMarket,
  locale: ShowroomLocale
): Promise<ShowroomMarketContext> {
  let regionId: string | null = null;
  try {
    regionId = await deps.regions.regionIdForMarket(market);
  } catch (error) {
    throw new ShowroomUpstreamError("Failed to resolve the market region", error);
  }
  return { market, locale, regionId, now: deps.now().toISOString() };
}

async function safeApprovalList(
  deps: ShowroomDeps,
  subjectKind: ShowroomSubjectKind
): Promise<ShowroomApprovalRecord[]> {
  try {
    return await deps.approvals.listApprovals(subjectKind);
  } catch (error) {
    throw new ShowroomUpstreamError("Failed to read showroom approvals", error);
  }
}

async function safeProductList(deps: ShowroomDeps): Promise<ShowroomLiveProduct[]> {
  try {
    return await deps.products.listProducts();
  } catch (error) {
    throw new ShowroomUpstreamError("Failed to read the product catalog", error);
  }
}

/**
 * The shared predicate applied to one live product with its approval record.
 * Used by the list, product detail, designer detail and collection detail
 * routes so no surface has its own visibility rule.
 */
export function evaluateProductForContext(
  product: ShowroomLiveProduct,
  record: ShowroomApprovalRecord | null,
  context: ShowroomMarketContext
) {
  return evaluateShowroomProduct(product, record, context);
}

type ShowroomListItem = { product: ShowroomLiveProduct; dto: any };

function applyListFilters(items: ShowroomListItem[], request: ShowroomListRequest) {
  return items.filter(({ product, dto }) => {
    if (request.designer && dto.designer.slug !== request.designer) {
      return false;
    }
    if (
      request.category &&
      !(product.categoryHandles ?? []).includes(request.category)
    ) {
      return false;
    }
    return true;
  });
}

function sortItems(items: ShowroomListItem[], sort: ShowroomListRequest["sort"]) {
  const ordered = [...items];
  if (sort === "NEWEST") {
    ordered.sort((left, right) =>
      String(right.product.createdAt ?? "").localeCompare(String(left.product.createdAt ?? ""))
    );
  } else if (sort === "PRICE_ASC") {
    ordered.sort((left, right) => left.dto.price.amountMinor - right.dto.price.amountMinor);
  } else if (sort === "PRICE_DESC") {
    ordered.sort((left, right) => right.dto.price.amountMinor - left.dto.price.amountMinor);
  }
  return ordered;
}

/** Anonymous product list. Only approved products appear, ordered and paged. */
export async function listShowroomProducts(
  deps: ShowroomDeps,
  request: ShowroomListRequest
): Promise<ShowroomListResult> {
  const context = await buildContext(deps, request.market, request.locale);
  const products = await safeProductList(deps);
  const approvals = await safeApprovalList(deps, "PRODUCT");
  const byProduct = new Map(approvals.map((record) => [record.subjectRef, record]));

  const granted: ShowroomListItem[] = [];
  for (const product of products) {
    const decision = evaluateProductForContext(product, byProduct.get(product.id) ?? null, context);
    if (decision.ok) {
      granted.push({ product, dto: decision.value });
    }
  }

  const filtered = applyListFilters(granted, request);
  const sorted = sortItems(filtered, request.sort);
  const total = sorted.length;
  const start = (request.page - 1) * request.pageSize;
  const page = sorted.slice(start, start + request.pageSize);

  const candidate = {
    market: request.market,
    locale: request.locale,
    items: page.map((entry) => entry.dto),
    page: request.page,
    pageSize: request.pageSize,
    total
  };
  const parsed = ShowroomProductPageSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ShowroomUpstreamError("The approved page did not satisfy the public showroom contract");
  }
  return { status: 200, body: parsed.data };
}

/** Anonymous product detail. Unknown, unapproved or incomplete slugs are 404. */
export async function getShowroomProduct(
  deps: ShowroomDeps,
  slug: string,
  request: ShowroomPublicRequest
): Promise<ShowroomDetailResult> {
  const context = await buildContext(deps, request.market, request.locale);
  let live: ShowroomLiveProduct | null = null;
  try {
    live = await deps.products.retrieveProductByHandle(slug);
  } catch (error) {
    throw new ShowroomUpstreamError("Failed to read the product", error);
  }
  if (!live) {
    return { status: 404, reason: "NO_APPROVAL" };
  }
  const record = await getApproval(deps, "PRODUCT", live.id);
  const decision = evaluateProductForContext(live, record, context);
  if (!decision.ok) {
    return { status: 404, reason: decision.reason };
  }
  const candidate = {
    market: request.market,
    locale: request.locale,
    product: decision.value
  };
  const parsed = ShowroomProductDetailSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ShowroomUpstreamError("The approved product detail did not satisfy the public contract");
  }
  return { status: 200, body: parsed.data as ShowroomProductDetail };
}

async function getApproval(
  deps: ShowroomDeps,
  subjectKind: ShowroomSubjectKind,
  subjectRef: string
): Promise<ShowroomApprovalRecord | null> {
  try {
    return await deps.approvals.getApproval(subjectKind, subjectRef);
  } catch (error) {
    throw new ShowroomUpstreamError("Failed to read the showroom approval", error);
  }
}

/** Anonymous designer detail: the profile plus its approved products. */
export async function getShowroomDesigner(
  deps: ShowroomDeps,
  slug: string,
  request: ShowroomPublicRequest
): Promise<ShowroomDetailResult> {
  const context = await buildContext(deps, request.market, request.locale);
  const record = await getApproval(deps, "DESIGNER", slug);
  const decision = evaluateShowroomDesigner(record, context);
  if (!decision.ok) {
    return { status: 404, reason: decision.reason };
  }

  const products = await safeProductList(deps);
  const approvals = await safeApprovalList(deps, "PRODUCT");
  const byProduct = new Map(approvals.map((entry) => [entry.subjectRef, entry]));
  const approvedProducts = products
    .map((product) => evaluateProductForContext(product, byProduct.get(product.id) ?? null, context))
    .filter((result) => result.ok)
    .map((result) => (result.ok ? result.value : null))
    .filter((value) => value !== null)
    .filter((value) => value!.designer.slug === slug);

  const candidate = {
    market: request.market,
    locale: request.locale,
    designer: decision.value,
    products: approvedProducts
  };
  const parsed = ShowroomDesignerDetailSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ShowroomUpstreamError("The approved designer detail did not satisfy the public contract");
  }
  return { status: 200, body: parsed.data as ShowroomDesignerDetail };
}

/** Anonymous collection detail: the published collection plus its approved products. */
export async function getShowroomCollection(
  deps: ShowroomDeps,
  slug: string,
  request: ShowroomPublicRequest
): Promise<ShowroomDetailResult> {
  const context = await buildContext(deps, request.market, request.locale);
  let collection: { id: string; handle: string | null } | null = null;
  try {
    collection = await deps.collections.retrieveCollectionByHandle(slug);
  } catch (error) {
    throw new ShowroomUpstreamError("Failed to read the collection", error);
  }
  if (!collection) {
    return { status: 404, reason: "NO_APPROVAL" };
  }
  const record = await getApproval(deps, "COLLECTION", slug);
  const decision = evaluateShowroomCollection(collection.handle, record, context);
  if (!decision.ok) {
    return { status: 404, reason: decision.reason };
  }

  const products = await safeProductList(deps);
  const approvals = await safeApprovalList(deps, "PRODUCT");
  const byProduct = new Map(approvals.map((entry) => [entry.subjectRef, entry]));
  const approvedProducts = products
    .filter((product) => product.collectionId === collection!.id)
    .map((product) => evaluateProductForContext(product, byProduct.get(product.id) ?? null, context))
    .filter((result) => result.ok)
    .map((result) => (result.ok ? result.value : null))
    .filter((value) => value !== null);

  const candidate = {
    market: request.market,
    locale: request.locale,
    collection: decision.value,
    products: approvedProducts
  };
  const parsed = ShowroomCollectionDetailSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ShowroomUpstreamError("The approved collection detail did not satisfy the public contract");
  }
  return { status: 200, body: parsed.data as ShowroomCollectionDetail };
}

// --- boundary parsing -------------------------------------------------------

export class ShowroomRequestError extends Error {
  readonly fieldErrors: { path: string; message: string }[];
  constructor(fieldErrors: { path: string; message: string }[]) {
    super("Invalid showroom request");
    this.name = "ShowroomRequestError";
    this.fieldErrors = fieldErrors;
  }
}

function fieldErrorsFrom(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join(".") || "(root)",
    message: issue.message
  }));
}

/**
 * Parses a list request from raw query values. Numeric inputs arrive as strings
 * from the HTTP layer and are converted before the strict, unbounded-schema
 * parse, so an out-of-range or non-numeric value still fails closed.
 */
export function parseListRequest(query: Record<string, unknown>): ShowroomListRequest {
  const numeric = (value: unknown) =>
    value === undefined ? undefined : typeof value === "string" ? Number(value) : value;
  const candidate = {
    ...query,
    page: numeric(query.page),
    pageSize: numeric(query.pageSize)
  };
  const parsed = ShowroomListRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ShowroomRequestError(fieldErrorsFrom(parsed.error));
  }
  return parsed.data;
}

/** Parses the strict detail request (exactly `market` and `locale`). */
export function parseDetailRequest(query: Record<string, unknown>): ShowroomPublicRequest {
  const parsed = ShowroomPublicRequestSchema.safeParse(query);
  if (!parsed.success) {
    throw new ShowroomRequestError(fieldErrorsFrom(parsed.error));
  }
  return parsed.data;
}

export { marketCurrency };

// --- Medusa container adapters ---------------------------------------------

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

import { SHOWROOM_PUBLICATION_MODULE } from "../modules/showroom-publication";

const MARKET_CURRENCY_CODE: Record<ShowroomMarket, string> = { CN: "cny", TW: "twd" };

/**
 * The live fields the gate reads. Money amounts live behind the variant's price
 * set: Medusa's Product module never hydrates `variants.prices`, the Pricing
 * module is reached through the Query layer, and each price's region scope is a
 * `region_id` price rule.
 */
const SHOWROOM_PRODUCT_FIELDS = [
  "id",
  "handle",
  "status",
  "collection_id",
  "created_at",
  "categories.handle",
  "variants.id",
  "variants.price_set.prices.amount",
  "variants.price_set.prices.currency_code",
  "variants.price_set.prices.price_rules.attribute",
  "variants.price_set.prices.price_rules.value"
];

/** The Medusa container scope a route handler resolves services from. */
export type ShowroomScope = { resolve: (key: string) => any };

function toLiveProduct(row: any): ShowroomLiveProduct {
  return {
    id: row.id,
    handle: row.handle ?? null,
    status: row.status ?? null,
    collectionId: row.collection_id ?? row.collection?.id ?? null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    categoryHandles: (row.categories ?? [])
      .map((category: any) => category?.handle)
      .filter((handle: unknown): handle is string => typeof handle === "string" && handle.length > 0),
    variants: (row.variants ?? []).map((variant: any) => ({
      id: variant.id,
      // Medusa's query layer exposes money amounts through the variant's
      // price set; the Admin fields remap this to `variants.prices` and turn
      // `price_rules` into `rules`, so both shapes are read here.
      prices: (variant.price_set?.prices ?? variant.prices ?? []).map((price: any) => ({
        regionId:
          price.rules?.region_id ??
          (price.price_rules ?? []).find((rule: any) => rule?.attribute === "region_id")?.value ??
          null,
        currencyCode: price.currency_code ?? "",
        amountMinor: Number(price.amount ?? 0)
      }))
    }))
  };
}

/**
 * Builds the read dependencies from a Medusa container scope. Services are
 * resolved lazily so a failed read is attributable, and every adapter keeps the
 * live Medusa data authoritative.
 */
export function createShowroomDeps(scope: ShowroomScope, now: () => Date = () => new Date()): ShowroomDeps {
  const query = () => scope.resolve(ContainerRegistrationKeys.QUERY);
  const productModule = () => scope.resolve(Modules.PRODUCT);
  const regionModule = () => scope.resolve(Modules.REGION);
  const translationModule = () => scope.resolve(Modules.TRANSLATION);
  const approvalModule = () => scope.resolve(SHOWROOM_PUBLICATION_MODULE);

  /**
   * The live per-locale translation fingerprint for each product, read from the
   * Medusa translation module. Every display locale is covered: a locale with no
   * stored translation reports the empty-payload fingerprint, so creating one
   * later is itself a change. A failed read is a `500`, never a silent skip.
   */
  async function translationFingerprints(
    productIds: string[]
  ): Promise<Record<string, Record<string, string>>> {
    const byId: Record<string, Record<string, string>> = {};
    for (const id of productIds) {
      byId[id] = Object.fromEntries(
        SHOWROOM_LOCALES.map((locale) => [locale, computeTranslationFingerprint(null)])
      );
    }
    if (productIds.length === 0) {
      return byId;
    }
    let rows: any[] = [];
    try {
      rows = (await translationModule().listTranslations({
        reference: "product",
        reference_id: productIds
      })) ?? [];
    } catch (error) {
      throw new ShowroomUpstreamError("Failed to read the live product translations", error);
    }
    for (const row of rows) {
      const id = String(row?.reference_id ?? "");
      const locale = String(row?.locale_code ?? "");
      if (!byId[id] || !(SHOWROOM_LOCALES as readonly string[]).includes(locale)) {
        continue;
      }
      byId[id][locale] = computeTranslationFingerprint(row?.translations);
    }
    return byId;
  }

  async function readProducts(filters: Record<string, unknown>, take?: number) {
    const { data } = await query().graph({
      entity: "product",
      fields: SHOWROOM_PRODUCT_FIELDS,
      filters,
      ...(take === undefined ? {} : { pagination: { take } })
    });
    const products: ShowroomLiveProduct[] = ((data ?? []) as any[]).map(toLiveProduct);
    const fingerprints = await translationFingerprints(products.map((product) => product.id));
    return products.map((product) => ({ ...product, translations: fingerprints[product.id] }));
  }

  return {
    now,
    products: {
      // Reads go through the Query layer: the Product module never hydrates
      // `variants.prices`, so money amounts and their region rules come from the
      // Pricing module through the price set.
      async listProducts() {
        return readProducts({});
      },
      async retrieveProductByHandle(handle: string) {
        const rows = await readProducts({ handle }, 1);
        return rows[0] ?? null;
      },
      async listProductsByHandles(handles: string[]) {
        if (handles.length === 0) {
          return [];
        }
        return readProducts({ handle: handles });
      }
    },
    collections: {
      async retrieveCollectionByHandle(handle: string) {
        const rows = await productModule().listCollections({ handle }, { take: 1 });
        const row = (rows ?? [])[0];
        return row ? { id: row.id, handle: row.handle ?? null } : null;
      }
    },
    regions: {
      async regionIdForMarket(market: ShowroomMarket) {
        const rows = await regionModule().listRegions({});
        const currencyCode = MARKET_CURRENCY_CODE[market];
        const region = (rows ?? []).find(
          (entry: any) => String(entry?.currency_code ?? "").toLowerCase() === currencyCode
        );
        return region?.id ?? null;
      }
    },
    approvals: {
      async getApproval(subjectKind: ShowroomSubjectKind, subjectRef: string) {
        return (await approvalModule().findApproval(subjectKind, subjectRef)) ?? null;
      },
      async listApprovals(subjectKind: ShowroomSubjectKind) {
        return (await approvalModule().listApprovalRecordsByKind(subjectKind)) ?? [];
      }
    }
  };
}

// --- route response helpers -------------------------------------------------

import { randomUUID } from "node:crypto";

const NO_STORE = "no-store";

/**
 * The shared public error envelope: `{ error: { code, message, fieldErrors?, requestId } }`,
 * exactly as `docs/API_SPECIFICATION.md` specifies for every public boundary.
 * `requestId` is Medusa's own request id when the route supplies it and a fresh
 * id otherwise, so a failure is always attributable.
 */
function errorEnvelope(
  code: string,
  message: string,
  requestId?: string | null,
  fieldErrors?: { path: string; message: string }[]
): { error: { code: string; message: string; fieldErrors?: { path: string; message: string }[]; requestId: string } } {
  return {
    error: {
      code,
      message,
      ...(fieldErrors ? { fieldErrors } : {}),
      requestId: requestId && requestId.trim().length > 0 ? requestId : randomUUID()
    }
  };
}

export function sendShowroomList(res: any, result: ShowroomListResult) {
  res.setHeader("Cache-Control", NO_STORE);
  res.status(result.status).json(result.body);
}

export function sendShowroomDetail(res: any, result: ShowroomDetailResult, requestId?: string | null) {
  res.setHeader("Cache-Control", NO_STORE);
  if (result.status === 200) {
    res.status(200).json(result.body);
    return;
  }
  res.status(404).json(
    errorEnvelope(
      "NOT_FOUND",
      "The requested showroom resource is not published for this market and locale.",
      requestId
    )
  );
}

export function sendShowroomValidationError(res: any, error: ShowroomRequestError, requestId?: string | null) {
  res.setHeader("Cache-Control", NO_STORE);
  res.status(400).json(errorEnvelope("VALIDATION_ERROR", error.message, requestId, error.fieldErrors));
}

export function sendShowroomUpstreamError(res: any, requestId?: string | null) {
  res.setHeader("Cache-Control", NO_STORE);
  res.status(500).json(errorEnvelope("INTERNAL_ERROR", "The showroom source could not be read.", requestId));
}
