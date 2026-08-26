import { ProviderUnavailableError } from "./auth-errors.js";

export type JsonWebKeySet = {
  readonly keys: readonly Record<string, unknown>[];
};

export type JwksTransportResponse = {
  readonly status: number;
  readonly cacheControl: string | null;
  json(): Promise<unknown>;
};

export type JwksTransport = (
  url: string,
  init: { readonly signal: AbortSignal }
) => Promise<JwksTransportResponse>;

export type JwksKeySourceOptions = {
  readonly url: string;
  readonly transport?: JwksTransport;
  readonly now?: () => number;
  readonly maxCacheMs?: number;
  readonly negativeCacheMs?: number;
  readonly requestTimeoutMs?: number;
};

const DEFAULT_MAX_CACHE_MS = 15 * 60_000;
const DEFAULT_NEGATIVE_CACHE_MS = 30_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

type CachedKeySet = {
  readonly jwks: JsonWebKeySet;
  readonly fetchedAt: number;
  readonly ttlMs: number;
};

function isJwksShape(value: unknown): value is JsonWebKeySet {
  if (typeof value !== "object" || value === null) return false;
  const keys = (value as { keys?: unknown }).keys;
  if (!Array.isArray(keys) || keys.length === 0) return false;
  return keys.every((key) => typeof key === "object" && key !== null);
}

function hasUniqueKids(jwks: JsonWebKeySet): boolean {
  const kids = new Set<string>();
  for (const key of jwks.keys) {
    const kid = key.kid;
    if (kid === undefined) continue;
    if (typeof kid !== "string" || kids.has(kid)) return false;
    kids.add(kid);
  }
  return true;
}

function maxAgeMsFromCacheControl(cacheControl: string | null): number | null {
  if (!cacheControl) return null;
  const match = /max-age\s*=\s*(\d+)/i.exec(cacheControl);
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
}

function hasKid(jwks: JsonWebKeySet, kid: string): boolean {
  return jwks.keys.some((key) => key.kid === kid);
}

function fail(message: string, cause?: unknown): never {
  throw new ProviderUnavailableError(message, { cause });
}

/**
 * Raised when the most recent successful JWKS refresh proves the requested
 * signing key id is absent. Deliberately carries no kid value so attacker
 * controlled header input never propagates through error paths.
 */
export class UnknownJwksKeyError extends Error {
  constructor() {
    super("The requested signing key id is not in the issuer's current key set.");
    this.name = "UnknownJwksKeyError";
  }
}

async function httpsJwksTransport(
  url: string,
  init: { signal: AbortSignal }
): Promise<JwksTransportResponse> {
  const { default: https } = await import("node:https");
  const connectTimeoutMs = 2_000;
  const readTimeoutMs = 2_000;
  const totalTimeoutMs = 5_000;

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      fail("The JWKS endpoint must use HTTPS.");
    }
    const agent = new https.Agent({ keepAlive: false });

    let connectTimer: NodeJS.Timeout | undefined;
    let readTimer: NodeJS.Timeout | undefined;
    let totalTimer: NodeJS.Timeout | undefined;
    let settled = false;

    const clearTimers = () => {
      clearTimeout(connectTimer);
      clearTimeout(readTimer);
      clearTimeout(totalTimer);
    };
    const settle = (settleFn: (value: never) => void, value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimers();
      init.signal.removeEventListener("abort", onAbort);
      settleFn(value as never);
    };
    const onAbort = () => {
      request.destroy();
      settle(reject, new ProviderUnavailableError("The JWKS request was aborted."));
    };

    const request = https.request(
      parsed,
      { method: "GET", agent, headers: { accept: "application/json" } },
      (response) => {
        clearTimeout(connectTimer);
        readTimer = setTimeout(() => {
          request.destroy();
          settle(reject, new ProviderUnavailableError("The JWKS read phase timed out."));
        }, readTimeoutMs);
        readTimer.unref();
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          settle(resolve, {
            status: response.statusCode ?? 0,
            cacheControl: response.headers["cache-control"] ?? null,
            json: async () => JSON.parse(body)
          });
        });
        response.on("error", (error: Error) => {
          settle(reject, new ProviderUnavailableError("The JWKS response failed.", { cause: error }));
        });
      }
    );

    connectTimer = setTimeout(() => {
      request.destroy();
      settle(reject, new ProviderUnavailableError("The JWKS connect phase timed out."));
    }, connectTimeoutMs);
    totalTimer = setTimeout(() => {
      request.destroy();
      settle(reject, new ProviderUnavailableError("The JWKS request exceeded its total budget."));
    }, totalTimeoutMs);
    connectTimer.unref();
    totalTimer.unref();

    request.on("socket", (socket) => {
      socket.once("connect", () => clearTimeout(connectTimer));
    });
    request.on("error", (error) => {
      if (init.signal.aborted) {
        settle(reject, new ProviderUnavailableError("The JWKS request was aborted."));
        return;
      }
      settle(
        reject,
        new ProviderUnavailableError("The JWKS request failed.", { cause: error })
      );
    });

    if (init.signal.aborted) {
      onAbort();
      return;
    }
    init.signal.addEventListener("abort", onAbort, { once: true });
    request.end();
  });
}

export class JwksKeySource {
  readonly #url: string;
  readonly #transport: JwksTransport;
  readonly #now: () => number;
  readonly #maxCacheMs: number;
  readonly #negativeCacheMs: number;
  readonly #requestTimeoutMs: number;
  #cache: CachedKeySet | null = null;
  #failureAt: number | null = null;
  #unknownKidCooldownUntil: number | null = null;
  #inflight: Promise<JsonWebKeySet> | null = null;

  constructor(options: JwksKeySourceOptions) {
    this.#url = options.url;
    this.#transport = options.transport ?? httpsJwksTransport;
    this.#now = options.now ?? (() => Date.now());
    this.#maxCacheMs = options.maxCacheMs ?? DEFAULT_MAX_CACHE_MS;
    this.#negativeCacheMs = options.negativeCacheMs ?? DEFAULT_NEGATIVE_CACHE_MS;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async getJwks(kid?: string): Promise<JsonWebKeySet> {
    const nowMs = this.#now();
    const cached = this.#cache;

    if (cached !== null && nowMs < cached.fetchedAt + cached.ttlMs) {
      if (kid === undefined || hasKid(cached.jwks, kid)) {
        return cached.jwks;
      }
    }

    if (
      kid !== undefined &&
      this.#unknownKidCooldownUntil !== null &&
      nowMs < this.#unknownKidCooldownUntil &&
      (cached === null || !hasKid(cached.jwks, kid))
    ) {
      // The most recent successful refresh already proved this kid is absent.
      // The cooldown is a negative result that is independent of the positive
      // key-set TTL: even an expired positive cache (for example max-age=0)
      // must not trigger a new transport call for a kid the latest key set
      // does not contain. A kid that did exist in the expired key set falls
      // through to a refresh below, because expired keys never verify.
      throw new UnknownJwksKeyError();
    }

    if (this.#inflight !== null) {
      return this.#settleRefresh(this.#inflight, kid);
    }

    if (
      this.#failureAt !== null &&
      nowMs - this.#failureAt < this.#negativeCacheMs
    ) {
      fail("JWKS refresh is suppressed by the negative cache after a recent failure.");
    }

    const inflight = this.#refresh().finally(() => {
      this.#inflight = null;
    });
    this.#inflight = inflight;
    return this.#settleRefresh(inflight, kid);
  }

  async #settleRefresh(
    inflight: Promise<JsonWebKeySet>,
    kid?: string
  ): Promise<JsonWebKeySet> {
    const jwks = await inflight;
    if (kid !== undefined && !hasKid(jwks, kid)) {
      // One successful bounded refresh proved the kid is absent: record an
      // independent global negative result. No attacker-supplied kid is ever
      // stored, and known cached keys keep verifying through the fast path.
      this.#unknownKidCooldownUntil = this.#now() + this.#negativeCacheMs;
      throw new UnknownJwksKeyError();
    }
    return jwks;
  }

  async #refresh(): Promise<JsonWebKeySet> {
    const controller = new AbortController();
    let budgetTimer: NodeJS.Timeout | undefined;
    const budget = new Promise<never>((_, reject) => {
      budgetTimer = setTimeout(() => {
        controller.abort();
        reject(new ProviderUnavailableError("The JWKS request exceeded its total budget."));
      }, this.#requestTimeoutMs);
      budgetTimer.unref();
    });
    try {
      const response = await Promise.race([
        this.#transport(this.#url, { signal: controller.signal }),
        budget
      ]);
      if (response.status !== 200) {
        fail(`The JWKS endpoint responded with status ${response.status}.`);
      }
      const body = await Promise.race([response.json(), budget]);
      if (!isJwksShape(body)) {
        fail("The JWKS endpoint returned a malformed key set.");
      }
      if (!hasUniqueKids(body)) {
        fail("The JWKS endpoint returned a key set with duplicate or invalid kids.");
      }
      const providerMaxAgeMs = maxAgeMsFromCacheControl(response.cacheControl);
      const ttlMs = Math.min(
        this.#maxCacheMs,
        providerMaxAgeMs === null ? this.#maxCacheMs : providerMaxAgeMs
      );
      const jwks: JsonWebKeySet = { keys: [...body.keys] };
      this.#cache = { jwks, fetchedAt: this.#now(), ttlMs };
      this.#failureAt = null;
      return jwks;
    } catch (error) {
      this.#failureAt = this.#now();
      if (error instanceof ProviderUnavailableError) {
        throw error;
      }
      fail("The JWKS request failed.", error);
    } finally {
      clearTimeout(budgetTimer);
    }
  }
}
