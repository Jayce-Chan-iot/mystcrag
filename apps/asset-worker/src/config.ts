/**
 * Worker configuration from the environment. Every value is validated the
 * same way: fractional numbers are rejected instead of silently rounded,
 * timings must be positive safe integers inside sane caps, the heartbeat must
 * leave a margin below the lease, and error messages never echo other
 * environment values (a mistyped lease next to a secret DATABASE_URL must not
 * turn the crash message into a credential leak).
 */
export class WorkerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkerConfigError";
  }
}

export type WorkerConfig = {
  databaseUrl: string;
  archiveRoot: string;
  workerId: string;
  leaseMs: number;
  heartbeatMs: number;
  pollMs: number;
  shutdownGraceMs: number;
  transientRetryDelayMs: number;
};

const MAX_WORKER_ID_LENGTH = 160;

type TimingSpec = {
  readonly name: string;
  readonly field: "leaseMs" | "heartbeatMs" | "pollMs" | "shutdownGraceMs" | "transientRetryDelayMs";
  readonly fallback: number;
  readonly max: number;
};

const TIMING_SPECS: readonly TimingSpec[] = [
  { name: "MYSTCRAG_ASSET_WORKER_LEASE_MS", field: "leaseMs", fallback: 60_000, max: 3_600_000 },
  { name: "MYSTCRAG_ASSET_WORKER_HEARTBEAT_MS", field: "heartbeatMs", fallback: 20_000, max: 600_000 },
  { name: "MYSTCRAG_ASSET_WORKER_POLL_MS", field: "pollMs", fallback: 5_000, max: 600_000 },
  { name: "MYSTCRAG_ASSET_WORKER_SHUTDOWN_GRACE_MS", field: "shutdownGraceMs", fallback: 30_000, max: 600_000 },
  {
    name: "MYSTCRAG_ASSET_WORKER_TRANSIENT_RETRY_DELAY_MS",
    field: "transientRetryDelayMs",
    fallback: 60_000,
    max: 3_600_000
  }
];

function readPositiveSafeInteger(env: Record<string, string | undefined>, spec: TimingSpec): number {
  const raw = env[spec.name];
  if (raw === undefined) return spec.fallback;
  const trimmed = raw.trim();
  // An explicitly set but empty (or blank) variable is a configuration
  // mistake, not "unset": fail closed instead of silently applying a default.
  if (trimmed === "") {
    throw new WorkerConfigError(`${spec.name} is set but empty; provide a positive safe integer in milliseconds`);
  }
  // Only plain integer literals are accepted: "1.5" must fail instead of
  // becoming 2 through rounding, and "6e4"-style notation stays out.
  if (!/^[+-]?\d+$/.test(trimmed)) {
    throw new WorkerConfigError(`${spec.name} must be a positive safe integer in milliseconds`);
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new WorkerConfigError(`${spec.name} must be a positive safe integer in milliseconds`);
  }
  if (value > spec.max) {
    throw new WorkerConfigError(`${spec.name} must not exceed ${spec.max}ms`);
  }
  return value;
}

function readWorkerId(env: Record<string, string | undefined>): string {
  const raw = env.MYSTCRAG_ASSET_WORKER_ID;
  const trimmed = raw?.trim();
  const workerId = trimmed && trimmed.length > 0 ? trimmed : `asset-worker-${process.pid}`;
  // Control characters would corrupt structured logs and lease-audit lines.
  if (/[\0-\x1f\u007f]/.test(workerId)) {
    throw new WorkerConfigError("MYSTCRAG_ASSET_WORKER_ID must not contain control characters or newlines");
  }
  if (workerId.length > MAX_WORKER_ID_LENGTH) {
    throw new WorkerConfigError(`MYSTCRAG_ASSET_WORKER_ID must be at most ${MAX_WORKER_ID_LENGTH} characters`);
  }
  return workerId;
}

export function loadWorkerConfigFromEnv(env: Record<string, string | undefined>): WorkerConfig {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new WorkerConfigError("DATABASE_URL is required");
  }
  const archiveRoot = env.MYSTCRAG_ASSET_ARCHIVE_ROOT?.trim();
  if (!archiveRoot) {
    throw new WorkerConfigError("MYSTCRAG_ASSET_ARCHIVE_ROOT is required");
  }

  const timing = {} as Record<TimingSpec["field"], number>;
  for (const spec of TIMING_SPECS) {
    timing[spec.field] = readPositiveSafeInteger(env, spec);
  }
  // A heartbeat at or above the lease leaves no window to detect a lost lease
  // before the lease itself expires: reject the configuration up front.
  if (timing.heartbeatMs >= timing.leaseMs) {
    throw new WorkerConfigError(
      "MYSTCRAG_ASSET_WORKER_HEARTBEAT_MS must stay strictly below MYSTCRAG_ASSET_WORKER_LEASE_MS"
    );
  }

  return {
    databaseUrl,
    archiveRoot,
    workerId: readWorkerId(env),
    ...timing
  };
}
