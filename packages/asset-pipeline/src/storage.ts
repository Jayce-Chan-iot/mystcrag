import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { dirname, join, sep } from "node:path";

import { normalizeAssetRelativePath } from "@mystcrag/design-contract";

import { sha256OfBytes, sha256OfFile } from "./hash.js";
import { probeRegularFile, readRegularFile } from "./safe-read.js";

export type ArchiveStoreErrorCode =
  | "ARCHIVE_ROOT_MISSING"
  | "ARCHIVE_ROOT_INSIDE_REPOSITORY"
  | "REPOSITORY_ROOT_INVALID"
  | "KEY_INVALID"
  | "HASH_MISMATCH"
  | "KEY_EXISTS_CONTENT_MISMATCH"
  | "WRITE_FAILED"
  | "READ_FAILED";

export class ArchiveStoreError extends Error {
  readonly code: ArchiveStoreErrorCode;

  constructor(code: ArchiveStoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const STAGING_KEY_PATTERN =
  /^imports\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/staging\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const ORIGINAL_EXTENSIONS = new Set(["arw", "jpg", "jpeg", "png", "webp"]);

export const PROCESSED_ARCHIVE_FILE_NAMES = ["bead-512.webp", "thumb-256.webp", "manifest.json"] as const;
export type ProcessedArchiveFileName = (typeof PROCESSED_ARCHIVE_FILE_NAMES)[number];
const PROCESSED_FILE_NAMES: ReadonlySet<string> = new Set(PROCESSED_ARCHIVE_FILE_NAMES);

const KEY_PREFIX = "imports";

export type ArchivePutResult = {
  archiveKey: string;
  sha256: string;
  byteSize: number;
  reused: boolean;
};

export type ArchiveStoreOptions = {
  root: string;
  repositoryRoots: readonly string[];
};

/**
 * Immutable local archive below `MYSTCRAG_ASSET_ARCHIVE_ROOT` (spec §5.4).
 * Layout (single adapter; the design-spec layout is authoritative):
 *
 *   imports/<session-id>/raw/<sha256>.<ext>
 *   imports/<session-id>/processed/<group-id>/v<version>/{bead-512.webp,thumb-256.webp,manifest.json}
 *   imports/<session-id>/tmp/…            (staging, never a business key)
 *
 * Every write goes through a session temp file, is fsynced, re-read and
 * verified (size + SHA-256) before an atomic no-overwrite link+unlink into
 * its final key. A key that already exists may only be reused when its
 * stored content still hashes to the same digest — same-name overwrite is
 * impossible by construction. Source files are never written to.
 */
export class ArchiveStore {
  private readonly rootReal: string;

  constructor(options: ArchiveStoreOptions) {
    const { root, repositoryRoots } = options;
    if (typeof root !== "string" || root.trim().length === 0) {
      throw new ArchiveStoreError("ARCHIVE_ROOT_MISSING", "The archive root is required");
    }
    let rootReal: string;
    try {
      rootReal = realpathSync(root);
      if (!statSync(rootReal).isDirectory()) {
        throw new Error("not a directory");
      }
    } catch {
      throw new ArchiveStoreError("ARCHIVE_ROOT_MISSING", `Archive root ${root} does not exist`);
    }
    for (const repositoryRoot of repositoryRoots) {
      if (typeof repositoryRoot !== "string" || repositoryRoot.length === 0) continue;
      let repoReal: string;
      try {
        repoReal = realpathSync(repositoryRoot);
        if (!statSync(repoReal).isDirectory()) {
          throw new Error("not a directory");
        }
      } catch (error) {
        // A supplied root that cannot be resolved is a fail-closed condition:
        // skipping it would silently shrink the set of protected trees.
        throw new ArchiveStoreError(
          "REPOSITORY_ROOT_INVALID",
          `Repository root ${repositoryRoot} cannot be resolved; cannot prove the archive root is outside every repository`,
          { cause: error }
        );
      }
      if (rootReal === repoReal || rootReal.startsWith(repoReal + sep)) {
        throw new ArchiveStoreError(
          "ARCHIVE_ROOT_INSIDE_REPOSITORY",
          `Archive root ${root} resolves inside the Git repository ${repositoryRoot}; originals must never be committed`
        );
      }
    }
    this.rootReal = rootReal;
  }

  static fromEnvironment(options: {
    repositoryRoots: readonly string[];
    env?: Record<string, string | undefined>;
  }): ArchiveStore {
    const env = options.env ?? process.env;
    const root = env.MYSTCRAG_ASSET_ARCHIVE_ROOT;
    if (typeof root !== "string" || root.trim().length === 0) {
      throw new ArchiveStoreError(
        "ARCHIVE_ROOT_MISSING",
        "MYSTCRAG_ASSET_ARCHIVE_ROOT must point at an existing directory outside every Git worktree"
      );
    }
    return new ArchiveStore({ root, repositoryRoots: options.repositoryRoots });
  }

  get root(): string {
    return this.rootReal;
  }

  async putOriginal(input: {
    sessionId: string;
    bytes: Uint8Array;
    sha256: string;
    extension: string;
  }): Promise<ArchivePutResult> {
    assertIdentifier(input.sessionId, "session id");
    assertSha256(input.sha256);
    if (typeof input.extension !== "string" || !ORIGINAL_EXTENSIONS.has(input.extension)) {
      throw new ArchiveStoreError("KEY_INVALID", `Unsupported original extension ${String(input.extension)}`);
    }
    const actual = sha256OfBytes(input.bytes);
    if (actual !== input.sha256) {
      throw new ArchiveStoreError(
        "HASH_MISMATCH",
        "Payload does not hash to the claimed SHA-256; refusing to archive"
      );
    }
    const archiveKey = `imports/${input.sessionId}/raw/${input.sha256}.${input.extension}`;
    return this.verifiedPut(archiveKey, input.bytes, input.sha256);
  }

  async putProcessed(input: {
    sessionId: string;
    groupId: string;
    processingVersion: number;
    fileName: string;
    bytes: Uint8Array;
  }): Promise<ArchivePutResult> {
    assertIdentifier(input.sessionId, "session id");
    assertIdentifier(input.groupId, "group id");
    if (!Number.isSafeInteger(input.processingVersion) || input.processingVersion < 1) {
      throw new ArchiveStoreError("KEY_INVALID", "processingVersion must be a positive safe integer");
    }
    if (typeof input.fileName !== "string" || !PROCESSED_FILE_NAMES.has(input.fileName)) {
      throw new ArchiveStoreError("KEY_INVALID", `Unsupported processed file name ${String(input.fileName)}`);
    }
    const archiveKey = `imports/${input.sessionId}/processed/${input.groupId}/v${input.processingVersion}/${input.fileName}`;
    return this.verifiedPut(archiveKey, input.bytes, sha256OfBytes(input.bytes));
  }

  async read(archiveKey: string): Promise<Uint8Array> {
    assertArchiveKey(archiveKey);
    let outcome: Awaited<ReturnType<typeof readRegularFile>>;
    try {
      const target = await this.joinUnderRoot(archiveKey);
      outcome = await readRegularFile(target);
    } catch (error) {
      if (error instanceof ArchiveStoreError) throw error;
      throw new ArchiveStoreError("READ_FAILED", `Failed to read ${redactKey(archiveKey)}`, { cause: error });
    }
    if (outcome.status !== "read") {
      throw new ArchiveStoreError("KEY_INVALID", "Archive key does not resolve to a stored file");
    }
    return outcome.bytes;
  }

  /**
   * Lands an uploaded payload in the session staging area under a fresh
   * server-generated UUID key. Staging is the only mutable area of the
   * archive: entries exist between upload and archival and are removed by the
   * ARCHIVE_FILE stage once the verified original is linked into raw/.
   */
  async putStaging(input: { sessionId: string; bytes: Uint8Array }): Promise<ArchivePutResult> {
    assertIdentifier(input.sessionId, "session id");
    const sha256 = sha256OfBytes(input.bytes);
    const archiveKey = `imports/${input.sessionId}/staging/${randomUUID()}`;
    return this.verifiedPut(archiveKey, input.bytes, sha256);
  }

  /**
   * Removes a staging entry. Only ENOENT is an idempotent no-op: a key that
   * cannot be inspected (permissions) or that does not hold a regular file
   * fails closed instead of pretending the entry was already consumed. Only
   * staging keys — verified through the strict parser that putStaging's key
   * grammar defines — are removable; raw and processed keys are immutable.
   */
  async removeStaging(archiveKey: string): Promise<void> {
    if (typeof archiveKey !== "string" || !STAGING_KEY_PATTERN.test(archiveKey)) {
      throw new ArchiveStoreError(
        "KEY_INVALID",
        "Only staging keys of the form imports/<sessionId>/staging/<uuid> can be removed"
      );
    }
    let probe: Awaited<ReturnType<typeof probeRegularFile>>;
    let target: string;
    try {
      target = await this.joinUnderRoot(archiveKey);
      probe = await probeRegularFile(target);
    } catch (error) {
      if (error instanceof ArchiveStoreError) throw error;
      throw new ArchiveStoreError("WRITE_FAILED", `Failed to inspect staging entry ${redactKey(archiveKey)}`, {
        cause: error
      });
    }
    if (probe === "missing") return;
    if (probe === "not-regular") {
      throw new ArchiveStoreError("KEY_INVALID", "Staging key does not resolve to a staged file");
    }
    try {
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new ArchiveStoreError("WRITE_FAILED", `Failed to remove staging entry ${redactKey(archiveKey)}`, {
        cause: error
      });
    }
  }

  async verifiedRead(archiveKey: string, expectedSha256: string): Promise<Uint8Array> {
    assertSha256(expectedSha256);
    const bytes = await this.read(archiveKey);
    if (sha256OfBytes(bytes) !== expectedSha256) {
      throw new ArchiveStoreError(
        "HASH_MISMATCH",
        `Stored content of ${redactKey(archiveKey)} does not match the expected SHA-256`
      );
    }
    return bytes;
  }

  async listSessionFiles(sessionId: string): Promise<string[]> {
    assertIdentifier(sessionId, "session id");
    const sessionDir = join(this.rootReal, KEY_PREFIX, sessionId);
    const results: string[] = [];
    await this.walkFiles(sessionDir, `${KEY_PREFIX}/${sessionId}`, results, true);
    return results.sort();
  }

  private async walkFiles(
    directory: string,
    prefix: string,
    results: string[],
    missingMeansEmpty: boolean
  ): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      // Only a directory that does not exist may read as an empty listing; an
      // unreadable one must surface as READ_FAILED instead of pretending the
      // session holds nothing.
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && missingMeansEmpty) return;
      throw new ArchiveStoreError("READ_FAILED", `Failed to list ${redactKey(prefix)}`, { cause: error });
    }
    for (const entry of entries) {
      const entryKey = `${prefix}/${entry.name}`;
      if (entry.isSymbolicLink()) continue; // never listed, never followed
      if (entry.isDirectory()) {
        await this.walkFiles(join(directory, entry.name), entryKey, results, false);
      } else if (entry.isFile()) {
        results.push(entryKey);
      }
    }
  }

  private async verifiedPut(archiveKey: string, bytes: Uint8Array, sha256: string): Promise<ArchivePutResult> {
    let tempPath: string | undefined;
    try {
      const target = await this.resolveWritablePath(archiveKey);
      const existing = await readExistingRegularFile(target);
      if (existing !== null) {
        if (sha256OfBytes(existing) === sha256) {
          await syncDirectoryMetadata(dirname(target));
          return { archiveKey, sha256, byteSize: existing.byteLength, reused: true };
        }
        throw new ArchiveStoreError(
          "KEY_EXISTS_CONTENT_MISMATCH",
          "Archive key already holds different content; overwriting is forbidden"
        );
      }

      const sessionId = archiveKey.split("/")[1]!;
      const tempDir = join(this.rootReal, KEY_PREFIX, sessionId, "tmp");
      tempPath = join(tempDir, `${randomUUID()}.tmp`);
      await mkdir(tempDir, { recursive: true });
      const handle = await open(tempPath, "w");
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }

      const verified = await sha256OfFile(tempPath);
      if (verified.sha256 !== sha256 || verified.byteSize !== bytes.byteLength) {
        throw new ArchiveStoreError(
          "HASH_MISMATCH",
          "Temp archive file failed size or SHA-256 verification after write"
        );
      }

      await mkdir(dirname(target), { recursive: true });
      // Re-verify every ancestor after the mkdir: freshly created segments and
      // the segments between the first walk and the link must still be real
      // directories, never swapped-in symlinks.
      await this.joinUnderRoot(archiveKey);
      try {
        await link(tempPath, target);
      } catch (error) {
        if (isLinkExistsError(error)) {
          const raced = await readExistingRegularFile(target);
          if (raced !== null && sha256OfBytes(raced) === sha256) {
            await syncDirectoryMetadata(dirname(target));
            return { archiveKey, sha256, byteSize: raced.byteLength, reused: true };
          }
          throw new ArchiveStoreError(
            "KEY_EXISTS_CONTENT_MISMATCH",
            "Archive key already holds different content; overwriting is forbidden"
          );
        }
        throw error;
      }
      await syncDirectoryMetadata(dirname(target));
      return { archiveKey, sha256, byteSize: bytes.byteLength, reused: false };
    } catch (error) {
      if (error instanceof ArchiveStoreError) throw error;
      throw new ArchiveStoreError("WRITE_FAILED", `Failed to archive ${redactKey(archiveKey)}`, {
        cause: error
      });
    } finally {
      if (tempPath !== undefined) {
        await unlink(tempPath).catch(() => undefined);
      }
    }
  }

  private async resolveWritablePath(archiveKey: string): Promise<string> {
    assertArchiveKey(archiveKey);
    return this.joinUnderRoot(archiveKey);
  }

  private async joinUnderRoot(archiveKey: string): Promise<string> {
    let current = this.rootReal;
    const segments = archiveKey.split("/");
    for (const [index, segment] of segments.entries()) {
      current = join(current, segment);
      let info;
      try {
        info = await lstat(current);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") continue;
        if (code === "ENOTDIR") {
          throw new ArchiveStoreError("KEY_INVALID", "An archive key ancestor is not a directory", {
            cause: error
          });
        }
        throw error;
      }
      if (info.isSymbolicLink()) {
        throw new ArchiveStoreError("KEY_INVALID", "Archive keys must not traverse symbolic links");
      }
      if (index < segments.length - 1 && !info.isDirectory()) {
        throw new ArchiveStoreError("KEY_INVALID", "An archive key ancestor is not a directory");
      }
    }
    return current;
  }
}

function assertIdentifier(value: string, field: string): void {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new ArchiveStoreError("KEY_INVALID", `Invalid archive ${field}`);
  }
}

function assertSha256(value: string): void {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new ArchiveStoreError("KEY_INVALID", "SHA-256 must be 64 lowercase hex characters");
  }
}

function assertArchiveKey(archiveKey: string): void {
  if (typeof archiveKey !== "string" || archiveKey.length === 0) {
    throw new ArchiveStoreError("KEY_INVALID", "Archive key is required");
  }
  let normalized: string;
  try {
    normalized = normalizeAssetRelativePath(archiveKey);
  } catch (error) {
    throw new ArchiveStoreError("KEY_INVALID", "Archive key is not a safe relative path", { cause: error });
  }
  if (normalized !== archiveKey) {
    throw new ArchiveStoreError("KEY_INVALID", "Archive key is not in normalized form");
  }
  if (!archiveKey.startsWith(`${KEY_PREFIX}/`)) {
    throw new ArchiveStoreError("KEY_INVALID", "Archive keys must live below imports/");
  }
}

function redactKey(archiveKey: string): string {
  const segments = archiveKey.split("/");
  return segments.length > 1 ? `${segments[0]}/…/${segments.at(-1)}` : archiveKey;
}

/** Existing content at a key, read through the same verified descriptor. */
async function readExistingRegularFile(path: string): Promise<Uint8Array | null> {
  const outcome = await readRegularFile(path);
  return outcome.status === "read" ? outcome.bytes : null;
}

/**
 * Fsyncs a directory after a link lands in it, so a successful archive write
 * includes the directory entry in its durability boundary. Any unsupported or
 * failed sync is surfaced as WRITE_FAILED by verifiedPut; durability must not
 * be reported as successful when the metadata sync was not proven.
 */
async function syncDirectoryMetadata(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isLinkExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { code?: unknown }).code === "EEXIST" ||
      (error as { code?: unknown }).code === "ENOTEMPTY")
  );
}
