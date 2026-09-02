import assert from "node:assert/strict";
import test from "node:test";

import { PersistenceError } from "../errors/persistence-errors.js";
import {
  AssetImportRepository,
  manifestPayloadFingerprint,
  publishPayloadFingerprint,
  type AssetJobLease,
  type CompleteAssetJobResult,
  type PublishAssetGroupInput,
  type SaveGroupDraftInput
} from "./asset-import.repository.js";

// ---------------------------------------------------------------------------
// In-memory Prisma double
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

type UniqueConstraint = {
  name: string;
  fields: readonly string[];
  predicate?: (row: Row) => boolean;
};

function uniqueViolation(constraint: string): Error {
  return Object.assign(new Error(`Unique constraint failed: ${constraint}`), { code: "P2002" });
}

function notFound(): Error {
  return Object.assign(new Error("Record not found"), { code: "P2025" });
}

class MemoryTable {
  readonly rows: Row[] = [];
  private idCounter = 0;

  constructor(private readonly uniques: readonly UniqueConstraint[] = []) {}

  private fieldsPresent(row: Row, fields: readonly string[]): boolean {
    return fields.every((field) => row[field] !== null && row[field] !== undefined);
  }

  private uniqueKey(row: Row, fields: readonly string[]): string {
    return fields.map((field) => String(row[field])).join("\u0000");
  }

  private assertUniques(candidate: Row, exclude?: Row): void {
    for (const constraint of this.uniques) {
      if (constraint.predicate && !constraint.predicate(candidate)) continue;
      if (!this.fieldsPresent(candidate, constraint.fields)) continue;
      const key = this.uniqueKey(candidate, constraint.fields);
      const clash = this.rows.some(
        (existing) =>
          existing !== exclude &&
          (constraint.predicate ? constraint.predicate(existing) : true) &&
          this.fieldsPresent(existing, constraint.fields) &&
          this.uniqueKey(existing, constraint.fields) === key
      );
      if (clash) throw uniqueViolation(constraint.name);
    }
  }

  matches(row: Row, where: Record<string, unknown> | undefined): boolean {
    for (const [key, condition] of Object.entries(where ?? {})) {
      if (
        typeof condition === "object" &&
        condition !== null &&
        !Array.isArray(condition) &&
        !(condition instanceof Date)
      ) {
        if ("not" in condition) {
          if (row[key] === (condition as { not: unknown }).not) return false;
          continue;
        }
        if ("in" in condition) {
          const values = (condition as { in: unknown[] }).in;
          if (!values.includes(row[key])) return false;
          continue;
        }
        if ("gt" in condition) {
          if (!((row[key] as never) > ((condition as { gt: unknown }).gt as never))) return false;
          continue;
        }
        if ("lt" in condition) {
          if (!((row[key] as never) < ((condition as { lt: unknown }).lt as never))) return false;
          continue;
        }
      }
      if (row[key] !== condition) return false;
    }
    return true;
  }

  async create({ data }: { data: Row }): Promise<Row> {
    const row: Row = { ...data };
    if (row.id === undefined) row.id = `row-${++this.idCounter}`;
    this.assertUniques(row);
    this.rows.push(row);
    return structuredClone(row);
  }

  async findUnique({ where }: { where: Record<string, unknown> }): Promise<Row | null> {
    for (const [key, value] of Object.entries(where)) {
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const match = this.rows.find((row) =>
          Object.entries(value as Record<string, unknown>).every(([field, expected]) => row[field] === expected)
        );
        return match === undefined ? null : structuredClone(match);
      }
      const match = this.rows.find((row) => row[key] === value);
      return match === undefined ? null : structuredClone(match);
    }
    return null;
  }

  async findFirst({
    where,
    orderBy
  }: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, "asc" | "desc">;
  }): Promise<Row | null> {
    let candidates = this.rows.filter((row) => this.matches(row, where));
    for (const [field, direction] of Object.entries(orderBy ?? {})) {
      candidates = [...candidates].sort((left, right) => {
        const delta =
          (left[field] as never) > (right[field] as never)
            ? 1
            : (left[field] as never) < (right[field] as never)
              ? -1
              : 0;
        return direction === "desc" ? -delta : delta;
      });
    }
    const match = candidates[0];
    return match === undefined ? null : structuredClone(match);
  }

  async findMany({ where }: { where?: Record<string, unknown> }): Promise<Row[]> {
    return this.rows.filter((row) => this.matches(row, where)).map((row) => structuredClone(row));
  }

  async update({ where, data }: { where: Record<string, unknown>; data: Row }): Promise<Row> {
    let target: Row | undefined;
    for (const [key, value] of Object.entries(where)) {
      if (typeof value === "object" && value !== null) {
        target = this.rows.find((row) =>
          Object.entries(value as Record<string, unknown>).every(([field, expected]) => row[field] === expected)
        );
      } else {
        target = this.rows.find((row) => row[key] === value);
      }
      break;
    }
    if (target === undefined) throw notFound();
    const candidate = { ...target, ...data };
    this.assertUniques(candidate, target);
    Object.assign(target, data);
    return structuredClone(target);
  }

  async updateMany({
    where,
    data
  }: {
    where?: Record<string, unknown>;
    data: Row;
  }): Promise<{ count: number }> {
    const affected = this.rows.filter((row) => this.matches(row, where));
    for (const row of affected) {
      const candidate = { ...row, ...data };
      this.assertUniques(candidate, row);
      Object.assign(row, data);
    }
    return { count: affected.length };
  }
}

class PrismaDouble {
  readonly assetImportSession = new MemoryTable([
    { name: "asset_import_sessions_idempotency_key_key", fields: ["idempotencyKey"] }
  ]);
  readonly assetSourceFile = new MemoryTable([
    { name: "asset_source_files_session_id_client_file_id_key", fields: ["sessionId", "clientFileId"] },
    {
      name: "asset_source_files_session_sha256_archived_key",
      fields: ["sessionId", "sha256"],
      predicate: (row) => row.state === "ARCHIVED"
    }
  ]);
  readonly beadImageGroup = new MemoryTable();
  readonly crystalDraft = new MemoryTable();
  readonly materialProductDraft = new MemoryTable([
    { name: "material_product_drafts_group_id_key", fields: ["groupId"] }
  ]);
  readonly processedAsset = new MemoryTable([
    {
      name: "processed_assets_group_id_purpose_processing_version_key",
      fields: ["groupId", "purpose", "processingVersion"]
    },
    {
      name: "processed_assets_current_version_key",
      fields: ["groupId", "purpose"],
      predicate: (row) => row.isCurrentVersion === true
    }
  ]);
  readonly productAssetBinding = new MemoryTable([
    {
      name: "product_asset_bindings_active_product_asset_key",
      fields: ["materialProductId", "purpose"],
      predicate: (row) => row.bindingStatus === "APPROVED"
    }
  ]);
  readonly beadGroupPublication = new MemoryTable([
    { name: "bead_group_publications_idempotency_key_key", fields: ["idempotencyKey"] },
    { name: "bead_group_publications_group_id_key", fields: ["groupId"] }
  ]);
  readonly assetProcessingJob = new MemoryTable();
  readonly crystal = new MemoryTable();
  readonly materialProduct = new MemoryTable([{ name: "material_products_sku_key", fields: ["sku"] }]);
  readonly inventorySnapshot = new MemoryTable([
    {
      name: "inventory_snapshots_product_type_product_id_source_version_key",
      fields: ["productType", "productId", "sourceVersion"]
    }
  ]);

  private tables(): MemoryTable[] {
    return [
      this.assetImportSession,
      this.assetSourceFile,
      this.beadImageGroup,
      this.crystalDraft,
      this.materialProductDraft,
      this.processedAsset,
      this.productAssetBinding,
      this.beadGroupPublication,
      this.assetProcessingJob,
      this.crystal,
      this.materialProduct,
      this.inventorySnapshot
    ];
  }

  async $transaction<T>(fn: (tx: PrismaDouble) => Promise<T>): Promise<T> {
    const snapshot = this.tables().map((table) => structuredClone(table.rows));
    try {
      return await fn(this);
    } catch (error) {
      this.tables().forEach((table, index) => {
        table.rows.splice(0, table.rows.length, ...snapshot[index]!);
      });
      throw error;
    }
  }

  // Row-lock statements (`SELECT ... FOR UPDATE`) are concurrency primitives;
  // the in-memory double is single-threaded, so they resolve to a no-op.
  async $queryRaw(): Promise<Array<Record<string, unknown>>> {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);
const ARCHIVE_KEY = "imports/session-1/raw/a-file.jpg";

const untouchableClient = new Proxy(
  {},
  {
    get() {
      throw new Error("database client must not be touched during input validation");
    }
  }
) as never;

function newDouble(): PrismaDouble {
  return new PrismaDouble();
}

async function createSessionWithFiles(
  prisma: PrismaDouble,
  options: { sessionId?: string; clientFileIds?: string[] } = {}
): Promise<{ sessionId: string; fileIds: string[] }> {
  const repository = new AssetImportRepository(prisma as never);
  const session = await repository.createSession({ idempotencyKey: `session-key-${Math.random()}` });
  const sessionId = options.sessionId ?? session.sessionId;
  const clientFileIds = options.clientFileIds ?? ["cf-1"];
  const registered = await repository.registerManifest(sessionId, {
    idempotencyKey: "manifest-key-1",
    files: clientFileIds.map((clientFileId) => ({
      clientFileId,
      relativePath: `folder/${clientFileId}.jpg`,
      byteSize: 1024,
      lastModifiedMs: 1_700_000_000_000,
      kind: "JPEG" as const
    }))
  });
  return { sessionId, fileIds: registered.files.map((file) => file.fileId) };
}

async function createGroupFixture(prisma: PrismaDouble): Promise<{ sessionId: string; groupId: string }> {
  const { sessionId, fileIds } = await createSessionWithFiles(prisma, {
    clientFileIds: ["cf-1", "cf-2"]
  });
  const group = await prisma.beadImageGroup.create({
    data: {
      sessionId,
      state: "NAMED",
      revision: 1,
      crystalName: "海蓝宝"
    }
  });
  await prisma.assetSourceFile.update({
    where: { id: fileIds[0]! },
    data: { groupId: group.id as string }
  });
  return { sessionId, groupId: group.id as string };
}

async function seedApprovedCurrentAsset(prisma: PrismaDouble, groupId: string): Promise<string> {
  const file = await prisma.assetSourceFile.findFirst({ where: { groupId } });
  await prisma.processedAsset.create({
    data: {
      sourceFileId: file?.id ?? "file-x",
      groupId,
      purpose: "MAIN",
      processingVersion: 1,
      state: "APPROVED",
      storageProvider: "local-fs",
      storageKey: "imports/s/processed/g/v1/bead-512.webp",
      assetKey: `approved:${VALID_SHA}`,
      outputSha256: VALID_SHA,
      outputBytes: 4096n,
      outputContentType: "image/webp",
      qcResult: { passed: true, checks: [] },
      qcPassedAt: new Date("2026-08-31T00:00:00.000Z"),
      usagePermission: "OWNED",
      isAuthenticPhotograph: true,
      allowCommercialUse: true,
      allowPublicDisplay: true,
      isCurrentVersion: true,
      approvedAt: new Date("2026-08-31T00:00:00.000Z")
    }
  });
  return `approved:${VALID_SHA}`;
}

function publishInput(overrides: Partial<PublishAssetGroupInput> = {}): PublishAssetGroupInput {
  return {
    idempotencyKey: "publish-key-1",
    expectedGroupRevision: 1,
    crystalId: "crystal-aquamarine",
    crystalName: "海蓝宝",
    crystalNameConfirmedByOperator: true,
    displayName: "海蓝宝圆珠 8mm",
    sku: "SKU-AQ-8-CNY",
    materialKey: "aq-8-material",
    shape: "ROUND",
    diameterMm: 8,
    qualityStatement: "品相完整，无裂痕",
    qualitySource: "供应商证书",
    textureAssetKey: `approved:${VALID_SHA}`,
    currency: "CNY",
    unitPriceMinor: 1200,
    costMinor: 500,
    availableQuantity: 50,
    allowPublicDisplay: true,
    allowAiRecommendation: true,
    allowAiTraining: false,
    allowCommercialUse: true,
    rightsHolder: "Mystcrag Studio",
    usagePermission: "OWNED",
    isAuthenticPhotograph: true,
    ...overrides
  };
}

async function expectValidationError(run: () => Promise<unknown>, field: string): Promise<void> {
  await assert.rejects(
    run,
    (error: unknown) => {
      assert.ok(error instanceof PersistenceError, `expected PersistenceError, got ${String(error)}`);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.match(error.message, new RegExp(field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      return true;
    }
  );
}

// ---------------------------------------------------------------------------
// 1. Input validation never touches the database
// ---------------------------------------------------------------------------

test("createSession rejects invalid idempotency keys before database access", async () => {
  const repository = new AssetImportRepository(untouchableClient);
  await expectValidationError(() => repository.createSession({ idempotencyKey: "" }), "idempotencyKey");
  await expectValidationError(
    () => repository.createSession({ idempotencyKey: "x".repeat(161) }),
    "idempotencyKey"
  );
  await expectValidationError(
    () => repository.createSession({ idempotencyKey: "bad\nkey" }),
    "idempotencyKey"
  );
});

test("registerManifest rejects invalid manifests before database access", async () => {
  const repository = new AssetImportRepository(untouchableClient);
  const validFile = {
    clientFileId: "cf-1",
    relativePath: "folder/bead.jpg",
    byteSize: 1024,
    lastModifiedMs: 1_700_000_000_000,
    kind: "JPEG" as const
  };
  await expectValidationError(
    () => repository.registerManifest("session-1", { idempotencyKey: "", files: [validFile] }),
    "idempotencyKey"
  );
  await expectValidationError(
    () => repository.registerManifest("session-1", { idempotencyKey: "k", files: [] }),
    "files"
  );
  await expectValidationError(
    () =>
      repository.registerManifest("session-1", {
        idempotencyKey: "k",
        files: [{ ...validFile, relativePath: "../escape.jpg" }]
      }),
    "relativePath"
  );
  await expectValidationError(
    () =>
      repository.registerManifest("session-1", {
        idempotencyKey: "k",
        files: [
          validFile,
          { ...validFile, relativePath: "folder/bead-copy.jpg" }
        ]
      }),
    "clientFileId"
  );
  await expectValidationError(
    () =>
      repository.registerManifest("session-1", {
        idempotencyKey: "k",
        files: [{ ...validFile, relativePath: "folder/bead.txt", kind: "JPEG" }]
      }),
    "kind"
  );
});

test("recordUploadedFile rejects malformed hashes and archive keys before database access", async () => {
  const repository = new AssetImportRepository(untouchableClient);
  await expectValidationError(
    () => repository.recordUploadedFile("file-1", "not-a-hash", ARCHIVE_KEY),
    "sha256"
  );
  await expectValidationError(
    () => repository.recordUploadedFile("file-1", VALID_SHA, "/absolute/path.jpg"),
    "archiveKey"
  );
  await expectValidationError(
    () => repository.recordUploadedFile("file-1", VALID_SHA, "../traversal.jpg"),
    "archiveKey"
  );
});

test("claimNextJob rejects invalid worker input before database access", async () => {
  const repository = new AssetImportRepository(untouchableClient);
  await expectValidationError(
    () => repository.claimNextJob("", new Date(Date.now() + 60_000)),
    "workerId"
  );
  await expectValidationError(
    () => repository.claimNextJob("worker-1", new Date(Date.now() - 60_000)),
    "leaseUntil"
  );
});

test("saveGroupDraft rejects contradictory draft input before database access", async () => {
  const repository = new AssetImportRepository(untouchableClient);
  await expectValidationError(
    () => repository.saveGroupDraft("group-1", { expectedGroupRevision: 1 }),
    "at least one product field"
  );
  await expectValidationError(
    () =>
      repository.saveGroupDraft("group-1", {
        expectedGroupRevision: 1,
        crystalId: "crystal-1",
        crystalDraftId: "draft-1",
        crystalName: "海蓝宝"
      }),
    "not both"
  );
});

test("publishGroup rejects contract-invalid publish payloads before database access", async () => {
  const repository = new AssetImportRepository(untouchableClient);
  await expectValidationError(() => repository.publishGroup("group-1", publishInput({ sku: "" })), "sku");
  await expectValidationError(
    () => repository.publishGroup("group-1", publishInput({ usagePermission: "PROHIBITED" as never })),
    "usagePermission"
  );
  await expectValidationError(
    () => repository.publishGroup("group-1", publishInput({ allowPublicDisplay: false as never })),
    "allowPublicDisplay"
  );
  await expectValidationError(
    () => repository.publishGroup("group-1", publishInput({ textureAssetKey: "not-approved-key" })),
    "textureAssetKey"
  );
});

test("job completion and failure inputs are validated before database access", async () => {
  const repository = new AssetImportRepository(untouchableClient);
  const lease: AssetJobLease = { workerId: "worker-1", leaseToken: "token-1" };
  const result: CompleteAssetJobResult = {
    kind: "ARCHIVE_FILE",
    sha256: VALID_SHA,
    archiveKey: ARCHIVE_KEY,
    storageProvider: "local-fs"
  };
  await expectValidationError(
    () => repository.completeJob("job-1", result, { workerId: "", leaseToken: "token" }),
    "workerId"
  );
  await expectValidationError(
    () => repository.completeJob("job-1", result, { workerId: "worker-1", leaseToken: "" }),
    "leaseToken"
  );
  await expectValidationError(
    () => repository.failJob("job-1", { code: "", message: "boom" }, null, lease),
    "code"
  );
  await expectValidationError(
    () =>
      repository.failJob(
        "job-1",
        { code: "SEGMENTATION_FAILED", message: "x".repeat(4_001) },
        null,
        lease
      ),
    "message"
  );
});

// ---------------------------------------------------------------------------
// 2. Session creation and idempotency
// ---------------------------------------------------------------------------

test("createSession returns the same session for a repeated idempotency key", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const first = await repository.createSession({ idempotencyKey: "stable-key" });
  assert.equal(first.created, true);
  assert.equal(first.state, "CREATED");
  const second = await repository.createSession({ idempotencyKey: "stable-key" });
  assert.equal(second.created, false);
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(await prisma.assetImportSession.findMany({}).then((rows) => rows.length), 1);
});

// ---------------------------------------------------------------------------
// 3. Manifest idempotency and conflicts
// ---------------------------------------------------------------------------

test("registerManifest is idempotent for an identical manifest retry", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const session = await repository.createSession({ idempotencyKey: "session-key" });
  const manifest = {
    idempotencyKey: "manifest-key",
    files: [
      {
        clientFileId: "cf-1",
        relativePath: "folder/bead.jpg",
        byteSize: 1024,
        lastModifiedMs: 1_700_000_000_000,
        kind: "JPEG" as const
      }
    ]
  };
  const first = await repository.registerManifest(session.sessionId, manifest);
  assert.equal(first.registeredFileCount, 1);
  const retry = await repository.registerManifest(session.sessionId, manifest);
  assert.equal(retry.registeredFileCount, 1);
  assert.equal(retry.files[0]!.fileId, first.files[0]!.fileId);
  assert.equal(
    await prisma.assetSourceFile.findMany({}).then((rows) => rows.length),
    1
  );
});

test("registerManifest conflicts when the same key carries a different manifest", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const session = await repository.createSession({ idempotencyKey: "session-key" });
  await repository.registerManifest(session.sessionId, {
    idempotencyKey: "manifest-key",
    files: [
      {
        clientFileId: "cf-1",
        relativePath: "folder/bead.jpg",
        byteSize: 1024,
        lastModifiedMs: 1_700_000_000_000,
        kind: "JPEG" as const
      }
    ]
  });
  await assert.rejects(
    () =>
      repository.registerManifest(session.sessionId, {
        idempotencyKey: "manifest-key",
        files: [
          {
            clientFileId: "cf-2",
            relativePath: "folder/bead2.jpg",
            byteSize: 2048,
            lastModifiedMs: 1_700_000_000_000,
            kind: "JPEG" as const
          }
        ]
      }),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

test("registerManifest returns the original fileId for re-declared consistent entries", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const session = await repository.createSession({ idempotencyKey: "session-key" });
  const file = {
    clientFileId: "cf-1",
    relativePath: "folder/bead.jpg",
    byteSize: 1024,
    lastModifiedMs: 1_700_000_000_000,
    kind: "JPEG" as const
  };
  await repository.registerManifest(session.sessionId, {
    idempotencyKey: "manifest-1",
    files: [file]
  });
  const second = await repository.registerManifest(session.sessionId, {
    idempotencyKey: "manifest-2",
    files: [file]
  });
  assert.equal(second.registeredFileCount, 1);
  const rows = await prisma.assetSourceFile.findMany({});
  assert.equal(rows.length, 1);
  assert.equal(second.files[0]!.fileId, rows[0]!.id);
});

test("registerManifest conflicts when a re-declared clientFileId carries different metadata", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const session = await repository.createSession({ idempotencyKey: "session-key" });
  await repository.registerManifest(session.sessionId, {
    idempotencyKey: "manifest-1",
    files: [
      {
        clientFileId: "cf-1",
        relativePath: "folder/bead.jpg",
        byteSize: 1024,
        lastModifiedMs: 1_700_000_000_000,
        kind: "JPEG" as const
      }
    ]
  });
  await assert.rejects(
    () =>
      repository.registerManifest(session.sessionId, {
        idempotencyKey: "manifest-2",
        files: [
          {
            clientFileId: "cf-1",
            relativePath: "folder/bead.jpg",
            byteSize: 4096,
            lastModifiedMs: 1_700_000_000_000,
            kind: "JPEG" as const
          }
        ]
      }),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

test("registerManifest rejects illegal session states", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const session = await repository.createSession({ idempotencyKey: "session-key" });
  await prisma.assetImportSession.update({
    where: { id: session.sessionId },
    data: { state: "PUBLISHED" }
  });
  await assert.rejects(
    () =>
      repository.registerManifest(session.sessionId, {
        idempotencyKey: "manifest-1",
        files: [
          {
            clientFileId: "cf-1",
            relativePath: "folder/bead.jpg",
            byteSize: 1024,
            lastModifiedMs: 1_700_000_000_000,
            kind: "JPEG" as const
          }
        ]
      }),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

test("registerManifest advances CREATED sessions to UPLOADING and counts bytes", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const session = await repository.createSession({ idempotencyKey: "session-key" });
  await repository.registerManifest(session.sessionId, {
    idempotencyKey: "manifest-1",
    files: [
      {
        clientFileId: "cf-1",
        relativePath: "folder/bead.jpg",
        byteSize: 1024,
        lastModifiedMs: 1_700_000_000_000,
        kind: "JPEG" as const
      },
      {
        clientFileId: "cf-2",
        relativePath: "folder/bead2.jpg",
        byteSize: 2048,
        lastModifiedMs: 1_700_000_000_000,
        kind: "JPEG" as const
      }
    ]
  });
  const row = await prisma.assetImportSession.findUnique({ where: { id: session.sessionId } });
  assert.equal(row?.state, "UPLOADING");
  assert.equal(row?.declaredFileCount, 2);
  assert.equal(row?.declaredBytes, 3072n);
});

test("registerManifest reports unknown sessions as NOT_FOUND", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  await assert.rejects(
    () =>
      repository.registerManifest("missing-session", {
        idempotencyKey: "manifest-1",
        files: [
          {
            clientFileId: "cf-1",
            relativePath: "folder/bead.jpg",
            byteSize: 1024,
            lastModifiedMs: 1_700_000_000_000,
            kind: "JPEG" as const
          }
        ]
      }),
    (error: unknown) => error instanceof PersistenceError && error.code === "NOT_FOUND"
  );
});

// ---------------------------------------------------------------------------
// 4. Uploaded file archival, SHA-256 idempotency and conflicts
// ---------------------------------------------------------------------------

test("recordUploadedFile archives a pending file and updates session counters", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { sessionId, fileIds } = await createSessionWithFiles(prisma);
  const archived = await repository.recordUploadedFile(fileIds[0]!, VALID_SHA, ARCHIVE_KEY, {
    storageProvider: "local-fs"
  });
  assert.equal(archived.uploadStatus, "ARCHIVED");
  assert.equal(archived.sha256, VALID_SHA);
  assert.equal(archived.archiveKey, ARCHIVE_KEY);
  const session = await prisma.assetImportSession.findUnique({ where: { id: sessionId } });
  assert.equal(session?.archivedFileCount, 1);
  assert.equal(session?.uploadedBytes, 1024n);
  assert.equal(session?.lastVerifiedCheckpoint, "ARCHIVED");
});

test("recordUploadedFile is idempotent for the same hash and archive key", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { fileIds } = await createSessionWithFiles(prisma);
  const first = await repository.recordUploadedFile(fileIds[0]!, VALID_SHA, ARCHIVE_KEY);
  const retry = await repository.recordUploadedFile(fileIds[0]!, VALID_SHA, ARCHIVE_KEY);
  assert.equal(retry.uploadStatus, "ARCHIVED");
  assert.equal(retry.fileId, first.fileId);
  assert.equal(retry.archivedAt!.getTime(), first.archivedAt!.getTime());
});

test("recordUploadedFile conflicts when the same file reports a different hash", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { fileIds } = await createSessionWithFiles(prisma);
  await repository.recordUploadedFile(fileIds[0]!, VALID_SHA, ARCHIVE_KEY);
  await assert.rejects(
    () => repository.recordUploadedFile(fileIds[0]!, OTHER_SHA, ARCHIVE_KEY),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

test("recordUploadedFile skips an exact duplicate within the session", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { fileIds } = await createSessionWithFiles(prisma, { clientFileIds: ["cf-1", "cf-2"] });
  await repository.recordUploadedFile(fileIds[0]!, VALID_SHA, ARCHIVE_KEY);
  const duplicate = await repository.recordUploadedFile(fileIds[1]!, VALID_SHA, ARCHIVE_KEY);
  assert.equal(duplicate.uploadStatus, "SKIPPED_DUPLICATE");
  assert.equal(duplicate.archiveKey, ARCHIVE_KEY);
  const row = await prisma.assetSourceFile.findUnique({ where: { id: fileIds[1]! } });
  assert.equal(row?.duplicateOfId, fileIds[0]);
  const sessionFiles = await prisma.assetSourceFile.findMany({});
  assert.equal(sessionFiles.filter((file) => file.state === "ARCHIVED").length, 1);
});

// ---------------------------------------------------------------------------
// 5. Group draft save and revision compare-and-set
// ---------------------------------------------------------------------------

test("saveGroupDraft persists fields, advances revision and marks the group NAMED", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { sessionId } = await createSessionWithFiles(prisma);
  const group = await prisma.beadImageGroup.create({
    data: { sessionId, state: "SUGGESTED", revision: 1 }
  });
  const saved = await repository.saveGroupDraft(group.id as string, {
    expectedGroupRevision: 1,
    crystalName: "海蓝宝",
    displayName: "海蓝宝圆珠 8mm",
    unitPriceMinor: 1200
  });
  assert.equal(saved.state, "NAMED");
  assert.equal(saved.revision, 2);
  const draft = await prisma.materialProductDraft.findUnique({
    where: { groupId: group.id as string }
  });
  assert.equal(draft?.crystalName, "海蓝宝");
  assert.equal(draft?.displayName, "海蓝宝圆珠 8mm");
  assert.equal(draft?.unitPriceMinor, 1200n);
  const groupRow = await prisma.beadImageGroup.findUnique({ where: { id: group.id as string } });
  assert.equal(groupRow?.crystalName, "海蓝宝");
});

test("saveGroupDraft keeps a READY group reviewable instead of regressing it to NAMED", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { sessionId } = await createSessionWithFiles(prisma);
  const group = await prisma.beadImageGroup.create({
    data: { sessionId, state: "READY", revision: 2 }
  });
  const saved = await repository.saveGroupDraft(group.id as string, {
    expectedGroupRevision: 2,
    displayName: "海蓝宝圆珠 8mm",
    unitPriceMinor: 1200
  });
  assert.equal(saved.state, "READY");
  assert.equal(saved.revision, 3);
  const groupRow = await prisma.beadImageGroup.findUnique({ where: { id: group.id as string } });
  assert.equal(groupRow?.state, "READY");
});

test("saveGroupDraft creates a crystal draft when no crystal reference is given", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { sessionId } = await createSessionWithFiles(prisma);
  const group = await prisma.beadImageGroup.create({
    data: { sessionId, state: "SUGGESTED", revision: 1 }
  });
  await repository.saveGroupDraft(group.id as string, {
    expectedGroupRevision: 1,
    crystalName: "新水晶"
  });
  const drafts = await prisma.crystalDraft.findMany({});
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0]!.nameCn, "新水晶");
  const groupRow = await prisma.beadImageGroup.findUnique({ where: { id: group.id as string } });
  assert.equal(groupRow?.crystalDraftId, drafts[0]!.id);
});

test("saveGroupDraft rejects a stale revision with CONFLICT", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { sessionId } = await createSessionWithFiles(prisma);
  const group = await prisma.beadImageGroup.create({
    data: { sessionId, state: "SUGGESTED", revision: 4 }
  });
  await assert.rejects(
    () =>
      repository.saveGroupDraft(group.id as string, {
        expectedGroupRevision: 3,
        crystalName: "海蓝宝"
      }),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

test("saveGroupDraft rejects unknown groups with NOT_FOUND", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  await assert.rejects(
    () =>
      repository.saveGroupDraft("missing-group", {
        expectedGroupRevision: 1,
        crystalName: "海蓝宝"
      }),
    (error: unknown) => error instanceof PersistenceError && error.code === "NOT_FOUND"
  );
});

// ---------------------------------------------------------------------------
// 6. Job lease compare-and-set, retry counts and QC result recording
// ---------------------------------------------------------------------------

async function seedRunningJob(
  prisma: PrismaDouble,
  options: {
    leaseToken?: string;
    workerId?: string;
    leaseUntil?: Date;
    retryCount?: number;
    maxRetries?: number;
    groupId?: string;
    state?: string;
  } = {}
): Promise<string> {
  const { sessionId } = await createSessionWithFiles(prisma);
  const job = await prisma.assetProcessingJob.create({
    data: {
      sessionId,
      groupId: options.groupId ?? null,
      jobType: "PROCESS_GROUP",
      state: options.state ?? "RUNNING",
      payload: {},
      retryCount: options.retryCount ?? 0,
      maxRetries: options.maxRetries ?? 3,
      workerId: options.workerId ?? "worker-1",
      leaseToken: options.leaseToken ?? "lease-token-1",
      leaseUntil: options.leaseUntil ?? new Date(Date.now() + 60_000)
    }
  });
  return job.id as string;
}

test("heartbeatJob extends only the matching unexpired lease", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const jobId = await seedRunningJob(prisma, { workerId: "worker-1" });
  const nextLease = new Date(Date.now() + 120_000);
  assert.equal(
    await repository.heartbeatJob(jobId, { workerId: "worker-1", leaseToken: "lease-token-1" }, nextLease),
    true
  );
  const row = await prisma.assetProcessingJob.findUnique({ where: { id: jobId } });
  assert.equal((row?.leaseUntil as Date).getTime(), nextLease.getTime());

  assert.equal(
    await repository.heartbeatJob(jobId, { workerId: "worker-2", leaseToken: "lease-token-1" }, nextLease),
    false
  );
  assert.equal(
    await repository.heartbeatJob(jobId, { workerId: "worker-1", leaseToken: "lease-token-1" }, new Date(Date.now() - 1_000)),
    false
  );
});

test("heartbeatJob rejects an expired lease", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const jobId = await seedRunningJob(prisma, {
    leaseUntil: new Date(Date.now() - 1_000)
  });
  assert.equal(
    await repository.heartbeatJob(jobId, { workerId: "worker-1", leaseToken: "lease-token-1" }, new Date(Date.now() + 60_000)),
    false
  );
});

async function seedGroupForProcessing(
  prisma: PrismaDouble
): Promise<{ groupId: string; jobId: string; sourceFileId: string }> {
  const { sessionId, fileIds } = await createSessionWithFiles(prisma);
  const group = await prisma.beadImageGroup.create({
    data: { sessionId, state: "NAMED", revision: 1, crystalName: "海蓝宝" }
  });
  await prisma.assetSourceFile.update({ where: { id: fileIds[0]! }, data: { groupId: group.id as string } });
  const job = await prisma.assetProcessingJob.create({
    data: {
      sessionId,
      groupId: group.id as string,
      jobType: "PROCESS_GROUP",
      state: "RUNNING",
      payload: {},
      retryCount: 0,
      maxRetries: 3,
      workerId: "worker-1",
      leaseToken: "lease-token-1",
      leaseUntil: new Date(Date.now() + 60_000)
    }
  });
  const file = await prisma.assetSourceFile.findUnique({ where: { id: fileIds[0]! } });
  return { groupId: group.id as string, jobId: job.id as string, sourceFileId: file!.id as string };
}

function processResult(overrides: Record<string, unknown> = {}): CompleteAssetJobResult {
  return {
    kind: "PROCESS_GROUP",
    processingVersion: 1,
    output: {
      sourceFileId: "",
      purpose: "MAIN",
      storageProvider: "local-fs",
      storageKey: "imports/s/processed/g/v1/bead-512.webp",
      outputSha256: VALID_SHA,
      outputContentType: "image/webp",
      byteSize: 4096,
      widthPx: 512,
      heightPx: 512,
      processorVersion: "sharp-1.0.0",
      parameters: { maskThreshold: 0.5 }
    },
    qc: { passed: true, checks: [{ id: "alpha-coverage", passed: true, detail: null }], summary: null },
    ...overrides
  } as CompleteAssetJobResult;
}

function reviewDecision(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    usagePermission: "OWNED",
    rightsHolder: "Mystcrag Studio",
    isAuthenticPhotograph: true,
    allowPublicDisplay: true,
    allowCommercialUse: true,
    allowAiTraining: false,
    allowAiRecommendation: true,
    ...overrides
  };
}

test("completeJob leaves a QC-passed asset pending human review, never APPROVED", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId, jobId, sourceFileId } = await seedGroupForProcessing(prisma);
  const result = processResult();
  (result as { output: { sourceFileId: string } }).output.sourceFileId = sourceFileId;
  const completed = await repository.completeJob(jobId, result, {
    workerId: "worker-1",
    leaseToken: "lease-token-1"
  });
  assert.equal(completed.state, "COMPLETED");
  const assets = await prisma.processedAsset.findMany({ where: { groupId } });
  assert.equal(assets.length, 1);
  assert.equal(assets[0]!.state, "QC_PENDING", "automatic QC pass must await human review");
  assert.equal(assets[0]!.assetKey, null, "the public asset key is minted by human approval, not by the worker");
  assert.equal(assets[0]!.approvedAt, null);
  assert.equal(assets[0]!.isCurrentVersion, true);
  assert.ok(assets[0]!.qcPassedAt);
  assert.equal(assets[0]!.usagePermission, "UNKNOWN");
  assert.equal(assets[0]!.rightsHolder, null);
  assert.equal(assets[0]!.isAuthenticPhotograph, false);
  assert.equal(assets[0]!.allowPublicDisplay, false);
  assert.equal(assets[0]!.allowCommercialUse, false);
  assert.equal(assets[0]!.allowAiTraining, null);
  assert.equal(assets[0]!.allowAiRecommendation, null);
  const group = await prisma.beadImageGroup.findUnique({ where: { id: groupId } });
  assert.equal(group?.state, "READY");
});

test("completeJob rejects worker-submitted permission decisions", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId, jobId, sourceFileId } = await seedGroupForProcessing(prisma);
  const result = processResult({
    usagePermission: "OWNED",
    isAuthenticPhotograph: true,
    allowCommercialUse: true,
    allowPublicDisplay: true
  });
  (result as { output: { sourceFileId: string } }).output.sourceFileId = sourceFileId;
  await assert.rejects(
    () =>
      repository.completeJob(jobId, result, {
        workerId: "worker-1",
        leaseToken: "lease-token-1"
      }),
    (error: unknown) => error instanceof PersistenceError && error.code === "VALIDATION_ERROR",
    "a worker result carrying permission decisions must be rejected before any write"
  );
  assert.equal((await prisma.processedAsset.findMany({ where: { groupId } })).length, 0);
});

test("reviewProcessedAsset approves the current QC-passed version with operator permissions", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId, jobId, sourceFileId } = await seedGroupForProcessing(prisma);
  const result = processResult();
  (result as { output: { sourceFileId: string } }).output.sourceFileId = sourceFileId;
  await repository.completeJob(jobId, result, {
    workerId: "worker-1",
    leaseToken: "lease-token-1"
  });
  const pending = await prisma.processedAsset.findFirst({ where: { groupId } });
  assert.ok(pending);
  const review = await repository.reviewProcessedAsset(
    pending!.id as string,
    reviewDecision() as never
  );
  assert.equal(review.state, "APPROVED");
  assert.equal(review.assetKey, `approved:${VALID_SHA}`);
  assert.ok(review.approvedAt);
  const approved = await prisma.processedAsset.findUnique({ where: { id: pending!.id as string } });
  assert.equal(approved?.state, "APPROVED");
  assert.equal(approved?.assetKey, `approved:${VALID_SHA}`);
  assert.ok(approved?.approvedAt);
  assert.equal(approved?.usagePermission, "OWNED");
  assert.equal(approved?.rightsHolder, "Mystcrag Studio");
  assert.equal(approved?.isAuthenticPhotograph, true);
  assert.equal(approved?.allowPublicDisplay, true);
  assert.equal(approved?.allowCommercialUse, true);
  assert.equal(approved?.allowAiTraining, false);
  assert.equal(approved?.allowAiRecommendation, true);
});

test("reviewProcessedAsset refuses assets outside the pending-review window", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId, jobId, sourceFileId } = await seedGroupForProcessing(prisma);
  const result = processResult();
  (result as { output: { sourceFileId: string } }).output.sourceFileId = sourceFileId;
  await repository.completeJob(jobId, result, {
    workerId: "worker-1",
    leaseToken: "lease-token-1"
  });
  const pending = (await prisma.processedAsset.findFirst({ where: { groupId } }))!;

  await assert.rejects(
    () => repository.reviewProcessedAsset("asset-does-not-exist", reviewDecision() as never),
    (error: unknown) => error instanceof PersistenceError && error.code === "NOT_FOUND"
  );

  await repository.reviewProcessedAsset(pending!.id as string, reviewDecision() as never);
  await assert.rejects(
    () => repository.reviewProcessedAsset(pending!.id as string, reviewDecision() as never),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT",
    "double review of the same asset must conflict"
  );

  const prismaFailed = newDouble();
  const repositoryFailed = new AssetImportRepository(prismaFailed as never);
  const failedFixture = await seedGroupForProcessing(prismaFailed);
  const failedResult = processResult({
    qc: { passed: false, checks: [{ id: "blur", passed: false }], summary: null }
  });
  (failedResult as { output: { sourceFileId: string } }).output.sourceFileId =
    failedFixture.sourceFileId;
  await repositoryFailed.completeJob(failedFixture.jobId, failedResult, {
    workerId: "worker-1",
    leaseToken: "lease-token-1"
  });
  const failedAsset = (await prismaFailed.processedAsset.findFirst({
    where: { groupId: failedFixture.groupId }
  }))!;
  await assert.rejects(
    () => repositoryFailed.reviewProcessedAsset(failedAsset!.id as string, reviewDecision() as never),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT",
    "a QC-failed asset can never be human-approved"
  );

  const prismaStale = newDouble();
  const repositoryStale = new AssetImportRepository(prismaStale as never);
  const { groupId: staleGroupId } = await createGroupFixture(prismaStale);
  const file = await prismaStale.assetSourceFile.findFirst({ where: { groupId: staleGroupId } });
  await prismaStale.processedAsset.create({
    data: {
      sourceFileId: file?.id ?? "file-x",
      groupId: staleGroupId,
      purpose: "MAIN",
      processingVersion: 1,
      state: "QC_PENDING",
      storageProvider: "local-fs",
      storageKey: "imports/s/processed/g/v1/bead-512.webp",
      outputSha256: VALID_SHA,
      outputBytes: 4096n,
      outputContentType: "image/webp",
      qcResult: { passed: true, checks: [] },
      qcPassedAt: null,
      isCurrentVersion: true
    }
  });
  const neverQcAsset = (await prismaStale.processedAsset.findFirst({
    where: { groupId: staleGroupId }
  }))!;
  await assert.rejects(
    () =>
      repositoryStale.reviewProcessedAsset(neverQcAsset!.id as string, reviewDecision() as never),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT",
    "an asset that never passed automatic QC cannot be approved"
  );

  const prismaOld = newDouble();
  const repositoryOld = new AssetImportRepository(prismaOld as never);
  const { groupId: oldGroupId } = await createGroupFixture(prismaOld);
  const oldFile = await prismaOld.assetSourceFile.findFirst({ where: { groupId: oldGroupId } });
  await prismaOld.processedAsset.create({
    data: {
      sourceFileId: oldFile?.id ?? "file-x",
      groupId: oldGroupId,
      purpose: "MAIN",
      processingVersion: 1,
      state: "QC_PENDING",
      storageProvider: "local-fs",
      storageKey: "imports/s/processed/g/v1/bead-512.webp",
      outputSha256: VALID_SHA,
      outputBytes: 4096n,
      outputContentType: "image/webp",
      qcResult: { passed: true, checks: [] },
      qcPassedAt: new Date("2026-08-31T00:00:00.000Z"),
      isCurrentVersion: false
    }
  });
  const oldAsset = (await prismaOld.processedAsset.findFirst({
    where: { groupId: oldGroupId }
  }))!;
  await assert.rejects(
    () => repositoryOld.reviewProcessedAsset(oldAsset!.id as string, reviewDecision() as never),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT",
    "only the current version of a purpose can be human-approved"
  );
});

test("reviewProcessedAsset validates the operator decision before database access", async () => {
  const repository = new AssetImportRepository(untouchableClient);
  await expectValidationError(
    () => repository.reviewProcessedAsset("asset-1", {} as never),
    "rightsHolder"
  );
  await expectValidationError(
    () =>
      repository.reviewProcessedAsset("asset-1", reviewDecision({ usagePermission: "GUESSING" }) as never),
    "usagePermission"
  );
  await expectValidationError(
    () => repository.reviewProcessedAsset("asset-1", reviewDecision({ rightsHolder: "   " }) as never),
    "rightsHolder"
  );
});

test("publishGroup fails closed until the QC-passed asset is human-approved", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId, jobId, sourceFileId } = await seedGroupForProcessing(prisma);
  await prisma.crystal.create({
    data: {
      id: "crystal-aquamarine",
      nameCn: "海蓝宝",
      nameEn: "Aquamarine",
      mineralName: "Beryl",
      gemologicalInfo: {},
      colorTags: [],
      visualTags: [],
      styleTags: [],
      emotionTags: [],
      cultureTags: [],
      priceLevel: 2,
      complianceNote: "ok"
    }
  });
  const result = processResult();
  (result as { output: { sourceFileId: string } }).output.sourceFileId = sourceFileId;
  await repository.completeJob(jobId, result, {
    workerId: "worker-1",
    leaseToken: "lease-token-1"
  });
  const pending = (await prisma.processedAsset.findFirst({ where: { groupId } }))!;
  await assert.rejects(
    () => repository.publishGroup(groupId, publishInput()),
    (error: unknown) => error instanceof PersistenceError && error.code === "COMPLIANCE_BLOCKED",
    "a QC-passed but unapproved asset must block publication"
  );
  assert.equal((await prisma.materialProduct.findMany({ where: {} })).length, 0);
  assert.equal((await prisma.beadGroupPublication.findMany({ where: {} })).length, 0);

  await repository.reviewProcessedAsset(pending!.id as string, reviewDecision() as never);
  const published = await repository.publishGroup(groupId, publishInput());
  assert.equal(published.state, "PUBLISHED");
  assert.deepEqual(published.publishedAssetKeys, [`approved:${VALID_SHA}`]);
});

test("findApprovedPublicAsset refuses an asset that only passed automatic QC", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId, jobId, sourceFileId } = await seedGroupForProcessing(prisma);
  const result = processResult();
  (result as { output: { sourceFileId: string } }).output.sourceFileId = sourceFileId;
  await repository.completeJob(jobId, result, {
    workerId: "worker-1",
    leaseToken: "lease-token-1"
  });
  assert.equal(await repository.findApprovedPublicAsset(`approved:${VALID_SHA}`), null);

  const prismaKeyed = newDouble();
  const repositoryKeyed = new AssetImportRepository(prismaKeyed as never);
  const { groupId: keyedGroupId } = await createGroupFixture(prismaKeyed);
  const keyedFile = await prismaKeyed.assetSourceFile.findFirst({ where: { groupId: keyedGroupId } });
  await prismaKeyed.processedAsset.create({
    data: {
      sourceFileId: keyedFile?.id ?? "file-x",
      groupId: keyedGroupId,
      purpose: "MAIN",
      processingVersion: 1,
      state: "QC_PENDING",
      storageProvider: "local-fs",
      storageKey: "imports/s/processed/g/v1/bead-512.webp",
      assetKey: `approved:${VALID_SHA}`,
      outputSha256: VALID_SHA,
      outputBytes: 4096n,
      outputContentType: "image/webp",
      qcResult: { passed: true, checks: [] },
      qcPassedAt: new Date("2026-08-31T00:00:00.000Z"),
      isCurrentVersion: true
    }
  });
  const productId = await seedProduct(prismaKeyed, { sku: "SKU-QC-PENDING" });
  const keyedAsset = (await prismaKeyed.processedAsset.findFirst({
    where: { groupId: keyedGroupId }
  }))!;
  await prismaKeyed.productAssetBinding.create({
    data: {
      materialProductId: productId,
      processedAssetId: keyedAsset!.id as string,
      assetKey: `approved:${VALID_SHA}`,
      purpose: "TEXTURE",
      bindingStatus: "APPROVED",
      allowPublicDisplay: true,
      allowCommercialUse: true,
      approvedAt: new Date()
    }
  });
  assert.equal(
    await repositoryKeyed.findApprovedPublicAsset(`approved:${VALID_SHA}`),
    null,
    "even a bound, keyed asset stays invisible while it lacks human approval"
  );
});

test("completeJob keeps a QC-failed asset out of the current version and marks the group", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId, jobId, sourceFileId } = await seedGroupForProcessing(prisma);
  const result = processResult({
    qc: { passed: false, checks: [{ id: "blur", passed: false, detail: "too blurry" }], summary: "重拍建议" }
  });
  (result as { output: { sourceFileId: string } }).output.sourceFileId = sourceFileId;
  await repository.completeJob(jobId, result, {
    workerId: "worker-1",
    leaseToken: "lease-token-1"
  });
  const assets = await prisma.processedAsset.findMany({ where: { groupId } });
  assert.equal(assets.length, 1);
  assert.equal(assets[0]!.state, "QC_FAILED");
  assert.equal(assets[0]!.assetKey, null);
  assert.equal(assets[0]!.isCurrentVersion, false);
  const group = await prisma.beadImageGroup.findUnique({ where: { id: groupId } });
  assert.equal(group?.state, "QC_FAILED");
});

test("completeJob retires the previous current version when a new one passes QC", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { sessionId, fileIds } = await createSessionWithFiles(prisma);
  const group = await prisma.beadImageGroup.create({
    data: { sessionId, state: "NAMED", revision: 1 }
  });
  await prisma.assetSourceFile.update({ where: { id: fileIds[0]! }, data: { groupId: group.id as string } });
  await prisma.processedAsset.create({
    data: {
      sourceFileId: fileIds[0]!,
      groupId: group.id as string,
      purpose: "MAIN",
      processingVersion: 1,
      state: "APPROVED",
      storageProvider: "local-fs",
      storageKey: "imports/s/processed/g/v1/bead-512.webp",
      assetKey: `approved:${VALID_SHA}`,
      outputSha256: VALID_SHA,
      isCurrentVersion: true,
      usagePermission: "OWNED",
      allowCommercialUse: true,
      allowPublicDisplay: true
    }
  });
  const job = await prisma.assetProcessingJob.create({
    data: {
      sessionId,
      groupId: group.id as string,
      jobType: "PROCESS_GROUP",
      state: "RUNNING",
      payload: {},
      retryCount: 0,
      maxRetries: 3,
      workerId: "worker-1",
      leaseToken: "lease-token-2",
      leaseUntil: new Date(Date.now() + 60_000)
    }
  });
  const result = processResult({ processingVersion: 2 });
  (result as { output: { sourceFileId: string; outputSha256: string } }).output.sourceFileId = fileIds[0]!;
  (result as { output: { outputSha256: string } }).output.outputSha256 = OTHER_SHA;
  await repository.completeJob(job.id as string, result, {
    workerId: "worker-1",
    leaseToken: "lease-token-2"
  });
  const assets = await prisma.processedAsset.findMany({ where: { groupId: group.id as string } });
  assert.equal(assets.length, 2);
  const current = assets.filter((asset) => asset.isCurrentVersion === true);
  assert.equal(current.length, 1);
  assert.equal(current[0]!.processingVersion, 2);
  assert.equal(current[0]!.state, "QC_PENDING");
  assert.equal(current[0]!.assetKey, null);
  const retiredPrevious = assets.find((asset) => asset.processingVersion === 1);
  assert.equal(retiredPrevious?.isCurrentVersion, false);
  assert.equal(retiredPrevious?.state, "APPROVED");
});

test("completeJob rejects a stale worker lease after the job was reassigned", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { jobId, sourceFileId } = await seedGroupForProcessing(prisma);
  const result = processResult();
  (result as { output: { sourceFileId: string } }).output.sourceFileId = sourceFileId;
  await assert.rejects(
    () =>
      repository.completeJob(jobId, result, {
        workerId: "worker-1",
        leaseToken: "stale-token"
      }),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

test("completeJob rejects a completed job and an expired lease", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { jobId, sourceFileId } = await seedGroupForProcessing(prisma);
  const result = processResult();
  (result as { output: { sourceFileId: string } }).output.sourceFileId = sourceFileId;
  await repository.completeJob(jobId, result, {
    workerId: "worker-1",
    leaseToken: "lease-token-1"
  });
  await assert.rejects(
    () =>
      repository.completeJob(jobId, result, {
        workerId: "worker-1",
        leaseToken: "lease-token-1"
      }),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );

  const second = await seedGroupForProcessing(prisma);
  const secondResult = processResult();
  (secondResult as { output: { sourceFileId: string } }).output.sourceFileId = second.sourceFileId;
  await prisma.assetProcessingJob.update({
    where: { id: second.jobId },
    data: { leaseUntil: new Date(Date.now() - 1_000) }
  });
  await assert.rejects(
    () =>
      repository.completeJob(second.jobId, secondResult, {
        workerId: "worker-1",
        leaseToken: "lease-token-1"
      }),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

test("failJob increments retryCount, stores retryAt and requeues", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const jobId = await seedRunningJob(prisma);
  const retryAt = new Date(Date.now() + 30_000);
  const failed = await repository.failJob(
    jobId,
    { code: "SEGMENTATION_FAILED", message: "mask could not converge" },
    retryAt,
    { workerId: "worker-1", leaseToken: "lease-token-1" }
  );
  assert.equal(failed.state, "QUEUED");
  assert.equal(failed.retryCount, 1);
  assert.equal(failed.nextAttemptAt?.getTime(), retryAt.getTime());
  const row = await prisma.assetProcessingJob.findUnique({ where: { id: jobId } });
  assert.equal(row?.state, "QUEUED");
  assert.equal(row?.retryCount, 1);
  assert.equal((row?.nextAttemptAt as Date).getTime(), retryAt.getTime());
  assert.equal(row?.workerId, null);
  assert.equal(row?.leaseToken, null);
  assert.equal(row?.errorCode, "SEGMENTATION_FAILED");
});

test("failJob fails terminally once retries are exhausted", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const jobId = await seedRunningJob(prisma, { retryCount: 3, maxRetries: 3 });
  const failed = await repository.failJob(
    jobId,
    { code: "SEGMENTATION_FAILED", message: "gave up" },
    new Date(Date.now() + 30_000),
    { workerId: "worker-1", leaseToken: "lease-token-1" }
  );
  assert.equal(failed.state, "FAILED");
  assert.equal(failed.retryCount, 4);
  assert.equal(failed.nextAttemptAt, null);
  const row = await prisma.assetProcessingJob.findUnique({ where: { id: jobId } });
  assert.equal(row?.state, "FAILED");
  assert.ok(row?.failedAt);
});

test("failJob rejects a stale lease", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const jobId = await seedRunningJob(prisma);
  await assert.rejects(
    () =>
      repository.failJob(
        jobId,
        { code: "SEGMENTATION_FAILED", message: "boom" },
        null,
        { workerId: "other-worker", leaseToken: "lease-token-1" }
      ),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

// ---------------------------------------------------------------------------
// 7. Publish fingerprints
// ---------------------------------------------------------------------------

test("publishPayloadFingerprint is deterministic and ignores the idempotency key", () => {
  const base = publishInput();
  const fingerprintA = publishPayloadFingerprint(base);
  const fingerprintB = publishPayloadFingerprint({ ...base, idempotencyKey: "different-key" });
  assert.equal(fingerprintA, fingerprintB);
  assert.equal(fingerprintA, publishPayloadFingerprint(publishInput()));
  const changed = publishPayloadFingerprint({ ...base, unitPriceMinor: 999 });
  assert.notEqual(fingerprintA, changed);
});

test("manifestPayloadFingerprint is order-independent over client file ids", () => {
  const files = [
    {
      clientFileId: "cf-1",
      relativePath: "folder/bead.jpg",
      byteSize: 1024,
      lastModifiedMs: 1,
      kind: "JPEG" as const
    },
    {
      clientFileId: "cf-2",
      relativePath: "folder/bead2.jpg",
      byteSize: 2048,
      lastModifiedMs: 2,
      kind: "JPEG" as const
    }
  ];
  assert.equal(
    manifestPayloadFingerprint(files),
    manifestPayloadFingerprint([files[1]!, files[0]!])
  );
  assert.notEqual(
    manifestPayloadFingerprint(files),
    manifestPayloadFingerprint([{ ...files[0]!, byteSize: 4096 }, files[1]!])
  );
});

// ---------------------------------------------------------------------------
// 8. Transactional publication
// ---------------------------------------------------------------------------

async function seedPublishableGroup(
  prisma: PrismaDouble,
  options: { groupState?: string; crystalId?: string | null } = {}
): Promise<{ sessionId: string; groupId: string }> {
  const { sessionId, groupId } = await createGroupFixture(prisma);
  await seedApprovedCurrentAsset(prisma, groupId);
  await prisma.beadImageGroup.update({
    where: { id: groupId },
    data: { state: options.groupState ?? "READY" }
  });
  if (options.crystalId !== null) {
    await prisma.crystal.create({
      data: {
        id: options.crystalId ?? "crystal-aquamarine",
        nameCn: "海蓝宝",
        nameEn: "Aquamarine",
        mineralName: "Beryl",
        gemologicalInfo: {},
        colorTags: [],
        visualTags: [],
        styleTags: [],
        emotionTags: [],
        cultureTags: [],
        priceLevel: 2,
        complianceNote: "ok"
      }
    });
  }
  await prisma.assetImportSession.update({
    where: { id: sessionId },
    data: { state: "READY_TO_PUBLISH" }
  });
  return { sessionId, groupId };
}

test("publishGroup creates product, inventory, binding and publication atomically", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { sessionId, groupId } = await seedPublishableGroup(prisma);
  const published = await repository.publishGroup(groupId, publishInput());
  assert.equal(published.state, "PUBLISHED");
  assert.ok(published.materialProductId);
  assert.equal(published.crystalId, "crystal-aquamarine");
  assert.ok(published.inventorySnapshotId);
  assert.deepEqual(published.publishedAssetKeys, [`approved:${VALID_SHA}`]);

  const product = await prisma.materialProduct.findUnique({
    where: { id: published.materialProductId }
  });
  assert.equal(product?.sku, "SKU-AQ-8-CNY");
  assert.equal(product?.textureAssetKey, `approved:${VALID_SHA}`);
  assert.equal(product?.unitPriceMinor, 1200n);
  assert.equal(product?.unitCostMinor, 500n);
  assert.equal(product?.active, true);

  const snapshot = await prisma.inventorySnapshot.findUnique({
    where: { id: published.inventorySnapshotId }
  });
  assert.equal(snapshot?.availableQuantity, 50);
  assert.equal(snapshot?.sourceVersion, `asset-import:${groupId}`);

  const bindings = await prisma.productAssetBinding.findMany({});
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0]!.bindingStatus, "APPROVED");
  assert.equal(bindings[0]!.materialProductId, published.materialProductId);
  assert.equal(bindings[0]!.allowPublicDisplay, true);

  const group = await prisma.beadImageGroup.findUnique({ where: { id: groupId } });
  assert.equal(group?.state, "PUBLISHED");
  const session = await prisma.assetImportSession.findUnique({ where: { id: sessionId } });
  assert.equal(session?.state, "PUBLISHED");
  assert.equal(session?.lastVerifiedCheckpoint, "PUBLISHED");
});

test("publishGroup binds both the texture and the model approved asset for one product", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);
  const file = await prisma.assetSourceFile.findFirst({ where: { groupId } });
  await prisma.processedAsset.create({
    data: {
      sourceFileId: file?.id ?? "file-x",
      groupId,
      purpose: "MODEL",
      processingVersion: 1,
      state: "APPROVED",
      storageProvider: "local-fs",
      storageKey: "imports/s/processed/g/v1/bead-model.glb",
      assetKey: `approved:${OTHER_SHA}`,
      outputSha256: OTHER_SHA,
      outputBytes: 2048n,
      outputContentType: "image/webp",
      qcResult: { passed: true, checks: [] },
      qcPassedAt: new Date("2026-08-31T00:00:00.000Z"),
      usagePermission: "OWNED",
      isAuthenticPhotograph: true,
      allowCommercialUse: true,
      allowPublicDisplay: true,
      isCurrentVersion: true,
      approvedAt: new Date("2026-08-31T00:00:00.000Z")
    }
  });
  const published = await repository.publishGroup(
    groupId,
    publishInput({ modelAssetKey: `approved:${OTHER_SHA}` })
  );
  assert.deepEqual(published.publishedAssetKeys.sort(), [
    `approved:${VALID_SHA}`,
    `approved:${OTHER_SHA}`
  ]);
  const bindings = await prisma.productAssetBinding.findMany({});
  assert.equal(bindings.length, 2);
  assert.equal(bindings.filter((binding) => binding.bindingStatus === "APPROVED").length, 2);
  const product = await prisma.materialProduct.findUnique({
    where: { id: published.materialProductId }
  });
  assert.equal(product?.textureAssetKey, `approved:${VALID_SHA}`);
  assert.equal(product?.modelAssetKey, `approved:${OTHER_SHA}`);
});

test("publishGroup replays the identical request idempotently", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);
  const first = await repository.publishGroup(groupId, publishInput());
  const retry = await repository.publishGroup(groupId, publishInput());
  assert.equal(retry.materialProductId, first.materialProductId);
  assert.equal(retry.inventorySnapshotId, first.inventorySnapshotId);
  assert.equal(retry.publishedAt.getTime(), first.publishedAt.getTime());
  assert.equal(await prisma.materialProduct.findMany({}).then((rows) => rows.length), 1);
  assert.equal(await prisma.inventorySnapshot.findMany({}).then((rows) => rows.length), 1);
  assert.equal(await prisma.productAssetBinding.findMany({}).then((rows) => rows.length), 1);
});

test("publishGroup conflicts when the same key carries a different payload", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);
  await repository.publishGroup(groupId, publishInput());
  await assert.rejects(
    () => repository.publishGroup(groupId, publishInput({ unitPriceMinor: 999 })),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

test("publishGroup conflicts when a group is published a second time under a new key", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);
  await repository.publishGroup(groupId, publishInput());
  await assert.rejects(
    () =>
      repository.publishGroup(
        groupId,
        publishInput({ idempotencyKey: "publish-key-2", expectedGroupRevision: 2 })
      ),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

test("publishGroup rejects a stale group revision", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);
  await assert.rejects(
    () => repository.publishGroup(groupId, publishInput({ expectedGroupRevision: 99 })),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

test("publishGroup rejects a group that is not READY", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma, { groupState: "NAMED" });
  await assert.rejects(
    () => repository.publishGroup(groupId, publishInput()),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
});

test("publishGroup blocks publication without an approved current asset", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);
  await prisma.processedAsset.updateMany({
    where: { groupId },
    data: { state: "QC_FAILED", assetKey: null, isCurrentVersion: false }
  });
  await assert.rejects(
    () => repository.publishGroup(groupId, publishInput()),
    (error: unknown) => error instanceof PersistenceError && error.code === "COMPLIANCE_BLOCKED"
  );
});

test("publishGroup blocks an asset whose key does not match the approved current version", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);
  await assert.rejects(
    () => repository.publishGroup(groupId, publishInput({ textureAssetKey: `approved:${OTHER_SHA}` })),
    (error: unknown) => error instanceof PersistenceError && error.code === "COMPLIANCE_BLOCKED"
  );
});

test("publishGroup blocks a private asset regardless of the request", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);
  await prisma.processedAsset.updateMany({
    where: { groupId },
    data: { allowPublicDisplay: false }
  });
  await assert.rejects(
    () => repository.publishGroup(groupId, publishInput()),
    (error: unknown) => error instanceof PersistenceError && error.code === "COMPLIANCE_BLOCKED"
  );
});

test("publishGroup blocks commercial publication of a non-commercial asset", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);
  await prisma.processedAsset.updateMany({
    where: { groupId },
    data: { allowCommercialUse: false }
  });
  await assert.rejects(
    () => repository.publishGroup(groupId, publishInput()),
    (error: unknown) => error instanceof PersistenceError && error.code === "COMPLIANCE_BLOCKED"
  );
});

test("publishGroup blocks an asset whose usage permission is not OWNED or GRANTED", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);
  await prisma.processedAsset.updateMany({
    where: { groupId },
    data: { usagePermission: "PROHIBITED" }
  });
  await assert.rejects(
    () => repository.publishGroup(groupId, publishInput()),
    (error: unknown) => error instanceof PersistenceError && error.code === "COMPLIANCE_BLOCKED"
  );
});

test("publishGroup promotes a confirmed crystal draft into a real Crystal", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { sessionId, groupId } = await createGroupFixture(prisma);
  await seedApprovedCurrentAsset(prisma, groupId);
  const draft = await prisma.crystalDraft.create({
    data: {
      nameCn: "新水晶",
      nameEn: "New Crystal",
      mineralName: "Beryl",
      colorTags: ["blue"],
      visualTags: ["translucent"],
      styleTags: ["minimal"],
      priceLevel: 3,
      complianceNote: "合规说明：天然矿物，无处理。"
    }
  });
  await prisma.beadImageGroup.update({
    where: { id: groupId },
    data: { state: "READY", crystalDraftId: draft.id as string }
  });
  await prisma.assetImportSession.update({
    where: { id: sessionId },
    data: { state: "READY_TO_PUBLISH" }
  });
  const published = await repository.publishGroup(
    groupId,
    publishInput({
      crystalId: undefined,
      crystalDraftId: draft.id as string,
      crystalDraftPromotionConfirmed: true,
      crystalName: "新水晶",
      sku: "SKU-NEW-1"
    })
  );
  assert.notEqual(published.crystalId, "crystal-aquamarine");
  const crystal = await prisma.crystal.findUnique({ where: { id: published.crystalId } });
  assert.equal(crystal?.nameCn, "新水晶");
  const draftRow = await prisma.crystalDraft.findUnique({ where: { id: draft.id as string } });
  assert.equal(draftRow?.promotedCrystalId, published.crystalId);
  assert.ok(draftRow?.promotedAt);
});

test("publishGroup rejects a draft promotion missing the operator-confirmed English name", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { sessionId, groupId } = await createGroupFixture(prisma);
  await seedApprovedCurrentAsset(prisma, groupId);
  const draft = await prisma.crystalDraft.create({
    data: {
      nameCn: "新水晶",
      nameEn: null,
      mineralName: "Beryl",
      colorTags: ["blue"],
      visualTags: ["translucent"],
      styleTags: ["minimal"],
      priceLevel: 3,
      complianceNote: "合规说明：天然矿物，无处理。"
    }
  });
  await prisma.beadImageGroup.update({
    where: { id: groupId },
    data: { state: "READY", crystalDraftId: draft.id as string }
  });
  await prisma.assetImportSession.update({
    where: { id: sessionId },
    data: { state: "READY_TO_PUBLISH" }
  });
  await assert.rejects(
    () =>
      repository.publishGroup(
        groupId,
        publishInput({
          crystalId: undefined,
          crystalDraftId: draft.id as string,
          crystalDraftPromotionConfirmed: true,
          crystalName: "新水晶",
          sku: "SKU-NEW-2"
        })
      ),
    (error: unknown) => error instanceof PersistenceError && error.code === "COMPLIANCE_BLOCKED"
  );
  assert.equal(await prisma.crystal.findMany({}).then((rows) => rows.length), 0);
  const draftRow = await prisma.crystalDraft.findUnique({ where: { id: draft.id as string } });
  assert.ok(!draftRow?.promotedCrystalId);
});

test("publishGroup rolls back the draft when the SKU conflicts", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);
  await prisma.materialProduct.create({
    data: {
      sku: "SKU-AQ-8-CNY",
      crystalId: "crystal-aquamarine",
      name: "existing",
      shape: "ROUND",
      diameterMm: 8,
      materialKey: "existing-material",
      currency: "CNY",
      unitPriceMinor: 1n,
      unitCostMinor: 1n
    }
  });
  await assert.rejects(
    () => repository.publishGroup(groupId, publishInput()),
    (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
  );
  assert.equal(await prisma.beadGroupPublication.findMany({}).then((rows) => rows.length), 0);
  assert.equal(await prisma.inventorySnapshot.findMany({}).then((rows) => rows.length), 0);
  assert.equal(await prisma.productAssetBinding.findMany({}).then((rows) => rows.length), 0);
  const group = await prisma.beadImageGroup.findUnique({ where: { id: groupId } });
  assert.equal(group?.state, "READY");
});

// ---------------------------------------------------------------------------
// 9. Approved-only public asset lookup
// ---------------------------------------------------------------------------

test("findApprovedPublicAsset returns only approved public bindings", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);
  await repository.publishGroup(groupId, publishInput());
  const assetKey = `approved:${VALID_SHA}`;
  const resolved = await repository.findApprovedPublicAsset(assetKey);
  assert.ok(resolved);
  assert.equal(resolved.assetKey, assetKey);
  assert.equal(resolved.outputSha256, VALID_SHA);
  assert.equal(resolved.storageProvider, "local-fs");
});

test("findApprovedPublicAsset returns null for drafts, retired and private assets", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);

  assert.equal(await repository.findApprovedPublicAsset(`approved:${VALID_SHA}`), null);

  await repository.publishGroup(groupId, publishInput());
  await prisma.processedAsset.updateMany({
    where: { groupId },
    data: { state: "RETIRED" }
  });
  assert.equal(await repository.findApprovedPublicAsset(`approved:${VALID_SHA}`), null);

  await prisma.processedAsset.updateMany({
    where: { groupId },
    data: { state: "APPROVED" }
  });
  await prisma.productAssetBinding.updateMany({
    where: {},
    data: { bindingStatus: "RETIRED", retiredAt: new Date() }
  });
  assert.equal(await repository.findApprovedPublicAsset(`approved:${VALID_SHA}`), null);
});

test("findApprovedPublicAsset rejects malformed keys before database access", async () => {
  const repository = new AssetImportRepository(untouchableClient);
  await expectValidationError(() => repository.findApprovedPublicAsset("not-a-key"), "assetKey");
});

// ---------------------------------------------------------------------------
// 10. SOL review fix round regressions (TASK-ASSET-DB-001)
// ---------------------------------------------------------------------------

test("heartbeatJob extends only a lease carrying the current lease token", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const job = await prisma.assetProcessingJob.create({
    data: {
      sessionId: "session-x",
      jobType: "ARCHIVE_FILE",
      state: "RUNNING",
      payload: {},
      retryCount: 0,
      maxRetries: 3,
      workerId: "worker-1",
      leaseToken: "lease-token-current",
      leaseUntil: new Date(Date.now() + 60_000)
    }
  });
  const nextLease = new Date(Date.now() + 120_000);
  assert.equal(
    await repository.heartbeatJob(job.id as string, { workerId: "worker-1", leaseToken: "lease-token-stale" }, nextLease),
    false,
    "a heartbeat with the same workerId but a stale lease token must be rejected"
  );
  assert.equal(
    await repository.heartbeatJob(job.id as string, { workerId: "worker-2", leaseToken: "lease-token-current" }, nextLease),
    false
  );
  assert.equal(
    await repository.heartbeatJob(job.id as string, { workerId: "worker-1", leaseToken: "lease-token-current" }, nextLease),
    true
  );
  const jobRow = await prisma.assetProcessingJob.findUnique({ where: { id: job.id as string } });
  assert.equal((jobRow?.leaseUntil as Date | undefined)?.getTime(), nextLease.getTime());
});

test("registerManifest persists the manifest-declared lastModifiedMs", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const session = await repository.createSession({ idempotencyKey: "session-lmm-1" });
  await repository.registerManifest(session.sessionId, {
    idempotencyKey: "manifest-lmm-1",
    files: [
      {
        clientFileId: "cf-lmm-1",
        relativePath: "folder/cf-lmm-1.jpg",
        byteSize: 2048,
        lastModifiedMs: 1_750_000_123_456,
        kind: "JPEG" as const
      }
    ]
  });
  const file = await prisma.assetSourceFile.findFirst({ where: { sessionId: session.sessionId } });
  assert.equal(file?.lastModifiedMs, 1_750_000_123_456n);
});

test("recording a duplicate upload counts a skipped file instead of a failed file", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { sessionId, fileIds } = await createSessionWithFiles(prisma, { clientFileIds: ["cf-dup-1", "cf-dup-2"] });
  await repository.recordUploadedFile(fileIds[0]!, VALID_SHA, "imports/s/raw/dup-1.jpg");
  const duplicate = await repository.recordUploadedFile(fileIds[1]!, VALID_SHA, "imports/s/raw/dup-2.jpg");
  assert.equal(duplicate.uploadStatus, "SKIPPED_DUPLICATE");
  const session = await prisma.assetImportSession.findUnique({ where: { id: sessionId } });
  assert.equal(session?.skippedFileCount, 1);
  assert.equal(session?.failedFileCount, 0);
  assert.equal(session?.archivedFileCount, 1);
});

async function seedDraftPublishableGroup(
  prisma: PrismaDouble,
  draftData: Record<string, unknown>
): Promise<{ groupId: string; draftId: string }> {
  const { sessionId, groupId } = await createGroupFixture(prisma);
  await seedApprovedCurrentAsset(prisma, groupId);
  const draft = await prisma.crystalDraft.create({ data: draftData });
  await prisma.beadImageGroup.update({
    where: { id: groupId },
    data: { state: "READY", crystalDraftId: draft.id as string }
  });
  await prisma.assetImportSession.update({
    where: { id: sessionId },
    data: { state: "READY_TO_PUBLISH" }
  });
  return { groupId, draftId: draft.id as string };
}

const COMPLETE_DRAFT = {
  nameCn: "新水晶",
  nameEn: "New Crystal",
  mineralName: "Beryl",
  colorTags: ["blue"],
  visualTags: ["translucent"],
  styleTags: ["minimal"],
  priceLevel: 3,
  complianceNote: "合规说明：天然矿物，无处理。"
};

test("publishGroup promotes a fully curated crystal draft with its manual fields", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId, draftId } = await seedDraftPublishableGroup(prisma, { ...COMPLETE_DRAFT });
  const published = await repository.publishGroup(
    groupId,
    publishInput({
      crystalId: undefined,
      crystalDraftId: draftId,
      crystalDraftPromotionConfirmed: true,
      crystalName: "新水晶",
      sku: "SKU-CURATED-1"
    })
  );
  const crystal = await prisma.crystal.findUnique({ where: { id: published.crystalId } });
  assert.equal(crystal?.nameCn, "新水晶");
  assert.equal(crystal?.nameEn, "New Crystal");
  assert.equal(crystal?.mineralName, "Beryl");
  assert.deepEqual(crystal?.colorTags, ["blue"]);
  assert.deepEqual(crystal?.visualTags, ["translucent"]);
  assert.deepEqual(crystal?.styleTags, ["minimal"]);
  assert.equal(crystal?.priceLevel, 3);
  assert.equal(crystal?.complianceNote, "合规说明：天然矿物，无处理。");
  const draftRow = await prisma.crystalDraft.findUnique({ where: { id: draftId } });
  assert.equal(draftRow?.promotedCrystalId, published.crystalId);
});

test("publishGroup refuses to promote a crystal draft that misses any manual curation field", async () => {
  const missingVariants: Array<{ field: string; data: Record<string, unknown> }> = [
    { field: "nameCn", data: { ...COMPLETE_DRAFT, nameCn: " " } },
    { field: "nameEn", data: { ...COMPLETE_DRAFT, nameEn: null } },
    { field: "mineralName", data: { ...COMPLETE_DRAFT, mineralName: "UNSPECIFIED" } },
    { field: "colorTags", data: { ...COMPLETE_DRAFT, colorTags: [] } },
    { field: "visualTags", data: { ...COMPLETE_DRAFT, visualTags: [] } },
    { field: "styleTags", data: { ...COMPLETE_DRAFT, styleTags: [] } },
    { field: "priceLevel", data: { ...COMPLETE_DRAFT, priceLevel: null } },
    { field: "complianceNote", data: { ...COMPLETE_DRAFT, complianceNote: " " } }
  ];
  for (const variant of missingVariants) {
    const prisma = newDouble();
    const repository = new AssetImportRepository(prisma as never);
    const { groupId, draftId } = await seedDraftPublishableGroup(prisma, variant.data);
    await assert.rejects(
      () =>
        repository.publishGroup(
          groupId,
          publishInput({
            crystalId: undefined,
            crystalDraftId: draftId,
            crystalDraftPromotionConfirmed: true,
            crystalName: "新水晶",
            sku: `SKU-GATE-${variant.field}`
          })
        ),
      (error: unknown) =>
        error instanceof PersistenceError && error.code === "COMPLIANCE_BLOCKED",
      `promotion must fail closed when ${variant.field} is missing`
    );
    assert.equal(await prisma.crystal.findMany({}).then((rows) => rows.length), 0);
    const draftRow = await prisma.crystalDraft.findUnique({ where: { id: draftId } });
    assert.ok(!draftRow?.promotedCrystalId);
  }
});

const PREVIEW_SHA = "c".repeat(64);

test("publishGroup ignores an unrelated private preview asset and publishes only the selected keys", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);
  const file = await prisma.assetSourceFile.findFirst({ where: { groupId } });
  await prisma.processedAsset.create({
    data: {
      sourceFileId: file?.id ?? "file-x",
      groupId,
      purpose: "PREVIEW",
      processingVersion: 1,
      state: "APPROVED",
      storageProvider: "local-fs",
      storageKey: "imports/s/processed/g/v1/bead-preview.webp",
      assetKey: `approved:${PREVIEW_SHA}`,
      outputSha256: PREVIEW_SHA,
      outputBytes: 1024n,
      outputContentType: "image/webp",
      qcResult: { passed: true, checks: [] },
      qcPassedAt: new Date("2026-08-31T00:00:00.000Z"),
      approvedAt: new Date("2026-08-31T00:00:00.000Z"),
      usagePermission: "OWNED",
      isAuthenticPhotograph: true,
      allowCommercialUse: true,
      allowPublicDisplay: false,
      isCurrentVersion: true
    }
  });
  const published = await repository.publishGroup(groupId, publishInput());
  assert.equal(published.state, "PUBLISHED");
  assert.deepEqual(published.publishedAssetKeys, [`approved:${VALID_SHA}`]);
  const bindings = await prisma.productAssetBinding.findMany({});
  assert.equal(bindings.length, 1);
  assert.notEqual(bindings[0]?.assetKey, `approved:${PREVIEW_SHA}`);
});

test("publishGroup snapshots the operator approval decisions on the publication record", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId } = await seedPublishableGroup(prisma);
  await repository.publishGroup(
    groupId,
    publishInput({ allowAiTraining: false, allowAiRecommendation: true })
  );
  const publication = await prisma.beadGroupPublication.findFirst({ where: { groupId } });
  assert.equal(publication?.qualityStatement, "品相完整，无裂痕");
  assert.equal(publication?.qualitySource, "供应商证书");
  assert.equal(publication?.rightsHolder, "Mystcrag Studio");
  assert.equal(publication?.usagePermission, "OWNED");
  assert.equal(publication?.isAuthenticPhotograph, true);
  assert.equal(publication?.allowAiTraining, false);
  assert.equal(publication?.allowAiRecommendation, true);
});

async function seedLookupFixture(prisma: PrismaDouble): Promise<{ groupId: string; assetId: string }> {
  const { groupId } = await createGroupFixture(prisma);
  await seedApprovedCurrentAsset(prisma, groupId);
  const asset = await prisma.processedAsset.findFirst({ where: { groupId } });
  return { groupId, assetId: asset!.id as string };
}

async function seedProduct(
  prisma: PrismaDouble,
  options: { sku: string; active?: boolean } = { sku: "SKU-LOOKUP", active: true }
): Promise<string> {
  const product = await prisma.materialProduct.create({
    data: {
      sku: options.sku,
      crystalId: "crystal-aquamarine",
      name: "lookup product",
      shape: "ROUND",
      diameterMm: 8,
      materialKey: "lookup-material",
      currency: "CNY",
      unitPriceMinor: 1n,
      unitCostMinor: 1n,
      active: options.active ?? true
    }
  });
  return product.id as string;
}

test("findApprovedPublicAsset ignores a binding that points at a different processed asset", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { groupId, assetId } = await seedLookupFixture(prisma);
  const decoy = await prisma.processedAsset.create({
    data: {
      sourceFileId: "file-decoy",
      groupId,
      purpose: "MODEL",
      processingVersion: 1,
      state: "APPROVED",
      storageProvider: "local-fs",
      storageKey: "imports/s/processed/g/v1/decoy.glb",
      assetKey: `approved:${OTHER_SHA}`,
      outputSha256: OTHER_SHA,
      outputBytes: 2048n,
      outputContentType: "image/webp",
      qcResult: { passed: true, checks: [] },
      qcPassedAt: new Date("2026-08-31T00:00:00.000Z"),
      approvedAt: new Date("2026-08-31T00:00:00.000Z"),
      usagePermission: "OWNED",
      isAuthenticPhotograph: true,
      allowCommercialUse: true,
      allowPublicDisplay: true,
      isCurrentVersion: true
    }
  });
  const productId = await seedProduct(prisma, { sku: "SKU-LOOKUP-DECOY" });
  await prisma.productAssetBinding.create({
    data: {
      materialProductId: productId,
      processedAssetId: decoy.id as string,
      assetKey: `approved:${VALID_SHA}`,
      purpose: "TEXTURE",
      bindingStatus: "APPROVED",
      allowPublicDisplay: true,
      allowCommercialUse: true,
      approvedAt: new Date()
    }
  });
  assert.notEqual(decoy.id, assetId);
  assert.equal(await repository.findApprovedPublicAsset(`approved:${VALID_SHA}`), null);
});

test("findApprovedPublicAsset rejects private bindings and inactive products", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { assetId } = await seedLookupFixture(prisma);
  const privateProductId = await seedProduct(prisma, { sku: "SKU-LOOKUP-PRIVATE" });
  await prisma.productAssetBinding.create({
    data: {
      materialProductId: privateProductId,
      processedAssetId: assetId,
      assetKey: `approved:${VALID_SHA}`,
      purpose: "TEXTURE",
      bindingStatus: "APPROVED",
      allowPublicDisplay: false,
      allowCommercialUse: true,
      approvedAt: new Date()
    }
  });
  assert.equal(await repository.findApprovedPublicAsset(`approved:${VALID_SHA}`), null);

  const prismaInactive = newDouble();
  const repositoryInactive = new AssetImportRepository(prismaInactive as never);
  const { assetId: inactiveAssetId } = await seedLookupFixture(prismaInactive);
  const inactiveProductId = await seedProduct(prismaInactive, {
    sku: "SKU-LOOKUP-INACTIVE",
    active: false
  });
  await prismaInactive.productAssetBinding.create({
    data: {
      materialProductId: inactiveProductId,
      processedAssetId: inactiveAssetId,
      assetKey: `approved:${VALID_SHA}`,
      purpose: "TEXTURE",
      bindingStatus: "APPROVED",
      allowPublicDisplay: true,
      allowCommercialUse: true,
      approvedAt: new Date()
    }
  });
  assert.equal(await repositoryInactive.findApprovedPublicAsset(`approved:${VALID_SHA}`), null);
});

test("findApprovedPublicAsset resolves an asset bound to an active public product", async () => {
  const prisma = newDouble();
  const repository = new AssetImportRepository(prisma as never);
  const { assetId } = await seedLookupFixture(prisma);
  const productId = await seedProduct(prisma);
  await prisma.productAssetBinding.create({
    data: {
      materialProductId: productId,
      processedAssetId: assetId,
      assetKey: `approved:${VALID_SHA}`,
      purpose: "TEXTURE",
      bindingStatus: "APPROVED",
      allowPublicDisplay: true,
      allowCommercialUse: true,
      approvedAt: new Date()
    }
  });
  const resolved = await repository.findApprovedPublicAsset(`approved:${VALID_SHA}`);
  assert.ok(resolved);
  assert.equal(resolved.assetKey, `approved:${VALID_SHA}`);
  assert.equal(resolved.outputSha256, VALID_SHA);
});
