import assert from "node:assert/strict";
import test from "node:test";

import { PersistenceError } from "../errors/persistence-errors.js";
import {
  KnowledgeUsageEventRepository,
  type RecordKnowledgeUsageEventInput
} from "./knowledge-usage-event.repository.js";

type StoredRow = {
  id: string;
  eventType: string;
  actorId: string | null;
  designId: string | null;
  revisionNumber: number | null;
  knowledgeVersion: string | null;
  productCatalogVersion: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
};

class KnowledgeUsageEventDelegate {
  readonly rows: StoredRow[] = [];
  private nextId = 1;
  readonly recorded: Array<Array<Record<string, unknown>>> = [];

  async createMany({ data }: { data: Array<Record<string, unknown>> }) {
    this.recorded.push(data.map((entry) => ({ ...entry })));
    for (const entry of data) {
      this.rows.push({
        id: `usage-event-${this.nextId++}`,
        eventType: String(entry.eventType),
        actorId: (entry.actorId as string | null) ?? null,
        designId: (entry.designId as string | null) ?? null,
        revisionNumber: (entry.revisionNumber as number | null) ?? null,
        knowledgeVersion: (entry.knowledgeVersion as string | null) ?? null,
        productCatalogVersion: (entry.productCatalogVersion as string | null) ?? null,
        payload: (entry.payload ?? {}) as Record<string, unknown>,
        createdAt: new Date(`2026-08-21T12:00:0${this.rows.length}.000Z`)
      });
    }
    return { count: data.length };
  }

  async findMany({
    where,
    orderBy,
    take
  }: {
    where?: Record<string, unknown>;
    orderBy?: Array<Record<string, string>>;
    take?: number;
  }) {
    void orderBy;
    let rows = [...this.rows];
    if (where?.eventType !== undefined) {
      rows = rows.filter((row) => row.eventType === where.eventType);
    }
    if (where?.actorId !== undefined) {
      rows = rows.filter((row) => row.actorId === where.actorId);
    }
    if (where?.designId !== undefined) {
      rows = rows.filter((row) => row.designId === where.designId);
    }
    return take === undefined ? rows : rows.slice(0, take);
  }
}

class PrismaDouble {
  readonly knowledgeUsageEvent = new KnowledgeUsageEventDelegate();
}

const baseEvent: RecordKnowledgeUsageEventInput = {
  eventType: "rule.fired",
  actorId: "user-1",
  designId: "design-1",
  revisionNumber: 1,
  knowledgeVersion: "kv-2026-08-21",
  productCatalogVersion: "catalog-2026-08-21",
  payload: { ruleId: "rule-color-1", source: "evaluate" }
};

test("recordEvents persists normalized batches and returns the inserted count", async () => {
  const prisma = new PrismaDouble();
  const repository = new KnowledgeUsageEventRepository(prisma as never);

  const count = await repository.recordEvents([
    baseEvent,
    {
      eventType: "design.saved",
      payload: { revision: 2 }
    }
  ]);

  assert.equal(count, 2);
  assert.equal(prisma.knowledgeUsageEvent.rows.length, 2);
  const first = prisma.knowledgeUsageEvent.rows[0]!;
  const second = prisma.knowledgeUsageEvent.rows[1]!;
  assert.equal(first.eventType, "rule.fired");
  assert.equal(first.actorId, "user-1");
  assert.equal(first.knowledgeVersion, "kv-2026-08-21");
  assert.deepEqual(first.payload, { ruleId: "rule-color-1", source: "evaluate" });
  assert.equal(second.actorId, null);
  assert.equal(second.designId, null);
  assert.equal(second.revisionNumber, null);
});

test("recordEvents rejects empty and oversized batches with VALIDATION_ERROR", async () => {
  const repository = new KnowledgeUsageEventRepository(new PrismaDouble() as never);

  await assert.rejects(
    () => repository.recordEvents([]),
    (error: unknown) =>
      error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
  );

  await assert.rejects(
    () =>
      repository.recordEvents(
        Array.from({ length: 501 }, () => ({ eventType: "rule.fired", payload: {} }))
      ),
    (error: unknown) =>
      error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
  );
});

test("recordEvents rejects malformed envelopes", async () => {
  const repository = new KnowledgeUsageEventRepository(new PrismaDouble() as never);

  await assert.rejects(
    () =>
      repository.recordEvents([
        { eventType: "", payload: {} } as unknown as RecordKnowledgeUsageEventInput
      ]),
    (error: unknown) =>
      error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
  );

  await assert.rejects(
    () =>
      repository.recordEvents([
        { eventType: "design.saved", payload: "not-an-object" } as unknown as RecordKnowledgeUsageEventInput
      ]),
    (error: unknown) =>
      error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
  );
});

test("listEvents filters by type, actor, and design and clamps the limit", async () => {
  const prisma = new PrismaDouble();
  const repository = new KnowledgeUsageEventRepository(prisma as never);
  await repository.recordEvents([
    { ...baseEvent, eventType: "rule.fired", designId: "design-1" },
    { ...baseEvent, eventType: "rule.fired", designId: "design-2", actorId: null },
    { ...baseEvent, eventType: "design.saved", designId: "design-2" }
  ]);

  const ruleEvents = await repository.listEvents({ eventType: "rule.fired" });
  assert.equal(ruleEvents.length, 2);
  assert.ok(ruleEvents.every((event) => event.eventType === "rule.fired"));
  assert.ok(ruleEvents[0]!.createdAt <= ruleEvents[1]!.createdAt);

  const designTwo = await repository.listEvents({ designId: "design-2" });
  assert.deepEqual(
    designTwo.map((event) => event.eventType).sort(),
    ["design.saved", "rule.fired"]
  );

  const byActor = await repository.listEvents({ actorId: "user-1" });
  assert.equal(byActor.length, 2);

  const limited = await repository.listEvents({ limit: 1 });
  assert.equal(limited.length, 1);

  const clamped = await repository.listEvents({ limit: 9999 });
  assert.equal(clamped.length, 3);
});
