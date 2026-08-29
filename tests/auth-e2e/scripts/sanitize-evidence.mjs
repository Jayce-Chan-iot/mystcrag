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
 *     past the directory/extension/basename rules. This is enforced TWICE: once
 *     at collection (dirent type) and once at OPEN time — every file is opened
 *     with O_NOFOLLOW, so a file swapped for a symlink between the directory
 *     listing and the open fails closed too (ELOOP), never reading the target.
 *   - Each file is opened EXACTLY ONCE with O_NOFOLLOW; the descriptor is fstat-ed
 *     (regular file required) and the SAME bytes read from that ONE descriptor are
 *     both scanned AND written to staging — there is no second path-based read
 *     (readFile/copyFile by path) that a TOCTOU swap could redirect. Zip archives
 *     are parsed from those same already-read bytes, never re-opened by path.
 *   - Traversal failures are fatal: a failed readdir (unreadable directory,
 *     vanished root) throws — it is never mistaken for an empty directory. An
 *     unreadable/unopenable/vanished FILE is a recorded violation (fail closed),
 *     never a silent skip.
 *   - Credential material is scanned in file CONTENTS, in every file's relative
 *     path/NAME, and in every zip entry NAME as well as its decompressed
 *     content: known token/cookie patterns (SENSITIVE_PATTERNS — shared with the
 *     in-process teardown scan) plus literal run secrets read from explicitly
 *     named ENVIRONMENT variables. Any hit excludes the file AND records a
 *     violation.
 *   - Secrets never travel on the command line (argv is visible in process
 *     listings): the CLI reads AUTH006_CLIENT_SECRET, AUTH006_SESSION_SECRET and
 *     AUTH006_ADMIN_TOKEN from the environment only.
 *   - The CLI's stdout/stderr never print a hit's original path, zip entry name,
 *     secret value or credential content — only sanitized categories, counts and
 *     opaque references. (The full violation detail — including paths — stays in
 *     the in-process return value and, on clean runs, in the published summary,
 *     where there are no violations at all; a dirty run's staging summary is
 *     deleted before anything is published.)
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
 *   node tests/auth-e2e/scripts/sanitize-evidence.mjs <sourceRoot> <destinationRoot>
 *
 * Secrets are read from the environment: AUTH006_CLIENT_SECRET,
 * AUTH006_SESSION_SECRET, AUTH006_ADMIN_TOKEN.
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

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

/** Run secrets enter ONLY through these named environment variables, never argv. */
export const SECRET_ENV_NAMES = ["AUTH006_CLIENT_SECRET", "AUTH006_SESSION_SECRET", "AUTH006_ADMIN_TOKEN"];

const ALLOWED_EXTENSIONS = new Set([".log", ".json", ".txt", ".md", ".png", ".zip"]);
/** Directories that are never evidence: TLS material and the run-scoped build tree. */
const DENIED_DIRECTORIES = new Set(["tls", "work"]);
/** Basenames that are never copied regardless of extension. */
const DENIED_BASENAMES = new Set(["synthetic-provider.key.pem"]);

/**
 * Sanitized violation categories. These labels are the ONLY thing the CLI ever
 * prints about a hit: the original path, the zip entry name and any credential
 * content stay out of stdout/stderr.
 */
const CATEGORY = {
  SYMBOLIC_LINK: "symbolic-link-in-source",
  NOT_REGULAR_FILE: "not-a-regular-file",
  SOURCE_READ_FAILURE: "source-read-failure",
  CREDENTIAL_IN_NAME: "credential-in-name",
  CREDENTIAL_IN_CONTENT: "credential-in-content",
  CREDENTIAL_IN_ARCHIVE: "credential-in-archive",
  MALFORMED_ARCHIVE: "malformed-archive",
  DESTINATION_CHAIN: "destination-chain-symbolic-link"
};

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
 * Scans every entry of a zip archive that was ALREADY read into memory (the
 * single-descriptor bytes — the archive is never re-opened by path) and returns
 * all hits found. Hits reference entries by INDEX only: a secret-bearing entry
 * NAME must never be embedded in any message this module produces.
 */
function scanZipEntries(entries, secrets) {
  const hits = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    for (const hit of scanName(entry.name, secrets)) {
      hits.push(`zip entry #${index} name: ${hit}`);
    }
    const text = entry.data.toString("utf8");
    if (!text || text.includes("\u0000")) continue;
    for (const hit of scanText(text, secrets)) {
      hits.push(`zip entry #${index} content: ${hit}`);
    }
  }
  return hits;
}

/**
 * Collects the files of the source tree WITHOUT following symbolic links.
 * Symlinks are reported separately so the caller can fail closed on them
 * (never read, never copied, always a violation). A symlinked directory is
 * never descended into either — its target tree is invisible to the sanitizer.
 *
 * A readdir failure is FATAL (thrown): an unreadable or vanished directory must
 * never be mistaken for an empty one and silently published as "clean".
 */
async function collectFiles(root, relative = "") {
  const entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  const symlinks = [];
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
 * writeFile both write THROUGH symlinks, which would silently move evidence
 * outside the sanitized root; such a chain is reported instead.
 */
async function destinationChainHits(absoluteDestinationRoot, absoluteTargetPath) {
  const hits = [];
  const relative = path.relative(absoluteDestinationRoot, absoluteTargetPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return [`destination escapes the sanitized root`];
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
      hits.push(`symbolic link in destination chain`);
      break;
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      // A non-directory blocks the chain; mkdir fails loudly on it later.
      break;
    }
  }
  return hits;
}

// O_NONBLOCK makes a swapped-in FIFO fail fast at open (a blocking O_RDONLY on a
// FIFO would hang the sanitizer); it is a no-op for regular files.
const OPEN_FLAGS =
  fs.constants.O_NOFOLLOW !== undefined
    ? fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | (fs.constants.O_NONBLOCK ?? 0)
    : fs.constants.O_RDONLY;

/**
 * Reads one file through a SINGLE descriptor opened with O_NOFOLLOW: the fstat
 * proves it is a regular file, and the bytes returned are the bytes scanned and
 * published. A file swapped for a symlink after the directory listing fails the
 * open with ELOOP (violation); a vanished or unreadable file fails closed as a
 * violation too — never a silent skip, never an empty read treated as success.
 */
async function openAndReadRegularFile(sourcePath) {
  let handle;
  try {
    handle = await fs.open(sourcePath, OPEN_FLAGS);
    // FileHandle exposes fstat(2) as .stat() — Node's FileHandle has no .fstat()
    // method, and calling it threw for EVERY file (misreported as a
    // source-read-failure, failing closed on clean sources too).
    const stat = await handle.stat();
    if (!stat.isFile()) {
      return { ok: false, reason: CATEGORY.NOT_REGULAR_FILE };
    }
    const bytes = await handle.readFile();
    return { ok: true, bytes };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ELOOP") {
      return { ok: false, reason: CATEGORY.SYMBOLIC_LINK };
    }
    return { ok: false, reason: CATEGORY.SOURCE_READ_FAILURE };
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    }
  }
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
      violations.push({
        path: relativePath,
        hits: ["symbolic link in run directory (target never read)"],
        categories: [CATEGORY.SYMBOLIC_LINK]
      });
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

      // Credential material in the path/name itself (not only the contents).
      const nameHits = scanName(relativePath, secrets);
      if (nameHits.length > 0) {
        violations.push({
          path: relativePath,
          hits: nameHits.map((hit) => `file name: ${hit}`),
          categories: [CATEGORY.CREDENTIAL_IN_NAME]
        });
        deny(`credential material in file name: ${nameHits.join("; ")}`);
        continue;
      }

      const absoluteTargetPath = path.join(absoluteDestination, relativePath);
      const chainHits = await destinationChainHits(absoluteDestination, absoluteTargetPath);
      if (chainHits.length > 0) {
        violations.push({
          path: relativePath,
          hits: chainHits,
          categories: [CATEGORY.DESTINATION_CHAIN]
        });
        deny(chainHits.join("; "));
        continue;
      }

      // ONE descriptor, ONE read: the bytes scanned below are the bytes written
      // to staging. No path-based readFile/copyFile exists anywhere in this loop.
      const read = await openAndReadRegularFile(sourcePath);
      if (!read.ok) {
        const reason =
          read.reason === CATEGORY.SYMBOLIC_LINK
            ? "symbolic link in run directory (target never read)"
            : read.reason === CATEGORY.NOT_REGULAR_FILE
              ? "not a regular file"
              : "source read failure (fail closed)";
        violations.push({ path: relativePath, hits: [reason], categories: [read.reason] });
        deny(reason);
        continue;
      }
      const bytes = read.bytes;

      if (extension === ".zip") {
        let zipEntries;
        try {
          zipEntries = parseZip(bytes);
        } catch {
          violations.push({
            path: relativePath,
            hits: ["malformed archive (fail closed)"],
            categories: [CATEGORY.MALFORMED_ARCHIVE]
          });
          deny("malformed archive (fail closed)");
          continue;
        }
        const hits = scanZipEntries(zipEntries, secrets);
        if (hits.length > 0) {
          violations.push({
            path: relativePath,
            hits,
            categories: [CATEGORY.CREDENTIAL_IN_ARCHIVE]
          });
          deny(`credential material inside archive: ${hits.join("; ")}`);
          continue;
        }
      } else if (extension !== ".png") {
        const content = bytes.toString("utf8");
        const hits = scanText(content, secrets);
        if (hits.length > 0) {
          violations.push({
            path: relativePath,
            hits,
            categories: [CATEGORY.CREDENTIAL_IN_CONTENT]
          });
          deny(`credential material: ${hits.join("; ")}`);
          continue;
        }
      }

      const stagingPath = path.join(stagingRoot, relativePath);
      await fs.mkdir(path.dirname(stagingPath), { recursive: true });
      // The SAME bytes read from the single descriptor are written to staging.
      // "wx" fails loudly on an unexpected pre-existing file instead of
      // overwriting anything.
      await fs.writeFile(stagingPath, bytes, { flag: "wx" });
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

/** Counts violations per sanitized category — the only violation detail the CLI prints. */
function countViolationCategories(violations) {
  const counts = new Map();
  for (const violation of violations) {
    for (const category of violation.categories ?? []) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }
  return counts;
}

async function main() {
  const args = process.argv.slice(2);
  const [sourceRoot, destinationRoot, ...rest] = args;
  if (!sourceRoot || !destinationRoot || rest.length > 0) {
    console.error("usage: node tests/auth-e2e/scripts/sanitize-evidence.mjs <sourceRoot> <destinationRoot>");
    console.error("run secrets are read from the environment (never the command line): AUTH006_CLIENT_SECRET, AUTH006_SESSION_SECRET, AUTH006_ADMIN_TOKEN");
    process.exit(1);
  }

  const secrets = SECRET_ENV_NAMES.map((name) => process.env[name] ?? "").filter((value) => value.length >= 16);

  let summary;
  try {
    summary = await sanitizeEvidence(sourceRoot, destinationRoot, { secrets });
  } catch (error) {
    // The error's message can embed source paths — it is never printed. Only the
    // stable error code and an opaque digest reach the log.
    const reference = crypto
      .createHash("sha256")
      .update(String(error && typeof error === "object" && error.message ? error.message : error))
      .digest("hex")
      .slice(0, 12);
    const code = (error && typeof error === "object" && error.code) || "unknown";
    console.error(`[auth-006-sanitize] FAILED: source traversal or read failed (code ${code}, ref ${reference}) — NOTHING was published`);
    process.exit(1);
  }

  console.log(
    `[auth-006-sanitize] copied ${summary.copiedFiles} files, excluded ${summary.excluded.length}, run secrets from env: ${secrets.length}`
  );
  if (summary.violations.length > 0) {
    const counts = countViolationCategories(summary.violations);
    const detail = [...counts].map(([category, count]) => `${category} x${count}`).join(", ");
    console.error(
      `[auth-006-sanitize] credential material detected — NOTHING was published ` +
        `(${summary.violations.length} violation(s): ${detail})`
    );
    process.exit(1);
  }
  console.log(`[auth-006-sanitize] sanitized evidence ready at ${path.resolve(destinationRoot)}`);
}

// CLI entry: import.meta.url is a file:// URL — it MUST be converted with
// fileURLToPath before being compared to process.argv[1] (resolving the URL
// string as a path never matches, so the CLI silently exited 0 without running).
const CLI_MODULE_PATH = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === CLI_MODULE_PATH) {
  main();
}
