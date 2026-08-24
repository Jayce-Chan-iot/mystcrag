import assert from "node:assert/strict";
import test from "node:test";

import { PersistenceError } from "../errors/persistence-errors.js";
import {
  KnowledgeCollectionRunRepository,
  type CompleteCollectionRunInput,
  type StartCollectionRunInput
} from "./knowledge-collection-run.repository.js";

type StoredRow = {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  sourcesCrawled: number;
  documentsAdded: number;
  documentDuplicates: number;
  candidatesInserted: number;
  corroboratedCandidates: number;
  candidateDuplicates: number;
  needsReview: number;
  conflicts: number;
  errors: unknown;
  sourceResults: unknown;
};

class KnowledgeCollectionRunDelegate {
  readonly rows: StoredRow[] = [];
  private nextId = 1;

  async create({ data }: { data: Record<string, unknown> }) {
    const row: StoredRow = {
      id: `run-${String(this.nextId++).padStart(3, "0")}`,
      status: String(data.status ?? "RUNNING"),
      startedAt: data.startedAt as Date,
      finishedAt: null,
      sourcesCrawled: 0,
      documentsAdded: 0,
      documentDuplicates: 0,
      candidatesInserted: 0,
      corroboratedCandidates: 0,
      candidateDuplicates: 0,
      needsReview: 0,
      conflicts: 0,
      errors: data.errors ?? [],
      sourceResults: data.sourceResults ?? []
    };
    this.rows.push(row);
    return row;
  }

  async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
    const row = this.rows.find((entry) => entry.id === where.id);
    if (row === undefined) {
      throw Object.assign(new Error("Record not found"), { code: "P2025" });
    }
    Object.assign(row, data);
    return row;
  }

  async findMany({ take, orderBy }: { take?: number; orderBy?: Array<Record<string, string>> }) {
    void orderBy;
    const rows = [...this.rows].sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
    );
    return take === undefined ? rows : rows.slice(0, take);
  }

  async count() {
    return this.rows.length;
  }
}

class PrismaDouble {
  readonly knowledgeCollectionRun = new KnowledgeCollectionRunDelegate();
}

const startInput: StartCollectionRunInput = {
  startedAt: new Date("2026-08-22T14:00:00.000Z")
};

const completeInput: CompleteCollectionRunInput = {
  finishedAt: new Date("2026-08-22T14:26:00.000Z"),
  status: "COMPLETED",
  sourcesCrawled: 3,
  documentsAdded: 190,
  documentDuplicates: 2,
  candidatesInserted: 210,
  corroboratedCandidates: 18,
  candidateDuplicates: 4,
  needsReview: 210,
  conflicts: 3,
  errors: [{ sourceId: "source-x", message: "HTTP 503" }],
  sourceResults: [
    {
      sourceId: "source-gemdat-gemstone-pages",
      documentsAdded: 84,
      duplicateDocuments: 0,
      candidatesInserted: 120,
      corroboratedCandidates: 10,
      duplicateCandidates: 1
    }
  ]
};

test("startRun persists a RUNNING row with startedAt and returns it", async () => {
  const prisma = new PrismaDouble();
  const repository = new KnowledgeCollectionRunRepository(prisma as never);

  const run = await repository.startRun(startInput);

  assert.equal(run.status, "RUNNING");
  assert.equal(run.startedAt.toISOString(), "2026-08-22T14:00:00.000Z");
  assert.equal(run.finishedAt, null);
  assert.equal(run.sourcesCrawled, 0);
  assert.equal(run.documentsAdded, 0);
});

test("completeRun fills finishedAt and the run metrics", async () => {
  const prisma = new PrismaDouble();
  const repository = new KnowledgeCollectionRunRepository(prisma as never);
  const run = await repository.startRun(startInput);

  const completed = await repository.completeRun(run.id, completeInput);

  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.finishedAt?.toISOString(), "2026-08-22T14:26:00.000Z");
  assert.equal(completed.sourcesCrawled, 3);
  assert.equal(completed.documentsAdded, 190);
  assert.equal(completed.documentDuplicates, 2);
  assert.equal(completed.candidatesInserted, 210);
  assert.equal(completed.corroboratedCandidates, 18);
  assert.equal(completed.candidateDuplicates, 4);
  assert.equal(completed.needsReview, 210);
  assert.equal(completed.conflicts, 3);
  assert.deepEqual(completed.errors, [{ sourceId: "source-x", message: "HTTP 503" }]);
  assert.equal(completed.sourceResults[0]?.sourceId, "source-gemdat-gemstone-pages");
});

test("completeRun caps errors and source results at sane sizes", async () => {
  const prisma = new PrismaDouble();
  const repository = new KnowledgeCollectionRunRepository(prisma as never);
  const run = await repository.startRun(startInput);

  const completed = await repository.completeRun(run.id, {
    ...completeInput,
    errors: Array.from({ length: 60 }, (_, i) => ({
      sourceId: `source-${i}`,
      message: "x".repeat(300)
    }))
  });

  assert.ok(completed.errors.length <= 50);
  assert.ok(completed.errors[0]!.message.length <= 280);
});

test("completeRun rejects negative counters and malformed errors", async () => {
  const prisma = new PrismaDouble();
  const repository = new KnowledgeCollectionRunRepository(prisma as never);
  const run = await repository.startRun(startInput);

  await assert.rejects(
    () => repository.completeRun(run.id, { ...completeInput, documentsAdded: -1 }),
    (error: unknown) =>
      error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
  );

  await assert.rejects(
    () =>
      repository.completeRun(run.id, {
        ...completeInput,
        errors: [{ sourceId: "", message: "boom" }] as never
      }),
    (error: unknown) =>
      error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
  );
});

test("completeRun surfaces a NOT_FOUND persistence error for unknown runs", async () => {
  const repository = new KnowledgeCollectionRunRepository(new PrismaDouble() as never);

  await assert.rejects(
    () => repository.completeRun("run-does-not-exist", completeInput),
    (error: unknown) =>
      error instanceof PersistenceError && error.code === "NOT_FOUND"
  );
});

test("listRuns returns newest first and clamps the limit", async () => {
  const prisma = new PrismaDouble();
  const repository = new KnowledgeCollectionRunRepository(prisma as never);
  for (const minute of [0, 1, 2]) {
    const run = await repository.startRun({
      startedAt: new Date(`2026-08-22T14:0${minute}:00.000Z`)
    });
    await repository.completeRun(run.id, completeInput);
  }

  const runs = await repository.listRuns();
  assert.equal(runs.length, 3);
  assert.ok(runs[0]!.startedAt.getTime() >= runs[1]!.startedAt.getTime());
  assert.ok(runs[1]!.startedAt.getTime() >= runs[2]!.startedAt.getTime());

  const limited = await repository.listRuns({ limit: 2 });
  assert.equal(limited.length, 2);

  const clamped = await repository.listRuns({ limit: 9999 });
  assert.equal(clamped.length, 3);
});
