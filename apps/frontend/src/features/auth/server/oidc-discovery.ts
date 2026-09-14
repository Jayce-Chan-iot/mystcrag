/**
 * OIDC discovery cache for Authing (and any standard OIDC issuer).
 * Server-only. Never exposes tokens or secrets to the browser.
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
  init: { readonly signal: AbortSignal }
) => Promise<{ status: number; json(): Promise<unknown> }>;

const DEFAULT_MAX_CACHE_MS = 15 * 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;

function normalizeIssuer(issuer: string): string {
  return issuer.endsWith("/") ? issuer : `${issuer}/`;
}

export function discoveryDocumentUrl(issuer: string): string {
  return `${normalizeIssuer(issuer)}.well-known/openid-configuration`;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isDiscoveryShape(value: unknown, expectedIssuer: string): value is OidcDiscoveryDocument {
  if (typeof value !== "object" || value === null) return false;
  const doc = value as Record<string, unknown>;
  if (typeof doc.issuer !== "string" || doc.issuer.length === 0) return false;
  if (normalizeIssuer(doc.issuer) !== normalizeIssuer(expectedIssuer)) return false;
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
};

export class OidcDiscoverySource {
  readonly #issuer: string;
  readonly #transport: OidcDiscoveryTransport;
  readonly #now: () => number;
  readonly #maxCacheMs: number;
  readonly #timeoutMs: number;
  #cache: { document: OidcDiscoveryDocument; fetchedAt: number } | null = null;
  #inflight: Promise<OidcDiscoveryDocument> | null = null;

  constructor(options: OidcDiscoverySourceOptions) {
    this.#issuer = options.issuer;
    this.#transport =
      options.transport ??
      (async (url, init) => {
        const response = await fetch(url, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: init.signal,
          cache: "no-store"
        });
        return { status: response.status, json: async () => response.json() };
      });
    this.#now = options.now ?? (() => Date.now());
    this.#maxCacheMs = options.maxCacheMs ?? DEFAULT_MAX_CACHE_MS;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#transport(discoveryDocumentUrl(this.#issuer), {
        signal: controller.signal
      });
      if (response.status !== 200) {
        throw new ProviderUnavailableError(`OIDC discovery status ${response.status}`);
      }
      const body = await response.json();
      if (!isDiscoveryShape(body, this.#issuer)) {
        throw new ProviderUnavailableError("OIDC discovery document is invalid");
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

// Process-wide discovery cache keyed by issuer.
const sources = new Map<string, OidcDiscoverySource>();

export function getOidcDiscoverySource(issuer: string): OidcDiscoverySource {
  const key = normalizeIssuer(issuer);
  let source = sources.get(key);
  if (!source) {
    source = new OidcDiscoverySource({ issuer });
    sources.set(key, source);
  }
  return source;
}
