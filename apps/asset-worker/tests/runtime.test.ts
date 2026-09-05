import assert from "node:assert/strict";
import test from "node:test";

import { PersistenceError, type ClaimedAssetJob } from "@mystcrag/database";

import {
  JobExecutionError,
  type JobHandlerOutcome,
  type JobHandlerResult,
  type JobRunContext
} from "../src/jobs.js";
import { AssetWorker, formatErrorForLog, type WorkerRepository } from "../src/runtime.js";

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
    handler?: (job: ClaimedAssetJob, context: JobRunContext) => Promise<JobHandlerOutcome>;
    leaseMs?: number;
    transientRetryDelayMs?: number;
    logger?: { info(message: string): void; error(message: string, detail?: string): void };
    workerId?: string;
  } = {}
): AssetWorker {
  return new AssetWorker({
    repository,
    workerId: options.workerId ?? "worker-under-test",
    leaseMs: options.leaseMs ?? 60_000,
    heartbeatMs: 5,
    pollMs: 1,
    shutdownGraceMs: 5_000,
    transientRetryDelayMs: options.transientRetryDelayMs ?? 45_000,
    logger: options.logger,
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
    heartbeatResult: () => false, // the probe confirms a real takeover
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
    heartbeatResult: () => false, // the probe confirms a real takeover
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

// ---------------------------------------------------------------------------
// Round 5 H: a lost lease must reach the handler as an abort signal before
// its next side effect, and a completion CONFLICT must be disambiguated by
// probing the lease instead of assuming a takeover.
// ---------------------------------------------------------------------------

test("a completion CONFLICT with the lease still held is a data conflict, not a takeover", async () => {
  const repository = new FakeRepository({
    jobs: [queuedJob()],
    // the lease probe succeeds: the conflict is about the result data
    completeBehavior: () => {
      throw new PersistenceError("CONFLICT", "result contract violation");
    }
  });
  const worker = makeWorker(repository);

  const outcome = await worker.runOnce();

  assert.equal(outcome, "failed", "a held lease means the completion data was rejected, not the worker");
  const failures = repository.callsOf("failJob");
  assert.equal(failures.length, 1, "the job records a bounded retry for a rejected result");
  assert.equal((failures[0]!.args[1] as { code: string }).code, "COMPLETION_REJECTED");
  assert.ok(repository.callsOf("heartbeatJob").length >= 1, "the probe distinguishes the conflict kind");
});

test("a lost lease aborts the handler before its next side effect", async () => {
  const events: string[] = [];
  let beats = 0;
  const repository = new FakeRepository({
    jobs: [queuedJob()],
    heartbeatResult: () => (beats += 1) <= 1 // the first beat holds, the next loses
  });
  const worker = makeWorker(repository, {
    handler: async (job, context) => {
      events.push("handler-started");
      assert.ok(context, "the runtime passes a run context carrying the lease signal");
      assert.equal(context.signal.aborted, false, "the signal starts clear");
      await new Promise((resolve) => setTimeout(resolve, 40)); // the heartbeat fires here
      if (context.signal.aborted) {
        events.push("aborted-before-side-effect");
        return { result: groupSessionResult };
      }
      events.push("side-effect");
      return { result: groupSessionResult };
    }
  });

  const outcome = await worker.runOnce();

  assert.equal(outcome, "abandoned");
  assert.deepEqual(
    events,
    ["handler-started", "aborted-before-side-effect"],
    "the handler can observe the abort and no side effect starts after it"
  );
  assert.equal(repository.callsOf("completeJob").length, 0);
  assert.equal(repository.callsOf("failJob").length, 0);
});

test("throwIfLeaseLost aborts the handler with the stable JOB_LEASE_CONFLICT code", async () => {
  let beats = 0;
  const repository = new FakeRepository({
    jobs: [queuedJob()],
    heartbeatResult: () => (beats += 1) <= 1
  });
  let caught: unknown;
  const worker = makeWorker(repository, {
    handler: async (job, context) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      try {
        context.throwIfLeaseLost();
      } catch (error) {
        caught = error;
        throw error;
      }
      return { result: groupSessionResult };
    }
  });

  assert.equal(await worker.runOnce(), "abandoned");
  assert.ok(caught instanceof JobExecutionError, "the abort surfaces as a JobExecutionError");
  assert.equal((caught as JobExecutionError).code, "JOB_LEASE_CONFLICT");
  assert.equal(repository.callsOf("failJob").length, 0, "a lost lease never records a bogus failure");
  assert.equal(repository.callsOf("completeJob").length, 0);
});

// ---------------------------------------------------------------------------
// Round 5 I: logs carry safe context only — never raw error objects and
// never credential-bearing values.
// ---------------------------------------------------------------------------

test("worker error logs are redacted strings and never leak secrets", async () => {
  const logged: Array<{ message: string; detail?: string }> = [];
  const logger = {
    info: (message: string) => logged.push({ message }),
    error: (message: string, detail?: string) => logged.push({ message, detail })
  };
  const repository = new FakeRepository({ jobs: [queuedJob()] });
  const worker = makeWorker(repository, {
    logger,
    handler: async () => {
      throw new Error(
        "connect failed: postgresql://asset:supersecret@db.internal:5432/mystcrag?password=hunter2"
      );
    }
  });

  assert.equal(await worker.runOnce(), "failed");

  const errorLogs = logged.filter((entry) => entry.message.includes("job job-1"));
  assert.ok(errorLogs.length > 0, "the failure is logged with safe context");
  for (const entry of errorLogs) {
    assert.equal(typeof entry.detail, "string", "the detail is a formatted string, never a raw Error");
    assert.ok(!entry.detail!.includes("supersecret"), "the credential must not survive redaction");
    assert.ok(!entry.detail!.includes("hunter2"), "the password must not survive redaction");
    assert.ok(!entry.detail!.includes("postgresql://"), "connection strings must not survive redaction");
  }
});

test("formatErrorForLog strips credential-bearing values from any message", () => {
  const formatted = formatErrorForLog(
    new Error(
      "boom postgresql://user:pass@host:5432/db password=hunter2 token=abc123 at /Users/operator/private/archive\nforged-line"
    )
  );
  assert.ok(!formatted.includes("pass@host"));
  assert.ok(!formatted.includes("hunter2"));
  assert.ok(!formatted.includes("abc123"));
  assert.ok(!formatted.includes("/Users/operator/private/archive"));
  assert.ok(!formatted.includes("\n"), "a diagnostic must stay on one log line");
  assert.match(formatted, /boom/);
  assert.equal(typeof formatErrorForLog("plain string failure"), "string");
  assert.equal(formatErrorForLog(undefined), "unknown error");
});

test("AssetWorker rejects control characters in workerId even when constructed without the env loader", () => {
  const repository = new FakeRepository();
  for (const workerId of ["evil\nworker", "evil\rworker", "bad\tworker", "bad\x00worker", "bad\x7fworker"]) {
    assert.throws(
      () => makeWorker(repository, { workerId }),
      /control characters/i,
      `direct construction must reject ${JSON.stringify(workerId)}`
    );
  }
});

test("persisted failure diagnostics are redacted before failJob receives them", async () => {
  const repository = new FakeRepository({ jobs: [queuedJob()] });
  const worker = makeWorker(repository, {
    handler: async () => {
      throw new Error("postgresql://asset:supersecret@db.internal:5432/mystcrag at /Users/operator/archive");
    }
  });

  assert.equal(await worker.runOnce(), "failed");
  const failure = repository.callsOf("failJob")[0]!.args[1] as { message: string };
  assert.ok(!failure.message.includes("supersecret"));
  assert.ok(!failure.message.includes("/Users/operator/archive"));
});
