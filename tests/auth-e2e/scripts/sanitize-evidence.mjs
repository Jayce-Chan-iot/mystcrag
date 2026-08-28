/**
 * AUTH-006 CI evidence sanitizer.
 *
 * Repair #2: a failed gate must never publish raw evidence. This script copies a
 * failed run's output into a SEPARATE, explicitly allowlisted sanitized directory,
 * and only what survives every check below is ever eligible for artifact upload:
 *
 *   - TLS material (private keys, the whole tls/ directory) is NEVER copied.
 *   - The run-scoped build checkout (work/) is never copied — build output is not
 *     evidence and would bloat the artifact.
 *   - Only allowlisted file types are considered at all: .log .json .txt .md .png
 *     .zip (Playwright traces/error contexts/screenshots/logs/run-state).
 *   - Symbolic links in the source tree FAIL CLOSED: the link target is never
 *     read and never copied, and every link is recorded as a violation. A link
 *     such as safe.log -> tls/private-key.pem must not smuggle denied material
 *     past the directory/extension/basename rules.
 *   - Credential material is scanned in file CONTENTS, in every file's relative
 *     path/NAME, and in every zip entry NAME as well as its decompressed
 *     content: known token/cookie patterns (SENSITIVE_PATTERNS — shared with the
 *     in-process teardown scan) plus optional literal secrets passed with
 *     --secret. Any hit excludes the file AND records a violation.
 *   - Destination writes cannot escape: each destination path is resolved under
 *     the sanitized root, and every ancestor segment is verified not to be a
 *     pre-existing symbolic link (mkdir/copyFile would otherwise write through
 *     it, outside the sanitized root).
 *   - The sanitized directory is built in a sibling STAGING directory and
 *     published with a single atomic rename ONLY after the full scan reports
 *     zero violations. A failing run (violation or sanitizer error) removes the
 *     staging tree and publishes NOTHING — a partial or unverified sanitized
 *     directory must never exist for CI to upload.
 *
 * Exit code 0 + sanitize-summary.json inside the published directory means: the
 * sanitized directory exists and contains no detected credential material.
 * Exit code 1 means either a violation was detected (the run must fail; nothing
 * was published) or the sanitizer itself failed (also a failure — upload must
 * not happen). The CI upload step is additionally gated on this step's success
 * (see .github/workflows/ci.yml: `failure() && steps.sanitize_auth006.outcome == 'success'`).
 *
 * Usage:
 *   node tests/auth-e2e/scripts/sanitize-evidence.mjs <sourceRoot> <destinationRoot> [--secret <value>]...
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { parseZip } from "../fixtures/zip-reader.mjs";

/**
 * Credential leakage patterns shared with the in-process teardown secret scan
 * (global-teardown.mts). Keep the two in sync through THIS module only.
 */
export const SENSITIVE_PATTERNS = [
  { label: "bearer access token in artifact", regex: /authorization["']?\s*[:=]\s*["']?Bearer\s+eyJ/i },
  { label: "session cookie value in artifact", regex: /mystcrag_session=\s*eyJ/ },
  { label: "__Host- session cookie value in artifact", regex: /__Host-mystcrag_session=\s*eyJ/ },
  {
    label: "unredacted sensitive header pair in trace archive",
    regex: /"name"\s*:\s*"(?:cookie|set-cookie|authorization)"\s*,\s*"value"\s*:\s*"(?!\[REDACTED-AUTH006\])[^"]{12,}/i
  },
  {
    label: "unredacted sensitive header message in trace archive",
    regex: /"message"\s*:\s*"[ \t]*(?:cookie|set-cookie|authorization)[ \t]*:[ \t]*(?![ \t]*\[REDACTED-AUTH006\])[^"]{12,}/i
  },
  {
    label: "unredacted session cookie entry in trace archive",
    regex: /"name"\s*:\s*"mystcrag_session"\s*,\s*"value"\s*:\s*"(?!\[REDACTED-AUTH006\])[^"]{12,}/i
  },
  {
    label: "unredacted __Host- session cookie entry in trace archive",
    regex: /"name"\s*:\s*"__Host-mystcrag_session"\s*,\s*"value"\s*:\s*"(?!\[REDACTED-AUTH006\])[^"]{12,}/i
  },
  {
    label: "unredacted transaction cookie in trace archive",
    regex: /"name"\s*:\s*"__txn_(?![^"]*REDACTED)[^"]{8,}/i
  },
  {
    label: "authorization code or state nonce in recorded URL",
    regex: /[?&](?:code|state|nonce|id_token|access_token|refresh_token|token)=(?!\[REDACTED-AUTH006\])[A-Za-z0-9_\-]{16,}/i
  }
];

const ALLOWED_EXTENSIONS = new Set([".log", ".json", ".txt", ".md", ".png", ".zip"]);
/** Directories that are never evidence: TLS material and the run-scoped build tree. */
const DENIED_DIRECTORIES = new Set(["tls", "work"]);
/** Basenames that are never copied regardless of extension. */
const DENIED_BASENAMES = new Set(["synthetic-provider.key.pem"]);

function scanText(content, secrets) {
  const hits = [];
  for (const secret of secrets) {
    if (secret.length >= 16 && content.includes(secret)) {
      hits.push("literal secret value");
      break;
    }
  }
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.regex.test(content)) {
      hits.push(pattern.label);
    }
  }
  return hits;
}

/**
 * Scans a NAME — a relative file path, a basename, or a zip entry name — for
 * credential material with the exact same detector used for file contents.
 * Credentials can leak through an artifact's filename or a zip member name
 * even when every file body is clean.
 */
function scanName(value, secrets) {
  return scanText(value, secrets);
}

/**
 * Scans every decompressed entry of a zip archive — entry NAMES first, then
 * contents — and returns all hits found.
 */
async function scanZipArchive(archivePath, secrets) {
  const buffer = await fs.readFile(archivePath);
  const entries = parseZip(buffer);
  const hits = [];
  for (const entry of entries) {
    for (const hit of scanName(entry.name, secrets)) {
      hits.push(`entry name ${entry.name}: ${hit}`);
    }
    const text = entry.data.toString("utf8");
    if (!text || text.includes("\u0000")) continue;
    for (const hit of scanText(text, secrets)) {
      hits.push(`${entry.name}: ${hit}`);
    }
  }
  return hits;
}

/**
 * Collects the files of the source tree WITHOUT following symbolic links.
 * Symlinks are reported separately so the caller can fail closed on them
 * (never read, never copied, always a violation). A symlinked directory is
 * never descended into either — its target tree is invisible to the sanitizer.
 */
async function collectFiles(root, relative = "") {
  const files = [];
  const symlinks = [];
  let entries;
  try {
    entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  } catch {
    return { files, symlinks };
  }
  for (const entry of entries) {
    const relativePath = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isSymbolicLink()) {
      symlinks.push(relativePath);
    } else if (entry.isDirectory()) {
      const nested = await collectFiles(root, relativePath);
      files.push(...nested.files);
      symlinks.push(...nested.symlinks);
    } else {
      files.push(relativePath);
    }
  }
  return { files, symlinks };
}

/** True when any path segment names a directory that is never evidence. */
function deniedDirectorySegment(relativePath) {
  return relativePath.split(path.sep).find((segment) => DENIED_DIRECTORIES.has(segment));
}

/**
 * Verifies that the destination path stays inside the sanitized root and that
 * NO segment of its path chain is a pre-existing symbolic link. mkdir and
 * copyFile both write THROUGH symlinks, which would silently move evidence
 * outside the sanitized root; such a chain is reported instead.
 */
async function destinationChainHits(absoluteDestinationRoot, absoluteTargetPath) {
  const hits = [];
  const relative = path.relative(absoluteDestinationRoot, absoluteTargetPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return [`destination escapes the sanitized root: ${absoluteTargetPath}`];
  }
  let current = absoluteDestinationRoot;
  const segments = relative.split(path.sep);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch {
      // Missing from here on: mkdir creates the rest fresh inside the root.
      break;
    }
    if (stat.isSymbolicLink()) {
      hits.push(`symbolic link in destination chain: ${path.relative(absoluteDestinationRoot, current)}`);
      break;
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      // A non-directory blocks the chain; mkdir fails loudly on it later.
      break;
    }
  }
  return hits;
}

export async function sanitizeEvidence(sourceRoot, destinationRoot, options = {}) {
  const secrets = (options.secrets ?? []).filter((value) => typeof value === "string");
  const copied = [];
  const excluded = [];
  const violations = [];

  const absoluteSource = path.resolve(sourceRoot);
  const absoluteDestination = path.resolve(destinationRoot);
  // Stage the sanitized tree NEXT TO the destination (same filesystem, so the
  // final publish is one atomic rename) and only publish on a fully clean scan.
  const stagingRoot = `${absoluteDestination}.staging-${crypto.randomBytes(6).toString("hex")}`;

  const { files, symlinks } = await collectFiles(sourceRoot);

  let fatal = null;
  try {
    await fs.mkdir(stagingRoot, { recursive: true });

    // Source symlinks: fail closed — the target is never read, never copied.
    for (const relativePath of symlinks) {
      violations.push({ path: relativePath, hits: ["symbolic link in run directory (target never read)"] });
      excluded.push({ path: relativePath, reason: "symbolic link (fail closed)" });
    }

    for (const relativePath of files) {
      const basename = path.basename(relativePath);
      const extension = path.extname(relativePath).toLowerCase();
      const sourcePath = path.join(absoluteSource, relativePath);

      const deny = (reason) => {
        excluded.push({ path: relativePath, reason });
      };

      // Denied directories apply at ANY depth: the CI invocation passes the parent
      // of all run directories as the source root, so the check cannot rely on the
      // denied directory being a top-level entry. Every file inside one is excluded
      // AND reported — exclusion that is not reported cannot be audited.
      const deniedSegment = deniedDirectorySegment(relativePath);
      if (deniedSegment) {
        deny(`inside never-copied directory: ${deniedSegment}/`);
        continue;
      }
      if (DENIED_BASENAMES.has(basename) || extension === ".pem" || extension === ".key") {
        deny("TLS material");
        continue;
      }
      if (!ALLOWED_EXTENSIONS.has(extension)) {
        deny("extension not allowlisted");
        continue;
      }

      // Re-verify with lstat IMMEDIATELY BEFORE any read: the tree can change
      // between readdir and now, and a swapped-in symlink must never be read
      // through (fail closed on race, not just on the initial listing).
      const sourceStat = await fs.lstat(sourcePath);
      if (sourceStat.isSymbolicLink()) {
        violations.push({ path: relativePath, hits: ["symbolic link in run directory (target never read)"] });
        deny("symbolic link (fail closed)");
        continue;
      }
      if (!sourceStat.isFile()) {
        violations.push({ path: relativePath, hits: ["not a regular file"] });
        deny("not a regular file");
        continue;
      }

      // Credential material in the path/name itself (not only the contents).
      const nameHits = scanName(relativePath, secrets);
      if (nameHits.length > 0) {
        violations.push({ path: relativePath, hits: nameHits.map((hit) => `file name: ${hit}`) });
        deny(`credential material in file name: ${nameHits.join("; ")}`);
        continue;
      }

      const absoluteTargetPath = path.join(absoluteDestination, relativePath);
      const chainHits = await destinationChainHits(absoluteDestination, absoluteTargetPath);
      if (chainHits.length > 0) {
        violations.push({ path: relativePath, hits: chainHits });
        deny(chainHits.join("; "));
        continue;
      }

      if (extension === ".zip") {
        const hits = await scanZipArchive(sourcePath, secrets);
        if (hits.length > 0) {
          violations.push({ path: relativePath, hits });
          deny(`credential material inside archive: ${hits.join("; ")}`);
          continue;
        }
      } else if (extension !== ".png") {
        const content = await fs.readFile(sourcePath, "utf8");
        const hits = scanText(content, secrets);
        if (hits.length > 0) {
          violations.push({ path: relativePath, hits });
          deny(`credential material: ${hits.join("; ")}`);
          continue;
        }
      }

      const stagingPath = path.join(stagingRoot, relativePath);
      await fs.mkdir(path.dirname(stagingPath), { recursive: true });
      await fs.copyFile(sourcePath, stagingPath);
      copied.push(relativePath);
    }

    const summary = {
      sourceRoot: absoluteSource,
      destinationRoot: absoluteDestination,
      copiedFiles: copied.length,
      copied,
      excluded,
      violations,
      ok: violations.length === 0,
      generatedAt: new Date().toISOString()
    };
    await fs.writeFile(path.join(stagingRoot, "sanitize-summary.json"), JSON.stringify(summary, null, 2), "utf8");

    if (violations.length === 0) {
      // Atomic publish: replace any previous sanitized directory with the fully
      // scanned, fully clean staging tree in one rename. The staging path lives
      // next to the destination so this never crosses a filesystem boundary.
      await fs.rm(absoluteDestination, { recursive: true, force: true });
      await fs.rename(stagingRoot, absoluteDestination);
    } else {
      // Fail closed: nothing is published. The staging tree is deleted so no
      // partial sanitized directory can ever be uploaded.
      await fs.rm(stagingRoot, { recursive: true, force: true });
    }
  } catch (error) {
    fatal = error;
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }

  if (fatal !== null) {
    // The sanitizer itself failed — nothing was published; the run must fail.
    throw fatal;
  }

  return {
    sourceRoot: absoluteSource,
    destinationRoot: absoluteDestination,
    copiedFiles: copied.length,
    copied,
    excluded,
    violations,
    ok: violations.length === 0,
    generatedAt: new Date().toISOString()
  };
}

async function main() {
  const [sourceRoot, destinationRoot, ...rest] = process.argv.slice(2);
  if (!sourceRoot || !destinationRoot) {
    console.error("usage: node sanitize-evidence.mjs <sourceRoot> <destinationRoot> [--secret <value>]...");
    process.exit(1);
  }
  const secrets = [];
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--secret" && rest[index + 1] !== undefined) {
      secrets.push(rest[index + 1]);
      index += 1;
    }
  }

  let summary;
  try {
    summary = await sanitizeEvidence(sourceRoot, destinationRoot, { secrets });
  } catch (error) {
    console.error(`[auth-006-sanitize] FAILED: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  console.log(`[auth-006-sanitize] copied ${summary.copiedFiles} files, excluded ${summary.excluded.length}`);
  if (summary.violations.length > 0) {
    console.error("[auth-006-sanitize] credential material detected — NOTHING was published:");
    for (const violation of summary.violations) {
      console.error(`  - ${violation.path}: ${violation.hits.join("; ")}`);
    }
    process.exit(1);
  }
  console.log(`[auth-006-sanitize] sanitized evidence ready at ${path.resolve(destinationRoot)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url)) {
  await main();
}
