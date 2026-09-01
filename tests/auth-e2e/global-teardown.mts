/**
 * AUTH-006 global teardown:
 *
 * 1. stops every process this run started — backend, both frontends, negative-config
 *    spawns, provider, CONNECT relay, TLS reverse proxies. Recovered pids are verified
 *    against the run-scoped ownership signature — CURRENT command line AND run-scoped
 *    working directory — BEFORE any signal; a foreign (recycled) pid is never
 *    signalled and fails teardown loudly. Any stop failure fails the run.
 * 2. verifies every port of the run-scoped plan was released, and drops + verifies
 *    gone the isolated database (name pattern asserted before any CREATE/DROP).
 *    Cleanup failures are never swallowed: the gate fails.
 * 3. redacts credential-bearing header values (cookie / set-cookie / authorization)
 *    from every retained Playwright trace archive — failed-run evidence must stay
 *    debuggable but may never retain session or transaction material
 * 4. scans every retained artifact of the run for the run's secrets — client
 *    secret, session secret, provider admin token — plus token/cookie leakage
 *    patterns, including the DECOMPRESSED content of the redacted trace archives.
 *    Any hit fails the run: secrets must never be written to logs or artifacts.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { stopIsolatedStack, resolveRunDirectory } from "./fixtures/stack";
import { extractTraceTexts, redactTraceArchives } from "./fixtures/trace-redact";
import { SENSITIVE_PATTERNS } from "./scripts/sanitize-evidence.mjs";

const SECRET_NAMES = ["AUTH006_CLIENT_SECRET", "AUTH006_SESSION_SECRET", "AUTH006_ADMIN_TOKEN"] as const;

async function collectTextFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTextFiles(target)));
    } else if (/\.(?:log|json|txt|md|har|jsonl)$/i.test(entry.name) || entry.name.startsWith("error-context")) {
      files.push(target);
    }
  }
  return files;
}

async function scanForSecretLeaks(): Promise<void> {
  const runDirectory = resolveRunDirectory();
  const secrets = SECRET_NAMES.map((name) => ({ name, value: process.env[name] ?? "" }))
    .filter((entry) => entry.value.length >= 16);

  const patterns = SENSITIVE_PATTERNS.map((pattern) => ({
    label: pattern.label,
    regex: new RegExp(pattern.regex.source, pattern.regex.flags)
  }));

  const violations: string[] = [];
  const files = await collectTextFiles(runDirectory);
  for (const file of files) {
    const content = await fs.readFile(file, "utf8").catch(() => "");
    if (!content) continue;
    for (const secret of secrets) {
      if (content.includes(secret.value)) {
        violations.push(`${path.relative(runDirectory, file)} contains ${secret.name}`);
      }
    }
    for (const pattern of patterns) {
      if (pattern.regex.test(content)) {
        violations.push(`${path.relative(runDirectory, file)} contains ${pattern.label}`);
      }
    }
  }

  const traceTexts = await extractTraceTexts(runDirectory);
  for (const entry of traceTexts) {
    for (const secret of secrets) {
      if (entry.text.includes(secret.value)) {
        violations.push(`${entry.archive}!${entry.name} contains ${secret.name}`);
      }
    }
    for (const pattern of patterns) {
      if (pattern.regex.test(entry.text)) {
        violations.push(`${entry.archive}!${entry.name} contains ${pattern.label}`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`AUTH-006 artifact secret scan FAILED:\n  ${violations.join("\n  ")}`);
  }
  console.log(
    `[auth-006] artifact secret scan passed (${files.length} text files, ${traceTexts.length} trace entries scanned)`
  );
}

export default async function globalTeardown(): Promise<void> {
  await stopIsolatedStack();
  console.log("[auth-006] stack stopped, owned ports released, isolated database dropped and verified gone");
  const redaction = await redactTraceArchives(resolveRunDirectory());
  console.log(
    `[auth-006] redacted ${redaction.archives} trace archives (${redaction.redactedHeaderValues} sensitive header values)`
  );
  await scanForSecretLeaks();
  console.log(`[auth-006] run torn down cleanly`);
}
