/**
 * PID ownership verification for AUTH-006 teardown.
 *
 * Teardown may only signal processes this run started. A pid recovered from
 * run-state.json (used when the orchestrator handle is lost, e.g. teardown runs in a
 * fresh process) proves nothing by itself: pids are recycled by the OS, and killing a
 * recycled pid would terminate an unrelated process.
 *
 * The check asks the OS for the pid's CURRENT command line (`ps -p <pid> -o command=`)
 * and requires it to match the run-scoped signature of the expected child:
 *   - backend  → the run-scoped dist path, which contains the unique run id
 *   - frontend → `next start -p <this run's port>` — ports come from the run-scoped
 *                port plan, and no two concurrent AUTH-006 runs share a port
 *
 * Three outcomes, all regression-tested (H5):
 *   owned   → the command line matches; signalling is safe
 *   gone    → no such process; nothing to signal (not an error)
 *   foreign → a live process owns the pid but its command line does NOT match; the
 *             pid was recycled or never belonged to this run. Teardown MUST fail
 *             loudly and MUST NOT signal it.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type OwnershipCheck =
  | { kind: "owned"; command: string }
  | { kind: "gone" }
  | { kind: "foreign"; pid: number; command: string };

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

export async function verifyProcessOwnership(options: {
  pid: number;
  /** The pid is owned only when its command line matches at least one pattern. */
  patterns: RegExp[];
}): Promise<OwnershipCheck> {
  const command = await processCommandFor(options.pid);
  if (command === null) {
    return { kind: "gone" };
  }
  if (options.patterns.some((pattern) => pattern.test(command))) {
    return { kind: "owned", command };
  }
  return { kind: "foreign", pid: options.pid, command };
}
