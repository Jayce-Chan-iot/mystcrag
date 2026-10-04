import assert from "node:assert/strict";
import test from "node:test";

import { DesignV1Schema, type DesignV1 } from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import type { PrismaClient } from "../../generated/client/client.js";
import { PersistenceError } from "../errors/persistence-errors.js";
import {
  createFirstBeadRequestFingerprint,
  DesignRepository
} from "./design.repository.js";

const FINGERPRINT_A = "fingerprint-a";

function oneBeadDesign(designId: string): DesignV1 {
  const fixture = structuredClone(standardAiDesignFixture);
  const bead = fixture.beads[0];
  if (!bead) throw new Error("The standard fixture must contain at least one bead");
  const materialSubtotalMinor = bead.unitPriceMinor;
  return DesignV1Schema.parse({
    ...fixture,
    designId,
    designName: "First bead",
    designMode: "DIY_CREATED",
    revision: 1,
    beads: [{ ...bead, positionIndex: 0 }],
    accessories: [],
    bracelet: { ...fixture.bracelet, totalBeadCount: 1 },
    pricing: {
      ...fixture.pricing,
      materialSubtotalMinor,
      accessorySubtotalMinor: 0,
      totalPriceMinor:
        materialSubtotalMinor +
        fixture.pricing.laborFeeMinor +
        fixture.pricing.designFeeMinor +
        fixture.pricing.packagingFeeMinor +
        fixture.pricing.platformFeeEstimateMinor +
        fixture.pricing.logisticsFeeEstimateMinor -
        fixture.pricing.discountMinor
    },
    production: {
      ...fixture.production,
      billOfMaterials: [
        {
          productId: bead.beadProductId,
          specification: `${bead.shape} ${bead.diameterMm}mm`,
          quantity: 1,
          sourceComponentIds: [bead.componentId]
        }
      ],
      componentSequence: [bead.componentId],
      anchoredComponents: []
    },
    provenance: {
      ...fixture.provenance,
      generatedBy: "USER",
      modelProvider: null,
      modelName: null,
      promptVersion: null,
      knowledgeBaseVersion: null,
      designTemplateVersion: null,
      sourceDesignId: null
    }
  });
}

function firstBeadVariant(designId: string, overrides: Partial<DesignV1>): DesignV1 {
  return DesignV1Schema.parse({ ...oneBeadDesign(designId), ...overrides });
}

function designRow(design: DesignV1, ownerId: string, requestId: string, fingerprint: string) {
  return {
    id: design.designId,
    ownerId,
    currentRevision: design.revision,
    status: "DRAFT" as const,
    currentSnapshot: structuredClone(design),
    createdAt: new Date("2026-10-04T00:00:00.000Z"),
    updatedAt: new Date("2026-10-04T00:00:00.000Z"),
    deletedAt: null,
    creationRequestId: requestId,
    creationRequestFingerprint: fingerprint
  };
}

function uniqueConflictError(): Error & { code: string } {
  return Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
}

test("createFirstBeadRequestFingerprint covers exactly beadProductId, locale and currency", () => {
  const base = { beadProductId: "product-aquamarine-round-8", locale: "zh-CN", currency: "CNY" };
  const fingerprint = createFirstBeadRequestFingerprint(base);
  assert.equal(createFirstBeadRequestFingerprint({ ...base }), fingerprint);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.notEqual(
    createFirstBeadRequestFingerprint({ ...base, beadProductId: "product-quartz-round-8" }),
    fingerprint
  );
  assert.notEqual(createFirstBeadRequestFingerprint({ ...base, locale: "en-US" }), fingerprint);
  assert.notEqual(createFirstBeadRequestFingerprint({ ...base, currency: "TWD" }), fingerprint);
});

test("findFirstBeadByRequest looks up by owner and request key and returns null when absent", async () => {
  let capturedWhere: unknown;
  const prisma = {
    design: {
      async findFirst(args: { where: unknown }) {
        capturedWhere = args.where;
        return null;
      }
    }
  } as unknown as PrismaClient;

  const result = await new DesignRepository(prisma).findFirstBeadByRequest(
    "actor-1",
    "request-1",
    FINGERPRINT_A
  );

  assert.equal(result, null);
  assert.deepEqual(capturedWhere, { ownerId: "actor-1", creationRequestId: "request-1" });
});

test("findFirstBeadByRequest returns the original snapshot for a matching fingerprint", async () => {
  const design = oneBeadDesign("design-replay-lookup");
  const prisma = {
    design: {
      async findFirst() {
        return designRow(design, "actor-1", "request-1", FINGERPRINT_A);
      }
    }
  } as unknown as PrismaClient;

  const result = await new DesignRepository(prisma).findFirstBeadByRequest(
    "actor-1",
    "request-1",
    FINGERPRINT_A
  );

  assert.ok(result);
  assert.equal(result.id, "design-replay-lookup");
  assert.deepEqual(result.snapshot, design);
});

test("findFirstBeadByRequest raises CONFLICT when the stored fingerprint differs", async () => {
  const design = oneBeadDesign("design-conflicting-lookup");
  const prisma = {
    design: {
      async findFirst() {
        return designRow(design, "actor-1", "request-1", "stored-fingerprint");
      }
    }
  } as unknown as PrismaClient;

  await assert.rejects(
    new DesignRepository(prisma).findFirstBeadByRequest("actor-1", "request-1", "different-fingerprint"),
    (error: unknown) => {
      assert.ok(error instanceof PersistenceError);
      assert.equal(error.code, "CONFLICT");
      return true;
    }
  );
});

test("createFirstBeadIdempotently rejects a zero-bead snapshot before any database work", async () => {
  let transactionCalls = 0;
  const prisma = {
    $transaction: async () => {
      transactionCalls += 1;
      throw new Error("The transaction must not start for an invalid snapshot");
    }
  } as unknown as PrismaClient;
  const zeroBead = { ...oneBeadDesign("design-zero-bead"), beads: [] };

  await assert.rejects(
    new DesignRepository(prisma).createFirstBeadIdempotently(
      "actor-1",
      "request-zero",
      FINGERPRINT_A,
      zeroBead as unknown as DesignV1
    ),
    (error: unknown) => {
      assert.ok(error instanceof PersistenceError);
      assert.equal(error.code, "VALIDATION_ERROR");
      return true;
    }
  );
  assert.equal(transactionCalls, 0);
});

test("createFirstBeadIdempotently replays the stored design instead of inserting again", async () => {
  const design = oneBeadDesign("design-replay-insert");
  let createCalls = 0;
  const tx = {
    design: {
      async findFirst() {
        return designRow(design, "actor-1", "request-1", FINGERPRINT_A);
      },
      async create() {
        createCalls += 1;
        throw new Error("Replay must not insert");
      }
    }
  };
  const prisma = {
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx)
  } as unknown as PrismaClient;

  const result = await new DesignRepository(prisma).createFirstBeadIdempotently(
    "actor-1",
    "request-1",
    FINGERPRINT_A,
    design
  );

  assert.equal(result.id, "design-replay-insert");
  assert.equal(createCalls, 0);
});

test("createFirstBeadIdempotently inserts one revision-1 design with the idempotency columns", async () => {
  const design = oneBeadDesign("design-fresh-insert");
  let createdData: Record<string, unknown> | undefined;
  const tx = {
    design: {
      async findFirst() {
        return null;
      },
      async create(args: { data: Record<string, unknown> }) {
        createdData = args.data;
        return {
          ...args.data,
          createdAt: new Date("2026-10-04T00:00:00.000Z"),
          updatedAt: new Date("2026-10-04T00:00:00.000Z"),
          deletedAt: null
        };
      }
    }
  };
  const prisma = {
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx)
  } as unknown as PrismaClient;

  const result = await new DesignRepository(prisma).createFirstBeadIdempotently(
    "actor-1",
    "request-fresh",
    FINGERPRINT_A,
    design
  );

  assert.equal(result.id, "design-fresh-insert");
  assert.equal(createdData?.creationRequestId, "request-fresh");
  assert.equal(createdData?.creationRequestFingerprint, FINGERPRINT_A);
  assert.equal(createdData?.currentRevision, 1);
  assert.deepEqual(createdData?.revisions, {
    create: {
      revisionNumber: 1,
      schemaVersion: design.schemaVersion,
      snapshot: design,
      changeType: "CREATED",
      changeReason: "Initial DIY design",
      createdBy: "actor-1"
    }
  });
});

test("createFirstBeadIdempotently resolves a concurrent unique conflict by rereading the winner", async () => {
  const design = oneBeadDesign("design-concurrent-winner");
  const tx = {
    design: {
      async findFirst() {
        return null;
      },
      async create() {
        throw uniqueConflictError();
      }
    }
  };
  const prisma = {
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    design: {
      async findFirst() {
        return designRow(design, "actor-1", "request-1", FINGERPRINT_A);
      }
    }
  } as unknown as PrismaClient;

  const result = await new DesignRepository(prisma).createFirstBeadIdempotently(
    "actor-1",
    "request-1",
    FINGERPRINT_A,
    design
  );

  assert.equal(result.id, "design-concurrent-winner");
});

test("createFirstBeadIdempotently raises CONFLICT when the concurrent winner has a different fingerprint", async () => {
  const design = oneBeadDesign("design-concurrent-conflict");
  const tx = {
    design: {
      async findFirst() {
        return null;
      },
      async create() {
        throw uniqueConflictError();
      }
    }
  };
  const prisma = {
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    design: {
      async findFirst() {
        return designRow(design, "actor-1", "request-1", "winner-fingerprint");
      }
    }
  } as unknown as PrismaClient;

  await assert.rejects(
    new DesignRepository(prisma).createFirstBeadIdempotently(
      "actor-1",
      "request-1",
      "loser-fingerprint",
      design
    ),
    (error: unknown) => {
      assert.ok(error instanceof PersistenceError);
      assert.equal(error.code, "CONFLICT");
      return true;
    }
  );
});

test("createFirstBeadIdempotently rejects a non-DIY_CREATED snapshot before any database work", async () => {
  let transactionCalls = 0;
  const prisma = {
    $transaction: async () => {
      transactionCalls += 1;
      throw new Error("The transaction must not start for an invalid snapshot");
    }
  } as unknown as PrismaClient;
  const aiDesign = firstBeadVariant("design-non-diy", { designMode: "AI_GENERATED" });

  await assert.rejects(
    new DesignRepository(prisma).createFirstBeadIdempotently(
      "actor-1",
      "request-non-diy",
      FINGERPRINT_A,
      aiDesign
    ),
    (error: unknown) => {
      assert.ok(error instanceof PersistenceError);
      assert.equal(error.code, "VALIDATION_ERROR");
      return true;
    }
  );
  assert.equal(transactionCalls, 0);
});

test("createFirstBeadIdempotently rejects a non-private snapshot before any database work", async () => {
  let transactionCalls = 0;
  const prisma = {
    $transaction: async () => {
      transactionCalls += 1;
      throw new Error("The transaction must not start for an invalid snapshot");
    }
  } as unknown as PrismaClient;
  const publicDesign = firstBeadVariant("design-non-private", {
    community: {
      visibility: "PUBLIC",
      publishConsent: true,
      allowRemix: false,
      creatorDisplayMode: "ANONYMOUS"
    }
  });

  await assert.rejects(
    new DesignRepository(prisma).createFirstBeadIdempotently(
      "actor-1",
      "request-non-private",
      FINGERPRINT_A,
      publicDesign
    ),
    (error: unknown) => {
      assert.ok(error instanceof PersistenceError);
      assert.equal(error.code, "VALIDATION_ERROR");
      return true;
    }
  );
  assert.equal(transactionCalls, 0);
});
