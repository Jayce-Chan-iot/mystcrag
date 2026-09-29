import assert from "node:assert/strict";
import test from "node:test";

import {
  DesignV1Schema,
  OracleCastDtoSchema,
  OracleDesignSignalSchema,
  OracleInterpretationSchema
} from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { createPrismaClient } from "../client/prisma-client.js";
import { PersistenceError } from "../errors/persistence-errors.js";
import { OracleSessionRepositoryImpl } from "./oracle-session.repository.js";

const databaseUrl = process.env.DATABASE_URL;

const cast = OracleCastDtoSchema.parse({
  lines: [7, 8, 9, 6, 7, 8],
  movingLineIndices: [3, 4],
  primaryHexagram: {
    number: 39,
    nameZh: "蹇",
    lowerTrigram: "WATER",
    upperTrigram: "MOUNTAIN"
  },
  transformedHexagram: {
    number: 31,
    nameZh: "咸",
    lowerTrigram: "MOUNTAIN",
    upperTrigram: "LAKE"
  },
  algorithm: { name: "THREE_COIN", version: "three-coin-v1" }
});

const signal = OracleDesignSignalSchema.parse({
  ruleVersion: "oracle-design-rules-v1",
  primaryColorTags: ["color:black", "color:blue"],
  supportColorTags: ["color:white"],
  styleTags: ["style:eastern-contemporary"],
  rhythmTags: ["rhythm:steady"],
  accentLinePositions: [3, 4]
});

const interpretation = OracleInterpretationSchema.parse({
  headline: "先稳住节奏",
  summary: "这组结构可作为观察当下节奏的一个角度。",
  keywords: ["沉静", "节奏", "转折"],
  designRationale: "深色主调以一处克制点睛承接变化。",
  disclaimer: "内容仅作文化观察与设计灵感。",
  source: { kind: "MYSTCRAG_ORIGINAL", version: "oracle-copy-v1" }
});

const createInput = (ownerId: string, operationId: string, parentSessionId?: string) => ({
  ownerId,
  operationId,
  locale: "zh-CN" as const,
  currency: "CNY" as const,
  wristCircumferenceMm: 155,
  cast,
  signal,
  interpretation,
  parentSessionId
});

test("Oracle repository persists an owner-scoped idempotent lifecycle without questions", { skip: !databaseUrl }, async (t) => {
  const prisma = createPrismaClient(databaseUrl);
  const repository = new OracleSessionRepositoryImpl(prisma);
  const ownerId = "oracle-repository-owner";
  const otherOwnerId = "oracle-repository-other-owner";

  await prisma.$connect();
  try {
    await prisma.user.createMany({
      data: [{ id: ownerId }, { id: otherOwnerId }],
      skipDuplicates: true
    });

    await t.test("create retry returns one cast and changed durable input conflicts", async () => {
      const input = createInput(ownerId, "oracle-create-retry");
      const created = await repository.createOrGet(input);
      const retry = await repository.createOrGet(input);
      assert.equal(retry.id, created.id);
      assert.deepEqual(retry.cast, created.cast);
      assert.equal(
        await prisma.oracleSession.count({
          where: { ownerId, operationId: input.operationId }
        }),
        1
      );
      await assert.rejects(
        () => repository.createOrGet({ ...input, wristCircumferenceMm: 160 }),
        (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
      );

      const concurrentInput = createInput(ownerId, "oracle-create-concurrent");
      const [firstConcurrent, secondConcurrent] = await Promise.all([
        repository.createOrGet(concurrentInput),
        repository.createOrGet(concurrentInput)
      ]);
      assert.equal(firstConcurrent.id, secondConcurrent.id);

      const raw = await prisma.oracleSession.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(Object.keys(raw).some((key) => key.toLowerCase().includes("question")), false);
      assert.equal(JSON.stringify(raw).includes("question"), false);
    });

    await t.test("cross-owner reads are generic and corrupt snapshots fail closed", async () => {
      const created = await repository.createOrGet(createInput(ownerId, "oracle-owner-scope"));
      await assert.rejects(
        () => repository.getOwned(otherOwnerId, created.id),
        (error: unknown) => error instanceof PersistenceError && error.code === "NOT_FOUND"
      );
      await prisma.$executeRawUnsafe(
        'UPDATE "oracle_sessions" SET "signal_snapshot" = $1::jsonb WHERE "id" = $2',
        JSON.stringify({ ...signal, question: "forbidden" }),
        created.id
      );
      await assert.rejects(
        () => repository.getOwned(ownerId, created.id),
        (error: unknown) => error instanceof PersistenceError && error.code === "DATA_INTEGRITY_ERROR"
      );
    });

    await t.test("operation lookup is owner-scoped, side-effect free, and fails closed", async () => {
      const created = await repository.createOrGet(createInput(ownerId, "oracle-operation-lookup"));
      const found = await repository.findOwnedByOperation(ownerId, "oracle-operation-lookup");
      assert.equal(found?.id, created.id);
      assert.equal(found?.operationId, "oracle-operation-lookup");
      assert.equal(found?.status, "CAST");

      assert.equal(
        await repository.findOwnedByOperation(otherOwnerId, "oracle-operation-lookup"),
        null
      );
      assert.equal(await repository.findOwnedByOperation(ownerId, "oracle-operation-lookup-absent"), null);

      assert.equal(
        await prisma.oracleSession.count({
          where: { ownerId, operationId: "oracle-operation-lookup" }
        }),
        1
      );
      const raw = await prisma.oracleSession.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(raw.status, "CAST");
      assert.equal(raw.stateRevision, 1);

      const corrupted = await repository.createOrGet(
        createInput(ownerId, "oracle-operation-lookup-corrupt")
      );
      await prisma.$executeRawUnsafe(
        'UPDATE "oracle_sessions" SET "cast_snapshot" = $1::jsonb WHERE "id" = $2',
        JSON.stringify({ ...cast, algorithm: { name: "THREE_COIN", version: "tampered" } }),
        corrupted.id
      );
      await assert.rejects(
        () => repository.findOwnedByOperation(ownerId, "oracle-operation-lookup-corrupt"),
        (error: unknown) => error instanceof PersistenceError && error.code === "DATA_INTEGRITY_ERROR"
      );
    });

    await t.test("PostgreSQL rejects invalid Oracle lifecycle, wrist, and rank state", async () => {
      const created = await repository.createOrGet(createInput(ownerId, "oracle-db-checks"));
      await assert.rejects(() => prisma.$executeRawUnsafe(
        'UPDATE "oracle_sessions" SET "state_revision" = 2 WHERE "id" = $1',
        created.id
      ));
      await assert.rejects(() => prisma.$executeRawUnsafe(
        'UPDATE "oracle_sessions" SET "wrist_circumference_mm" = 129 WHERE "id" = $1',
        created.id
      ));
      await assert.rejects(() => prisma.$executeRawUnsafe(
        'UPDATE "oracle_sessions" SET "recommendation_operation_id" = $1 WHERE "id" = $2',
        "illegal-before-recommend",
        created.id
      ));
      const raw = await prisma.oracleSession.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(raw.status, "CAST");
      assert.equal(raw.stateRevision, 1);
      assert.equal(raw.recommendationOperationId, null);
    });

    await t.test("recommend and save use revision guards, unique links, and restrictive FKs", async () => {
      const designIds = [1, 2, 3].map((rank) => `oracle-recommendation-design-${rank}`);
      for (const [index, designId] of designIds.entries()) {
        const snapshot = DesignV1Schema.parse({
          ...structuredClone(standardAiDesignFixture),
          designId,
          designMode: "ORACLE_GUIDED",
          provenance: {
            ...structuredClone(standardAiDesignFixture.provenance),
            oracleCandidate: {
              sessionId: "pending-session-link",
              ruleVersion: signal.ruleVersion,
              rank: index + 1,
              direction: ["BALANCED", "CONTRAST", "NEUTRAL_LED"][index]
            }
          }
        });
        await prisma.design.create({
          data: {
            id: snapshot.designId,
            ownerId,
            name: snapshot.designName,
            mode: snapshot.designMode,
            status: "GENERATED",
            schemaVersion: snapshot.schemaVersion,
            currentRevision: snapshot.revision,
            locale: snapshot.locale,
            currency: snapshot.currency,
            currentSnapshot: snapshot,
            complianceStatus: snapshot.compliance.complianceStatus,
            visibility: snapshot.community.visibility,
            publishConsent: snapshot.community.publishConsent,
            allowRemix: snapshot.community.allowRemix,
            creatorDisplayMode: snapshot.community.creatorDisplayMode
          }
        });
      }

      const created = await repository.createOrGet(createInput(ownerId, "oracle-lifecycle"));
      const recommendations = designIds.map((designId, index) => ({ rank: index + 1, designId }));
      await assert.rejects(
        () => repository.saveRecommendations({
          ownerId,
          sessionId: created.id,
          operationId: "oracle-recommend-stale",
          expectedRevision: 2,
          recommendations
        }),
        (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
      );
      const recommendCommand = {
        ownerId,
        sessionId: created.id,
        operationId: "oracle-recommend-once",
        expectedRevision: 1,
        recommendations
      };
      const [recommended, retry] = await Promise.all([
        repository.saveRecommendations(recommendCommand),
        repository.saveRecommendations(recommendCommand)
      ]);
      assert.equal(retry.stateRevision, recommended.stateRevision);

      await assert.rejects(
        () => repository.saveRecommendations({
          ...recommendCommand,
          ownerId: otherOwnerId,
          operationId: "oracle-cross-owner-recommend"
        }),
        (error: unknown) => error instanceof PersistenceError && error.code === "NOT_FOUND"
      );
      await assert.rejects(
        () => repository.markSaved({
          ownerId,
          sessionId: created.id,
          operationId: "oracle-save-stale",
          expectedRevision: 1,
          selectedDesignId: designIds[0]!
        }),
        (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
      );

      await assert.rejects(() => prisma.$executeRawUnsafe(
        'UPDATE "oracle_design_recommendations" SET "rank" = 4 WHERE "session_id" = $1 AND "rank" = 1',
        created.id
      ));

      const firstSaveCommand = {
        ownerId,
        sessionId: created.id,
        operationId: "oracle-save-once",
        expectedRevision: recommended.stateRevision,
        selectedDesignId: designIds[0]!
      };
      const secondSaveCommand = {
        ...firstSaveCommand,
        selectedDesignId: designIds[1]!
      };
      const saveRace = await Promise.allSettled([
        repository.markSaved(firstSaveCommand),
        repository.markSaved(secondSaveCommand)
      ]);
      assert.equal(saveRace.filter(({ status }) => status === "fulfilled").length, 1);
      assert.equal(saveRace.filter(({ status }) => status === "rejected").length, 1);
      const rejectedSave = saveRace.find(({ status }) => status === "rejected");
      assert.ok(rejectedSave?.status === "rejected");
      assert.ok(rejectedSave.reason instanceof PersistenceError);
      assert.equal(rejectedSave.reason.code, "CONFLICT");
      const saved = await repository.getOwned(ownerId, created.id);
      assert.equal(saved.status, "SAVED");
      assert.equal(saved.stateRevision, 3);
      assert.ok(saved.selectedDesignId === designIds[0] || saved.selectedDesignId === designIds[1]);
      const savedRetry = await repository.markSaved({
        ...(saved.selectedDesignId === designIds[0] ? firstSaveCommand : secondSaveCommand)
      });
      assert.equal(savedRetry.stateRevision, saved.stateRevision);
      await assert.rejects(() => prisma.design.delete({ where: { id: designIds[0] } }));
      await assert.rejects(() => prisma.oracleSession.delete({ where: { id: created.id } }));

      for (const [suffix, sameOperation] of [["different-operation", false], ["same-operation", true]] as const) {
        const raceSession = await repository.createOrGet(
          createInput(ownerId, `oracle-recommend-race-${suffix}`)
        );
        const firstCommand = {
          ownerId,
          sessionId: raceSession.id,
          operationId: `recommend-race-${suffix}-a`,
          expectedRevision: 1,
          recommendations
        };
        const secondCommand = {
          ...firstCommand,
          operationId: sameOperation ? firstCommand.operationId : `recommend-race-${suffix}-b`,
          recommendations: [
            { rank: 1, designId: designIds[1]! },
            { rank: 2, designId: designIds[0]! },
            { rank: 3, designId: designIds[2]! }
          ]
        };
        const race = await Promise.allSettled([
          repository.saveRecommendations(firstCommand),
          repository.saveRecommendations(secondCommand)
        ]);
        assert.equal(race.filter(({ status }) => status === "fulfilled").length, 1);
        assert.equal(race.filter(({ status }) => status === "rejected").length, 1);
        const rejection = race.find(({ status }) => status === "rejected");
        assert.ok(rejection?.status === "rejected");
        assert.ok(rejection.reason instanceof PersistenceError);
        assert.equal(rejection.reason.code, "CONFLICT");
        const final = await repository.getOwned(ownerId, raceSession.id);
        assert.equal(final.stateRevision, 2);
        assert.equal(final.recommendations.length, 3);
        const finalLinks = final.recommendations.map(({ rank, designId }) => ({ rank, designId }));
        assert.ok(
          JSON.stringify(finalLinks) === JSON.stringify(firstCommand.recommendations) ||
          JSON.stringify(finalLinks) === JSON.stringify(secondCommand.recommendations)
        );
      }
    });

    await t.test("redraw lineage requires the same owner", async () => {
      const parent = await repository.createOrGet(createInput(ownerId, "oracle-parent"));
      const redraw = await repository.createOrGet(
        createInput(ownerId, "oracle-redraw", parent.id)
      );
      assert.equal(redraw.parentSessionId, parent.id);
      const otherParent = await repository.createOrGet(
        createInput(otherOwnerId, "oracle-other-parent")
      );
      await assert.rejects(
        () => repository.createOrGet(createInput(ownerId, "oracle-invalid-parent", otherParent.id)),
        (error: unknown) => error instanceof PersistenceError && error.code === "NOT_FOUND"
      );
    });
  } finally {
    await prisma.$disconnect();
  }
});
