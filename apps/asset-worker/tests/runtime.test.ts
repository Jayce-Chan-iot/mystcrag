import assert from "node:assert/strict";
import test from "node:test";

import { PersistenceError, type ClaimedAssetJob } from "@mystcrag/database";

import { JobExecutionError, type JobHandlerOutcome, type JobHandlerResult } from "../src/jobs.js";
import { AssetWorker, type WorkerRepository } from "../src/runtime.js";

const SESSION = "session-runtime-test";

type RecordedCall = { method: string; args: unknown[] };

type FakeRepositoryOptions = {
  jobs?: ClaimedAssetJob[];
  heartbeatResult?: (jobId: string) => boolean | Promise<boolean>;
  completeBehavior?: (jobId: string) => void;
  failBehavior?: (jobId: string) => void;
};

class FakeRepository implements WorkerRepository {
  readonly calls: RecordedCall[] = [];
  private readonly jobs: ClaimedAssetJob[];
  private readonly heartbeatResult: NonNullable<FakeRepositoryOptions["heartbeatResult"]>;
  private readonly completeBehavior: NonNullable<FakeRepositoryOptions["completeBehavior"]>;
  private readonly failBehavior: NonNullable<FakeRepositoryOptions["failBehavior"]>;
  private index = 0;

  constructor(options: FakeRepositoryOptions = {}) {
    this.jobs = options.jobs ?? [];
    this.heartbeatResult = options.heartbeatResult ?? (() => true);
    this.completeBehavior = options.completeBehavior ?? (() => undefined);
    this.failBehavior = options.failBehavior ?? (() => undefined);
  }

  async claimNextJob(workerId: string, leaseUntil: Date): Promise<ClaimedAssetJob | null> {
    this.calls.push({ method: "claimNextJob", args: [workerId, leaseUntil] });
    const job = this.jobs[this.index] ?? null;
    this.index += 1;
    return job ? { ...job, lease: { workerId, leaseToken: `token-${this.index}` } } : null;
  }

  async heartbeatJob(
    jobId: string,
    lease: { workerId: string; leaseToken: string },
    leaseUntil: Date
  ): Promise<boolean> {
    this.calls.push({ method: "heartbeatJob", args: [jobId, lease, leaseUntil] });
    return this.heartbeatResult(jobId);
  }

  async completeJob(
    jobId: string,
    result: unknown,
    lease: { workerId: string; leaseToken: string }
  ): Promise<{ jobId: string; state: "COMPLETED"; completedAt: Date }> {
    this.calls.push({ method: "completeJob", args: [jobId, result, lease] });
    this.completeBehavior(jobId);
    return { jobId, state: "COMPLETED", completedAt: new Date() };
  }

  async failJob(
    jobId: string,
    error: { code: string; message: string },
    retryAt: Date | null,
    lease: { workerId: string; leaseToken: string }
  ): Promise<{
    jobId: string;
    state: "QUEUED" | "FAILED";
    retryCount: number;
    maxRetries: number;
    nextAttemptAt: Date | null;
  }> {
    this.calls.push({ method: "failJob", args: [jobId, error, retryAt, lease] });
    this.failBehavior(jobId);
    return { jobId, state: "QUEUED", retryCount: 1, maxRetries: 3, nextAttemptAt: retryAt };
  }

  callsOf(method: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method);
  }
}

function queuedJob(overrides: Partial<ClaimedAssetJob> = {}): ClaimedAssetJob {
  return {
    jobId: "job-1",
    sessionId: SESSION,
    groupId: null,
    jobType: "GROUP_SESSION",
    state: "RUNNING",
    payload: {},
    retryCount: 0,
    maxRetries: 3,
    lease: { workerId: "worker-under-test", leaseToken: "token-1" },
    leaseUntil: new Date(Date.now() + 60_000),
    ...overrides
  };
}

const groupSessionResult: JobHandlerResult = {
  kind: "GROUP_SESSION",
  groups: [{ groupId: "sg-1", memberFileIds: ["file-1"], primaryFileId: "file-1", similarityEvidence: [] }]
};

function makeWorker(
  repository: WorkerRepository,
  options: {
    jobs?: ClaimedAssetJob[];
    handler?: (job: ClaimedAssetJob) => Promise<JobHandlerOutcome>;
    leaseMs?: number;
    transientRetryDelayMs?: number;
  } = {}
): AssetWorker {
  return new AssetWorker({
    repository,
    workerId: "worker-under-test",
    leaseMs: options.leaseMs ?? 60_000,
    heartbeatMs: 5,
    pollMs: 1,
    shutdownGraceMs: 5_000,
    transientRetryDelayMs: options.transientRetryDelayMs ?? 45_000,
    handlers: {
      ARCHIVE_FILE: options.handler ?? (async () => ({ result: groupSessionResult })),
      GROUP_SESSION: options.handler ?? (async () => ({ result: groupSessionResult })),
      PROCESS_GROUP: options.handler ?? (async () => ({ result: groupSessionResult }))
    }
  });
}

test("runOnce claims a job, heartbeats during processing and completes it", async () => {
  const repository = new FakeRepository({ jobs: [queuedJob()] });
  const worker = makeWorker(repository);

  const outcome = await worker.runOnce();

  assert.equal(outcome, "completed");
  assert.equal(repository.callsOf("claimNextJob").length, 1);
  assert.ok(repository.callsOf("heartbeatJob").length >= 1, "the lease is extended while processing");
  const completion = repository.callsOf("completeJob");
  assert.equal(completion.length, 1);
  assert.equal((completion[0]!.args[1] as { kind: string }).kind, "GROUP_SESSION");
  assert.equal(repository.callsOf("failJob").length, 0);
});

test("runOnce reports idle when the queue is empty", async () => {
  const repository = new FakeRepository({ jobs: [] });
  const worker = makeWorker(repository);

  assert.equal(await worker.runOnce(), "idle");
});

test("a failed heartbeat abandons the job: no completion, no failure, no further heartbeats", async () => {
  const repository = new FakeRepository({ jobs: [queuedJob()], heartbeatResult: () => false });
  const worker = makeWorker(repository);

  const outcome = await worker.runOnce();

  assert.equal(outcome, "abandoned");
  assert.equal(repository.callsOf("completeJob").length, 0);
  assert.equal(repository.callsOf("failJob").length, 0);
  assert.equal(repository.callsOf("heartbeatJob").length, 1, "the first failed heartbeat stops the loop");
});

test("a lease lost at completion time abandons the job instead of failing it", async () => {
  const repository = new FakeRepository({
    jobs: [queuedJob()],
    completeBehavior: () => {
      throw new PersistenceError("CONFLICT", "lease expired");
    }
  });
  const worker = makeWorker(repository);

  const outcome = await worker.runOnce();

  assert.equal(outcome, "abandoned");
  assert.equal(repository.callsOf("failJob").length, 0, "a lost lease must not enqueue a bogus retry");
});

test("deterministic handler failures fail the job with retryAt null (repository default delay)", async () => {
  const repository = new FakeRepository({ jobs: [queuedJob()] });
  const worker = makeWorker(repository, {
    handler: async () => {
      throw new JobExecutionError("DECODE_FAILED", "cannot decode", false);
    }
  });

  const outcome = await worker.runOnce();

  assert.equal(outcome, "failed");
  const failures = repository.callsOf("failJob");
  assert.equal(failures.length, 1);
  assert.equal((failures[0]!.args[1] as { code: string }).code, "DECODE_FAILED");
  assert.equal(failures[0]!.args[2], null, "deterministic failures let the repository pick the delay");
});

test("transient handler failures fail the job with a backoff retry time", async () => {
  const repository = new FakeRepository({ jobs: [queuedJob()] });
  const worker = makeWorker(repository, {
    handler: async () => {
      throw new JobExecutionError("WRITE_FAILED", "disk hiccup", true);
    },
    transientRetryDelayMs: 45_000
  });

  const outcome = await worker.runOnce();

  assert.equal(outcome, "failed");
  const retryAt = repository.callsOf("failJob")[0]!.args[2] as Date;
  assert.ok(retryAt instanceof Date);
  assert.ok(retryAt.getTime() >= Date.now() + 40_000);
});

test("unknown handler errors are classified transient and retried with backoff", async () => {
  const repository = new FakeRepository({ jobs: [queuedJob()] });
  const worker = makeWorker(repository, {
    handler: async () => {
      throw new Error("unexpected");
    }
  });

  assert.equal(await worker.runOnce(), "failed");
  const failures = repository.callsOf("failJob");
  assert.equal(failures.length, 1);
  assert.match((failures[0]!.args[1] as { message: string }).message, /unexpected/);
  const retryAt = failures[0]!.args[2] as Date;
  assert.ok(retryAt instanceof Date);
  assert.ok(retryAt.getTime() > Date.now());
});

test("failJob lease conflicts abandon the job instead of crashing the worker", async () => {
  const repository = new FakeRepository({
    jobs: [queuedJob()],
    failBehavior: () => {
      throw new PersistenceError("CONFLICT", "lease expired");
    }
  });
  const worker = makeWorker(repository, {
    handler: async () => {
      throw new JobExecutionError("DECODE_FAILED", "boom", false);
    }
  });

  assert.equal(await worker.runOnce(), "abandoned");
});

test("requestShutdown stops claiming new jobs and lets the in-flight job finish", async () => {
  // A container object keeps the resolver reachable across the handler
  // closure without TypeScript's control-flow analysis narrowing it to null.
  const gate: { release: (() => void) | null } = { release: null };
  const repository = new FakeRepository({ jobs: [queuedJob({ jobId: "job-1" }), queuedJob({ jobId: "job-2" })] });
  const worker = makeWorker(repository, {
    handler: async (job) => {
      if (job.jobId === "job-1") {
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      }
      return { result: groupSessionResult };
    }
  });

  const runPromise = worker.run();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(worker.isShuttingDown(), false);
  worker.requestShutdown();
  assert.equal(worker.isShuttingDown(), true);
  gate.release?.();
  await runPromise;

  assert.equal(repository.callsOf("claimNextJob").length, 1, "no new job is claimed after shutdown");
  assert.equal(repository.callsOf("completeJob").length, 1, "the in-flight job still completes");
});

test("run() exits after shutdown even when the queue still holds jobs", async () => {
  const repository = new FakeRepository({ jobs: [queuedJob(), queuedJob({ jobId: "job-2" })] });
  const worker = makeWorker(repository);
  worker.requestShutdown();

  await worker.run();

  assert.equal(repository.callsOf("claimNextJob").length, 0);
});

test("post-commit cleanup runs only after the completion commits", async () => {
  const events: string[] = [];
  const repository = new FakeRepository({
    jobs: [queuedJob()],
    completeBehavior: () => {
      events.push("completeJob");
    }
  });
  const worker = makeWorker(repository, {
    handler: async () => ({
      result: groupSessionResult,
      afterCommit: async () => {
        events.push("afterCommit");
      }
    })
  });

  assert.equal(await worker.runOnce(), "completed");
  assert.deepEqual(events, ["completeJob", "afterCommit"], "the cleanup strictly follows the committed result");
});

test("a lost lease at completion time skips the post-commit cleanup", async () => {
  const cleanups: string[] = [];
  const repository = new FakeRepository({
    jobs: [queuedJob()],
    completeBehavior: () => {
      throw new PersistenceError("CONFLICT", "lease expired");
    }
  });
  const worker = makeWorker(repository, {
    handler: async () => ({
      result: groupSessionResult,
      afterCommit: async () => {
        cleanups.push("ran");
      }
    })
  });

  assert.equal(await worker.runOnce(), "abandoned");
  assert.deepEqual(cleanups, [], "a stale worker must not remove staging the new holder still needs");
  assert.equal(repository.callsOf("failJob").length, 0);
});

test("a worker whose lease is lost mid-processing skips the handler cleanup", async () => {
  const cleanups: string[] = [];
  const repository = new FakeRepository({ jobs: [queuedJob()], heartbeatResult: () => false });
  const worker = makeWorker(repository, {
    handler: async () => ({
      result: groupSessionResult,
      afterCommit: async () => {
        cleanups.push("ran");
      }
    })
  });

  assert.equal(await worker.runOnce(), "abandoned");
  assert.deepEqual(cleanups, []);
});

test("a failing post-commit cleanup cannot turn the completed job into a failure", async () => {
  const cleanups: string[] = [];
  const repository = new FakeRepository({ jobs: [queuedJob()] });
  const worker = makeWorker(repository, {
    handler: async () => ({
      result: groupSessionResult,
      afterCommit: async () => {
        cleanups.push("attempted");
        throw new Error("staging directory is read-only");
      }
    })
  });

  assert.equal(await worker.runOnce(), "completed");
  assert.deepEqual(cleanups, ["attempted"]);
  assert.equal(repository.callsOf("completeJob").length, 1, "the completion stays committed");
  assert.equal(repository.callsOf("failJob").length, 0, "a completed job is never flipped to failed");
});
