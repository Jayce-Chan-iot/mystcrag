import { PersistenceError } from "@mystcrag/database";
import type {
  AssetJobFailure,
  AssetJobLease,
  ClaimedAssetJob,
  CompleteAssetJobResult,
  FailAssetJobOutcome
} from "@mystcrag/database";

import {
  classifyHandlerError,
  JobExecutionError,
  type ClassifiedJobError,
  type JobHandlerOutcome,
  type JobHandlers,
  type JobRunContext
} from "./jobs.js";

export type WorkerRepository = {
  claimNextJob(workerId: string, leaseUntil: Date): Promise<ClaimedAssetJob | null>;
  heartbeatJob(jobId: string, lease: AssetJobLease, leaseUntil: Date): Promise<boolean>;
  completeJob(
    jobId: string,
    result: CompleteAssetJobResult,
    lease: AssetJobLease
  ): Promise<{ jobId: string; state: "COMPLETED"; completedAt: Date }>;
  failJob(
    jobId: string,
    error: AssetJobFailure,
    retryAt: Date | null,
    lease: AssetJobLease
  ): Promise<FailAssetJobOutcome>;
};

export type WorkerRunOutcome = "completed" | "idle" | "failed" | "abandoned";

export type AssetWorkerLogger = {
  info(message: string): void;
  error(message: string, detail?: string): void;
};

export type AssetWorkerOptions = {
  repository: WorkerRepository;
  handlers: JobHandlers;
  workerId: string;
  leaseMs: number;
  heartbeatMs: number;
  pollMs: number;
  shutdownGraceMs: number;
  transientRetryDelayMs: number;
  logger?: AssetWorkerLogger;
};

const MAX_WORKER_ID_LENGTH = 160;
const CONTROL_CHARACTER_PATTERN = /[\0-\x1f\u007f]/;

// Redaction patterns for anything a failure detail might carry. Logs receive
// formatted strings only — never raw Error objects — and credential-bearing
// values (connection strings, passwords, tokens) are stripped before a line
// ever reaches an operator or a log shipper.
const URL_WITH_CREDENTIALS_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^\s@/"']+:[^\s@/"']*@[^\s]+/gi;
const SECRET_ASSIGNMENT_PATTERN = /\b(password|passwd|secret|token|api[_-]?key|access[_-]?key|refresh[_-]?token|credential)s?\b\s*[=:]\s*[^\s,;&"']+/gi;
const POSIX_ABSOLUTE_PATH_PATTERN = /(^|[\s("'=])\/(?:[^/\s"'(),;]+\/)*[^/\s"'(),;]+/g;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /(^|[\s("'=])[A-Za-z]:\\(?:[^\\\s"'(),;]+\\)*[^\\\s"'(),;]+/g;
const LOG_CONTROL_CHARACTERS_PATTERN = /[\0-\x1f\u007f]+/g;

function redactSecrets(text: string): string {
  return text
    .replace(URL_WITH_CREDENTIALS_PATTERN, "[REDACTED-URL]")
    .replace(SECRET_ASSIGNMENT_PATTERN, (match) => `${match.split(/[=:]/)[0]!.trim()}=[REDACTED]`)
    .replace(POSIX_ABSOLUTE_PATH_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED-PATH]`)
    .replace(WINDOWS_ABSOLUTE_PATH_PATTERN, (_match, prefix: string) => `${prefix}[REDACTED-PATH]`)
    .replace(LOG_CONTROL_CHARACTERS_PATTERN, " ")
    .trim();
}

/**
 * Formats any thrown value into a safe single log detail line: a plain
 * message string with credentials redacted. Raw Error objects are never
 * handed to a logger, so stack traces, causes and nested properties (which
 * may carry connection strings) cannot leak into log storage.
 */
export function formatErrorForLog(error: unknown): string {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  if (message === undefined || message === "") {
    return "unknown error";
  }
  return redactSecrets(message);
}

/**
 * Lease-driven job loop over the asset processing queue. Every state change
 * goes through the repository's compare-and-set lease operations, so a worker
 * that loses its lease (crash, expiry, reclaim) can never commit a result,
 * record a bogus retry, or terminally fail a job another worker owns.
 */
export class AssetWorker {
  private readonly repository: WorkerRepository;
  private readonly handlers: JobHandlers;
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly pollMs: number;
  private readonly transientRetryDelayMs: number;
  private readonly logger: AssetWorkerLogger;
  private shutdownRequested = false;
  private readonly shutdownSignal: Promise<void>;
  private resolveShutdown!: () => void;

  constructor(options: AssetWorkerOptions) {
    if (typeof options.workerId === "string" && CONTROL_CHARACTER_PATTERN.test(options.workerId)) {
      throw new Error("workerId must not contain control characters or newlines");
    }
    if (
      typeof options.workerId !== "string" ||
      options.workerId.length === 0 ||
      options.workerId.length > MAX_WORKER_ID_LENGTH
    ) {
      throw new Error("workerId must be a non-empty string of at most 160 characters");
    }
    for (const [field, value] of Object.entries({
      leaseMs: options.leaseMs,
      heartbeatMs: options.heartbeatMs,
      pollMs: options.pollMs,
      shutdownGraceMs: options.shutdownGraceMs,
      transientRetryDelayMs: options.transientRetryDelayMs
    })) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`AssetWorker option ${field} must be a positive safe integer`);
      }
    }
    if (options.heartbeatMs >= options.leaseMs) {
      throw new Error("AssetWorker heartbeatMs must stay strictly below leaseMs");
    }
    this.repository = options.repository;
    this.handlers = options.handlers;
    this.workerId = options.workerId;
    this.leaseMs = options.leaseMs;
    this.heartbeatMs = options.heartbeatMs;
    this.pollMs = options.pollMs;
    this.transientRetryDelayMs = options.transientRetryDelayMs;
    this.logger = options.logger ?? {
      info: (message) => console.log(`[asset-worker ${this.workerId}] ${message}`),
      error: (message, detail) => console.error(`[asset-worker ${this.workerId}] ${message}`, detail ?? "")
    };
    this.shutdownSignal = new Promise((resolve) => {
      this.resolveShutdown = resolve;
    });
  }

  isShuttingDown(): boolean {
    return this.shutdownRequested;
  }

  requestShutdown(): void {
    if (!this.shutdownRequested) {
      this.shutdownRequested = true;
      this.resolveShutdown();
    }
  }

  /** Claims and processes at most one job. */
  async runOnce(): Promise<WorkerRunOutcome> {
    if (this.shutdownRequested) return "idle";
    const job = await this.repository.claimNextJob(this.workerId, this.nextLeaseUntil());
    if (!job) return "idle";
    return this.processClaimedJob(job, { submit: true });
  }

  /** Runs until shutdown is requested; an in-flight job always finishes first. */
  async run(): Promise<void> {
    while (!this.shutdownRequested) {
      let outcome: WorkerRunOutcome;
      try {
        outcome = await this.runOnce();
      } catch (error) {
        this.logger.error("claiming the next job failed", formatErrorForLog(error));
        await this.waitFor(this.pollMs);
        continue;
      }
      if (outcome === "idle") {
        await this.waitFor(this.pollMs);
      }
    }
  }

  /**
   * Executes a claimed job's handler with heartbeats. By default the outcome
   * is never submitted — the crash-recovery test harness uses it to reproduce
   * a worker dying right after its outputs landed; `{ submit: true }` runs the
   * full path (completion plus post-commit cleanup) for a job that was claimed
   * manually.
   */
  async processClaimedJobForTest(
    job: ClaimedAssetJob,
    options: { submit: boolean } = { submit: false }
  ): Promise<WorkerRunOutcome> {
    return this.processClaimedJob(job, options);
  }

  private async processClaimedJob(
    job: ClaimedAssetJob,
    options: { submit: boolean }
  ): Promise<WorkerRunOutcome> {
    // The first heartbeat proves the lease before any work starts; a failed
    // beat means the lease is gone and another worker may already own the job.
    const leaseHeld = await this.beat(job);
    if (!leaseHeld) return "abandoned";

    let leaseLost = false;
    // The abort signal reaches the handler as its lease guard: the moment a
    // heartbeat reports the lease lost, the signal aborts and the handler can
    // stop before its next side effect instead of writing storage or business
    // rows that a new lease holder will conflict with.
    const leaseController = new AbortController();
    const runContext: JobRunContext = {
      signal: leaseController.signal,
      throwIfLeaseLost: () => {
        if (leaseController.signal.aborted) {
          throw new JobExecutionError(
            "JOB_LEASE_CONFLICT",
            "The job lease was lost while the handler was running; the job must be reclaimed, not retried here",
            false
          );
        }
      }
    };
    const heartbeat = this.startHeartbeat(job, () => {
      leaseLost = true;
      leaseController.abort();
    });

    try {
      let outcome: JobHandlerOutcome;
      try {
        outcome = await this.handlers[job.jobType](job, runContext);
      } catch (error) {
        heartbeat.stop();
        if (leaseLost) return "abandoned";
        const classified = classifyHandlerError(error);
        this.logger.error(
          `job ${job.jobId} failed (${classified.code})`,
          formatErrorForLog(error)
        );
        if (!options.submit) return "failed";
        return this.submitFailure(job, classified);
      }
      heartbeat.stop();
      if (leaseLost) return "abandoned";
      if (!options.submit) return "completed";

      try {
        await this.repository.completeJob(job.jobId, outcome.result, job.lease);
      } catch (error) {
        // A CONFLICT at completion is ambiguous on its own: it may be a real
        // lease takeover (another worker owns the job now, nothing more may
        // happen here) or the result data itself was rejected. One lease probe
        // with the same token disambiguates: a held lease means the result was
        // rejected and deserves a bounded retry; a lost lease means abandon.
        if (isLeaseConflict(error)) {
          const stillHeld = await this.beat(job);
          if (!stillHeld) return "abandoned";
          this.logger.error(
            `completing job ${job.jobId} was rejected while the lease is held`,
            formatErrorForLog(error)
          );
          return this.submitFailure(job, {
            code: "COMPLETION_REJECTED",
            message: `The completion result was rejected: ${errorMessage(error)}`,
            retryable: true
          });
        }
        this.logger.error(`completing job ${job.jobId} was rejected`, formatErrorForLog(error));
        // The result was rejected for a non-lease reason (e.g. a result
        // contract violation). Record a bounded retry instead of letting the
        // job ping-pong between reclaim cycles forever.
        return this.submitFailure(job, {
          code: "COMPLETION_REJECTED",
          message: `The completion result was rejected: ${errorMessage(error)}`,
          retryable: true
        });
      }

      // The result is durably committed; only now may mutable side inputs be
      // cleaned. A failing cleanup leaks a staging entry (reclaimable) but can
      // never turn the committed job back into a failure.
      try {
        await outcome.afterCommit?.();
      } catch (error) {
        this.logger.error(
          `post-commit cleanup for job ${job.jobId} failed; a staging entry may remain`,
          formatErrorForLog(error)
        );
      }
      return "completed";
    } finally {
      heartbeat.stop();
    }
  }

  private async submitFailure(
    job: ClaimedAssetJob,
    classified: ClassifiedJobError
  ): Promise<WorkerRunOutcome> {
    const retryAt = classified.retryable ? new Date(Date.now() + this.transientRetryDelayMs) : null;
    try {
      await this.repository.failJob(
        job.jobId,
        { code: classified.code, message: formatErrorForLog(classified.message) },
        retryAt,
        job.lease
      );
      return "failed";
    } catch (error) {
      if (isLeaseConflict(error)) return "abandoned";
      this.logger.error(
        `recording the failure of job ${job.jobId} failed`,
        formatErrorForLog(error)
      );
      // The lease is left to expire; the reclaimer re-runs the job.
      return "abandoned";
    }
  }

  private nextLeaseUntil(): Date {
    return new Date(Date.now() + this.leaseMs);
  }

  private async beat(job: ClaimedAssetJob): Promise<boolean> {
    try {
      return await this.repository.heartbeatJob(job.jobId, job.lease, this.nextLeaseUntil());
    } catch (error) {
      this.logger.error(`heartbeating job ${job.jobId} failed`, formatErrorForLog(error));
      return false;
    }
  }

  private startHeartbeat(job: ClaimedAssetJob, onLost: () => void): { stop: () => void } {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const beat = async (): Promise<void> => {
      if (stopped) return;
      const held = await this.beat(job);
      if (stopped) return;
      if (!held) {
        stopped = true;
        onLost();
        return;
      }
      timer = setTimeout(() => {
        void beat();
      }, this.heartbeatMs);
    };
    timer = setTimeout(() => {
      void beat();
    }, this.heartbeatMs);
    return {
      stop: () => {
        stopped = true;
        if (timer !== null) clearTimeout(timer);
      }
    };
  }

  private async waitFor(ms: number): Promise<void> {
    await Promise.race([new Promise<void>((resolve) => setTimeout(resolve, ms)), this.shutdownSignal]);
  }
}

function isLeaseConflict(error: unknown): boolean {
  return error instanceof PersistenceError && error.code === "CONFLICT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
