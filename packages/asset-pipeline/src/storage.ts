import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  read as readDescriptor,
  readdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  write as writeDescriptor
} from "node:fs";
import { type FileHandle, link, lstat, mkdir, open, readdir, unlink } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { Readable } from "node:stream";

import { normalizeAssetRelativePath } from "@mystcrag/design-contract";

import { sha256OfBytes, sha256OfFile } from "./hash.js";
import { probeRegularFile, readRegularFile } from "./safe-read.js";

export type ArchiveStoreErrorCode =
  | "ARCHIVE_ROOT_MISSING"
  | "ARCHIVE_ROOT_INSIDE_REPOSITORY"
  | "REPOSITORY_ROOT_INVALID"
  | "KEY_INVALID"
  | "HASH_MISMATCH"
  | "SIZE_MISMATCH"
  | "PAYLOAD_TOO_LARGE"
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

const READ_CHUNK_BYTES = 64 * 1024;

export type ArchivePutResult = {
  archiveKey: string;
  sha256: string;
  byteSize: number;
  reused: boolean;
};

export type StagingStreamPutResult = {
  stagingKey: string;
  sha256: string;
  byteSize: number;
};

export type ArchiveStoreOptions = {
  root: string;
  repositoryRoots: readonly string[];
};

type StagingDirectoryContext = {
  handles: FileHandle[];
  session: FileHandle;
  temp: FileHandle;
  staging: FileHandle;
  sessionLogicalPath: string;
  tempLogicalPath: string;
  stagingLogicalPath: string;
};

type FileIdentity = {
  dev: number;
  ino: number;
};

/**
 * Streams the verified bytes of an already-open, already-verified FileHandle
 * in fixed chunks via positional reads starting at byte zero. The handle is
 * owned exclusively by this stream: it is closed exactly once in `_destroy`,
 * which Node runs on normal completion, on `destroy()` and on read failure —
 * never via garbage collection — so the served body is always the same
 * descriptor that produced the digest, even if the path is replaced mid-read.
 */
class ArchiveVerifiedReadStream extends Readable {
  private position = 0;

  constructor(
    private readonly handle: FileHandle,
    private readonly size: number,
    private readonly archiveKey: string
  ) {
    super({ highWaterMark: READ_CHUNK_BYTES, autoDestroy: true });
  }

  override async _read(): Promise<void> {
    try {
      if (this.position >= this.size) {
        this.push(null);
        return;
      }
      const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, this.size - this.position));
      const { bytesRead } = await this.handle.read(buffer, 0, buffer.byteLength, this.position);
      if (this.destroyed) return; // the consumer aborted mid-read; _destroy owns cleanup
      if (bytesRead <= 0) {
        throw new ArchiveStoreError("READ_FAILED", `Failed to read ${redactKey(this.archiveKey)}`);
      }
      this.position += bytesRead;
      this.push(buffer.subarray(0, bytesRead));
    } catch (error) {
      // _read promise rejections are not converted to stream errors, so the
      // failure must be delivered to the consumer through destroy() itself.
      this.destroy(
        error instanceof ArchiveStoreError
          ? error
          : new ArchiveStoreError("READ_FAILED", `Failed to read ${redactKey(this.archiveKey)}`, { cause: error })
      );
    }
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.handle.close().catch(() => undefined).then(() => callback(error));
  }
}

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
   * Streams one upload into the canonical staging area. The source is consumed
   * incrementally, bounded before every write and hashed as bytes land. A
   * staged key becomes visible only after the complete temp file has been
   * fsynced and independently re-verified. Failed attempts remove only entries
   * whose original inode ownership can still be proven. This safety boundary
   * assumes the archive directory topology is owned exclusively by the asset
   * service account, as documented in ASSET_PIPELINE.md.
   */
  async putStagingStream(input: {
    sessionId: string;
    source: AsyncIterable<Uint8Array>;
    expectedByteSize: number;
    maxByteSize: number;
  }): Promise<StagingStreamPutResult> {
    let sourceIterator: AsyncIterator<Uint8Array> | undefined;
    let sourceExhausted = false;
    let directoryContext: StagingDirectoryContext | undefined;
    let stagingKey: string | undefined;
    let stagingName: string | undefined;
    let tempPath: string | undefined;
    let tempName: string | undefined;
    let tempIdentity: FileIdentity | undefined;
    let tempCleanupAttempted = false;
    let fileDescriptor: number | undefined;
    let linkedTarget: string | undefined;
    let operationError: ArchiveStoreError | undefined;
    let result: StagingStreamPutResult | undefined;
    const cleanupErrors: unknown[] = [];

    try {
      sourceIterator = getAsyncIterator(input.source);
      assertIdentifier(input.sessionId, "session id");
      assertPositiveSafeByteSize(input.expectedByteSize, "expectedByteSize");
      assertPositiveSafeByteSize(input.maxByteSize, "maxByteSize");
      if (input.expectedByteSize > input.maxByteSize) {
        throw new ArchiveStoreError(
          "PAYLOAD_TOO_LARGE",
          "Declared upload size exceeds the configured staging byte limit"
        );
      }

      stagingName = randomUUID();
      stagingKey = `${KEY_PREFIX}/${input.sessionId}/staging/${stagingName}`;
      directoryContext = await openStagingDirectoryContext(this.rootReal, input.sessionId);
      tempName = `${randomUUID()}.upload`;
      tempPath = join(directoryContext.tempLogicalPath, tempName);
      const target = join(directoryContext.stagingLogicalPath, stagingName);
      assertLogicalDirectoryIdentity(directoryContext.tempLogicalPath, directoryContext.temp);
      fileDescriptor = openSync(
        tempPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW,
        0o600
      );
      tempIdentity = identityOfFileDescriptor(fileDescriptor);

      const digest = createHash("sha256");
      let byteSize = 0;
      while (true) {
        const next = await sourceIterator.next();
        if (next.done) {
          sourceExhausted = true;
          break;
        }
        const chunk = next.value;
        if (!(chunk instanceof Uint8Array)) {
          throw new ArchiveStoreError("WRITE_FAILED", "Upload stream produced a non-byte chunk");
        }
        const nextByteSize = byteSize + chunk.byteLength;
        if (!Number.isSafeInteger(nextByteSize) || nextByteSize > input.maxByteSize) {
          throw new ArchiveStoreError("PAYLOAD_TOO_LARGE", "Upload exceeded the configured staging byte limit");
        }
        if (nextByteSize > input.expectedByteSize) {
          throw new ArchiveStoreError("SIZE_MISMATCH", "Upload exceeded its declared byte size");
        }

        digest.update(chunk);
        let offset = 0;
        while (offset < chunk.byteLength) {
          const bytesWritten = await writeToDescriptor(
            fileDescriptor,
            chunk,
            offset,
            chunk.byteLength - offset
          );
          if (bytesWritten <= 0) {
            throw new ArchiveStoreError("WRITE_FAILED", "Upload stream write made no progress");
          }
          offset += bytesWritten;
        }
        byteSize = nextByteSize;
      }

      if (byteSize !== input.expectedByteSize) {
        throw new ArchiveStoreError("SIZE_MISMATCH", "Upload ended before its declared byte size");
      }
      fsyncSync(fileDescriptor);

      const sha256 = digest.digest("hex");
      const verified = await sha256OfDescriptor(fileDescriptor);
      if (verified.byteSize !== byteSize || verified.sha256 !== sha256) {
        throw new ArchiveStoreError(
          "HASH_MISMATCH",
          "Staged upload failed size or SHA-256 verification after write"
        );
      }
      closeSync(fileDescriptor);
      fileDescriptor = undefined;

      // Source callbacks are exhausted before this synchronous critical
      // section. Under the documented single-owner topology boundary, pinned
      // directory identities and file-inode checks reject path replacement.
      assertLogicalDirectoryIdentity(directoryContext.tempLogicalPath, directoryContext.temp);
      assertLogicalDirectoryIdentity(
        directoryContext.stagingLogicalPath,
        directoryContext.staging
      );
      assertFileIdentity(tempPath, tempIdentity);
      linkSync(tempPath, target);
      linkedTarget = target;
      await directoryContext.staging.sync();
      assertLogicalDirectoryIdentity(
        directoryContext.stagingLogicalPath,
        directoryContext.staging
      );
      assertFileIdentity(target, tempIdentity);
      result = { stagingKey, sha256, byteSize };
    } catch (error) {
      operationError = normalizeStagingStreamError(error);
    }

    if (!sourceExhausted && sourceIterator !== undefined) {
      try {
        const returnSource = sourceIterator.return;
        if (typeof returnSource === "function") {
          await returnSource.call(sourceIterator);
        }
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    // A successful operation is not reported until the temporary link has
    // itself been durably removed. If that final cleanup fails, convert the
    // call to a failure and roll back the business-visible staging key.
    if (
      operationError === undefined &&
      cleanupErrors.length === 0 &&
      tempPath !== undefined &&
      tempName !== undefined &&
      tempIdentity !== undefined &&
      directoryContext !== undefined
    ) {
      tempCleanupAttempted = true;
      try {
        await unlinkPinnedDirectoryEntry({
          logicalDirectoryPath: directoryContext.tempLogicalPath,
          recoveryParentPath: directoryContext.sessionLogicalPath,
          recoveryParent: directoryContext.session,
          directory: directoryContext.temp,
          entryName: tempName,
          expectedFile: tempIdentity
        });
        tempPath = undefined;
      } catch (error) {
        operationError = new ArchiveStoreError(
          "WRITE_FAILED",
          "The upload was staged but temporary-file cleanup could not be completed",
          { cause: error }
        );
        result = undefined;
      }
    }

    if (
      (operationError !== undefined || cleanupErrors.length > 0) &&
      linkedTarget !== undefined &&
      stagingName !== undefined &&
      tempIdentity !== undefined &&
      directoryContext !== undefined
    ) {
      try {
        await unlinkPinnedDirectoryEntry({
          logicalDirectoryPath: directoryContext.stagingLogicalPath,
          recoveryParentPath: directoryContext.sessionLogicalPath,
          recoveryParent: directoryContext.session,
          directory: directoryContext.staging,
          entryName: stagingName,
          expectedFile: tempIdentity
        });
        linkedTarget = undefined;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (
      tempPath !== undefined &&
      tempName !== undefined &&
      tempIdentity !== undefined &&
      !tempCleanupAttempted &&
      directoryContext !== undefined
    ) {
      try {
        await unlinkPinnedDirectoryEntry({
          logicalDirectoryPath: directoryContext.tempLogicalPath,
          recoveryParentPath: directoryContext.sessionLogicalPath,
          recoveryParent: directoryContext.session,
          directory: directoryContext.temp,
          entryName: tempName,
          expectedFile: tempIdentity
        });
        tempPath = undefined;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (fileDescriptor !== undefined) {
      try {
        closeSync(fileDescriptor);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (directoryContext !== undefined) {
      const closeErrors = await closeDirectoryHandles(directoryContext.handles);
      // Once the business key and its parent are durable and the temp entry is
      // gone, a read-only directory descriptor close error cannot invalidate
      // the staged result. During a failed operation it is retained as cleanup
      // evidence because no success will be returned.
      if (operationError !== undefined || cleanupErrors.length > 0) {
        cleanupErrors.push(...closeErrors);
      }
    }

    if (cleanupErrors.length > 0) {
      throw new ArchiveStoreError(
        "WRITE_FAILED",
        "The upload failed and one or more stream or filesystem cleanup operations could not be completed",
        { cause: new AggregateError([operationError, ...cleanupErrors].filter(Boolean)) }
      );
    }
    if (operationError !== undefined) throw operationError;
    if (result === undefined || stagingKey === undefined) {
      throw new ArchiveStoreError("WRITE_FAILED", "The upload did not produce a staged result");
    }
    return result;
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

  /**
   * Opens an immutable archive key exactly once and performs a verified
   * streaming read on that single descriptor, closing the TOCTOU window where
   * a verification pass and a response stream would otherwise be served from
   * two different opens. The file is opened with O_NOFOLLOW after the usual
   * no-symlink walk, its type and size are confirmed against the opened
   * handle, and its SHA-256 is streamed over that same handle in fixed chunks
   * — verified against `expectedSha256` when supplied — before any byte leaves
   * the method. The returned Readable reads from byte zero of the *same* open
   * descriptor, so the digest, `byteSize` and response body are all bound to
   * one inode: replacing the path between verification and streaming cannot
   * substitute different bytes. Ending, aborting or erroring the stream closes
   * the descriptor; there is no second open and no second full-size buffer.
   */
  async openVerifiedRead(
    archiveKey: string,
    expectedSha256?: string
  ): Promise<{ stream: Readable; byteSize: number; sha256: string }> {
    if (expectedSha256 !== undefined) assertSha256(expectedSha256);
    const { handle, size } = await this.openRegularFile(archiveKey);
    let sha256: string;
    try {
      sha256 = await digestDescriptor(handle, size, archiveKey);
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
    if (expectedSha256 !== undefined && sha256 !== expectedSha256) {
      await handle.close().catch(() => undefined);
      throw new ArchiveStoreError(
        "HASH_MISMATCH",
        `Stored content of ${redactKey(archiveKey)} does not match the expected SHA-256`
      );
    }
    // The stream takes exclusive ownership of the already-open descriptor and
    // closes it in `_destroy`. It never re-opens by path, so the bytes it
    // serves are the same inode that produced `sha256`.
    return {
      stream: new ArchiveVerifiedReadStream(handle, size, archiveKey),
      byteSize: size,
      sha256
    };
  }

  private async openRegularFile(archiveKey: string): Promise<{ handle: FileHandle; size: number }> {
    assertArchiveKey(archiveKey);
    const target = await this.joinUnderRoot(archiveKey);
    let handle: FileHandle;
    try {
      handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
      if (error instanceof ArchiveStoreError) throw error;
      throw new ArchiveStoreError("READ_FAILED", `Failed to read ${redactKey(archiveKey)}`, { cause: error });
    }
    try {
      const info = await handle.stat();
      if (!info.isFile()) {
        throw new ArchiveStoreError("KEY_INVALID", "Archive key does not resolve to a stored file");
      }
      return { handle, size: info.size };
    } catch (error) {
      await handle.close().catch(() => undefined);
      if (error instanceof ArchiveStoreError) throw error;
      throw new ArchiveStoreError("READ_FAILED", `Failed to read ${redactKey(archiveKey)}`, { cause: error });
    }
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

function assertPositiveSafeByteSize(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ArchiveStoreError("KEY_INVALID", `${field} must be a positive safe integer`);
  }
}

function getAsyncIterator(source: AsyncIterable<Uint8Array>): AsyncIterator<Uint8Array> {
  if (
    (typeof source !== "object" && typeof source !== "function") ||
    source === null ||
    typeof source[Symbol.asyncIterator] !== "function"
  ) {
    throw new ArchiveStoreError("KEY_INVALID", "Upload source must be an async byte iterable");
  }
  const iterator = source[Symbol.asyncIterator]();
  if (iterator === null || typeof iterator !== "object" || typeof iterator.next !== "function") {
    throw new ArchiveStoreError("KEY_INVALID", "Upload source did not provide a valid async iterator");
  }
  return iterator;
}

function normalizeStagingStreamError(error: unknown): ArchiveStoreError {
  if (error instanceof ArchiveStoreError) return error;
  return new ArchiveStoreError("WRITE_FAILED", "Failed to stage the uploaded byte stream", {
    cause: error
  });
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

async function openStagingDirectoryContext(
  root: string,
  sessionId: string
): Promise<StagingDirectoryContext> {
  const handles: FileHandle[] = [];
  try {
    const rootHandle = await openDirectory(root);
    handles.push(rootHandle);
    const importsPath = join(root, KEY_PREFIX);
    const importsHandle = await openOrCreateChildDirectory(rootHandle, root, KEY_PREFIX);
    handles.push(importsHandle);
    const sessionPath = join(importsPath, sessionId);
    const sessionHandle = await openOrCreateChildDirectory(importsHandle, importsPath, sessionId);
    handles.push(sessionHandle);
    const tempHandle = await openOrCreateChildDirectory(sessionHandle, sessionPath, "tmp");
    handles.push(tempHandle);
    const stagingHandle = await openOrCreateChildDirectory(sessionHandle, sessionPath, "staging");
    handles.push(stagingHandle);
    return {
      handles,
      session: sessionHandle,
      temp: tempHandle,
      staging: stagingHandle,
      sessionLogicalPath: sessionPath,
      tempLogicalPath: join(sessionPath, "tmp"),
      stagingLogicalPath: join(sessionPath, "staging")
    };
  } catch (error) {
    await closeDirectoryHandles(handles);
    throw error;
  }
}

async function openDirectory(path: string): Promise<FileHandle> {
  return open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  );
}

async function openOrCreateChildDirectory(
  parent: FileHandle,
  parentPath: string,
  name: string
): Promise<FileHandle> {
  assertLogicalDirectoryIdentity(parentPath, parent);
  const childPath = join(parentPath, name);
  let created = false;
  try {
    await mkdir(childPath, { mode: 0o700 });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  let child: FileHandle;
  try {
    child = await openDirectory(childPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ELOOP" || code === "ENOTDIR") {
      throw new ArchiveStoreError(
        "KEY_INVALID",
        "Archive staging directories must be real directories, never symbolic links",
        { cause: error }
      );
    }
    throw error;
  }
  try {
    assertLogicalDirectoryIdentity(childPath, child);
    if (created) {
      // Persist both the new directory inode and its entry in the parent.
      await child.sync();
      await parent.sync();
    }
  } catch (error) {
    await child.close().catch(() => undefined);
    throw error;
  }
  return child;
}

function assertLogicalDirectoryIdentity(path: string, handle: FileHandle): void {
  let logical: ReturnType<typeof lstatSync>;
  let opened: ReturnType<typeof fstatSync>;
  try {
    logical = lstatSync(path);
    opened = fstatSync(handle.fd);
  } catch (error) {
    throw new ArchiveStoreError(
      "KEY_INVALID",
      "An archive staging directory changed while the upload was in progress",
      { cause: error }
    );
  }
  if (
    logical.isSymbolicLink() ||
    !logical.isDirectory() ||
    !opened.isDirectory() ||
    logical.dev !== opened.dev ||
    logical.ino !== opened.ino
  ) {
    throw new ArchiveStoreError(
      "KEY_INVALID",
      "An archive staging directory changed while the upload was in progress"
    );
  }
}

function identityOfFileDescriptor(fileDescriptor: number): FileIdentity {
  const info = fstatSync(fileDescriptor);
  if (!info.isFile()) {
    throw new ArchiveStoreError("WRITE_FAILED", "The temporary upload is not a regular file");
  }
  return { dev: info.dev, ino: info.ino };
}

function assertFileIdentity(path: string, expected: FileIdentity): void {
  let info: ReturnType<typeof lstatSync>;
  try {
    info = lstatSync(path);
  } catch (error) {
    throw new ArchiveStoreError("KEY_INVALID", "An upload file changed during staging", {
      cause: error
    });
  }
  if (info.isSymbolicLink() || !info.isFile() || info.dev !== expected.dev || info.ino !== expected.ino) {
    throw new ArchiveStoreError("KEY_INVALID", "An upload file changed during staging");
  }
}

function resolvePinnedDirectoryPath(input: {
  logicalPath: string;
  recoveryParentPath: string;
  recoveryParent: FileHandle;
  directory: FileHandle;
}): string {
  try {
    assertLogicalDirectoryIdentity(input.logicalPath, input.directory);
    return input.logicalPath;
  } catch (originalError) {
    // A source cancellation callback may have renamed the directory. Recover
    // only when the same inode is still a direct child of the pinned session;
    // never follow the replacement path or scan outside that safe boundary.
    assertLogicalDirectoryIdentity(input.recoveryParentPath, input.recoveryParent);
    const expected = fstatSync(input.directory.fd);
    for (const name of readdirSync(input.recoveryParentPath)) {
      const candidate = join(input.recoveryParentPath, name);
      let info: ReturnType<typeof lstatSync>;
      try {
        info = lstatSync(candidate);
      } catch {
        continue;
      }
      if (
        !info.isSymbolicLink() &&
        info.isDirectory() &&
        info.dev === expected.dev &&
        info.ino === expected.ino
      ) {
        return candidate;
      }
    }
    throw originalError;
  }
}

async function unlinkPinnedDirectoryEntry(input: {
  logicalDirectoryPath: string;
  recoveryParentPath: string;
  recoveryParent: FileHandle;
  directory: FileHandle;
  entryName: string;
  expectedFile: FileIdentity;
}): Promise<void> {
  const actualDirectoryPath = resolvePinnedDirectoryPath({
    logicalPath: input.logicalDirectoryPath,
    recoveryParentPath: input.recoveryParentPath,
    recoveryParent: input.recoveryParent,
    directory: input.directory
  });
  const entryPath = join(actualDirectoryPath, input.entryName);
  assertFileIdentity(entryPath, input.expectedFile);
  unlinkSync(entryPath);
  await input.directory.sync();
}

function writeToDescriptor(
  fileDescriptor: number,
  chunk: Uint8Array,
  offset: number,
  length: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    writeDescriptor(fileDescriptor, chunk, offset, length, null, (error, bytesWritten) => {
      if (error) reject(error);
      else resolve(bytesWritten);
    });
  });
}

function readFromDescriptor(
  fileDescriptor: number,
  buffer: Uint8Array,
  length: number,
  position: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    readDescriptor(fileDescriptor, buffer, 0, length, position, (error, bytesRead) => {
      if (error) reject(error);
      else resolve(bytesRead);
    });
  });
}

async function sha256OfDescriptor(
  fileDescriptor: number
): Promise<{ sha256: string; byteSize: number }> {
  const info = fstatSync(fileDescriptor);
  if (!info.isFile() || !Number.isSafeInteger(info.size) || info.size < 0) {
    throw new ArchiveStoreError("WRITE_FAILED", "The temporary upload has an invalid file size");
  }
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (position < info.size) {
    const bytesRead = await readFromDescriptor(
      fileDescriptor,
      buffer,
      Math.min(buffer.byteLength, info.size - position),
      position
    );
    if (bytesRead <= 0) {
      throw new ArchiveStoreError("WRITE_FAILED", "Temporary upload verification made no progress");
    }
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return { sha256: hash.digest("hex"), byteSize: info.size };
}

/**
 * Streams a SHA-256 over an already-open, already-verified FileHandle using
 * positional reads from byte zero, so it never buffers the file and never
 * disturbs the descriptor's current offset. Used by {@link ArchiveStore
 * #openVerifiedRead} so the digest and the response stream come from the same
 * open descriptor.
 */
async function digestDescriptor(handle: FileHandle, size: number, archiveKey: string): Promise<string> {
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  let position = 0;
  while (position < size) {
    const { bytesRead } = await handle.read(
      buffer,
      0,
      Math.min(buffer.byteLength, size - position),
      position
    );
    if (bytesRead <= 0) {
      throw new ArchiveStoreError("READ_FAILED", `Failed to read ${redactKey(archiveKey)}`);
    }
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

async function closeDirectoryHandles(handles: readonly FileHandle[]): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const handle of [...handles].reverse()) {
    try {
      await handle.close();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
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
