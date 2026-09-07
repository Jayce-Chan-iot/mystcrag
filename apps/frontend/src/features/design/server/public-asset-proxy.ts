import {
  APPROVED_ASSET_KEY_PATTERN
} from "../model/visual-assets";

/**
 * Same-origin public asset delivery for the browser: GET /api/assets/<assetKey>
 * proxies exactly one backend route, `GET /api/assets/:assetKey`, which serves
 * only approved, published, publicly displayable images. The browser never
 * learns a backend origin, an archive or storage key, or any credential: this
 * handler validates the key shape before anything leaves the process, forwards
 * no request headers at all, streams the response body without buffering it,
 * and forwards only the four delivery headers the contract defines. Missing or
 * invalid deployment configuration fails closed with a redacted body.
 */

export const PUBLIC_ASSET_PROXY_DEFAULT_ORIGIN = "http://127.0.0.1:4000";

const RESPONSE_HEADER_ALLOWLIST = ["content-type", "content-length", "etag", "cache-control"] as const;

export type PublicAssetEnv = { readonly MYSTCRAG_BACKEND_ORIGIN?: string | undefined };

export type PublicAssetFetcher = (url: string, init?: RequestInit) => Promise<Response>;

function redacted(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

function resolveBackendOrigin(env: PublicAssetEnv): string | null {
  const raw = (env.MYSTCRAG_BACKEND_ORIGIN ?? PUBLIC_ASSET_PROXY_DEFAULT_ORIGIN).replace(/\/+$/, "");
  if (raw === "") {
    return null;
  }
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

/**
 * A dynamic route parameter may still carry percent-encoding, so it is decoded
 * exactly once before the strict key check. Anything that does not match
 * `approved:<64 lowercase hex>` — traversal, archive keys, legacy ids, encoded
 * separators — is rejected without a single upstream request.
 */
function decodeAssetKey(assetKeyParam: string): string | null {
  try {
    return decodeURIComponent(assetKeyParam);
  } catch {
    return null;
  }
}

export async function handlePublicAssetRequest(input: {
  assetKeyParam: string;
  env?: PublicAssetEnv;
  fetcher?: PublicAssetFetcher;
}): Promise<Response> {
  const assetKey = decodeAssetKey(input.assetKeyParam);
  if (assetKey === null || !APPROVED_ASSET_KEY_PATTERN.test(assetKey)) {
    return redacted(400, "INVALID_ASSET_KEY");
  }

  const origin = resolveBackendOrigin(input.env ?? {});
  if (origin === null) {
    return redacted(502, "ASSET_DELIVERY_UNAVAILABLE");
  }

  const fetcher = input.fetcher ?? ((url: string, init?: RequestInit) => fetch(url, { ...init, cache: "no-store" }));
  let backendResponse: Response;
  try {
    backendResponse = await fetcher(`${origin}/api/assets/${encodeURIComponent(assetKey)}`, { cache: "no-store" });
  } catch {
    // The transport error is deliberately dropped: it can name the backend origin.
    return redacted(502, "ASSET_DELIVERY_UNAVAILABLE");
  }

  if (!backendResponse.ok) {
    // The upstream status is meaningful (404 for unknown/unpublished assets);
    // its body may carry internal detail, so only the status is forwarded.
    return redacted(backendResponse.status === 404 ? 404 : 502, "ASSET_NOT_AVAILABLE");
  }

  const headers = new Headers();
  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    const value = backendResponse.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  return new Response(backendResponse.body, { status: backendResponse.status, headers });
}
