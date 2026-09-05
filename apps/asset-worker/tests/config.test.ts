import assert from "node:assert/strict";
import test from "node:test";

import { WorkerConfigError, loadWorkerConfigFromEnv } from "../src/config.js";

const VALID_ENV = {
  DATABASE_URL: "postgresql://worker:test-password@localhost:5432/assets",
  MYSTCRAG_ASSET_ARCHIVE_ROOT: "/tmp/asset-archive",
  MYSTCRAG_ASSET_WORKER_ID: "worker-1",
  MYSTCRAG_ASSET_WORKER_LEASE_MS: "60000",
  MYSTCRAG_ASSET_WORKER_HEARTBEAT_MS: "20000",
  MYSTCRAG_ASSET_WORKER_POLL_MS: "5000",
  MYSTCRAG_ASSET_WORKER_SHUTDOWN_GRACE_MS: "30000",
  MYSTCRAG_ASSET_WORKER_TRANSIENT_RETRY_DELAY_MS: "60000"
} as const;

function envWith(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  return { ...VALID_ENV, ...overrides };
}

test("loadWorkerConfigFromEnv accepts a valid environment and never rounds values", () => {
  const config = loadWorkerConfigFromEnv(envWith({}));
  assert.equal(config.leaseMs, 60_000);
  assert.equal(config.heartbeatMs, 20_000);
  assert.equal(config.pollMs, 5_000);
  assert.equal(config.shutdownGraceMs, 30_000);
  assert.equal(config.transientRetryDelayMs, 60_000);
  assert.equal(config.workerId, "worker-1");
  assert.equal(config.archiveRoot, "/tmp/asset-archive");
});

test("loadWorkerConfigFromEnv fills the defaults for unset numeric variables", () => {
  const config = loadWorkerConfigFromEnv({
    DATABASE_URL: VALID_ENV.DATABASE_URL,
    MYSTCRAG_ASSET_ARCHIVE_ROOT: VALID_ENV.MYSTCRAG_ASSET_ARCHIVE_ROOT
  });
  assert.equal(config.leaseMs, 60_000);
  assert.equal(config.heartbeatMs, 20_000);
  assert.equal(config.workerId.length > 0, true);
});

test("fractional timing values are rejected instead of silently rounded", () => {
  for (const name of [
    "MYSTCRAG_ASSET_WORKER_LEASE_MS",
    "MYSTCRAG_ASSET_WORKER_HEARTBEAT_MS",
    "MYSTCRAG_ASSET_WORKER_POLL_MS",
    "MYSTCRAG_ASSET_WORKER_SHUTDOWN_GRACE_MS",
    "MYSTCRAG_ASSET_WORKER_TRANSIENT_RETRY_DELAY_MS"
  ]) {
    assert.throws(
      () => loadWorkerConfigFromEnv(envWith({ [name]: "1.5" })),
      (error: unknown) => {
        assert.ok(error instanceof WorkerConfigError, `${name}=1.5 must be rejected, not rounded`);
        return true;
      },
      `${name}=1.5 must never become 2 through Math.round`
    );
  }
});

test("non-positive and non-numeric timing values are rejected", () => {
  for (const name of [
    "MYSTCRAG_ASSET_WORKER_LEASE_MS",
    "MYSTCRAG_ASSET_WORKER_HEARTBEAT_MS",
    "MYSTCRAG_ASSET_WORKER_POLL_MS",
    "MYSTCRAG_ASSET_WORKER_SHUTDOWN_GRACE_MS",
    "MYSTCRAG_ASSET_WORKER_TRANSIENT_RETRY_DELAY_MS"
  ]) {
    for (const raw of ["0", "-5", "not-a-number", ""]) {
      assert.throws(
        () => loadWorkerConfigFromEnv(envWith({ [name]: raw })),
        (error: unknown) => error instanceof WorkerConfigError,
        `${name}=${JSON.stringify(raw)} must be rejected`
      );
    }
  }
});

test("timing values beyond their sane caps are rejected", () => {
  const overCap: Record<string, string> = {
    MYSTCRAG_ASSET_WORKER_LEASE_MS: "3_600_001".replace(/_/g, ""),
    MYSTCRAG_ASSET_WORKER_HEARTBEAT_MS: "600001",
    MYSTCRAG_ASSET_WORKER_POLL_MS: "600001",
    MYSTCRAG_ASSET_WORKER_SHUTDOWN_GRACE_MS: "600001",
    MYSTCRAG_ASSET_WORKER_TRANSIENT_RETRY_DELAY_MS: "3600001"
  };
  for (const [name, raw] of Object.entries(overCap)) {
    assert.throws(
      () => loadWorkerConfigFromEnv(envWith({ [name]: raw })),
      (error: unknown) => error instanceof WorkerConfigError,
      `${name}=${raw} exceeds its cap and must be rejected`
    );
  }
});

test("heartbeatMs must stay strictly below leaseMs", () => {
  assert.throws(
    () =>
      loadWorkerConfigFromEnv(
        envWith({ MYSTCRAG_ASSET_WORKER_LEASE_MS: "60000", MYSTCRAG_ASSET_WORKER_HEARTBEAT_MS: "60000" })
      ),
    (error: unknown) => {
      assert.ok(error instanceof WorkerConfigError);
      assert.match(error.message, /heartbeat/i);
      return true;
    },
    "an equal heartbeat and lease leaves no margin to detect a lost lease"
  );
  assert.throws(
    () =>
      loadWorkerConfigFromEnv(
        envWith({ MYSTCRAG_ASSET_WORKER_LEASE_MS: "60000", MYSTCRAG_ASSET_WORKER_HEARTBEAT_MS: "90000" })
      ),
    (error: unknown) => error instanceof WorkerConfigError,
    "a heartbeat slower than the lease can never keep the lease alive"
  );
});

test("a workerId with control characters or newlines is rejected", () => {
  for (const workerId of ["evil\nworker", "evil\rworker", "bad\tworker", "bad\x00worker", "bad\x1fworker"]) {
    assert.throws(
      () => loadWorkerConfigFromEnv(envWith({ MYSTCRAG_ASSET_WORKER_ID: workerId })),
      (error: unknown) => error instanceof WorkerConfigError,
      `workerId ${JSON.stringify(workerId)} must be rejected`
    );
  }
});

test("a workerId longer than 160 characters is rejected", () => {
  assert.throws(
    () => loadWorkerConfigFromEnv(envWith({ MYSTCRAG_ASSET_WORKER_ID: "w".repeat(161) })),
    (error: unknown) => error instanceof WorkerConfigError
  );
});

test("missing required variables fail closed with the variable named", () => {
  assert.throws(
    () => loadWorkerConfigFromEnv(envWith({ DATABASE_URL: undefined })),
    (error: unknown) => {
      assert.ok(error instanceof WorkerConfigError);
      assert.match(error.message, /DATABASE_URL/);
      return true;
    }
  );
  assert.throws(
    () => loadWorkerConfigFromEnv(envWith({ MYSTCRAG_ASSET_ARCHIVE_ROOT: undefined })),
    (error: unknown) => {
      assert.ok(error instanceof WorkerConfigError);
      assert.match(error.message, /MYSTCRAG_ASSET_ARCHIVE_ROOT/);
      return true;
    }
  );
});

test("configuration errors never echo the raw environment value", () => {
  const secret = "postgresql://worker:supersecret@db.internal:5432/assets";
  try {
    loadWorkerConfigFromEnv(
      envWith({ DATABASE_URL: secret, MYSTCRAG_ASSET_WORKER_LEASE_MS: "1.5" })
    );
    assert.fail("the invalid lease must be rejected");
  } catch (error) {
    assert.ok(error instanceof WorkerConfigError);
    assert.ok(!error.message.includes("supersecret"), "the error must not echo other env values");
    assert.ok(!error.message.includes(secret));
  }
});
