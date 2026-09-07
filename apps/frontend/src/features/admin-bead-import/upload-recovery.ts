import {
  normalizeAssetRelativePath,
  type AssetImportSessionResponse
} from "@mystcrag/design-contract";

import { canRegisterManifest, canUploadFileContent } from "./workflow-model";

/**
 * Decides what picking a folder means for a session that already carries
 * registered files. After a refresh the browser no longer holds the original
 * File handles, so a PARTIALLY_FAILED session cannot re-register a manifest —
 * the Backend refuses one outside CREATED/UPLOADING. What it can do is re-send
 * the bytes for files that are already registered under a known file id, which
 * is exactly what a re-picked folder matching those relative paths enables.
 */

export type RegisteredRetryTarget = {
  fileId: string;
  clientFileId: string;
  relativePath: string;
  byteSize: number;
};

export type UploadRecoveryDecision =
  | { mode: "REGISTER_AND_UPLOAD" }
  | {
      mode: "RETRY_REGISTERED";
      targets: RegisteredRetryTarget[];
      /** Picked files that match no registered retryable entry. */
      unmatchedPickedPaths: string[];
    };

/** Registered files whose bytes the archive does not hold yet. */
export function registeredRetryTargetsOf(session: AssetImportSessionResponse) {
  return session.files.filter((file) => file.state === "FAILED" || file.state === "PENDING");
}

export function decideUploadRecovery(input: {
  session: AssetImportSessionResponse;
  pickedRelativePaths: readonly string[];
  newClientFileId: () => string;
}): UploadRecoveryDecision {
  const { session, pickedRelativePaths, newClientFileId } = input;
  const retryable = registeredRetryTargetsOf(session);
  if (
    retryable.length === 0 ||
    canRegisterManifest(session.state) ||
    !canUploadFileContent(session.state)
  ) {
    return { mode: "REGISTER_AND_UPLOAD" };
  }
  const byPath = new Map(retryable.map((file) => [file.relativePath, file]));
  const targets: RegisteredRetryTarget[] = [];
  const unmatchedPickedPaths: string[] = [];
  for (const picked of pickedRelativePaths) {
    let normalized = picked;
    try {
      normalized = normalizeAssetRelativePath(picked);
    } catch {
      // An unreadable path cannot match a server entry; it is reported unmatched
      // rather than echoed or guessed at.
    }
    const registered = byPath.get(normalized);
    if (registered === undefined) {
      unmatchedPickedPaths.push(picked);
      continue;
    }
    byPath.delete(normalized);
    targets.push({
      fileId: registered.fileId,
      clientFileId: newClientFileId(),
      relativePath: registered.relativePath,
      byteSize: registered.byteSize
    });
  }
  return { mode: "RETRY_REGISTERED", targets, unmatchedPickedPaths };
}
