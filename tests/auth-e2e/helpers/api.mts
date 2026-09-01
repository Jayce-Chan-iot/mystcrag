/**
 * BFF API client for AUTH-006 specs.
 *
 * Uses `page.request` (an APIRequestContext that shares the browser context's cookie
 * jar), so every call is made with EXACTLY the session cookies the real browser holds
 * — no hand-built cookie headers, no anonymous mock path. Mutations carry the same
 * Origin header a real same-origin browser fetch would send, because the BFF rejects
 * any mutation without the exact app origin.
 *
 * Request bodies are ALWAYS handed to Playwright as objects (`data: <object>`), never
 * pre-stringified: Playwright performs the single JSON serialization itself. The
 * H1 regression proves byte-for-byte (against a local echo server) that this produces
 * exactly one JSON encoding — a pre-stringified body would double-encode and the
 * backend schema would reject it, which the H2 contrast proves live.
 */

import type { APIRequestContext, Page } from "@playwright/test";

import { stackState } from "./run-state";

export type ApiResponse = {
  status: number;
  headers: Record<string, string[]>;
  body: string;
  json<T = unknown>(): T;
};

function collectHeaders(response: { headersArray(): Array<{ name: string; value: string }> }): Record<string, string[]> {
  const collected: Record<string, string[]> = {};
  for (const { name, value } of response.headersArray()) {
    const key = name.toLowerCase();
    (collected[key] ??= []).push(value);
  }
  return collected;
}

/**
 * Origin control for mutation calls. The default sends the exact app origin a real
 * same-origin browser fetch would send. `"omit"` sends no Origin header at all
 * (CSRF negative), and any other string sends an attacker Origin.
 */
export type OriginControl = "app" | "omit" | (string & {});

/**
 * Builds the API client around any Playwright APIRequestContext. `bffClient` binds it
 * to the browser page's context and this run's main app origin; the narrow regression
 * suite binds the very same request-building code to a standalone context against a
 * local echo server, so the encoding guarantees are tested on the exact code path.
 */
export function clientFor(
  request: APIRequestContext,
  resolveAppOrigin: () => Promise<string>
) {
  async function call(
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; origin?: OriginControl } = {}
  ): Promise<ApiResponse> {
    const mutation = method !== "GET";
    const originMode: OriginControl = options.origin ?? "app";
    const originHeader =
      !mutation || originMode === "omit"
        ? {}
        : { origin: originMode === "app" ? await resolveAppOrigin() : originMode };
    const response = await request.fetch(path, {
      method,
      headers: {
        ...originHeader,
        ...(options.body === undefined ? {} : { "content-type": "application/json" })
      },
      data: options.body,
      maxRedirects: 0,
      failOnStatusCode: false
    });
    const body = await response.text();
    return {
      status: response.status(),
      headers: collectHeaders(response),
      body,
      json<T = unknown>(): T {
        return JSON.parse(body) as T;
      }
    };
  }

  return {
    get: (path: string) => call("GET", path),
    post: (path: string, body?: unknown, options?: { origin?: OriginControl }) =>
      call("POST", path, { body, ...options }),

    session: () => call("GET", "/auth/session"),
    login: () => call("GET", "/auth/login"),
    logoutPost: (options?: { origin?: OriginControl }) =>
      call("POST", "/auth/logout", { ...options }),
    logoutGet: () => call("GET", "/auth/logout"),

    /** GET /api/designs — the protected "my designs" projection. */
    listDesigns: () => call("GET", "/api/designs"),
    getDesign: (designId: string) => call("GET", `/api/design/${encodeURIComponent(designId)}`),
    generateDesign: (input: unknown) => call("POST", "/api/design/generate", { body: input }),
    saveDesign: (input: unknown) => call("POST", "/api/design/save", { body: input }),
    cloneDesign: (input: unknown) => call("POST", "/api/design/clone", { body: input }),
    deleteDesign: (input: unknown) => call("POST", "/api/design/delete", { body: input }),
    updateDesign: (input: unknown) => call("POST", "/api/design/update", { body: input }),
    createOrder: (input: unknown) => call("POST", "/api/orders/from-design", { body: input }),
    listOrders: () => call("GET", "/api/orders"),
    catalogMaterials: () => call("GET", "/api/catalog/materials?currency=CNY")
  };
}

export function bffClient(page: Page) {
  return clientFor(page.request, async () => (await stackState()).urls.frontend);
}

/**
 * The minimum valid GenerateDesignRequest accepted by the real backend.
 *
 * `excludedProductIds` is the request contract's own exclusion mechanism. The seed
 * marks several CNY catalog products as out-of-stock (0) or low-stock (5), and the
 * deterministic rule-based recommender maps each candidate crystal to the
 * first-in-catalog-order product of that crystal — which is exactly the
 * out-of-stock size for several crystals (id order puts "-10" before "-6"/"-8").
 * Excluding every seeded out-of-stock/low-stock CNY product guarantees the
 * generated design only references materials whose seeded inventory (100) can
 * always satisfy the 12-bead layout, so the business-loop specs exercise the
 * authenticated surface rather than seed inventory state.
 */
const SEEDED_UNAVAILABLE_CNY_PRODUCT_IDS = [
  "product-amethyst-faceted-10",
  "product-amethyst-faceted-6",
  "product-fluorite-round-6",
  "product-black-onyx-round-10",
  "product-rose-quartz-round-6-twd",
  "product-moonstone-round-10",
  "product-garnet-faceted-8",
  "product-pendant-drop-silver-8",
  "product-tiger-eye-round-6"
] as const;

export function generateDesignRequest(): Record<string, unknown> {
  return {
    requestId: `auth006-${crypto.randomUUID()}`,
    locale: "zh-CN",
    currency: "CNY",
    wristCircumferenceMm: 155,
    emotionTags: ["calm"],
    styleTags: ["eastern"],
    colorTags: ["mist-blue"],
    minBudgetMinor: 3000,
    maxBudgetMinor: 50000,
    excludedProductIds: [...SEEDED_UNAVAILABLE_CNY_PRODUCT_IDS],
    personalizationConsent: true
  };
}
