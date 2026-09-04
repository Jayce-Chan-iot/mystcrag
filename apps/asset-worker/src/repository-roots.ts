import { execFile } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GIT_COMMAND_TIMEOUT_MS = 5_000;
const GITDIR_POINTER = /^gitdir:\s*(.+)$/;

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
      current = { path: line.slice("worktree ".length).trim(), prunable: false };
      continue;
    }
    if (line.startsWith("prunable") && current !== null) {
      current.prunable = true;
    }
    // HEAD/branch/bare/detached/locked lines carry no discovery signal.
  }
  if (current !== null) entries.push(current);
  return entries.filter((entry) => entry.path.length > 0);
}

function readGitdirPointer(dotGitFile: string): string {
  let content: string;
  try {
    content = readFileSync(dotGitFile, "utf8");
  } catch (error) {
    throw new RepositoryRootsError(`Cannot read the .git file at ${dotGitFile}: ${(error as Error).message}`, {
      cause: error
    });
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
  let commondir: string | null = null;
  try {
    commondir = readFileSync(join(gitdirPath, "commondir"), "utf8");
  } catch (error) {
    if (errnoCode(error) !== "ENOENT") {
      throw new RepositoryRootsError(
        `Cannot read the commondir file at ${join(gitdirPath, "commondir")}: ${(error as Error).message}`,
        { cause: error }
      );
    }
  }
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
 * Filesystem fallback for environments without a usable git binary. Instead
 * of trusting only the current worktree and the main checkout, it enumerates
 * EVERY worktree registered in the shared git dir's `worktrees/<name>/gitdir`
 * files, so sibling worktrees outside the main checkout stay protected.
 *
 * A registered worktree whose recorded path no longer exists is skipped —
 * that is exactly the state git itself reports as prunable, and nothing can
 * be archived inside a nonexistent directory. Any registration that exists
 * but cannot be resolved fails closed, and an unreadable registry fails
 * closed because enumeration completeness can no longer be proven.
 */
export function discoverRepositoryRootsFromFilesystem(startDir: string): string[] {
  let dir = resolve(startDir);
  let currentRoot: string | null = null;
  let dotGitPath: string | null = null;
  for (;;) {
    const candidate = join(dir, ".git");
    try {
      statSync(candidate);
      currentRoot = dir;
      dotGitPath = candidate;
      break;
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") {
        throw new RepositoryRootsError(`Cannot inspect ${candidate}: ${(error as Error).message}`, {
          cause: error
        });
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (currentRoot === null || dotGitPath === null) {
    throw new RepositoryRootsError(`No Git repository root found above ${startDir}`);
  }

  const currentReal = resolveWorktreeRoot(currentRoot, "the current worktree");
  if (currentReal === null) {
    throw new RepositoryRootsError(`The current worktree at ${currentRoot} is no longer accessible`);
  }
  const roots = new Set<string>([currentReal]);

  let dotGitStats;
  try {
    dotGitStats = statSync(dotGitPath);
  } catch (error) {
    throw new RepositoryRootsError(`Cannot inspect ${dotGitPath}: ${(error as Error).message}`, {
      cause: error
    });
  }
  const commonDir = dotGitStats.isDirectory()
    ? dotGitPath
    : dotGitStats.isFile()
      ? commonGitDirOf(readGitdirPointer(dotGitPath))
      : null;
  if (commonDir === null) {
    throw new RepositoryRootsError(
      `The .git entry at ${dotGitPath} is neither a directory nor a file; cannot enumerate worktrees`
    );
  }

  if (basename(commonDir) === ".git") {
    const mainRoot = resolveWorktreeRoot(dirname(commonDir), "the main checkout");
    if (mainRoot !== null) roots.add(mainRoot);
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
    if (!entry.isDirectory()) continue;
    const gitdirFile = join(worktreesDir, entry.name, "gitdir");
    let content: string;
    try {
      content = readFileSync(gitdirFile, "utf8");
    } catch (error) {
      throw new RepositoryRootsError(
        `Cannot read the gitdir file of registered worktree ${entry.name}: ${(error as Error).message}`,
        { cause: error }
      );
    }
    const recorded = resolve(dirname(gitdirFile), content.trim());
    const root = resolveWorktreeRoot(dirname(recorded), `registered worktree ${entry.name}`);
    if (root === null) continue; // prunable: the recorded worktree no longer exists
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
 * entries explicitly marked prunable may be ignored when their directory is
 * gone, while a missing non-prunable worktree fails closed. A missing git
 * binary or a failed command falls back to a filesystem walk that enumerates
 * the shared git dir's `worktrees/<name>/gitdir` registry. When neither can
 * identify a repository the discovery fails closed with
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
        if (entry.prunable) continue;
        throw new RepositoryRootsError(
          `Git worktree ${entry.path} is missing and not marked prunable; cannot prove the archive root is outside the repository`
        );
      }
      roots.push(real);
    }
    if (roots.length > 0) return [...new Set(roots)];
  }

  return discoverRepositoryRootsFromFilesystem(startDir);
}
