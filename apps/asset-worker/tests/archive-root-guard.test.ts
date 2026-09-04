import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ArchiveStore, ArchiveStoreError } from "@mystcrag/asset-pipeline";

import {
  discoverRepositoryRoots,
  discoverRepositoryRootsFromFilesystem,
  RepositoryRootsError
} from "../src/repository-roots.js";

const testsDir = dirname(fileURLToPath(import.meta.url));
const worktreeRoot = realpathSync(resolve(testsDir, "..", "..", ".."));

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "asset-root-guard-"));
}

/**
 * A faithful synthetic linked-worktree layout:
 *
 *   <base>/main/.git/worktrees/wt/   ← the shared git dir of the main checkout
 *   <base>/wt/.git                   ← "gitdir: <base>/main/.git/worktrees/wt"
 *
 * `wt` deliberately lives OUTSIDE `main` so that protection of the linked
 * worktree root is proven independently from the main-checkout root.
 */
function makeSyntheticWorktrees(): { base: string; main: string; worktree: string } {
  const base = makeTempDir();
  const main = join(base, "main");
  const worktree = join(base, "wt");
  mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
  mkdirSync(join(worktree, "apps", "worker", "src"), { recursive: true });
  writeFileSync(join(worktree, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`, "utf8");
  writeFileSync(join(main, ".git", "worktrees", "wt", "gitdir"), `${join(worktree, ".git")}\n`, "utf8");
  return { base, main, worktree };
}

test("filesystem discovery finds a linked worktree and its main checkout from the .git file pointer", () => {
  const layout = makeSyntheticWorktrees();
  try {
    const roots = discoverRepositoryRootsFromFilesystem(join(layout.worktree, "apps", "worker", "src"));

    assert.deepEqual(new Set(roots), new Set([realpathSync(layout.worktree), realpathSync(layout.main)]));
  } finally {
    rmSync(layout.base, { recursive: true, force: true });
  }
});

test("filesystem discovery finds a plain checkout from a .git directory", () => {
  const layout = makeSyntheticWorktrees();
  try {
    const roots = discoverRepositoryRootsFromFilesystem(layout.main);

    assert.deepEqual(roots, [realpathSync(layout.main)]);
  } finally {
    rmSync(layout.base, { recursive: true, force: true });
  }
});

test("filesystem discovery fails closed when no .git exists above the start directory", () => {
  const isolated = makeTempDir();
  try {
    assert.throws(
      () => discoverRepositoryRootsFromFilesystem(isolated),
      (error: unknown) => error instanceof RepositoryRootsError
    );
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});

test("git worktree listing keeps existing worktrees and drops prunable entries", async () => {
  const existingA = makeTempDir();
  const existingB = makeTempDir();
  try {
    const fixture = [
      `worktree ${existingA}`,
      "HEAD 0000000000000000000000000000000000000000",
      "branch refs/heads/main",
      "",
      `worktree ${existingB}`,
      "HEAD 0000000000000000000000000000000000000000",
      "branch refs/heads/task/example",
      "",
      "worktree /nonexistent/prunable-worktree",
      "HEAD 0000000000000000000000000000000000000000",
      "branch refs/heads/task/pruned",
      ""
    ].join("\n");

    const roots = await discoverRepositoryRoots({
      startDir: existingA,
      runGit: async () => fixture
    });

    assert.deepEqual(roots, [realpathSync(existingA), realpathSync(existingB)]);
  } finally {
    rmSync(existingA, { recursive: true, force: true });
    rmSync(existingB, { recursive: true, force: true });
  }
});

test("a failing git command falls back to filesystem discovery", async () => {
  const layout = makeSyntheticWorktrees();
  try {
    const roots = await discoverRepositoryRoots({
      startDir: join(layout.worktree, "apps", "worker", "src"),
      runGit: async () => {
        throw new Error("git unavailable");
      }
    });

    assert.deepEqual(new Set(roots), new Set([realpathSync(layout.worktree), realpathSync(layout.main)]));
  } finally {
    rmSync(layout.base, { recursive: true, force: true });
  }
});

test("discovery fails closed when git is unavailable and no .git can be found", async () => {
  const isolated = makeTempDir();
  try {
    await assert.rejects(
      discoverRepositoryRoots({
        startDir: isolated,
        runGit: async () => {
          throw new Error("git unavailable");
        }
      }),
      (error: unknown) => error instanceof RepositoryRootsError
    );
  } finally {
    rmSync(isolated, { recursive: true, force: true });
  }
});

test("discovery from the real repository reports the current worktree root and the main checkout root", async () => {
  const roots = await discoverRepositoryRoots();

  assert.ok(
    roots.includes(worktreeRoot),
    `the current worktree root ${worktreeRoot} must be discovered; got ${JSON.stringify(roots)}`
  );

  const dotGit = join(worktreeRoot, ".git");
  if (statSync(dotGit).isDirectory()) {
    return; // tests run inside the main checkout itself; its root is already asserted above
  }

  const gitdir = realpathSync(dotGit);
  const mainRoot = realpathSync(dirname(dirname(dirname(gitdir))));
  assert.ok(
    roots.includes(mainRoot),
    `the main checkout root ${mainRoot} must be discovered; got ${JSON.stringify(roots)}`
  );
  assert.ok(
    worktreeRoot.startsWith(mainRoot + sep),
    "the current worktree must live inside the discovered main checkout"
  );
});

test("the archive guard built from discovered roots rejects every repository location and accepts outside roots", async () => {
  const repositoryRoots = await discoverRepositoryRoots();
  const mainRoot = repositoryRoots.find(
    (root) => root !== worktreeRoot && worktreeRoot.startsWith(root + sep)
  );

  const rejectedRoots = [
    worktreeRoot,
    join(worktreeRoot, "packages", "asset-pipeline"),
    join(worktreeRoot, "apps")
  ];
  if (mainRoot !== undefined) {
    rejectedRoots.push(mainRoot, join(mainRoot, ".git"), join(mainRoot, ".worktrees"));
  }

  for (const candidate of rejectedRoots) {
    assert.ok(existsSync(candidate), `test precondition: ${candidate} must exist`);
    assert.throws(
      () => ArchiveStore.fromEnvironment({ repositoryRoots, env: { MYSTCRAG_ASSET_ARCHIVE_ROOT: candidate } }),
      (error: unknown) => {
        assert.ok(error instanceof ArchiveStoreError, `expected ArchiveStoreError for ${candidate}`);
        assert.equal(error.code, "ARCHIVE_ROOT_INSIDE_REPOSITORY");
        return true;
      },
      `archive root ${candidate} must be rejected`
    );
  }

  const symlinkHolders = makeTempDir();
  try {
    const linkIntoWorktree = join(symlinkHolders, "into-worktree");
    symlinkSync(join(worktreeRoot, "packages"), linkIntoWorktree);
    assert.throws(
      () =>
        ArchiveStore.fromEnvironment({
          repositoryRoots,
          env: { MYSTCRAG_ASSET_ARCHIVE_ROOT: linkIntoWorktree }
        }),
      (error: unknown) => {
        assert.ok(error instanceof ArchiveStoreError);
        assert.equal(error.code, "ARCHIVE_ROOT_INSIDE_REPOSITORY");
        return true;
      },
      "a symlink pointing into the worktree must be rejected through realpath"
    );

    if (mainRoot !== undefined) {
      const linkIntoMain = join(symlinkHolders, "into-main");
      symlinkSync(mainRoot, linkIntoMain);
      assert.throws(
        () =>
          ArchiveStore.fromEnvironment({
            repositoryRoots,
            env: { MYSTCRAG_ASSET_ARCHIVE_ROOT: linkIntoMain }
          }),
        (error: unknown) => {
          assert.ok(error instanceof ArchiveStoreError);
          assert.equal(error.code, "ARCHIVE_ROOT_INSIDE_REPOSITORY");
          return true;
        },
        "a symlink pointing at the main checkout must be rejected through realpath"
      );
    }

    const outside = makeTempDir();
    try {
      const store = ArchiveStore.fromEnvironment({
        repositoryRoots,
        env: { MYSTCRAG_ASSET_ARCHIVE_ROOT: outside }
      });
      assert.equal(store.root, realpathSync(outside));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  } finally {
    rmSync(symlinkHolders, { recursive: true, force: true });
  }
});
