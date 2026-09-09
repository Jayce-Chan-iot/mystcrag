import { randomUUID } from "node:crypto";

import {
  ASSET_IMPORT_TRANSPORT_STATUS_BY_CODE,
  ASSET_MANIFEST_LIMITS,
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
 * The declared Content-Length is validated against the manifest limit before
 * any Backend call, and the streamed body is cut off if it ever grows beyond
 * that limit, so neither the framework-level clone cap nor this handler can
 * be bypassed by a lying or absent Content-Length.
 */

export const ASSET_ADMIN_BACKEND_PREFIX = "/api/admin/bead-import";

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT"]);
/** IDs and fixed route words only: no separators, escapes, dots-pairs or control bytes. */
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;
const BODY_HEADER_ALLOWLIST = ["content-type", "content-length", "x-content-sha256"] as const;
const RESPONSE_HEADER_ALLOWLIST = ["content-type", "content-length", "etag", "cache-control"] as const;
/** Hard upload ceiling shared with the Backend manifest contract (256 MiB). */
const MAX_UPLOAD_BYTES = ASSET_MANIFEST_LIMITS.maxFileBytes;
/** Plain digit runs without signs, exponents or leading zeros, capped below 2^53. */
const DECLARED_CONTENT_LENGTH_PATTERN = /^(0|[1-9][0-9]{0,15})$/;

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

/**
 * Streams the source through unchanged while counting transferred bytes; past
 * `limitBytes` the stream errors and the source is cancelled. Cancellation
 * from the consumer propagates back to the source, and nothing is buffered:
 * each chunk is handed to the consumer before the next one is pulled.
 */
function boundedUploadStream(
  source: ReadableStream<Uint8Array>,
  limitBytes: number
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let transferred = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      transferred += value.byteLength;
      if (transferred > limitBytes) {
        void reader.cancel().catch(() => undefined);
        controller.error(new RangeError("The uploaded body exceeded its allowed size."));
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
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
  let declaredBodyBytes: number | null = null;
  if (carriesBody) {
    for (const name of BODY_HEADER_ALLOWLIST) {
      const value = request.headers.get(name);
      if (value !== null) {
        headers.set(name, value);
      }
    }
    // The declared size is checked before any Backend call: an oversize or
    // malformed Content-Length must never open an upstream connection. An
    // absent declaration (a streamed body) is bounded at transfer time instead.
    const declared = request.headers.get("content-length");
    if (declared !== null) {
      if (!DECLARED_CONTENT_LENGTH_PATTERN.test(declared)) {
        return proxyError("VALIDATION_ERROR", "The declared upload size is not a valid Content-Length.");
      }
      const declaredNumber = Number(declared);
      if (declaredNumber > MAX_UPLOAD_BYTES) {
        return proxyError("PAYLOAD_TOO_LARGE", "The uploaded file exceeds the bead import size limit.");
      }
      declaredBodyBytes = declaredNumber;
    }
  }

  // With a declaration the stream must match it exactly; without one the
  // manifest limit still caps the transfer, so no upload path is unbounded.
  const bodyLimitBytes = declaredBodyBytes ?? MAX_UPLOAD_BYTES;
  const uploadBody =
    carriesBody && request.body !== null ? boundedUploadStream(request.body, bodyLimitBytes) : null;

  const fetcher: BeadImportProxyFetcher = deps.fetcher ?? ((url, init) => fetch(url, init as RequestInit));
  let backendResponse: Response;
  try {
    backendResponse = await fetcher(`${origin}${ASSET_ADMIN_BACKEND_PREFIX}/${path.join("/")}${forwardedSearch(request)}`, {
      method,
      headers,
      body: uploadBody,
      duplex: "half",
      cache: "no-store",
      // A client disconnect aborts the upstream fetch immediately, even while
      // the body is still streaming.
      signal: request.signal
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
