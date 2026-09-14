import { ProviderUnavailableError } from "./auth-errors.js";

export type OidcDiscoveryDocument = {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly end_session_endpoint?: string;
  readonly userinfo_endpoint?: string;
};

export type OidcDiscoveryTransport = (
  url: string,
  init: { readonly signal: AbortSignal }
) => Promise<{ status: number; json(): Promise<unknown> }>;

export type OidcDiscoveryOptions = {
  readonly issuer: string;
  readonly transport?: OidcDiscoveryTransport;
  readonly now?: () => number;
  readonly maxCacheMs?: number;
  readonly requestTimeoutMs?: number;
};

const DEFAULT_MAX_CACHE_MS = 15 * 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

function fail(message: string, cause?: unknown): never {
  throw new ProviderUnavailableError(message, { cause });
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeIssuerPath(issuer: string): string {
  return issuer.endsWith("/") ? issuer : `${issuer}/`;
}

export function discoveryDocumentUrl(issuer: string): string {
  return `${normalizeIssuerPath(issuer)}.well-known/openid-configuration`;
}

function isDiscoveryShape(value: unknown, expectedIssuer: string): value is OidcDiscoveryDocument {
  if (typeof value !== "object" || value === null) return false;
  const doc = value as Record<string, unknown>;
  if (typeof doc.issuer !== "string" || doc.issuer.length === 0) return false;
  // Authing may or may not include the trailing slash; compare normalized forms.
  if (normalizeIssuerPath(doc.issuer) !== normalizeIssuerPath(expectedIssuer)) return false;
  if (!isHttpsUrl(doc.authorization_endpoint)) return false;
  if (!isHttpsUrl(doc.token_endpoint)) return false;
  if (!isHttpsUrl(doc.jwks_uri)) return false;
  return true;
}

async function httpsDiscoveryTransport(
  url: string,
  init: { signal: AbortSignal }
): Promise<{ status: number; json(): Promise<unknown> }> {
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: init.signal,
    cache: "no-store"
  });
  return {
    status: response.status,
    json: async () => response.json()
  };
}

/**
 * Caches the OIDC discovery document for an issuer. Authing exposes jwks_uri and
 * end_session_endpoint through discovery; the backend never guesses Auth0-style
 * well-known JWKS paths as the sole authority.
 */
export class OidcDiscoverySource {
  readonly #issuer: string;
  readonly #transport: OidcDiscoveryTransport;
  readonly #now: () => number;
  readonly #maxCacheMs: number;
  readonly #requestTimeoutMs: number;
  #cache: { document: OidcDiscoveryDocument; fetchedAt: number } | null = null;
  #inflight: Promise<OidcDiscoveryDocument> | null = null;

  constructor(options: OidcDiscoveryOptions) {
    this.#issuer = options.issuer;
    this.#transport = options.transport ?? httpsDiscoveryTransport;
    this.#now = options.now ?? (() => Date.now());
    this.#maxCacheMs = options.maxCacheMs ?? DEFAULT_MAX_CACHE_MS;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async getDocument(): Promise<OidcDiscoveryDocument> {
    const cached = this.#cache;
    if (cached !== null && this.#now() - cached.fetchedAt < this.#maxCacheMs) {
      return cached.document;
    }
    if (this.#inflight !== null) {
      return this.#inflight;
    }
    const inflight = this.#fetchDocument().finally(() => {
      this.#inflight = null;
    });
    this.#inflight = inflight;
    return inflight;
  }

  async getJwksUri(): Promise<string> {
    const document = await this.getDocument();
    return document.jwks_uri;
  }

  async #fetchDocument(): Promise<OidcDiscoveryDocument> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#requestTimeoutMs);
    timer.unref?.();
    try {
      const response = await this.#transport(discoveryDocumentUrl(this.#issuer), {
        signal: controller.signal
      });
      if (response.status !== 200) {
        fail(`OIDC discovery responded with status ${response.status}.`);
      }
      const body = await response.json();
      if (!isDiscoveryShape(body, this.#issuer)) {
        fail("OIDC discovery document is malformed or does not match the configured issuer.");
      }
      const document: OidcDiscoveryDocument = {
        issuer: body.issuer,
        authorization_endpoint: body.authorization_endpoint,
        token_endpoint: body.token_endpoint,
        jwks_uri: body.jwks_uri,
        ...(body.end_session_endpoint ? { end_session_endpoint: body.end_session_endpoint } : {}),
        ...(body.userinfo_endpoint ? { userinfo_endpoint: body.userinfo_endpoint } : {})
      };
      this.#cache = { document, fetchedAt: this.#now() };
      return document;
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw error;
      fail("OIDC discovery request failed.", error);
    } finally {
      clearTimeout(timer);
    }
  }
}
