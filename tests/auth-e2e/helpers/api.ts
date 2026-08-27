/**
 * BFF API client for AUTH-006 specs.
 *
 * Uses `page.request` (an APIRequestContext that shares the browser context's cookie
 * jar), so every call is made with EXACTLY the session cookies the real browser holds
 * — no hand-built cookie headers, no anonymous mock path. Mutations carry the same
 * Origin header a real same-origin browser fetch would send, because the BFF rejects
 * any mutation without the exact app origin.
 */

import type { Page } from "@playwright/test";

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

export function bffClient(page: Page) {
  const request = page.request;
  let appOrigin: string | null = null;

  async function origin(): Promise<string> {
    appOrigin ??= (await stackState()).urls.frontend;
    return appOrigin;
  }

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
        : { origin: originMode === "app" ? await origin() : originMode };
    const response = await request.fetch(path, {
      method,
      headers: {
        ...originHeader,
        ...(options.body === undefined ? {} : { "content-type": "application/json" })
      },
      data: options.body === undefined ? undefined : JSON.stringify(options.body),
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
    generateDesign: (input: unknown) => call("POST", "/api/design/generate", input),
    saveDesign: (input: unknown) => call("POST", "/api/design/save", input),
    cloneDesign: (input: unknown) => call("POST", "/api/design/clone", input),
    deleteDesign: (input: unknown) => call("POST", "/api/design/delete", input),
    updateDesign: (input: unknown) => call("POST", "/api/design/update", input),
    createOrder: (input: unknown) => call("POST", "/api/orders/from-design", input),
    listOrders: () => call("GET", "/api/orders"),
    catalogMaterials: () => call("GET", "/api/catalog/materials?currency=CNY")
  };
}

/** The minimum valid GenerateDesignRequest accepted by the real backend. */
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
    excludedProductIds: [],
    personalizationConsent: true
  };
}
