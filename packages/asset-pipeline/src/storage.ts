import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { link, lstat, mkdir, open, readdir, readFile, unlink } from "node:fs/promises";
import { dirname, join, sep } from "node:path";

import { normalizeAssetRelativePath } from "@mystcrag/design-contract";

import { sha256OfBytes, sha256OfFile } from "./hash.js";

export type ArchiveStoreErrorCode =
  | "ARCHIVE_ROOT_MISSING"
  | "ARCHIVE_ROOT_INSIDE_REPOSITORY"
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
      } catch {
        continue;
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
    if (!Number.isInteger(input.processingVersion) || input.processingVersion < 1) {
      throw new ArchiveStoreError("KEY_INVALID", "processingVersion must be a positive integer");
    }
    if (typeof input.fileName !== "string" || !PROCESSED_FILE_NAMES.has(input.fileName)) {
      throw new ArchiveStoreError("KEY_INVALID", `Unsupported processed file name ${String(input.fileName)}`);
    }
    const archiveKey = `imports/${input.sessionId}/processed/${input.groupId}/v${input.processingVersion}/${input.fileName}`;
    return this.verifiedPut(archiveKey, input.bytes, sha256OfBytes(input.bytes));
  }

  async read(archiveKey: string): Promise<Uint8Array> {
    const target = await this.resolveExistingFile(archiveKey);
    try {
      return await readFile(target);
    } catch (error) {
      throw new ArchiveStoreError("READ_FAILED", `Failed to read ${redactKey(archiveKey)}`, { cause: error });
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
    await this.walkFiles(sessionDir, `${KEY_PREFIX}/${sessionId}`, results);
    return results.sort();
  }

  private async walkFiles(directory: string, prefix: string, results: string[]): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryKey = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await this.walkFiles(join(directory, entry.name), entryKey, results);
      } else {
        results.push(entryKey);
      }
    }
  }

  private async verifiedPut(archiveKey: string, bytes: Uint8Array, sha256: string): Promise<ArchivePutResult> {
    const target = await this.resolveWritablePath(archiveKey);

    const existing = await readIfRegularFile(target);
    if (existing !== null) {
      if (sha256OfBytes(existing) === sha256) {
        return { archiveKey, sha256, byteSize: existing.byteLength, reused: true };
      }
      throw new ArchiveStoreError(
        "KEY_EXISTS_CONTENT_MISMATCH",
        "Archive key already holds different content; overwriting is forbidden"
      );
    }

    const sessionId = archiveKey.split("/")[1]!;
    const tempDir = join(this.rootReal, KEY_PREFIX, sessionId, "tmp");
    const tempPath = join(tempDir, `${randomUUID()}.tmp`);
    try {
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
      try {
        await link(tempPath, target);
      } catch (error) {
        if (isLinkExistsError(error)) {
          const raced = await readIfRegularFile(target);
          if (raced !== null && sha256OfBytes(raced) === sha256) {
            return { archiveKey, sha256, byteSize: raced.byteLength, reused: true };
          }
          throw new ArchiveStoreError(
            "KEY_EXISTS_CONTENT_MISMATCH",
            "Archive key already holds different content; overwriting is forbidden"
          );
        }
        throw error;
      }
      return { archiveKey, sha256, byteSize: bytes.byteLength, reused: false };
    } catch (error) {
      if (error instanceof ArchiveStoreError) throw error;
      throw new ArchiveStoreError("WRITE_FAILED", `Failed to archive ${redactKey(archiveKey)}`, {
        cause: error
      });
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }

  private async resolveWritablePath(archiveKey: string): Promise<string> {
    assertArchiveKey(archiveKey);
    return this.joinUnderRoot(archiveKey);
  }

  private async resolveExistingFile(archiveKey: string): Promise<string> {
    assertArchiveKey(archiveKey);
    const target = await this.joinUnderRoot(archiveKey);
    const info = await lstat(target).catch(() => null);
    if (!info || !info.isFile()) {
      throw new ArchiveStoreError("KEY_INVALID", "Archive key does not resolve to a stored file");
    }
    return target;
  }

  private async joinUnderRoot(archiveKey: string): Promise<string> {
    let current = this.rootReal;
    for (const segment of archiveKey.split("/")) {
      current = join(current, segment);
      const info = await lstat(current).catch(() => null);
      if (info?.isSymbolicLink()) {
        throw new ArchiveStoreError("KEY_INVALID", "Archive keys must not traverse symbolic links");
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

async function readIfRegularFile(path: string): Promise<Uint8Array | null> {
  const info = await lstat(path).catch(() => null);
  if (!info || !info.isFile()) return null;
  return readFile(path);
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
