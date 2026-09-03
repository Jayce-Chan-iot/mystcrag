import { PersistenceError } from "@mystcrag/database";
import type {
  AssetJobFailure,
  AssetJobLease,
  ClaimedAssetJob,
  CompleteAssetJobResult,
  FailAssetJobOutcome
} from "@mystcrag/database";

import { classifyHandlerError, type ClassifiedJobError, type JobHandlers, type JobHandlerResult } from "./jobs.js";

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
  error(message: string, error?: unknown): void;
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
    if (typeof options.workerId !== "string" || options.workerId.length === 0 || options.workerId.length > MAX_WORKER_ID_LENGTH) {
      throw new Error("workerId must be a non-empty string of at most 160 characters");
    }
    for (const [field, value] of Object.entries({
      leaseMs: options.leaseMs,
      heartbeatMs: options.heartbeatMs,
      pollMs: options.pollMs,
      shutdownGraceMs: options.shutdownGraceMs,
      transientRetryDelayMs: options.transientRetryDelayMs
    })) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`AssetWorker option ${field} must be a positive number`);
      }
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
      error: (message, error) => console.error(`[asset-worker ${this.workerId}] ${message}`, error ?? "")
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
        this.logger.error("claiming the next job failed", error);
        await this.waitFor(this.pollMs);
        continue;
      }
      if (outcome === "idle") {
        await this.waitFor(this.pollMs);
      }
    }
  }

  /**
   * Executes a claimed job's handler with heartbeats but never submits the
   * outcome — the crash-recovery test harness uses it to reproduce a worker
   * dying right after its outputs landed.
   */
  async processClaimedJobForTest(job: ClaimedAssetJob): Promise<WorkerRunOutcome> {
    return this.processClaimedJob(job, { submit: false });
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
    const heartbeat = this.startHeartbeat(job, () => {
      leaseLost = true;
    });

    try {
      let result: JobHandlerResult;
      try {
        result = await this.handlers[job.jobType](job);
      } catch (error) {
        heartbeat.stop();
        if (leaseLost) return "abandoned";
        const classified = classifyHandlerError(error);
        if (!options.submit) return "failed";
        return this.submitFailure(job, classified);
      }
      heartbeat.stop();
      if (leaseLost) return "abandoned";
      if (!options.submit) return "completed";

      try {
        await this.repository.completeJob(job.jobId, result, job.lease);
        return "completed";
      } catch (error) {
        if (isLeaseConflict(error)) return "abandoned";
        this.logger.error(`completing job ${job.jobId} was rejected`, error);
        // The result was rejected for a non-lease reason (e.g. a result
        // contract violation). Record a bounded retry instead of letting the
        // job ping-pong between reclaim cycles forever.
        return this.submitFailure(job, {
          code: "COMPLETION_REJECTED",
          message: `The completion result was rejected: ${errorMessage(error)}`,
          retryable: true
        });
      }
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
        { code: classified.code, message: classified.message },
        retryAt,
        job.lease
      );
      return "failed";
    } catch (error) {
      if (isLeaseConflict(error)) return "abandoned";
      this.logger.error(`recording the failure of job ${job.jobId} failed`, error);
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
      this.logger.error(`heartbeating job ${job.jobId} failed`, error);
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
