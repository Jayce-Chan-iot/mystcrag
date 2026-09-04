import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  const base = makeTempDir();
  const plain = join(base, "plain");
  try {
    mkdirSync(join(plain, ".git"), { recursive: true });

    const roots = discoverRepositoryRootsFromFilesystem(plain);

    assert.deepEqual(roots, [realpathSync(plain)]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("filesystem discovery from the main checkout still enumerates registered linked worktrees", () => {
  const layout = makeSyntheticWorktrees();
  try {
    const roots = discoverRepositoryRootsFromFilesystem(layout.main);

    assert.deepEqual(
      new Set(roots),
      new Set([realpathSync(layout.main), realpathSync(layout.worktree)]),
      "a registered linked worktree must stay protected even when discovery starts at the main checkout"
    );
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
      "prunable gitdir file points to non-existent location",
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

test("git worktree listing fails closed on a missing worktree that is not marked prunable", async () => {
  const existing = makeTempDir();
  try {
    const fixture = [
      `worktree ${existing}`,
      "HEAD 0000000000000000000000000000000000000000",
      "branch refs/heads/main",
      "",
      "worktree /nonexistent/not-marked-prunable",
      "HEAD 0000000000000000000000000000000000000000",
      "branch refs/heads/task/lost",
      ""
    ].join("\n");

    await assert.rejects(
      discoverRepositoryRoots({
        startDir: existing,
        runGit: async () => fixture
      }),
      (error: unknown) => {
        assert.ok(error instanceof RepositoryRootsError);
        assert.match(error.message, /not-marked-prunable/);
        return true;
      },
      "a missing worktree without a prunable marker must fail closed instead of being dropped"
    );
  } finally {
    rmSync(existing, { recursive: true, force: true });
  }
});

test("git worktree listing fails closed on a locked worktree even when marked prunable", async () => {
  const existing = makeTempDir();
  try {
    const fixture = [
      `worktree ${existing}`,
      "HEAD 0000000000000000000000000000000000000000",
      "branch refs/heads/main",
      "",
      "worktree /nonexistent/locked-worktree",
      "HEAD 0000000000000000000000000000000000000000",
      "branch refs/heads/task/locked",
      "locked",
      "prunable gitdir file points to non-existent location",
      ""
    ].join("\n");

    await assert.rejects(
      discoverRepositoryRoots({
        startDir: existing,
        runGit: async () => fixture
      }),
      (error: unknown) => {
        assert.ok(error instanceof RepositoryRootsError);
        assert.match(error.message, /locked-worktree/);
        return true;
      },
      "a locked missing worktree must refuse to start even if porcelain also marks it prunable"
    );
  } finally {
    rmSync(existing, { recursive: true, force: true });
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

/**
 * Two linked worktrees, both registered in the main checkout's git dir and
 * both living OUTSIDE the main checkout. Discovering from inside wt-a must
 * still enumerate wt-b: without that, an archive root inside the sibling
 * would slip past the guard whenever git is unavailable.
 */
function makeSyntheticSiblingWorktrees(): {
  base: string;
  main: string;
  worktreeA: string;
  worktreeB: string;
} {
  const base = makeTempDir();
  const main = join(base, "main");
  const worktreeA = join(base, "wt-a");
  const worktreeB = join(base, "wt-b");
  mkdirSync(join(main, ".git", "worktrees", "wt-a"), { recursive: true });
  mkdirSync(join(main, ".git", "worktrees", "wt-b"), { recursive: true });
  mkdirSync(join(worktreeA, "apps", "worker", "src"), { recursive: true });
  mkdirSync(join(worktreeB, "apps", "worker", "src"), { recursive: true });
  writeFileSync(join(worktreeA, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt-a")}\n`, "utf8");
  writeFileSync(join(worktreeB, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt-b")}\n`, "utf8");
  writeFileSync(join(main, ".git", "worktrees", "wt-a", "gitdir"), `${join(worktreeA, ".git")}\n`, "utf8");
  writeFileSync(join(main, ".git", "worktrees", "wt-b", "gitdir"), `${join(worktreeB, ".git")}\n`, "utf8");
  return { base, main, worktreeA, worktreeB };
}

test("filesystem discovery enumerates sibling worktrees that live outside the main checkout", () => {
  const layout = makeSyntheticSiblingWorktrees();
  try {
    const roots = discoverRepositoryRootsFromFilesystem(join(layout.worktreeA, "apps", "worker", "src"));

    assert.deepEqual(
      new Set(roots),
      new Set([realpathSync(layout.worktreeA), realpathSync(layout.worktreeB), realpathSync(layout.main)]),
      "every registered worktree must be protected even without git"
    );
  } finally {
    rmSync(layout.base, { recursive: true, force: true });
  }
});

test("filesystem discovery fails closed on a registered worktree it cannot prove prunable", () => {
  const layout = makeSyntheticSiblingWorktrees();
  try {
    // The registration survives while the worktree directory is gone. Git
    // would report it prunable, but the fallback cannot prove that — so it
    // must refuse to start instead of silently dropping the entry.
    rmSync(layout.worktreeB, { recursive: true, force: true });

    assert.throws(
      () => discoverRepositoryRootsFromFilesystem(join(layout.worktreeA, "apps", "worker", "src")),
      (error: unknown) => error instanceof RepositoryRootsError,
      "a missing registered worktree must fail closed when git cannot prove it prunable"
    );
  } finally {
    rmSync(layout.base, { recursive: true, force: true });
  }
});

test("filesystem discovery fails closed on a locked worktree whose directory is missing", () => {
  const layout = makeSyntheticSiblingWorktrees();
  try {
    writeFileSync(join(layout.main, ".git", "worktrees", "wt-b", "locked"), "held by CI\n", "utf8");
    rmSync(layout.worktreeB, { recursive: true, force: true });

    assert.throws(
      () => discoverRepositoryRootsFromFilesystem(join(layout.worktreeA, "apps", "worker", "src")),
      (error: unknown) => {
        assert.ok(error instanceof RepositoryRootsError);
        assert.match(error.message, /locked/i);
        return true;
      },
      "a locked worktree whose target is missing must refuse to start"
    );
  } finally {
    rmSync(layout.base, { recursive: true, force: true });
  }
});

test("filesystem discovery fails closed on an empty gitdir file", () => {
  const layout = makeSyntheticSiblingWorktrees();
  try {
    writeFileSync(join(layout.main, ".git", "worktrees", "wt-b", "gitdir"), "  \n\t\n", "utf8");

    assert.throws(
      () => discoverRepositoryRootsFromFilesystem(join(layout.worktreeA, "apps", "worker", "src")),
      (error: unknown) => error instanceof RepositoryRootsError,
      "an empty gitdir file must fail closed instead of resolving to a bogus path"
    );
  } finally {
    rmSync(layout.base, { recursive: true, force: true });
  }
});

test("filesystem discovery fails closed on a gitdir file that does not point at a .git entry", () => {
  const layout = makeSyntheticSiblingWorktrees();
  try {
    const bogus = join(layout.base, "not-a-worktree", "readme.txt");
    writeFileSync(join(layout.main, ".git", "worktrees", "wt-b", "gitdir"), `${bogus}\n`, "utf8");

    assert.throws(
      () => discoverRepositoryRootsFromFilesystem(join(layout.worktreeA, "apps", "worker", "src")),
      (error: unknown) => error instanceof RepositoryRootsError,
      "a gitdir file pointing anywhere other than the worktree's .git must fail closed"
    );
  } finally {
    rmSync(layout.base, { recursive: true, force: true });
  }
});

test("filesystem discovery fails closed when a registry entry is a file or a symlink", () => {
  const layout = makeSyntheticSiblingWorktrees();
  try {
    writeFileSync(join(layout.main, ".git", "worktrees", "bogus-file"), "not a worktree", "utf8");
    symlinkSync(layout.worktreeA, join(layout.main, ".git", "worktrees", "bogus-link"));

    for (const bogus of ["bogus-file", "bogus-link"]) {
      assert.throws(
        () => discoverRepositoryRootsFromFilesystem(join(layout.worktreeA, "apps", "worker", "src")),
        (error: unknown) => {
          assert.ok(error instanceof RepositoryRootsError);
          assert.match(error.message, new RegExp(bogus));
          return true;
        },
        `registry entry ${bogus} must fail closed`
      );
      rmSync(join(layout.main, ".git", "worktrees", bogus), { recursive: true, force: true });
    }
  } finally {
    rmSync(layout.base, { recursive: true, force: true });
  }
});

test("filesystem discovery fails closed when a registered worktree path is not a directory", () => {
  const layout = makeSyntheticSiblingWorktrees();
  try {
    rmSync(layout.worktreeB, { recursive: true, force: true });
    writeFileSync(layout.worktreeB, "not a directory", "utf8");

    assert.throws(
      () => discoverRepositoryRootsFromFilesystem(join(layout.worktreeA, "apps", "worker", "src")),
      (error: unknown) => error instanceof RepositoryRootsError,
      "a registered worktree that exists but is not a directory must fail closed"
    );
  } finally {
    rmSync(layout.base, { recursive: true, force: true });
  }
});

test("filesystem discovery fails closed when a registered worktree path cannot be resolved", () => {
  const layout = makeSyntheticSiblingWorktrees();
  try {
    rmSync(layout.worktreeB, { recursive: true, force: true });
    symlinkSync("wt-b", layout.worktreeB); // self-referencing symlink: realpath cannot resolve it

    assert.throws(
      () => discoverRepositoryRootsFromFilesystem(join(layout.worktreeA, "apps", "worker", "src")),
      (error: unknown) => error instanceof RepositoryRootsError,
      "a registered worktree that cannot be realpath'd must fail closed"
    );
  } finally {
    rmSync(layout.base, { recursive: true, force: true });
  }
});

test("the archive guard rejects roots inside a sibling worktree and symlinks into it", () => {
  const layout = makeSyntheticSiblingWorktrees();
  const symlinkHolders = makeTempDir();
  let outside: string | null = null;
  try {
    const repositoryRoots = discoverRepositoryRootsFromFilesystem(
      join(layout.worktreeA, "apps", "worker", "src")
    );

    const rejectedRoots = [
      layout.worktreeB,
      join(layout.worktreeB, "apps"),
      join(layout.worktreeB, "apps", "worker")
    ];
    for (const candidate of rejectedRoots) {
      assert.throws(
        () => ArchiveStore.fromEnvironment({ repositoryRoots, env: { MYSTCRAG_ASSET_ARCHIVE_ROOT: candidate } }),
        (error: unknown) => {
          assert.ok(error instanceof ArchiveStoreError, `expected ArchiveStoreError for ${candidate}`);
          assert.equal(error.code, "ARCHIVE_ROOT_INSIDE_REPOSITORY");
          return true;
        },
        `archive root ${candidate} inside the sibling worktree must be rejected`
      );
    }

    const linkIntoSibling = join(symlinkHolders, "into-sibling");
    symlinkSync(layout.worktreeB, linkIntoSibling);
    assert.throws(
      () =>
        ArchiveStore.fromEnvironment({
          repositoryRoots,
          env: { MYSTCRAG_ASSET_ARCHIVE_ROOT: linkIntoSibling }
        }),
      (error: unknown) => {
        assert.ok(error instanceof ArchiveStoreError);
        assert.equal(error.code, "ARCHIVE_ROOT_INSIDE_REPOSITORY");
        return true;
      },
      "a symlink pointing at the sibling worktree must be rejected through realpath"
    );

    outside = makeTempDir();
    const store = ArchiveStore.fromEnvironment({
      repositoryRoots,
      env: { MYSTCRAG_ASSET_ARCHIVE_ROOT: outside }
    });
    assert.equal(store.root, realpathSync(outside));
  } finally {
    rmSync(layout.base, { recursive: true, force: true });
    rmSync(symlinkHolders, { recursive: true, force: true });
    if (outside !== null) rmSync(outside, { recursive: true, force: true });
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

test("filesystem discovery without git fails closed on the real repository's unprovable registrations", async () => {
  // The real repository carries stale registrations whose directories are
  // gone. Git marks them prunable and may drop them, but the filesystem
  // fallback cannot prove prunability — so it must refuse to start. Only a
  // repository without any missing registration may rely on the fallback.
  const porcelain = execFileSync("git", ["worktree", "list", "--porcelain"], {
    cwd: testsDir,
    encoding: "utf8"
  });
  const missing = [...porcelain.matchAll(/^worktree (.+)$/gm)]
    .map((match) => match[1]!.trim())
    .filter((path) => !existsSync(path));

  if (missing.length > 0) {
    assert.throws(
      () => discoverRepositoryRootsFromFilesystem(testsDir),
      (error: unknown) => {
        assert.ok(error instanceof RepositoryRootsError);
        assert.match(error.message, /cannot be proven prunable|locked/i);
        return true;
      },
      `the fallback must fail closed on ${missing.length} unprovable missing registration(s)`
    );
    return;
  }

  const viaGit = await discoverRepositoryRoots();
  const viaFilesystem = discoverRepositoryRootsFromFilesystem(testsDir);
  for (const root of viaGit) {
    assert.ok(
      viaFilesystem.includes(root),
      `filesystem discovery must also protect ${root}; git reported ${JSON.stringify(viaGit)}, filesystem found ${JSON.stringify(viaFilesystem)}`
    );
  }
  assert.ok(viaFilesystem.includes(worktreeRoot), "the current worktree root must stay protected");
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
