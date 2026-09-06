import assert from "node:assert/strict";
import test from "node:test";

import {
  DIRECTORY_UNSUPPORTED_NOTICE,
  readDirectoryDrop,
  readPickedFiles,
  transferItemsOf,
  type DataTransferItemLike,
  type FileSystemEntryLike
} from "./folder-picker";
import type { UploadFileSource } from "./upload-queue";

const FORBIDDEN_CLAIMS = ["功效", "疗效", "治疗", "保证", "转运", "招财", "辟邪", "旺财"];
const FORBIDDEN_LEAKS = [
  "127.0.0.1",
  "localhost",
  "x-admin-key",
  "asset-archive",
  "/Users/",
  "archiveKey",
  "MYSTCRAG_ASSET_ARCHIVE_ROOT"
];

/**
 * A real `File` keeps `size`, `type` and `stream()` on its prototype, so they
 * are not own enumerable properties. Any picker that spreads a File silently
 * produces an empty object, and this fake reproduces that shape.
 */
function browserFile(
  name: string,
  init: { size?: number; lastModified?: number; type?: string } = {}
): { file: UploadFileSource; stream: ReadableStream<Uint8Array> } {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    }
  });
  const size = init.size ?? 2048;
  const lastModified = init.lastModified ?? 1_700_000_000_000;
  const type = init.type ?? "image/jpeg";
  const prototype = {
    get name() {
      return name;
    },
    get size() {
      return size;
    },
    get lastModified() {
      return lastModified;
    },
    get type() {
      return type;
    },
    stream() {
      return stream;
    }
  };
  return { file: Object.create(prototype) as UploadFileSource, stream };
}

function fileEntry(
  fullPath: string,
  file: UploadFileSource,
  options: { fails?: boolean } = {}
): FileSystemEntryLike {
  return {
    isFile: true,
    isDirectory: false,
    name: fullPath.split("/").at(-1) ?? fullPath,
    fullPath,
    file(success, failure) {
      if (options.fails === true) {
        failure?.(new Error("the browser refused to hand over this file"));
        return;
      }
      success(file);
    }
  };
}

function directoryEntry(
  fullPath: string,
  batches: readonly (readonly FileSystemEntryLike[])[],
  options: { readerFails?: boolean; noReader?: boolean } = {}
): FileSystemEntryLike {
  const base = {
    isFile: false,
    isDirectory: true,
    name: fullPath.split("/").at(-1) ?? fullPath,
    fullPath
  };
  if (options.noReader === true) {
    return base;
  }
  let call = 0;
  return {
    ...base,
    createReader() {
      return {
        readEntries(success, failure) {
          if (options.readerFails === true) {
            failure?.(new Error("the browser refused to list this directory"));
            return;
          }
          const batch = batches[call] ?? [];
          call += 1;
          success(batch);
        }
      };
    }
  };
}

function itemOf(entry: FileSystemEntryLike | null, kind = "file"): DataTransferItemLike {
  return {
    kind,
    webkitGetAsEntry() {
      return entry;
    }
  };
}

function countingItem(entry: FileSystemEntryLike): { item: DataTransferItemLike; reads(): number } {
  let reads = 0;
  const inner = entry.createReader?.();
  const counted: FileSystemEntryLike = {
    ...entry,
    createReader() {
      return {
        readEntries(success, failure) {
          reads += 1;
          inner?.readEntries(success, failure);
        }
      };
    }
  };
  return { item: itemOf(counted), reads: () => reads };
}

function pathsOf(files: readonly UploadFileSource[]): (string | undefined)[] {
  return files.map((file) => file.webkitRelativePath);
}

test("a dropped directory is walked into every nested file with its folder path", async () => {
  const deep = browserFile("b.jpg");
  const deeper = browserFile("c.png", { type: "image/png" });
  const shallow = browserFile("a.jpg");
  const pick = await readDirectoryDrop([
    itemOf(
      directoryEntry("/批次", [
        [
          fileEntry("/批次/a.jpg", shallow.file),
          directoryEntry("/批次/正面", [[fileEntry("/批次/正面/b.jpg", deep.file), fileEntry("/批次/正面/c.png", deeper.file)], []])
        ],
        []
      ])
    )
  ]);

  assert.deepEqual(pathsOf(pick.files), ["批次/a.jpg", "批次/正面/b.jpg", "批次/正面/c.png"]);
  assert.equal(pick.unreadableCount, 0);
  for (const path of pathsOf(pick.files)) {
    assert.ok(path !== undefined);
    assert.equal(path.startsWith("/"), false, "a browser-relative path must never be absolute");
    assert.equal(path.includes(".."), false);
    assert.equal(/[A-Za-z]:[\\/]/.test(path), false);
  }
});

test("a directory reader is drained until it returns an empty batch", async () => {
  const first = browserFile("1.jpg");
  const second = browserFile("2.jpg");
  const third = browserFile("3.jpg");
  const counted = countingItem(
    directoryEntry("/批次", [
      [fileEntry("/批次/1.jpg", first.file), fileEntry("/批次/2.jpg", second.file)],
      [fileEntry("/批次/3.jpg", third.file)],
      []
    ])
  );

  const pick = await readDirectoryDrop([counted.item]);

  assert.equal(counted.reads(), 3, "Chrome hands back at most one hundred entries per read");
  assert.equal(pick.files.length, 3);
});

test("a single dropped file is picked without a directory walk", async () => {
  const made = browserFile("bead.jpg");
  const pick = await readDirectoryDrop([itemOf(fileEntry("/bead.jpg", made.file))]);
  assert.deepEqual(pathsOf(pick.files), ["bead.jpg"]);
  assert.equal(pick.unreadableCount, 0);
});

test("every dropped item is resolved to its entry before the walk yields", async () => {
  let live = true;
  const first = browserFile("a.jpg");
  const second = browserFile("b.jpg");
  const firstEntry: FileSystemEntryLike = {
    isFile: true,
    isDirectory: false,
    name: "a.jpg",
    fullPath: "/批次/a.jpg",
    file(success) {
      // The browser drops the transfer list on the handler's first await.
      void Promise.resolve().then(() => {
        live = false;
      });
      success(first.file);
    }
  };
  const pick = await readDirectoryDrop([
    { kind: "file", webkitGetAsEntry: () => (live ? firstEntry : null) },
    { kind: "file", webkitGetAsEntry: () => (live ? fileEntry("/批次/b.jpg", second.file) : null) }
  ]);

  assert.deepEqual(pathsOf(pick.files), ["批次/a.jpg", "批次/b.jpg"]);
  assert.equal(pick.unreadableCount, 0);
});

test("a drop is read from its item list, and a missing list yields nothing", () => {
  const item: DataTransferItemLike = { kind: "file" };
  assert.deepEqual(transferItemsOf({ items: [item] }), [item]);
  assert.deepEqual(transferItemsOf({ items: { 0: item, length: 1 } }), [item]);
  assert.deepEqual(transferItemsOf({ items: null }), []);
  assert.deepEqual(transferItemsOf({}), []);
  assert.deepEqual(transferItemsOf(null), []);
});

test("dropped items that are not files are ignored", async () => {
  const made = browserFile("bead.jpg");
  const pick = await readDirectoryDrop([
    itemOf(fileEntry("/bead.jpg", made.file), "string"),
    { kind: "string" }
  ]);
  assert.equal(pick.files.length, 0);
  assert.equal(pick.unreadableCount, 0);
});

test("nothing dropped is an empty pick, not an error", async () => {
  assert.deepEqual(await readDirectoryDrop([]), { files: [], unreadableCount: 0 });
});

test("a file the browser refuses to hand over is counted instead of silently dropped", async () => {
  const good = browserFile("a.jpg");
  const bad = browserFile("b.jpg");
  const pick = await readDirectoryDrop([
    itemOf(
      directoryEntry("/批次", [
        [fileEntry("/批次/a.jpg", good.file), fileEntry("/批次/b.jpg", bad.file, { fails: true })],
        []
      ])
    )
  ]);

  assert.deepEqual(pathsOf(pick.files), ["批次/a.jpg"]);
  assert.equal(pick.unreadableCount, 1);
});

test("a directory that cannot be listed is counted", async () => {
  const pick = await readDirectoryDrop([itemOf(directoryEntry("/批次", [], { readerFails: true }))]);
  assert.deepEqual(pick.files, []);
  assert.equal(pick.unreadableCount, 1);
});

test("a directory without a reader is counted", async () => {
  const pick = await readDirectoryDrop([itemOf(directoryEntry("/批次", [], { noReader: true }))]);
  assert.equal(pick.unreadableCount, 1);
});

test("an item the browser cannot resolve to an entry is counted", async () => {
  const pick = await readDirectoryDrop([itemOf(null), { kind: "file" }]);
  assert.deepEqual(pick.files, []);
  assert.equal(pick.unreadableCount, 2);
});

test("a picked file keeps the size, type and stream the browser reported", async () => {
  const made = browserFile("raw.arw", { size: 4096, lastModified: 1_600_000_000_000, type: "image/x-sony-arw" });
  const pick = await readDirectoryDrop([itemOf(fileEntry("/批次/raw.arw", made.file))]);
  const picked = pick.files[0];
  assert.ok(picked !== undefined);
  assert.equal(picked.name, "raw.arw");
  assert.equal(picked.size, 4096);
  assert.equal(picked.lastModified, 1_600_000_000_000);
  assert.equal(picked.type, "image/x-sony-arw");
  assert.equal(picked.stream(), made.stream, "the browser stream must survive the folder walk untouched");
});

test("a folder input's FileList is copied into an array and holes are skipped", () => {
  const first = browserFile("a.jpg").file;
  const second = browserFile("b.jpg").file;
  const list = { 0: first, 1: second, length: 2 } as ArrayLike<UploadFileSource>;
  assert.deepEqual(readPickedFiles(list), [first, second]);
  const sparse = { 0: first, length: 3 } as ArrayLike<UploadFileSource>;
  assert.deepEqual(readPickedFiles(sparse), [first]);
  assert.deepEqual(readPickedFiles({ length: 0 } as ArrayLike<UploadFileSource>), []);
});

test("the unsupported-browser notice refuses the folder instead of pretending", () => {
  assert.match(DIRECTORY_UNSUPPORTED_NOTICE, /不支持整目录导入/);
  assert.ok(DIRECTORY_UNSUPPORTED_NOTICE.length > 0);
  for (const forbidden of [...FORBIDDEN_CLAIMS, ...FORBIDDEN_LEAKS]) {
    assert.ok(!DIRECTORY_UNSUPPORTED_NOTICE.includes(forbidden), `must not mention ${forbidden}`);
  }
});
