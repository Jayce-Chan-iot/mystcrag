import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL;
const backendRoot = fileURLToPath(new URL("../..", import.meta.url));
const tsxLoader = `${backendRoot}/node_modules/tsx/dist/loader.mjs`;

type SpawnOutcome = {
  code: number | null;
  signal: NodeJS.Signals | null;
  output: string;
};

function spawnBackend(
  envOverrides: Record<string, string | undefined>,
  timeoutMs = 20_000
): Promise<SpawnOutcome> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("MYSTCRAG_AUTH")) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", tsxLoader, "src/index.ts"], {
      cwd: backendRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const record = (chunk: Buffer) => {
      output += chunk.toString("utf8");
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", record);
    child.stderr.on("data", record);

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Backend did not exit within ${timeoutMs}ms.\n${output}`));
    }, timeoutMs);
    timer.unref();

    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
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
}

test("production startup smoke matrix", { skip: !databaseUrl }, async (t) => {
  await t.test("production refuses the signed-test provider", async () => {
    const outcome = await spawnBackend({
      NODE_ENV: "production",
      MYSTCRAG_AUTH_PROVIDER: "signed-test",
      MYSTCRAG_ENABLE_SIGNED_TEST_AUTH: "true",
      MYSTCRAG_AUTH_SIGNING_SECRET: "mystcrag-auth004-smoke-secret-2026",
      MYSTCRAG_AUTH_ISSUER: "https://auth.test.mystcrag.local",
      MYSTCRAG_AUTH_AUDIENCE: "mystcrag-backend"
    });

    assert.notEqual(outcome.code, 0, "the process must fail before listening");
    assert.match(outcome.output, /Signed test authentication is disabled/);
  });

  await t.test("production refuses an incomplete auth0 configuration", async () => {
    const outcome = await spawnBackend({
      NODE_ENV: "production",
      MYSTCRAG_AUTH_PROVIDER: "auth0",
      MYSTCRAG_AUTH_AUDIENCE: "https://api.mystcrag.example.com"
    });

    assert.notEqual(outcome.code, 0, "the process must fail before listening");
    assert.match(outcome.output, /MYSTCRAG_AUTH_ISSUER/);
  });

  await t.test("a configured auth0 provider starts, protects routes, and stops cleanly", async () => {
    const port = await allocatePort();
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined && !key.startsWith("MYSTCRAG_AUTH")) {
        env[key] = value;
      }
    }
    env.NODE_ENV = "production";
    env.BACKEND_PORT = String(port);
    env.MYSTCRAG_AUTH_PROVIDER = "auth0";
    env.MYSTCRAG_AUTH_ISSUER = "https://mystcrag-tenant.auth0.example.com/";
    env.MYSTCRAG_AUTH_AUDIENCE = "https://api.mystcrag.example.com";

    const child = spawn(process.execPath, ["--import", tsxLoader, "src/index.ts"], {
      cwd: backendRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      output += chunk;
    });
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve) => {
        child.once("exit", (code, signal) => resolve({ code, signal }));
      }
    );

    try {
      let health: unknown;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const earlyExit = await Promise.race([
          exit.then((result): { kind: "exit"; result: typeof result } => ({
            kind: "exit",
            result
          })),
          new Promise<{ kind: "wait" }>((resolve) =>
            setTimeout(() => resolve({ kind: "wait" }), 100)
          )
        ]);
        if (earlyExit.kind === "exit") {
          assert.fail(`Backend exited before becoming healthy.\n${output}`);
        }
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`);
          if (response.ok) {
            health = await response.json();
            break;
          }
        } catch {
          // listener not ready yet
        }
      }
      assert.deepEqual(health, { status: "ok" });

      const protectedResponse = await fetch(`http://127.0.0.1:${port}/api/designs`);
      assert.equal(protectedResponse.status, 401);
      const protectedBody = (await protectedResponse.json()) as {
        error: { code: string; message: string };
      };
      assert.equal(protectedBody.error.code, "UNAUTHORIZED");
      assert.equal(protectedBody.error.message, "Authentication is required.");
    } finally {
      child.kill("SIGTERM");
    }

    const result = await exit;
    assert.equal(result.code, 0, `the backend must stop cleanly.\n${output}`);
    assert.equal(result.signal, null);
  });
});
