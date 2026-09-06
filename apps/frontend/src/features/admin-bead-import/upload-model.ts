import {
  ASSET_MANIFEST_LIMITS,
  AssetImportManifestFileEntrySchema,
  AssetSourceFileKindSchema,
  isAllowedAssetSourceExtension,
  normalizeAssetRelativePath,
  type AssetImportManifestFileEntry,
  type AssetSourceFileKind,
  type RegisterAssetManifestRequest
} from "@mystcrag/design-contract";

import { formatByteSize } from "./console-format";

/**
 * Turns a browser folder selection into a contract-valid manifest. The contract
 * owns every limit, extension and path rule: this module only applies them and
 * reports refusals in operator language. It never derives a crystal identity,
 * SKU or quality from a folder number or a file name, and no refusal may echo
 * the path it rejected, because a picked folder can carry an absolute one.
 */

export const UPLOAD_CONCURRENCY = 3;

export type UploadFileLike = {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
  readonly webkitRelativePath?: string;
};

export type UploadRejectionReason =
  | "PATH_REJECTED"
  | "UNSUPPORTED_TYPE"
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "UNREADABLE_FILE"
  | "DUPLICATE_PATH";

export type UploadRejection = {
  fileName: string;
  reason: UploadRejectionReason;
  message: string;
};

export type UploadBlockReason = "FILE_COUNT_LIMIT" | "SESSION_BYTE_LIMIT";

export type UploadCandidate = {
  clientFileId: string;
  fileName: string;
  relativePath: string;
  byteSize: number;
  lastModifiedMs: number;
  kind: AssetSourceFileKind;
};

export type UploadPlan = {
  entries: UploadCandidate[];
  rejected: UploadRejection[];
  blockedBy: UploadBlockReason | null;
  message: string | null;
};

export type DirectoryInputSupport = { folderInput: boolean; folderDrop: boolean };

export type DirectorySupportProbe = {
  inputPrototype: object | null;
  hasGetAsEntry: boolean;
};

export function detectDirectorySupport(probe: DirectorySupportProbe): DirectoryInputSupport {
  return {
    folderInput: probe.inputPrototype !== null && "webkitdirectory" in probe.inputPrototype,
    folderDrop: probe.hasGetAsEntry
  };
}

const REJECTION_MESSAGES: Readonly<Record<UploadRejectionReason, string>> = {
  PATH_REJECTED: "无法接受该文件的路径：只允许不含盘符、上级目录或绝对前缀的相对路径。",
  UNSUPPORTED_TYPE: "只支持 ARW、JPG、PNG、WEBP 四种素材文件。",
  EMPTY_FILE: "文件大小为 0，无法上传。",
  FILE_TOO_LARGE: `文件超过单文件上限 ${formatByteSize(ASSET_MANIFEST_LIMITS.maxFileBytes)}。`,
  UNREADABLE_FILE: "无法读取该文件的大小或修改时间，请重新选择该文件。",
  DUPLICATE_PATH: "同一个相对路径在一次导入中只能出现一次。"
};

const UNSAFE_LABEL_CHARACTER = /[\\/\u0000-\u001f]/g;

/** A refusal may name the file, but never a separator, a drive letter or a control byte. */
function fileLabel(file: UploadFileLike): string {
  const cleaned = file.name.replace(UNSAFE_LABEL_CHARACTER, "").replace(/^[A-Za-z]:/, "").trim();
  return cleaned === "" ? "未命名文件" : cleaned;
}

function declaredPath(file: UploadFileLike): string {
  const relative = file.webkitRelativePath;
  return relative === undefined || relative === "" ? file.name : relative;
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

const KIND_PROBE = { clientFileId: "kind-probe", byteSize: 1, lastModifiedMs: 1 } as const;

/**
 * The contract publishes the extension table only as a predicate, so the
 * declared kind is discovered by asking the manifest entry schema which kind
 * accepts this path. Nothing here restates which extension belongs to which
 * kind, and a contract change needs no frontend edit.
 */
export function assetSourceFileKindOf(relativePath: string): AssetSourceFileKind | null {
  if (!isAllowedAssetSourceExtension(relativePath)) {
    return null;
  }
  for (const kind of AssetSourceFileKindSchema.options) {
    if (AssetImportManifestFileEntrySchema.safeParse({ ...KIND_PROBE, relativePath, kind }).success) {
      return kind;
    }
  }
  return null;
}

export function planUploads(files: readonly UploadFileLike[], deps: { newClientFileId(): string }): UploadPlan {
  const entries: UploadCandidate[] = [];
  const rejected: UploadRejection[] = [];
  const seenPaths = new Set<string>();
  let totalBytes = 0;

  for (const file of files) {
    const refuse = (reason: UploadRejectionReason): void => {
      rejected.push({ fileName: fileLabel(file), reason, message: REJECTION_MESSAGES[reason] });
    };

    let relativePath: string;
    try {
      relativePath = normalizeAssetRelativePath(declaredPath(file));
    } catch {
      refuse("PATH_REJECTED");
      continue;
    }

    const kind = assetSourceFileKindOf(relativePath);
    if (kind === null) {
      refuse("UNSUPPORTED_TYPE");
      continue;
    }

    if (!Number.isSafeInteger(file.size)) {
      refuse("UNREADABLE_FILE");
      continue;
    }
    if (file.size === 0) {
      refuse("EMPTY_FILE");
      continue;
    }
    if (file.size > ASSET_MANIFEST_LIMITS.maxFileBytes) {
      refuse("FILE_TOO_LARGE");
      continue;
    }
    if (!isPositiveSafeInteger(file.lastModified)) {
      refuse("UNREADABLE_FILE");
      continue;
    }
    if (seenPaths.has(relativePath)) {
      refuse("DUPLICATE_PATH");
      continue;
    }

    seenPaths.add(relativePath);
    totalBytes += file.size;
    entries.push({
      clientFileId: deps.newClientFileId(),
      fileName: (relativePath.split("/").at(-1) ?? relativePath),
      relativePath,
      byteSize: file.size,
      lastModifiedMs: file.lastModified,
      kind
    });
  }

  let blockedBy: UploadBlockReason | null = null;
  let message: string | null = null;
  if (entries.length > ASSET_MANIFEST_LIMITS.maxFiles) {
    blockedBy = "FILE_COUNT_LIMIT";
    message = `一次最多登记 ${ASSET_MANIFEST_LIMITS.maxFiles} 个文件，请分批导入。`;
  } else if (totalBytes > ASSET_MANIFEST_LIMITS.maxSessionBytes) {
    blockedBy = "SESSION_BYTE_LIMIT";
    message = `一次导入的总大小不能超过 ${formatByteSize(ASSET_MANIFEST_LIMITS.maxSessionBytes)}，请分批导入。`;
  } else if (entries.length === 0) {
    message = "没有可登记的文件：仅支持 ARW、JPG、PNG、WEBP。";
  }

  return { entries, rejected, blockedBy, message };
}

export function canRegisterManifest(plan: UploadPlan): boolean {
  return plan.blockedBy === null && plan.entries.length > 0;
}

export function buildManifestRequest(
  plan: UploadPlan,
  idempotencyKey: string
): RegisterAssetManifestRequest | null {
  if (!canRegisterManifest(plan)) {
    return null;
  }
  const files: AssetImportManifestFileEntry[] = plan.entries.map((entry) => ({
    clientFileId: entry.clientFileId,
    relativePath: entry.relativePath,
    byteSize: entry.byteSize,
    lastModifiedMs: entry.lastModifiedMs,
    kind: entry.kind
  }));
  return { idempotencyKey, files };
}
