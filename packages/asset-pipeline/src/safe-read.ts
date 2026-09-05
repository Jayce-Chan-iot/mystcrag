import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type { Stats } from "node:fs";
import { open } from "node:fs/promises";

// O_NOFOLLOW makes the open itself refuse a symlinked final segment, closing
// the lstat-then-readByPath race where the path is swapped for a link between
// the check and the read. Platforms without O_NOFOLLOW (Windows) fall back to
// flag 0: the caller's own lstat walk still rejects static symlinks, and the
// swap race remains a documented residual limitation there.
const READ_FLAGS_NOFOLLOW = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

export type RegularFileRead =
  | { status: "missing" }
  | { status: "not-regular" }
  | { status: "read"; bytes: Uint8Array };

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function classifyOpenError(error: unknown): { status: "missing" } | { status: "not-regular" } | undefined {
  const code = errnoCode(error);
  if (code === "ENOENT") return { status: "missing" };
  if (code === "ELOOP") return { status: "not-regular" };
  return undefined;
}

function assertWithinCap(info: Stats, maxBytes: number | undefined, path: string): void {
  if (maxBytes !== undefined && info.size > maxBytes) {
    throw new Error(`Regular file ${path} is ${info.size} bytes and exceeds the ${maxBytes}-byte read cap`);
  }
}

/**
 * Reads a regular file through a single descriptor that was itself verified:
 * open with O_NOFOLLOW, fstat that same descriptor, and read from it. The
 * outcome distinguishes "missing" (ENOENT) and "not-regular" (symlink at the
 * final segment, directory, device node) from a successful read, and any other
 * errno (e.g. EACCES) propagates so callers can fail closed instead of
 * mistaking a real error for an absent file.
 */
export async function readRegularFile(
  path: string,
  options: { maxBytes?: number } = {}
): Promise<RegularFileRead> {
  let handle;
  try {
    handle = await open(path, READ_FLAGS_NOFOLLOW);
  } catch (error) {
    const outcome = classifyOpenError(error);
    if (outcome !== undefined) return outcome;
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) return { status: "not-regular" };
    assertWithinCap(info, options.maxBytes, path);
    const bytes = await handle.readFile();
    return { status: "read", bytes };
  } finally {
    await handle.close();
  }
}

/** Synchronous twin of {@link readRegularFile} for control-file reads. */
export function readRegularFileSync(
  path: string,
  options: { maxBytes?: number } = {}
): RegularFileRead {
  let fd: number | undefined;
  try {
    fd = openSync(path, READ_FLAGS_NOFOLLOW);
  } catch (error) {
    const outcome = classifyOpenError(error);
    if (outcome !== undefined) return outcome;
    throw error;
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) return { status: "not-regular" };
    assertWithinCap(info, options.maxBytes, path);
    const chunks: Buffer[] = [];
    let remaining = info.size;
    while (remaining > 0) {
      const chunk = Buffer.alloc(Math.min(remaining, 1 << 20));
      const read = readSync(fd, chunk, 0, chunk.byteLength, null);
      if (read === 0) break;
      chunks.push(chunk.subarray(0, read));
      remaining -= read;
    }
    return { status: "read", bytes: Buffer.concat(chunks) };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Verifies through one descriptor that a path holds a regular file without
 * reading its content. Used where only existence and type matter (e.g.
 * removing a staging entry) so multi-megabyte originals are never loaded just
 * to be unlinked.
 */
export async function probeRegularFile(path: string): Promise<"missing" | "not-regular" | "regular"> {
  let handle;
  try {
    handle = await open(path, READ_FLAGS_NOFOLLOW);
  } catch (error) {
    const outcome = classifyOpenError(error);
    if (outcome !== undefined) return outcome.status;
    throw error;
  }
  try {
    return (await handle.stat()).isFile() ? "regular" : "not-regular";
  } finally {
    await handle.close();
  }
}