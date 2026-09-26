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
  init: { readonly signal: AbortSignal; readonly redirect: "manual" | "error" }
) => Promise<{ status: number; url: string; json(): Promise<unknown> }>;

export type OidcDiscoveryOptions = {
  readonly issuer: string;
  readonly transport?: OidcDiscoveryTransport;
  readonly now?: () => number;
  readonly maxCacheMs?: number;
  readonly requestTimeoutMs?: number;
  readonly hostAllowlist?: readonly string[];
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

export function discoveryDocumentUrl(issuer: string): string {
  const base = issuer.endsWith("/") ? issuer : `${issuer}/`;
  return `${base}.well-known/openid-configuration`;
}


const DEFAULT_AUTHING_HOST_SUFFIXES = [".authing.cn"];

function looksLikeIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isPrivateOrReservedHostname(hostname: string): boolean {
  const bare = (hostname.endsWith(".") ? hostname.slice(0, -1) : hostname).toLowerCase();
  if (bare === "localhost" || bare.endsWith(".localhost")) return true;
  if (bare.endsWith(".local") || bare.endsWith(".internal")) return true;
  if (looksLikeIpv4(bare)) {
    const a = Number(bare.split(".")[0]);
    const b = Number(bare.split(".")[1]);
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true;
    return false;
  }
  if (bare.includes(":")) return true;
  return false;
}

function isTrustedAuthingHost(hostname: string, allowlist: readonly string[]): boolean {
  if (isPrivateOrReservedHostname(hostname)) return false;
  const lower = hostname.toLowerCase();
  // Allowlist is additive to default *.authing.cn trust.
  if (DEFAULT_AUTHING_HOST_SUFFIXES.some((suffix) => lower.endsWith(suffix))) {
    return true;
  }
  return allowlist.some((entry) => {
    const host = entry.toLowerCase();
    return lower === host || lower.endsWith(`.${host}`);
  });
}

export function assertTrustedOidcIssuer(issuer: string, allowlist: readonly string[] = []): void {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    fail("OIDC issuer is not a valid URL");
  }
  if (url.protocol !== "https:") fail("OIDC issuer must use HTTPS");
  if (url.username || url.password || url.search || url.hash) {
    fail("OIDC issuer must not contain credentials, query, or fragment");
  }
  if (!isTrustedAuthingHost(url.hostname, allowlist)) {
    fail("OIDC issuer host is not a trusted Authing domain");
  }
}

function assertSameIssuerOriginEndpoint(issuer: string, endpoint: string, label: string): void {
  let issuerUrl: URL;
  let endpointUrl: URL;
  try {
    issuerUrl = new URL(issuer);
    endpointUrl = new URL(endpoint);
  } catch {
    fail(`OIDC ${label} is not a valid URL`);
  }
  if (endpointUrl.protocol !== "https:") fail(`OIDC ${label} must use HTTPS`);
  if (endpointUrl.origin !== issuerUrl.origin) {
    fail(`OIDC ${label} must share the issuer origin`);
  }
}

function isDiscoveryShape(value: unknown, expectedIssuer: string): value is OidcDiscoveryDocument {
  if (typeof value !== "object" || value === null) return false;
  const doc = value as Record<string, unknown>;
  if (typeof doc.issuer !== "string" || doc.issuer.length === 0) return false;
  // Exact configured issuer comparison — never rewrite trailing slashes.
  if (doc.issuer !== expectedIssuer) return false;
  if (!isHttpsUrl(doc.authorization_endpoint)) return false;
  if (!isHttpsUrl(doc.token_endpoint)) return false;
  if (!isHttpsUrl(doc.jwks_uri)) return false;
  return true;
}

async function httpsDiscoveryTransport(
  url: string,
  init: { signal: AbortSignal; redirect: "manual" | "error" }
): Promise<{ status: number; url: string; json(): Promise<unknown> }> {
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    signal: init.signal,
    redirect: "manual",
    cache: "no-store"
  });
  // 3xx with manual redirect must fail closed — never follow Location.
  if (response.status >= 300 && response.status < 400) {
    fail("OIDC discovery redirects are not followed");
  }
  return {
    status: response.status,
    url: response.url || url,
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
    assertTrustedOidcIssuer(options.issuer, options.hostAllowlist ?? []);
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
      const discoveryUrl = discoveryDocumentUrl(this.#issuer);
      const response = await this.#transport(discoveryUrl, {
        signal: controller.signal,
        redirect: "manual"
      });
      if (response.status !== 200) {
        fail(`OIDC discovery responded with status ${response.status}.`);
      }
      // Final response URL must remain same-origin with the configured issuer.
      assertSameIssuerOriginEndpoint(this.#issuer, response.url || discoveryUrl, "discovery document");
      const body = await response.json();
      if (!isDiscoveryShape(body, this.#issuer)) {
        fail("OIDC discovery document is malformed or does not match the configured issuer.");
      }
      assertSameIssuerOriginEndpoint(this.#issuer, body.authorization_endpoint, "authorization_endpoint");
      assertSameIssuerOriginEndpoint(this.#issuer, body.token_endpoint, "token_endpoint");
      assertSameIssuerOriginEndpoint(this.#issuer, body.jwks_uri, "jwks_uri");
      if (body.end_session_endpoint) {
        assertSameIssuerOriginEndpoint(this.#issuer, body.end_session_endpoint, "end_session_endpoint");
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
