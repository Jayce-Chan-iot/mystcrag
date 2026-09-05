import { execFile } from "node:child_process";
import { lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { readRegularFileSync } from "@mystcrag/asset-pipeline";

const execFileAsync = promisify(execFile);

const GIT_COMMAND_TIMEOUT_MS = 5_000;
const GITDIR_POINTER = /^gitdir:\s*(.+)$/;
/** Control files written by git are tiny; anything larger is not one of them. */
const CONTROL_FILE_MAX_BYTES = 1 << 20;

export type GitWorktreeCommand = (args: string[], cwd: string) => Promise<string>;

/**
 * Fail-closed signal: the guard cannot determine which Git trees surround the
 * worker, so it cannot prove the archive root is safe and the worker must
 * refuse to start.
 */
export class RepositoryRootsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RepositoryRootsError";
  }
}

async function runGitWorktreeList(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    timeout: GIT_COMMAND_TIMEOUT_MS,
    encoding: "utf8"
  });
  return result.stdout;
}

function errnoCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

/**
 * Resolves a worktree path to its realpath. Returns null only when the path
 * verifiably does not exist (ENOENT); any other failure — permission errors,
 * symlink loops, a non-directory — fails closed because the guard cannot
 * prove the location is outside every repository.
 */
function resolveWorktreeRoot(path: string, description: string): string | null {
  try {
    statSync(path);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return null;
    throw new RepositoryRootsError(`Cannot inspect ${description} ${path}: ${(error as Error).message}`, {
      cause: error
    });
  }

  let real: string;
  try {
    real = realpathSync(path);
  } catch (error) {
    throw new RepositoryRootsError(`Cannot resolve ${description} ${path}: ${(error as Error).message}`, {
      cause: error
    });
  }
  if (!statSync(real).isDirectory()) {
    throw new RepositoryRootsError(`${description} ${path} is not a directory`);
  }
  return real;
}

type PorcelainWorktree = {
  path: string;
  prunable: boolean;
  locked: boolean;
};

function parseGitWorktreeList(output: string): PorcelainWorktree[] {
  const entries: PorcelainWorktree[] = [];
  let current: PorcelainWorktree | null = null;
  for (const rawLine of output.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) {
      if (current !== null) entries.push(current);
      current = null;
      continue;
    }
    if (line.startsWith("worktree ")) {
      if (current !== null) entries.push(current);
      current = { path: line.slice("worktree ".length).trim(), prunable: false, locked: false };
      continue;
    }
    if (line.startsWith("prunable") && current !== null) {
      current.prunable = true;
    }
    if (line.startsWith("locked") && current !== null) {
      current.locked = true;
    }
    // HEAD/branch/bare/detached lines carry no discovery signal.
  }
  if (current !== null) entries.push(current);
  return entries.filter((entry) => entry.path.length > 0);
}

/**
 * Reads a git control file through the shared same-descriptor safe read: the
 * file is opened with O_NOFOLLOW, verified regular by fstat on that very
 * descriptor, and read from it — never lstat'd first and then re-resolved by
 * path. Returns null only when the file verifiably does not exist (ENOENT).
 */
function readControlFile(path: string, description: string): string | null {
  let outcome;
  try {
    outcome = readRegularFileSync(path, { maxBytes: CONTROL_FILE_MAX_BYTES });
  } catch (error) {
    throw new RepositoryRootsError(`Cannot read ${description} at ${path}: ${(error as Error).message}`, {
      cause: error
    });
  }
  if (outcome.status === "missing") return null;
  if (outcome.status === "not-regular") {
    throw new RepositoryRootsError(
      `${description} at ${path} is not a plain file; cannot prove the repository layout through it`
    );
  }
  return Buffer.from(outcome.bytes).toString("utf8");
}

function readGitdirPointer(dotGitFile: string): string {
  const content = readControlFile(dotGitFile, "the .git file");
  if (content === null) {
    throw new RepositoryRootsError(`The .git file at ${dotGitFile} is missing; cannot locate the repository`);
  }
  const match = GITDIR_POINTER.exec(content.trim());
  if (match === null) {
    throw new RepositoryRootsError(
      `The .git file at ${dotGitFile} has no gitdir pointer; cannot locate the repository`
    );
  }
  return resolve(dirname(dotGitFile), match[1]!.trim());
}

/**
 * The shared git dir that holds `worktrees/`: for a linked worktree its
 * location comes from the `commondir` file git writes; a commondir-less
 * layout falls back to the `<main>/.git/worktrees/<name>` shape, and a
 * submodule checkout uses its gitdir as the common dir directly.
 */
function commonGitDirOf(gitdirPath: string): string {
  const commondir = readControlFile(join(gitdirPath, "commondir"), "the commondir file");
  if (commondir !== null) {
    const trimmed = commondir.trim();
    if (trimmed.length === 0) {
      throw new RepositoryRootsError(
        `The commondir file at ${join(gitdirPath, "commondir")} is empty; cannot enumerate worktrees`
      );
    }
    return resolve(gitdirPath, trimmed);
  }
  const twoUp = dirname(dirname(gitdirPath));
  if (basename(twoUp) === ".git") return twoUp;
  return gitdirPath;
}

/**
 * Verifies the bidirectional registration of a linked worktree. The registry
 * entry's gitdir file points at `<worktree>/.git`; that entry must itself be a
 * plain file (never a directory or a symlink) carrying a valid `gitdir:`
 * pointer back to exactly this registry directory — all established through
 * the same descriptor the content is read from. A missing, unreadable,
 * mistyped, malformed, or cross-wired registration fails closed: the guard
 * can no longer prove the archive root is outside every repository.
 */
function verifyWorktreeRegistration(name: string, dotGitFile: string, registryDir: string): void {
  const content = readControlFile(dotGitFile, `the .git entry of registered worktree ${name}`);
  if (content === null) {
    throw new RepositoryRootsError(
      `The .git entry of registered worktree ${name} at ${dotGitFile} is missing or cannot be inspected`
    );
  }
  const match = GITDIR_POINTER.exec(content.trim());
  if (match === null) {
    throw new RepositoryRootsError(
      `The .git file of registered worktree ${name} at ${dotGitFile} has no gitdir pointer; cannot prove the archive root is outside the repository`
    );
  }
  const pointer = match[1]!.trim();
  if (pointer.length === 0) {
    throw new RepositoryRootsError(
      `The .git file of registered worktree ${name} at ${dotGitFile} has an empty gitdir pointer; cannot prove the archive root is outside the repository`
    );
  }
  const backPointer = resolve(dirname(dotGitFile), pointer);
  if (backPointer !== resolve(registryDir)) {
    throw new RepositoryRootsError(
      `The .git file of registered worktree ${name} at ${dotGitFile} points back at ${backPointer} instead of its registry entry ${resolve(registryDir)}; cannot prove the archive root is outside the repository`
    );
  }
}

/**
 * Filesystem fallback for environments without a usable git binary. Instead
 * of trusting only the current worktree and the main checkout, it enumerates
 * EVERY worktree registered in the shared git dir's `worktrees/<name>/gitdir`
 * files, so sibling worktrees outside the main checkout stay protected.
 *
 * Without git, prunability cannot be proven, so a registration whose recorded
 * directory is gone is NOT skipped — the guard refuses to start. Locked
 * registrations are treated the same (locked worktrees must never be
 * dropped). Only git's porcelain output, which explicitly marks entries
 * prunable, may ignore a nonexistent path. Every registry entry must be a
 * verifiable directory with a readable, non-empty gitdir file pointing at
 * the worktree's `.git` entry, and that entry must be a plain file whose
 * `gitdir:` pointer resolves back to exactly this registry entry; anything
 * else fails closed because enumeration completeness can no longer be
 * proven.
 */
export function discoverRepositoryRootsFromFilesystem(startDir: string): string[] {
  let dir = resolve(startDir);
  let currentRoot: string | null = null;
  let dotGitPath: string | null = null;
  let dotGitInfo: Stats | null = null;
  for (;;) {
    const candidate = join(dir, ".git");
    let info: Stats;
    try {
      info = lstatSync(candidate);
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") {
        throw new RepositoryRootsError(`Cannot inspect ${candidate}: ${(error as Error).message}`, {
          cause: error
        });
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
      continue;
    }
    // A symlinked .git would resolve the repository through a link: the guard
    // would protect whatever the link happens to target (or silently shrink to
    // the worktree alone), so it must refuse to prove anything here.
    if (info.isSymbolicLink()) {
      throw new RepositoryRootsError(
        `The .git entry at ${candidate} is a symbolic link; cannot prove which repository surrounds this directory`
      );
    }
    currentRoot = dir;
    dotGitPath = candidate;
    dotGitInfo = info;
    break;
  }
  if (currentRoot === null || dotGitPath === null || dotGitInfo === null) {
    throw new RepositoryRootsError(`No Git repository root found above ${startDir}`);
  }

  const currentReal = resolveWorktreeRoot(currentRoot, "the current worktree");
  if (currentReal === null) {
    throw new RepositoryRootsError(`The current worktree at ${currentRoot} is no longer accessible`);
  }
  const roots = new Set<string>([currentReal]);

  const commonDir = dotGitInfo.isDirectory()
    ? dotGitPath
    : dotGitInfo.isFile()
      ? commonGitDirOf(readGitdirPointer(dotGitPath))
      : null;
  if (commonDir === null) {
    throw new RepositoryRootsError(
      `The .git entry at ${dotGitPath} is neither a directory nor a file; cannot enumerate worktrees`
    );
  }

  if (basename(commonDir) === ".git") {
    const mainRoot = resolveWorktreeRoot(dirname(commonDir), "the main checkout");
    if (mainRoot === null) {
      throw new RepositoryRootsError(
        `The main checkout at ${dirname(commonDir)} is no longer accessible; cannot prove the archive root is outside the repository`
      );
    }
    roots.add(mainRoot);
  }

  const worktreesDir = join(commonDir, "worktrees");
  let registered: Dirent[];
  try {
    registered = readdirSync(worktreesDir, { withFileTypes: true });
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      registered = []; // no linked worktrees registered at all
    } else {
      throw new RepositoryRootsError(
        `Cannot enumerate the registered worktrees in ${worktreesDir}: ${(error as Error).message}`,
        { cause: error }
      );
    }
  }

  for (const entry of registered) {
    if (!entry.isDirectory()) {
      throw new RepositoryRootsError(
        `The worktrees registry entry ${entry.name} is not a directory; cannot prove the archive root is outside the repository`
      );
    }
    const worktreeDir = join(worktreesDir, entry.name);
    const gitdirFile = join(worktreeDir, "gitdir");
    const content = readControlFile(gitdirFile, `the gitdir file of registered worktree ${entry.name}`);
    if (content === null) {
      throw new RepositoryRootsError(
        `The gitdir file of registered worktree ${entry.name} is missing; cannot resolve its worktree`
      );
    }
    const recordedPath = content.trim();
    if (recordedPath.length === 0) {
      throw new RepositoryRootsError(
        `The gitdir file of registered worktree ${entry.name} is empty; cannot resolve its worktree`
      );
    }
    const recorded = resolve(dirname(gitdirFile), recordedPath);
    if (basename(recorded) !== ".git") {
      throw new RepositoryRootsError(
        `The gitdir file of registered worktree ${entry.name} points at ${recorded} instead of the worktree's .git entry; cannot prove the archive root is outside the repository`
      );
    }
    const worktreeRootPath = dirname(recorded);
    const root = resolveWorktreeRoot(worktreeRootPath, `registered worktree ${entry.name}`);
    if (root === null) {
      let locked = false;
      try {
        statSync(join(worktreeDir, "locked"));
        locked = true;
      } catch (error) {
        if (errnoCode(error) !== "ENOENT") {
          throw new RepositoryRootsError(
            `Cannot inspect the lock state of registered worktree ${entry.name}: ${(error as Error).message}`,
            { cause: error }
          );
        }
      }
      throw new RepositoryRootsError(
        locked
          ? `Registered worktree ${entry.name} at ${worktreeRootPath} is locked but its directory is missing; cannot prove the archive root is outside the repository`
          : `Registered worktree ${entry.name} at ${worktreeRootPath} is missing and cannot be proven prunable without git; cannot prove the archive root is outside the repository`
      );
    }
    verifyWorktreeRegistration(entry.name, recorded, worktreeDir);
    roots.add(root);
  }

  return [...roots];
}

/**
 * Discover every Git worktree that could accidentally receive archived
 * originals: the current linked worktree, the main checkout, and any sibling
 * worktrees registered for this repository.
 *
 * `git worktree list --porcelain` is authoritative when available: only
 * entries explicitly marked prunable (and not locked) may be ignored when
 * their directory is gone, while a locked or unmarked missing worktree
 * fails closed. A missing git binary or a failed command falls back to a
 * filesystem walk that enumerates the shared git dir's
 * `worktrees/<name>/gitdir` registry; because that walk cannot prove
 * prunability, any missing registration fails closed there. When neither
 * path can identify a repository the discovery fails closed with
 * {@link RepositoryRootsError}.
 */
export async function discoverRepositoryRoots(options?: {
  startDir?: string;
  runGit?: GitWorktreeCommand;
}): Promise<string[]> {
  const startDir = options?.startDir ?? dirname(fileURLToPath(import.meta.url));
  const runGit = options?.runGit ?? runGitWorktreeList;

  let output: string | null = null;
  try {
    output = await runGit(["worktree", "list", "--porcelain"], startDir);
  } catch {
    output = null;
  }

  const entries = output === null ? [] : parseGitWorktreeList(output);
  if (entries.length > 0) {
    const roots: string[] = [];
    for (const entry of entries) {
      const real = resolveWorktreeRoot(entry.path, "git worktree");
      if (real === null) {
        if (entry.prunable && !entry.locked) continue;
        throw new RepositoryRootsError(
          entry.locked
            ? `Git worktree ${entry.path} is missing and locked; cannot prove the archive root is outside the repository`
            : `Git worktree ${entry.path} is missing and not marked prunable; cannot prove the archive root is outside the repository`
        );
      }
      roots.push(real);
    }
    if (roots.length > 0) return [...new Set(roots)];
  }

  return discoverRepositoryRootsFromFilesystem(startDir);
}
