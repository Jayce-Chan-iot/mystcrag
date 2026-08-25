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

    if (cached && nowMs < cached.fetchedAt + cached.ttlMs) {
      if (kid === undefined || hasKid(cached.jwks, kid)) {
        return cached.jwks;
      }
      if (this.#inflight) {
        return this.#inflight;
      }
      if (
        this.#unknownKidCooldownUntil !== null &&
        nowMs < this.#unknownKidCooldownUntil
      ) {
        // A bounded refresh already confirmed this key set within the cooldown
        // window; answer from it so the caller can classify the kid as unknown
        // without contacting the provider.
        return cached.jwks;
      }
    } else if (this.#inflight) {
      return this.#inflight;
    }

    if (
      this.#failureAt !== null &&
      nowMs - this.#failureAt < this.#negativeCacheMs
    ) {
      fail("JWKS refresh is suppressed by the negative cache after a recent failure.");
    }

    this.#inflight = this.#refresh().finally(() => {
      this.#inflight = null;
    });
    const jwks = await this.#inflight;
    if (kid !== undefined && !hasKid(jwks, kid)) {
      // Global cooldown: one successful bounded refresh proved the kid is not
      // in the current key set, so further unknown-kid refreshes are suppressed
      // for the cooldown window. Known cached keys keep verifying above.
      this.#unknownKidCooldownUntil = this.#now() + this.#negativeCacheMs;
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
