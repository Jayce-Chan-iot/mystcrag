/**
 * PID ownership verification for AUTH-006 teardown.
 *
 * Teardown may only signal processes this run started. A pid recovered from
 * run-state.json (used when the orchestrator handle is lost, e.g. teardown runs in a
 * fresh process) proves nothing by itself: pids are recycled by the OS, and killing a
 * recycled pid would terminate an unrelated process.
 *
 * The check asks the OS for the pid's CURRENT state and requires BOTH:
 *   - command line (`ps -p <pid> -o command=`) matching the run-scoped signature
 *     (backend → the run-scoped dist path; frontend → `next start -p <port>`)
 *   - when a run-scoped cwd expectation is given, the pid's CURRENT working directory
 *     (`/proc/<pid>/cwd` on Linux, `lsof -d cwd` on macOS) must equal it. The run
 *     checkout directory embeds the unique run id, so a foreign or recycled process
 *     that merely happens to run the same generic `next start -p <port>` command is
 *     refused: same port + same command + different cwd can never be this run's child.
 *
 * A pid that cannot be proven owned is never signalled. An unverifiable cwd (unknown
 * platform, permission error) fails closed exactly like a mismatch.
 *
 * Four outcomes, regression-tested (H5, H5b):
 *   owned   → command line matches (and cwd matches, when expected); signalling is safe
 *   gone    → no such process; nothing to signal (not an error)
 *   foreign → a live process owns the pid but command line and/or cwd do not match;
 *             the pid was recycled or never belonged to this run. Teardown MUST fail
 *             loudly and MUST NOT signal it.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OwnershipCheck =
  | { kind: "owned"; command: string; cwd: string | null }
  | { kind: "gone" }
  | { kind: "foreign"; pid: number; command: string; cwd: string | null; reason: string };

/** Returns the current command line of `pid`, or null when no such process exists. */
export async function processCommandFor(pid: number): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "command="], {
      timeout: 5_000
    });
    const command = stdout.trim();
    return command.length > 0 ? command : null;
  } catch {
    return null;
  }
}

/**
 * Returns the CURRENT working directory of `pid`, or null when it cannot be
 * determined (no such process, unsupported platform, permission failure).
 * Callers treat null as "unverifiable" and fail closed — never as a match.
 *
 * Linux (GitHub runners): readlink /proc/<pid>/cwd.
 * macOS (local runs): lsof -a -p <pid> -d cwd -Fn → the n-prefixed name line.
 */
export async function processCwdFor(pid: number): Promise<string | null> {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === "linux" || process.platform === "android") {
      const link = await fs.readlink(`/proc/${pid}/cwd`);
      return link.length > 0 ? link : null;
    }
    if (process.platform === "darwin") {
      const { stdout } = await execFileAsync(
        "lsof",
        ["-a", "-p", String(pid), "-d", "cwd", "-Fn"],
        { timeout: 5_000 }
      );
      const lines = stdout.split("\n").map((line) => line.trim());
      const nameLine = lines.find((line) => line.startsWith("n"));
      const cwd = nameLine?.slice(1) ?? "";
      return cwd.length > 0 ? cwd : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function verifyProcessOwnership(options: {
  pid: number;
  /** The pid is owned only when its command line matches at least one pattern. */
  patterns: RegExp[];
  /**
   * Optional exact directory the pid must CURRENTLY be working in. Runs embed their
   * identity in run-scoped directories, so cwd is the run-specific marker that a
   * same-command, same-port foreign process cannot reuse. Omitted → command-only
   * verification (used by generic H5 checks).
   */
  cwd?: string;
}): Promise<OwnershipCheck> {
  const command = await processCommandFor(options.pid);
  if (command === null) {
    return { kind: "gone" };
  }
  if (!options.patterns.some((pattern) => pattern.test(command))) {
    return {
      kind: "foreign",
      pid: options.pid,
      command,
      cwd: null,
      reason: "command line does not match this run's signature (possible recycled pid)"
    };
  }
  if (options.cwd === undefined) {
    return { kind: "owned", command, cwd: null };
  }
  const expectedCwd = options.cwd;
  const actualCwd = await processCwdFor(options.pid);
  if (actualCwd === null) {
    return {
      kind: "foreign",
      pid: options.pid,
      command,
      cwd: null,
      reason: `current working directory could not be verified (fail closed; expected ${expectedCwd})`
    };
  }
  if (actualCwd !== expectedCwd) {
    return {
      kind: "foreign",
      pid: options.pid,
      command,
      cwd: actualCwd,
      reason: `current working directory ${actualCwd} does not equal this run's scoped directory ${expectedCwd} (foreign or recycled pid)`
    };
  }
  return { kind: "owned", command, cwd: actualCwd };
}
