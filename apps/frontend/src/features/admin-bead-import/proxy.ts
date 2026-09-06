import { randomUUID } from "node:crypto";

import {
  ASSET_IMPORT_TRANSPORT_STATUS_BY_CODE,
  type AssetImportTransportErrorCode
} from "@mystcrag/design-contract";
import { NextResponse, type NextRequest } from "next/server";

import {
  isAssetAdminAuthenticated,
  resolveAssetAdminKey,
  type AssetAdminEnv
} from "./admin-auth";

/**
 * Server-side proxy for the bead import Admin API. The browser talks only to
 * this route: it never sees the Backend origin, never supplies `x-admin-key`,
 * and never sends its own cookies upstream. Uploads are streamed straight from
 * the incoming request body to the Backend and Backend responses are streamed
 * straight back, so a 256 MiB photograph is never buffered in this process.
 */

export const ASSET_ADMIN_BACKEND_PREFIX = "/api/admin/bead-import";

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT"]);
/** IDs and fixed route words only: no separators, escapes, dots-pairs or control bytes. */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;
const BODY_HEADER_ALLOWLIST = ["content-type", "content-length", "x-content-sha256"] as const;
const RESPONSE_HEADER_ALLOWLIST = ["content-type", "content-length", "etag", "cache-control"] as const;

export type BeadImportProxyFetcher = (
  url: string,
  init: RequestInit & { duplex?: "half" }
) => Promise<Response>;

export type BeadImportProxyDeps = {
  env?: AssetAdminEnv;
  fetcher?: BeadImportProxyFetcher;
};

function proxyError(code: AssetImportTransportErrorCode, message: string): NextResponse {
  const envelope = { error: { code, message, requestId: `frontend-${randomUUID()}` } };
  return new NextResponse(JSON.stringify(envelope), {
    status: ASSET_IMPORT_TRANSPORT_STATUS_BY_CODE[code],
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function isSafeProxyPath(path: readonly string[]): boolean {
  if (path.length === 0) {
    return false;
  }
  return path.every((segment) => segment !== "." && segment !== ".." && SAFE_PATH_SEGMENT.test(segment));
}

function resolveBackendOrigin(env: AssetAdminEnv): string | null {
  const raw = (env.MYSTCRAG_BACKEND_ORIGIN ?? "http://127.0.0.1:4000").replace(/\/+$/, "");
  if (raw === "") {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:" ? raw : null;
}

function forwardedSearch(request: NextRequest): string {
  const search = request.nextUrl.searchParams.toString();
  return search === "" ? "" : `?${search}`;
}

export async function handleBeadImportProxyRequest(
  request: NextRequest,
  path: string[],
  deps: BeadImportProxyDeps = {}
): Promise<NextResponse> {
  const env = deps.env ?? process.env;

  // Authentication is settled before anything else: an unauthenticated caller
  // must not cause a single Backend request, and an unconfigured deployment has
  // no key to authenticate with at all.
  const adminKey = resolveAssetAdminKey(env);
  if (adminKey === null || !isAssetAdminAuthenticated(request.cookies, env)) {
    return proxyError("UNAUTHORIZED", "Administrator session required.");
  }

  if (!ALLOWED_METHODS.has(request.method)) {
    return proxyError("VALIDATION_ERROR", "That HTTP method is not allowed on the bead import admin API.");
  }

  if (!isSafeProxyPath(path)) {
    return proxyError("VALIDATION_ERROR", "The requested bead import path is not allowed.");
  }

  const origin = resolveBackendOrigin(env);
  if (origin === null) {
    return proxyError("INTERNAL_ERROR", "The bead import service is not reachable from this deployment.");
  }

  const method = request.method;
  const carriesBody = method !== "GET";
  const headers = new Headers();
  headers.set("x-admin-key", adminKey);
  if (carriesBody) {
    for (const name of BODY_HEADER_ALLOWLIST) {
      const value = request.headers.get(name);
      if (value !== null) {
        headers.set(name, value);
      }
    }
  }

  const fetcher: BeadImportProxyFetcher = deps.fetcher ?? ((url, init) => fetch(url, init as RequestInit));
  let backendResponse: Response;
  try {
    backendResponse = await fetcher(`${origin}${ASSET_ADMIN_BACKEND_PREFIX}/${path.join("/")}${forwardedSearch(request)}`, {
      method,
      headers,
      body: carriesBody ? request.body : null,
      duplex: "half",
      cache: "no-store"
    });
  } catch {
    // The transport error is deliberately dropped: it can name the Backend origin.
    return proxyError("INTERNAL_ERROR", "The bead import service did not respond.");
  }

  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    const value = backendResponse.headers.get(name);
    if (value !== null) {
      responseHeaders.set(name, value);
    }
  }

  return new NextResponse(backendResponse.body, {
    status: backendResponse.status,
    headers: responseHeaders
  });
}
