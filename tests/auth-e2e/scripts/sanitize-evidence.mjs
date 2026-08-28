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
 *   - Every text file is scanned for credential material BEFORE copying: known
 *     token/cookie patterns (SENSITIVE_PATTERNS — shared with the in-process
 *     teardown scan) plus optional literal secrets passed with --secret. A file
 *     that trips the scan is EXCLUDED from the sanitized directory and recorded as
 *     a violation.
 *   - Trace archives (.zip) are opened and every decompressed entry is scanned the
 *     same way; the archive is copied only when every entry is clean.
 *
 * Exit code 0 + summary.json means: a sanitized directory exists and contains no
 * detected credential material. Exit code 1 means either a violation was detected
 * (the run must fail; nothing sensitive was copied) or the sanitizer itself failed
 * (also a failure — upload must not happen). The CI upload step is gated on this
 * step's success, so any failure here leaves the sensitive files on the runner
 * only, never in an artifact.
 *
 * Usage:
 *   node tests/auth-e2e/scripts/sanitize-evidence.mjs <sourceRoot> <destinationRoot> [--secret <value>]...
 */

import fs from "node:fs/promises";
import path from "node:path";

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

/** Scans every decompressed entry of a zip archive; returns all hits found. */
async function scanZipArchive(archivePath, secrets) {
  const buffer = await fs.readFile(archivePath);
  const entries = parseZip(buffer);
  const hits = [];
  for (const entry of entries) {
    const text = entry.data.toString("utf8");
    if (!text || text.includes("\u0000")) continue;
    for (const hit of scanText(text, secrets)) {
      hits.push(`${entry.name}: ${hit}`);
    }
  }
  return hits;
}

async function collectFiles(root, relative = "") {
  const files = [];
  let entries;
  try {
    entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const relativePath = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(root, relativePath)));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

/** True when any path segment names a directory that is never evidence. */
function deniedDirectorySegment(relativePath) {
  return relativePath.split(path.sep).find((segment) => DENIED_DIRECTORIES.has(segment));
}

export async function sanitizeEvidence(sourceRoot, destinationRoot, options = {}) {
  const secrets = (options.secrets ?? []).filter((value) => typeof value === "string");
  const copied = [];
  const excluded = [];
  const violations = [];

  const files = await collectFiles(sourceRoot);
  await fs.mkdir(destinationRoot, { recursive: true });

  for (const relativePath of files) {
    const basename = path.basename(relativePath);
    const extension = path.extname(relativePath).toLowerCase();
    const sourcePath = path.join(sourceRoot, relativePath);

    const deny = (reason) => {
      excluded.push({ path: relativePath, reason });
      return null;
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

    try {
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
      const destinationPath = path.join(destinationRoot, relativePath);
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.copyFile(sourcePath, destinationPath);
      copied.push(relativePath);
    } catch (error) {
      // The sanitizer itself failed on this file — treat as a violation, never copy.
      violations.push({ path: relativePath, hits: [`unreadable: ${error instanceof Error ? error.message : error}`] });
      excluded.push({ path: relativePath, reason: "sanitizer error" });
    }
  }

  const summary = {
    sourceRoot: path.resolve(sourceRoot),
    destinationRoot: path.resolve(destinationRoot),
    copiedFiles: copied.length,
    copied,
    excluded,
    violations,
    ok: violations.length === 0,
    generatedAt: new Date().toISOString()
  };
  await fs.writeFile(path.join(destinationRoot, "sanitize-summary.json"), JSON.stringify(summary, null, 2), "utf8");
  return summary;
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
    console.error("[auth-006-sanitize] credential material detected — affected files were NOT copied:");
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
