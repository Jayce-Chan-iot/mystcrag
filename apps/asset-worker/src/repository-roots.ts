import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
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

function toRealDirectoryRoot(path: string): string | null {
  try {
    const real = realpathSync(path);
    if (!statSync(real).isDirectory()) return null;
    return real;
  } catch {
    return null;
  }
}

function parseGitWorktreeList(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter((path) => path.length > 0);
}

/**
 * Derive the main checkout root from a linked worktree's `.git` file, whose
 * `gitdir:` pointer targets `<main>/.git/worktrees/<name>` (or, for a
 * submodule, `<main>/.git/modules/<name>`). Both shapes share the depth, so
 * three `dirname` calls land on the main checkout root.
 */
function mainCheckoutRootFromGitFile(dotGitFile: string): string | null {
  let content: string;
  try {
    content = readFileSync(dotGitFile, "utf8");
  } catch {
    return null;
  }
  const match = GITDIR_POINTER.exec(content.trim());
  if (match === null) {
    throw new RepositoryRootsError(`The .git file at ${dotGitFile} has no gitdir pointer; cannot locate the main checkout`);
  }
  const gitdir = resolve(dirname(dotGitFile), match[1]!.trim());
  const mainGitDir = dirname(dirname(gitdir));
  if (basename(mainGitDir) !== ".git") return null;
  return dirname(mainGitDir);
}

export function discoverRepositoryRootsFromFilesystem(startDir: string): string[] {
  let dir = resolve(startDir);
  for (;;) {
    const dotGit = join(dir, ".git");
    if (existsSync(dotGit)) {
      const candidates = [dir];
      if (statSync(dotGit).isFile()) {
        const mainRoot = mainCheckoutRootFromGitFile(dotGit);
        if (mainRoot !== null) candidates.push(mainRoot);
      }
      const roots = candidates
        .map(toRealDirectoryRoot)
        .filter((root): root is string => root !== null);
      if (roots.length === 0) {
        throw new RepositoryRootsError(`The Git worktree at ${dir} is no longer accessible`);
      }
      return [...new Set(roots)];
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new RepositoryRootsError(`No Git repository root found above ${startDir}`);
}

/**
 * Discover every Git worktree that could accidentally receive archived
 * originals: the current linked worktree, the main checkout, and any sibling
 * worktrees registered for this repository.
 *
 * `git worktree list --porcelain` is authoritative when available; a missing
 * git binary or a failed command falls back to a filesystem walk that reads
 * the linked-worktree `.git` pointer. When neither can identify a repository
 * the discovery fails closed with {@link RepositoryRootsError}.
 */
export async function discoverRepositoryRoots(options?: {
  startDir?: string;
  runGit?: GitWorktreeCommand;
}): Promise<string[]> {
  const startDir = options?.startDir ?? dirname(fileURLToPath(import.meta.url));
  const runGit = options?.runGit ?? runGitWorktreeList;

  let listed: string[] = [];
  try {
    listed = parseGitWorktreeList(await runGit(["worktree", "list", "--porcelain"], startDir));
  } catch {
    listed = [];
  }

  if (listed.length > 0) {
    const roots = listed
      .map(toRealDirectoryRoot)
      .filter((root): root is string => root !== null);
    if (roots.length > 0) return [...new Set(roots)];
  }

  return discoverRepositoryRootsFromFilesystem(startDir);
}
