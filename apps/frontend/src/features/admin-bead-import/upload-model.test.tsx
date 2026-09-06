import assert from "node:assert/strict";
import test from "node:test";

import {
  ASSET_MANIFEST_LIMITS,
  AssetImportManifestFileEntrySchema,
  RegisterAssetManifestRequestSchema,
  type AssetSourceFileKind
} from "@mystcrag/design-contract";

import {
  UPLOAD_CONCURRENCY,
  assetSourceFileKindOf,
  buildManifestRequest,
  canRegisterManifest,
  detectDirectorySupport,
  planUploads,
  type UploadFileLike
} from "./upload-model";

const FORBIDDEN_CLAIMS = ["功效", "疗效", "治疗", "保证", "转运", "招财", "辟邪", "旺财"];
const FORBIDDEN_LEAKS = [
  "archiveKey",
  "asset-archive",
  "x-admin-key",
  "MYSTCRAG_ASSET_ADMIN_KEY",
  "ASSET_ADMIN_API_KEY",
  "MYSTCRAG_BACKEND_ORIGIN",
  "127.0.0.1",
  "localhost"
];

function file(overrides: Partial<UploadFileLike> & { name: string }): UploadFileLike {
  return { size: 1024, lastModified: 1_700_000_000_000, ...overrides };
}

function idGenerator(prefix = "client"): { newClientFileId(): string; issued: string[] } {
  const issued: string[] = [];
  return {
    issued,
    newClientFileId: () => {
      const id = `${prefix}-${issued.length + 1}`;
      issued.push(id);
      return id;
    }
  };
}

function plan(files: readonly UploadFileLike[], ids = idGenerator()) {
  return planUploads(files, ids);
}

function assertClean(value: string, label: string): void {
  for (const forbidden of [...FORBIDDEN_LEAKS, ...FORBIDDEN_CLAIMS]) {
    assert.ok(!value.includes(forbidden), `${label} must not mention ${forbidden}: ${value}`);
  }
  assert.ok(!value.includes("/Users/"), `${label} must not echo an absolute path: ${value}`);
  assert.ok(!/[A-Za-z]:[\\/]/.test(value), `${label} must not echo a drive letter: ${value}`);
}

test("upload concurrency is pinned at three", () => {
  assert.equal(UPLOAD_CONCURRENCY, 3);
});

test("a picked folder keeps its structure and normalizes the declared path", () => {
  const result = plan([
    file({ name: "bead-01.jpg", webkitRelativePath: "批次A/./正面/bead-01.jpg", size: 2048 }),
    file({ name: "bead-02.arw", webkitRelativePath: "批次A/正面/bead-02.arw" })
  ]);

  assert.equal(result.blockedBy, null);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(
    result.entries.map((entry) => entry.relativePath),
    ["批次A/正面/bead-01.jpg", "批次A/正面/bead-02.arw"]
  );
  assert.deepEqual(Object.keys(result.entries[0] as object).sort(), [
    "byteSize",
    "clientFileId",
    "fileName",
    "kind",
    "lastModifiedMs",
    "relativePath"
  ]);
});

test("every accepted extension maps to the kind the contract declares", () => {
  const expectations: ReadonlyArray<[string, AssetSourceFileKind]> = [
    ["a.arw", "ARW"],
    ["a.ARW", "ARW"],
    ["a.jpg", "JPEG"],
    ["a.jpeg", "JPEG"],
    ["a.JPG", "JPEG"],
    ["a.png", "PNG"],
    ["a.webp", "WEBP"]
  ];
  for (const [name, kind] of expectations) {
    const result = plan([file({ name, webkitRelativePath: `批次/${name}` })]);
    assert.deepEqual(
      result.rejected,
      [],
      `${name} must be accepted`
    );
    assert.equal(result.entries[0]?.kind, kind, `${name} must declare ${kind}`);
    assert.equal(assetSourceFileKindOf(`批次/${name}`), kind);
  }
});

test("anything the contract does not allow is rejected instead of silently uploaded", () => {
  const result = plan([
    file({ name: "scan.tiff", webkitRelativePath: "批次/scan.tiff" }),
    file({ name: "clip.mp4", webkitRelativePath: "批次/clip.mp4" }),
    file({ name: "notes", webkitRelativePath: "批次/notes" }),
    file({ name: ".DS_Store", webkitRelativePath: "批次/.DS_Store" }),
    file({ name: "shot.raw", webkitRelativePath: "批次/shot.raw" })
  ]);
  assert.deepEqual(result.entries, []);
  assert.deepEqual(
    result.rejected.map((rejection) => rejection.reason),
    ["UNSUPPORTED_TYPE", "UNSUPPORTED_TYPE", "UNSUPPORTED_TYPE", "UNSUPPORTED_TYPE", "UNSUPPORTED_TYPE"]
  );
  assert.equal(canRegisterManifest(result), false);
});

test("an absolute or traversing path is rejected without being echoed back", () => {
  const absolutePaths = [
    "/Users/operator/批次/bead.jpg",
    "C:\\照片\\bead.jpg",
    "~/bead.jpg",
    "../../escape.jpg",
    "批次/../../escape.jpg",
    "批次//bead.jpg",
    "批次/bead\u0000.jpg"
  ];
  for (const raw of absolutePaths) {
    const result = plan([file({ name: "bead.jpg", webkitRelativePath: raw })]);
    assert.deepEqual(result.entries, [], `${JSON.stringify(raw)} must not be accepted`);
    const rejection = result.rejected[0];
    assert.ok(rejection !== undefined);
    assert.equal(rejection.reason, "PATH_REJECTED", `${JSON.stringify(raw)} must be a path rejection`);
    assertClean(rejection.message, `rejection for ${JSON.stringify(raw)}`);
    assertClean(rejection.fileName, `label for ${JSON.stringify(raw)}`);
    assert.ok(!rejection.message.includes("escape"), "the message must not repeat the raw path");
  }
});

test("a dropped file without a relative path falls back to its own name", () => {
  const result = plan([
    file({ name: "loose-bead.png", size: 4096 }),
    file({ name: "dropped-bead.png", webkitRelativePath: "", size: 4096 })
  ]);
  assert.deepEqual(result.rejected, []);
  assert.deepEqual(
    result.entries.map((entry) => entry.relativePath),
    ["loose-bead.png", "dropped-bead.png"]
  );
});

test("an empty file and an oversized file are rejected for different reasons", () => {
  const empty = plan([file({ name: "a.jpg", webkitRelativePath: "批次/a.jpg", size: 0 })]);
  assert.equal(empty.rejected[0]?.reason, "EMPTY_FILE");

  const oversized = plan([
    file({
      name: "huge.jpg",
      webkitRelativePath: "批次/huge.jpg",
      size: ASSET_MANIFEST_LIMITS.maxFileBytes + 1
    })
  ]);
  assert.equal(oversized.rejected[0]?.reason, "FILE_TOO_LARGE");
  assertClean(oversized.rejected[0]?.message ?? "", "oversized rejection message");

  const atLimit = plan([
    file({ name: "edge.jpg", webkitRelativePath: "批次/edge.jpg", size: ASSET_MANIFEST_LIMITS.maxFileBytes })
  ]);
  assert.deepEqual(atLimit.rejected, [], "the published ceiling itself must be accepted");
});

test("unreadable file metadata is rejected rather than padded with an invented value", () => {
  for (const lastModified of [0, -1, Number.NaN, 1.5]) {
    const result = plan([file({ name: "a.jpg", webkitRelativePath: "批次/a.jpg", lastModified })]);
    assert.deepEqual(result.entries, [], `lastModified ${lastModified} must not be accepted`);
    assert.equal(result.rejected[0]?.reason, "UNREADABLE_FILE");
  }
  const fractionalSize = plan([
    file({ name: "a.jpg", webkitRelativePath: "批次/a.jpg", size: 10.5 })
  ]);
  assert.equal(fractionalSize.rejected[0]?.reason, "UNREADABLE_FILE");
});

test("two files claiming the same relative path never both reach the manifest", () => {
  const result = plan([
    file({ name: "a.jpg", webkitRelativePath: "批次/a.jpg" }),
    file({ name: "a.jpg", webkitRelativePath: "批次/./a.jpg" })
  ]);
  assert.equal(result.entries.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0]?.reason, "DUPLICATE_PATH");
});

test("the manifest is blocked when the picked folder exceeds a published limit", () => {
  const tooMany = Array.from({ length: ASSET_MANIFEST_LIMITS.maxFiles + 1 }, (_, index) =>
    file({ name: `bead-${index}.jpg`, webkitRelativePath: `批次/bead-${index}.jpg` })
  );
  const countPlan = plan(tooMany);
  assert.equal(countPlan.blockedBy, "FILE_COUNT_LIMIT");
  assert.equal(canRegisterManifest(countPlan), false);
  assert.equal(buildManifestRequest(countPlan, "key-1"), null);
  assertClean(countPlan.message ?? "", "file count block message");

  const perFileCeiling = ASSET_MANIFEST_LIMITS.maxFileBytes;
  const filesToExceedSession = Math.floor(ASSET_MANIFEST_LIMITS.maxSessionBytes / perFileCeiling) + 1;
  assert.ok(filesToExceedSession < ASSET_MANIFEST_LIMITS.maxFiles, "the byte block must trip first");
  const tooHeavy = Array.from({ length: filesToExceedSession }, (_, index) =>
    file({ name: `bead-${index}.jpg`, webkitRelativePath: `批次/bead-${index}.jpg`, size: perFileCeiling })
  );
  const bytePlan = plan(tooHeavy);
  assert.equal(bytePlan.blockedBy, "SESSION_BYTE_LIMIT");
  assert.equal(canRegisterManifest(bytePlan), false);
  assert.equal(buildManifestRequest(bytePlan, "key-1"), null);
  assertClean(bytePlan.message ?? "", "session byte block message");
});

test("an empty selection is reported, never turned into an empty manifest", () => {
  const result = plan([]);
  assert.deepEqual(result.entries, []);
  assert.equal(result.blockedBy, null);
  assert.equal(canRegisterManifest(result), false);
  assert.equal(buildManifestRequest(result, "key-1"), null);
});

test("the manifest request satisfies the contract and keeps every generated id", () => {
  const ids = idGenerator("cf");
  const result = plan(
    [
      file({ name: "a.jpg", webkitRelativePath: "批次/a.jpg", size: 10, lastModified: 5 }),
      file({ name: "b.arw", webkitRelativePath: "批次/子目录/b.arw", size: 20, lastModified: 6 })
    ],
    ids
  );
  const request = buildManifestRequest(result, "idem-1");
  assert.ok(request !== null);
  assert.equal(RegisterAssetManifestRequestSchema.safeParse(request).success, true);
  assert.equal(request.idempotencyKey, "idem-1");
  assert.deepEqual(
    request.files.map((entry) => entry.clientFileId),
    ["cf-1", "cf-2"]
  );
  assert.deepEqual(request.files[1], {
    clientFileId: "cf-2",
    relativePath: "批次/子目录/b.arw",
    byteSize: 20,
    lastModifiedMs: 6,
    kind: "ARW"
  });
  for (const entry of request.files) {
    assert.equal(AssetImportManifestFileEntrySchema.safeParse(entry).success, true);
  }
});

test("a rejected file never consumes a client file id", () => {
  const ids = idGenerator("cf");
  const result = plan(
    [
      file({ name: "notes.txt", webkitRelativePath: "批次/notes.txt" }),
      file({ name: "a.jpg", webkitRelativePath: "批次/a.jpg" }),
      file({ name: "clip.mp4", webkitRelativePath: "批次/clip.mp4" })
    ],
    ids
  );
  assert.deepEqual(ids.issued, ["cf-1"]);
  assert.equal(result.entries[0]?.clientFileId, "cf-1");
});

test("a folder number is never treated as a crystal identity", () => {
  const result = plan([
    file({ name: "IMG_0001.JPG", webkitRelativePath: "001/白水晶/IMG_0001.JPG" })
  ]);
  const entry = result.entries[0];
  assert.ok(entry !== undefined);
  assert.equal(entry.kind, "JPEG", "only the declared file kind may be derived");
  assert.equal(entry.fileName, "IMG_0001.JPG");
  const serialized = JSON.stringify(entry);
  for (const forbidden of ["crystal", "sku", "variety", "quality", "material"]) {
    assert.ok(!serialized.toLowerCase().includes(forbidden), `${forbidden} must never be inferred client-side`);
  }
});

test("directory support is probed, never assumed", () => {
  assert.deepEqual(
    detectDirectorySupport({ inputPrototype: { webkitdirectory: "" }, hasGetAsEntry: true }),
    { folderInput: true, folderDrop: true }
  );
  assert.deepEqual(
    detectDirectorySupport({ inputPrototype: {}, hasGetAsEntry: false }),
    { folderInput: false, folderDrop: false }
  );
  assert.deepEqual(
    detectDirectorySupport({ inputPrototype: null, hasGetAsEntry: false }),
    { folderInput: false, folderDrop: false }
  );
  assert.deepEqual(
    detectDirectorySupport({ inputPrototype: { webkitdirectory: "" }, hasGetAsEntry: false }),
    { folderInput: true, folderDrop: false }
  );
});

test("no operator copy leaks a secret, an internal origin or a storage path", () => {
  const result = plan([
    file({ name: "a.jpg", webkitRelativePath: "/Users/operator/a.jpg" }),
    file({ name: "b.tiff", webkitRelativePath: "批次/b.tiff" }),
    file({ name: "c.jpg", webkitRelativePath: "批次/c.jpg", size: 0 })
  ]);
  for (const rejection of result.rejected) {
    assertClean(rejection.message, "rejection message");
    assertClean(rejection.fileName, "rejection label");
  }
  assertClean(result.message ?? "", "plan message");
});
