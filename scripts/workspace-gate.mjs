import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const TASKS_BY_MODE = {
  build: ["build"],
  lint: ["lint"],
  test: ["test"],
  typecheck: ["typecheck"],
  validate: ["lint", "typecheck", "test", "build"]
};

const [mode, ...turboArguments] = process.argv.slice(2);
const tasks = TASKS_BY_MODE[mode];

if (!tasks) {
  throw new Error(`Unknown workspace gate mode: ${mode ?? "<missing>"}`);
}

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, {
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(pnpmCommand, ["--filter", "@mystcrag/database", "db:generate"]);

for (const task of tasks) {
  if (task === "test") {
    const rootTests = readdirSync(new URL("../tests/", import.meta.url))
      .filter((fileName) => fileName.endsWith(".test.mjs"))
      .sort()
      .map((fileName) => new URL(`../tests/${fileName}`, import.meta.url).pathname);

    run(process.execPath, ["--test", ...rootTests]);
  }

  run(pnpmCommand, ["exec", "turbo", "run", task, ...turboArguments]);
}
