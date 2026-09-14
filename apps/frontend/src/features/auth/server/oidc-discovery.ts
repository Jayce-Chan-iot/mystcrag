/**
 * OIDC discovery cache for Authing.
 *
 * Security boundaries:
 * - Endpoints must be HTTPS and same-origin as the configured issuer.
 * - Issuer host must be a trusted Authing domain (*.authing.cn by default).
 * - Redirects are not followed; every hop/final URL is re-validated.
 * - Loopback / link-local / private hosts are rejected.
 */

import { ProviderUnavailableError } from "./oidc-errors";

export type OidcDiscoveryDocument = {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly end_session_endpoint?: string;
};

export type OidcDiscoveryTransport = (
  url: string,
  init: { readonly signal: AbortSignal; readonly redirect: "manual" | "error" }
) => Promise<{ status: number; url: string; json(): Promise<unknown> }>;

const DEFAULT_MAX_CACHE_MS = 15 * 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_AUTHING_HOST_SUFFIXES = [".authing.cn", ".authing.co"];

function normalizeIssuerPath(issuer: string): string {
  return issuer.endsWith("/") ? issuer : `${issuer}/`;
}

export function discoveryDocumentUrl(issuer: string): string {
  return `${normalizeIssuerPath(issuer)}.well-known/openid-configuration`;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function looksLikeIpv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function looksLikeIpv6(host: string): boolean {
  return host.includes(":");
}

function isPrivateOrReservedHostname(hostname: string): boolean {
  const bare = hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  const lower = bare.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower.endsWith(".local") || lower.endsWith(".internal")) return true;
  if (looksLikeIpv4(lower)) {
    const parts = lower.split(".").map(Number);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? 0;
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a >= 224) return true;
    return false;
  }
  if (looksLikeIpv6(lower)) {
    return true;
  }
  return false;
}

function isTrustedAuthingHost(hostname: string, allowlist: readonly string[]): boolean {
  if (isPrivateOrReservedHostname(hostname)) return false;
  const lower = hostname.toLowerCase();
  if (allowlist.length === 0) {
    return DEFAULT_AUTHING_HOST_SUFFIXES.some((suffix) => lower.endsWith(suffix));
  }
  return allowlist.some((entry) => {
    const host = entry.toLowerCase();
    return lower === host || lower.endsWith(`.${host}`);
  });
}

export function assertTrustedOidcIssuer(issuer: string, allowlist: readonly string[] = []): URL {
  let url: URL;
  try {
    url = new URL(issuer);
  } catch {
    throw new ProviderUnavailableError("OIDC issuer is not a valid URL");
  }
  if (url.protocol !== "https:") {
    throw new ProviderUnavailableError("OIDC issuer must use HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ProviderUnavailableError("OIDC issuer must not contain credentials, query, or fragment");
  }
  if (!isTrustedAuthingHost(url.hostname, allowlist)) {
    throw new ProviderUnavailableError("OIDC issuer host is not a trusted Authing domain");
  }
  return url;
}

export function assertSameIssuerOriginEndpoint(
  issuer: string,
  endpoint: string,
  label: string
): void {
  let issuerUrl: URL;
  let endpointUrl: URL;
  try {
    issuerUrl = new URL(issuer);
    endpointUrl = new URL(endpoint);
  } catch {
    throw new ProviderUnavailableError(`OIDC ${label} is not a valid URL`);
  }
  if (endpointUrl.protocol !== "https:") {
    throw new ProviderUnavailableError(`OIDC ${label} must use HTTPS`);
  }
  if (endpointUrl.origin !== issuerUrl.origin) {
    throw new ProviderUnavailableError(`OIDC ${label} must share the issuer origin`);
  }
}

function isDiscoveryShape(value: unknown, expectedIssuer: string): value is OidcDiscoveryDocument {
  if (typeof value !== "object" || value === null) return false;
  const doc = value as Record<string, unknown>;
  // Exact configured issuer comparison — no trailing-slash normalization.
  if (doc.issuer !== expectedIssuer) return false;
  if (!isHttpsUrl(doc.authorization_endpoint)) return false;
  if (!isHttpsUrl(doc.token_endpoint)) return false;
  if (!isHttpsUrl(doc.jwks_uri)) return false;
  return true;
}

export type OidcDiscoverySourceOptions = {
  readonly issuer: string;
  readonly transport?: OidcDiscoveryTransport;
  readonly now?: () => number;
  readonly maxCacheMs?: number;
  readonly timeoutMs?: number;
  readonly hostAllowlist?: readonly string[];
  /** Test-only: bypass process-global cache isolation. */
  readonly isolated?: boolean;
};

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
  // 3xx with manual redirect must be rejected as a cross-hop navigation.
  if (response.status >= 300 && response.status < 400) {
    throw new ProviderUnavailableError("OIDC discovery redirects are not followed");
  }
  return {
    status: response.status,
    url: response.url || url,
    json: async () => response.json()
  };
}

export class OidcDiscoverySource {
  readonly #issuer: string;
  readonly #transport: OidcDiscoveryTransport;
  readonly #now: () => number;
  readonly #maxCacheMs: number;
  readonly #timeoutMs: number;
  readonly #hostAllowlist: readonly string[];
  #cache: { document: OidcDiscoveryDocument; fetchedAt: number } | null = null;
  #inflight: Promise<OidcDiscoveryDocument> | null = null;

  constructor(options: OidcDiscoverySourceOptions) {
    assertTrustedOidcIssuer(options.issuer, options.hostAllowlist ?? []);
    this.#issuer = options.issuer;
    this.#transport = options.transport ?? httpsDiscoveryTransport;
    this.#now = options.now ?? (() => Date.now());
    this.#maxCacheMs = options.maxCacheMs ?? DEFAULT_MAX_CACHE_MS;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#hostAllowlist = options.hostAllowlist ?? [];
  }

  async getDocument(): Promise<OidcDiscoveryDocument> {
    const cached = this.#cache;
    if (cached !== null && this.#now() - cached.fetchedAt < this.#maxCacheMs) {
      return cached.document;
    }
    if (this.#inflight !== null) {
      return this.#inflight;
    }
    const inflight = this.#fetch().finally(() => {
      this.#inflight = null;
    });
    this.#inflight = inflight;
    return inflight;
  }

  async #fetch(): Promise<OidcDiscoveryDocument> {
    assertTrustedOidcIssuer(this.#issuer, this.#hostAllowlist);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    timer.unref?.();
    try {
      const discoveryUrl = discoveryDocumentUrl(this.#issuer);
      const response = await this.#transport(discoveryUrl, {
        signal: controller.signal,
        redirect: "manual"
      });
      if (response.status !== 200) {
        throw new ProviderUnavailableError(`OIDC discovery status ${response.status}`);
      }
      // Re-validate the final response URL after any transport behavior.
      assertSameIssuerOriginEndpoint(this.#issuer, response.url || discoveryUrl, "discovery document");
      const body = await response.json();
      if (!isDiscoveryShape(body, this.#issuer)) {
        throw new ProviderUnavailableError("OIDC discovery document is invalid or issuer mismatch");
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
        ...(body.end_session_endpoint ? { end_session_endpoint: body.end_session_endpoint } : {})
      };
      this.#cache = { document, fetchedAt: this.#now() };
      return document;
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw error;
      throw new ProviderUnavailableError("OIDC discovery request failed", { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}

const sources = new Map<string, OidcDiscoverySource>();

export function getOidcDiscoverySource(issuer: string): OidcDiscoverySource {
  const key = issuer;
  let source = sources.get(key);
  if (!source) {
    source = new OidcDiscoverySource({ issuer });
    sources.set(key, source);
  }
  return source;
}

export function __resetOidcDiscoveryCacheForTests(): void {
  sources.clear();
}
