import type { UploadFileSource } from "./upload-queue";

/**
 * Reads a folder out of the two mechanisms a browser offers: a drop, whose
 * entries have to be walked and whose files arrive without a relative path,
 * and an `<input webkitdirectory>` FileList, which already carries one. Neither
 * exists everywhere, so an unsupported browser is told so plainly instead of
 * being handed a picker that quietly uploads nothing.
 */

export const DIRECTORY_UNSUPPORTED_NOTICE =
  "当前浏览器不支持整目录导入：请改用支持选择或拖入文件夹的浏览器后再上传素材。";

export type FileSystemReaderLike = {
  readEntries(
    success: (entries: readonly FileSystemEntryLike[]) => void,
    failure?: (error: unknown) => void
  ): void;
};

export type FileSystemEntryLike = {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  readonly fullPath: string;
  file?(success: (file: UploadFileSource) => void, failure?: (error: unknown) => void): void;
  createReader?(): FileSystemReaderLike;
};

export type DataTransferItemLike = {
  readonly kind: string;
  webkitGetAsEntry?(): FileSystemEntryLike | null;
};

export type DataTransferLike = {
  readonly items?: ArrayLike<DataTransferItemLike> | null;
};

export type DirectoryPick = { files: UploadFileSource[]; unreadableCount: number };

/** A drop event's item list is only valid while its handler runs synchronously. */
export function transferItemsOf(dataTransfer: DataTransferLike | null): readonly DataTransferItemLike[] {
  const items = dataTransfer?.items;
  if (items === undefined || items === null) {
    return [];
  }
  const collected: DataTransferItemLike[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item !== undefined) {
      collected.push(item);
    }
  }
  return collected;
}

function relativePathOf(entry: FileSystemEntryLike): string {
  return entry.fullPath.replace(/^\/+/, "");
}

/**
 * A File reached through an entry carries no `webkitRelativePath`, and a File
 * keeps `size`, `type` and `stream()` on its prototype, so spreading one yields
 * an empty object. The path is attached by an explicit wrapper that delegates.
 */
function withRelativePath(file: UploadFileSource, relativePath: string): UploadFileSource {
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    type: file.type,
    webkitRelativePath: relativePath,
    stream: () => file.stream()
  };
}

function readFileEntry(entry: FileSystemEntryLike): Promise<UploadFileSource | null> {
  return new Promise((resolve) => {
    if (typeof entry.file !== "function") {
      resolve(null);
      return;
    }
    entry.file(
      (file) => resolve(withRelativePath(file, relativePathOf(entry))),
      () => resolve(null)
    );
  });
}

function readBatch(reader: FileSystemReaderLike): Promise<readonly FileSystemEntryLike[] | null> {
  return new Promise((resolve) => {
    reader.readEntries(
      (entries) => resolve(entries),
      () => resolve(null)
    );
  });
}

export async function readDirectoryDrop(items: readonly DataTransferItemLike[]): Promise<DirectoryPick> {
  const files: UploadFileSource[] = [];
  const roots: FileSystemEntryLike[] = [];
  let unreadableCount = 0;

  async function walk(entry: FileSystemEntryLike): Promise<void> {
    if (entry.isFile) {
      const file = await readFileEntry(entry);
      if (file === null) {
        unreadableCount += 1;
        return;
      }
      files.push(file);
      return;
    }
    if (!entry.isDirectory) {
      return;
    }
    const reader = entry.createReader?.();
    if (reader === undefined) {
      unreadableCount += 1;
      return;
    }
    for (;;) {
      const batch = await readBatch(reader);
      if (batch === null) {
        unreadableCount += 1;
        return;
      }
      // A reader hands back at most one hundred entries per call and signals the
      // end of the directory with an empty batch, never with a flag.
      if (batch.length === 0) {
        return;
      }
      for (const child of batch) {
        await walk(child);
      }
    }
  }

  for (const item of items) {
    if (item.kind !== "file") {
      continue;
    }
    const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    if (entry === null) {
      unreadableCount += 1;
      continue;
    }
    roots.push(entry);
  }

  // The walk awaits, and the browser has already dropped the transfer list by
  // then, so every entry is resolved above before the first await happens.
  for (const root of roots) {
    await walk(root);
  }

  return { files, unreadableCount };
}

export function readPickedFiles(list: ArrayLike<UploadFileSource>): UploadFileSource[] {
  const files: UploadFileSource[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const file = list[index];
    if (file !== undefined) {
      files.push(file);
    }
  }
  return files;
}
