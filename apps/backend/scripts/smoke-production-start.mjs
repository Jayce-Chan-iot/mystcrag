import { createServer } from "node:net";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_TIMEOUTS = {
  healthFetchTimeoutMs: 1_000,
  healthPollIntervalMs: 100,
  healthAttempts: 100,
  sigtermGraceMs: 15_000,
  sigkillGraceMs: 5_000
};

// Bounded wait for a child process to exit. Resolves { code, signal } on exit, or null
// once `timeoutMs` elapses without an exit. The timeout timer is cleared on the exit
// path and unref'd so a successful shutdown never leaves a referenced timer that would
// delay the smoke process from draining its event loop.
export function waitForExit(child, timeoutMs) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve({ code: child.exitCode ?? null, signal: child.signalCode ?? null });
      return;
    }
    let settled = false;
    let timer;
    const onExit = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal });
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.off("exit", onExit);
      resolve(null);
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    child.once("exit", onExit);
  });
}

// Single termination helper used by every exit path: SIGTERM with a bounded grace, then
// SIGKILL with another bounded grace, then an explicit failure if the child survives
// both. Success and failure paths (health-invalid included) all go through here so no
// path can hang on an unbounded wait.
export async function terminateBackend(child, output, timeouts) {
  const { sigtermGraceMs, sigkillGraceMs } = timeouts;
  child.kill("SIGTERM");
  const result = await waitForExit(child, sigtermGraceMs);
  if (result === null) {
    child.kill("SIGKILL");
    const killed = await waitForExit(child, sigkillGraceMs);
    if (killed === null) {
      throw new Error(`Backend did not stop after SIGTERM and SIGKILL.\n${output}`);
    }
    throw new Error(
      `Backend did not stop cleanly after SIGTERM within ${sigtermGraceMs}ms (forced with SIGKILL).\n${output}`
    );
  }
  if (result.code !== 0 || result.signal !== null) {
    throw new Error(
      `Backend did not stop cleanly after SIGTERM (${JSON.stringify(result)}).\n${output}`
    );
  }
  return result;
}

// Poll the health endpoint until it reports ok (or the child exits), aborting each fetch
// after a short timeout so a TCP-accepted-but-silent listener cannot hang the gate.
export async function waitForHealth(child, healthUrl, output, timeouts) {
  let health;
  for (let attempt = 0; attempt < timeouts.healthAttempts; attempt += 1) {
    const earlyExit = await waitForExit(child, timeouts.healthPollIntervalMs);
    if (earlyExit !== null) {
      throw new Error(
        `Backend exited before becoming healthy (${JSON.stringify(earlyExit)}).\n${output}`
      );
    }
    try {
      const response = await fetch(healthUrl, {
        signal: AbortSignal.timeout(timeouts.healthFetchTimeoutMs)
      });
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      // The listener may not be ready yet, or the fetch timed out.
    }
  }
  return health;
}

async function runSmoke(timeouts) {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for the production artifact smoke test.");
  }

  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a smoke-test port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

  const childEnv = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV ?? "development",
    BACKEND_PORT: String(port),
    MYSTCRAG_AUTH_PROVIDER: process.env.MYSTCRAG_AUTH_PROVIDER ?? "signed-test",
    MYSTCRAG_ENABLE_SIGNED_TEST_AUTH:
      process.env.MYSTCRAG_ENABLE_SIGNED_TEST_AUTH ?? "true",
    MYSTCRAG_AUTH_SIGNING_SECRET:
      process.env.MYSTCRAG_AUTH_SIGNING_SECRET ??
      "mystcrag-production-artifact-smoke-secret",
    MYSTCRAG_AUTH_ISSUER:
      process.env.MYSTCRAG_AUTH_ISSUER ?? "mystcrag-production-artifact-smoke",
    MYSTCRAG_AUTH_AUDIENCE:
      process.env.MYSTCRAG_AUTH_AUDIENCE ?? "mystcrag-production-artifact-smoke"
  };
  // The artifact must start with no NODE_PATH. Strip any ambient value so a caller never
  // has to remember to prefix the run with `env -u NODE_PATH`.
  delete childEnv.NODE_PATH;

  const child = spawn(process.execPath, ["dist/index.js"], {
    cwd: new URL("..", import.meta.url),
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  const healthUrl = `http://127.0.0.1:${port}/health`;
  const health = await waitForHealth(child, healthUrl, output, timeouts);

  if (health?.status !== "ok") {
    await terminateBackend(child, output, timeouts);
    throw new Error(`Backend did not report healthy at ${healthUrl}.\n${output}`);
  }

  await terminateBackend(child, output, timeouts);

  console.log(
    JSON.stringify({ artifact: "dist/index.js", health, shutdown: "clean" })
  );
}

const isMain =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  runSmoke(DEFAULT_TIMEOUTS).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}