import { createServer } from "node:net";
import { spawn } from "node:child_process";

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

const child = spawn(process.execPath, ["dist/index.js"], {
  cwd: new URL("..", import.meta.url),
  env: {
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
  },
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

const exit = new Promise((resolve) => {
  child.once("exit", (code, signal) => resolve({ code, signal }));
});

const healthUrl = `http://127.0.0.1:${port}/health`;
let health;
for (let attempt = 0; attempt < 100; attempt += 1) {
  const earlyExit = await Promise.race([
    exit.then((result) => ({ kind: "exit", result })),
    new Promise((resolve) => setTimeout(() => resolve({ kind: "wait" }), 100))
  ]);
  if (earlyExit.kind === "exit") {
    throw new Error(
      `Backend exited before becoming healthy (${JSON.stringify(earlyExit.result)}).\n${output}`
    );
  }

  try {
    const response = await fetch(healthUrl);
    if (response.ok) {
      health = await response.json();
      break;
    }
  } catch {
    // The listener may not be ready yet.
  }
}

if (health?.status !== "ok") {
  child.kill("SIGTERM");
  await exit;
  throw new Error(`Backend did not report healthy at ${healthUrl}.\n${output}`);
}

child.kill("SIGTERM");
const result = await exit;
if (result.code !== 0 || result.signal !== null) {
  throw new Error(
    `Backend did not stop cleanly after SIGTERM (${JSON.stringify(result)}).\n${output}`
  );
}

console.log(
  JSON.stringify({ artifact: "dist/index.js", health, shutdown: "clean" })
);
