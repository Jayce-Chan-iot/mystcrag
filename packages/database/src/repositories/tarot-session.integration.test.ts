import assert from "node:assert/strict";
import test from "node:test";

import { DesignV1Schema } from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";
import {
  createPrivateDrawState,
  revealDraw,
  selectPosition,
  type PrivateDrawState,
  type RandomSource,
  type RevealedTarotCard
} from "@mystcrag/tarot-engine";

import { createPrismaClient } from "../client/prisma-client.js";
import { PersistenceError } from "../errors/persistence-errors.js";
import {
  TarotSessionRepositoryImpl,
  type TarotDrawSnapshot,
  type TarotRecommendationSnapshot
} from "./tarot-session.repository.js";

const databaseUrl = process.env.DATABASE_URL;

class ZeroRandomSource implements RandomSource {
  nextInt(maxExclusive: number): number {
    assert.ok(maxExclusive > 0);
    return 0;
  }
}

const emptyDrawSnapshot = (): TarotDrawSnapshot => ({ acceptedSelections: [] });

const toDrawSnapshot = (
  state: PrivateDrawState,
  cards?: readonly RevealedTarotCard[]
): TarotDrawSnapshot => ({
  acceptedSelections: state.selections.map((selection) => ({ ...selection })),
  ...(cards
    ? {
        revealedCards: cards.map((card) => ({
          slot: card.slot,
          displayedPosition: card.displayedPosition,
          cardId: card.id,
          number: card.number,
          nameZh: card.nameZh,
          nameEn: card.nameEn,
          assetFile: card.assetFile,
          orientation: card.orientation,
          keywords: [...(card.orientation === "UPRIGHT" ? card.uprightKeywords : card.reversedKeywords)]
        }))
      }
    : {})
});

const recommendationSnapshot: TarotRecommendationSnapshot = {
  interpretation: {
    headline: "A grounded next step",
    summary: "Use the card imagery as a reflective prompt for a balanced design direction.",
    cardReflections: [{ slot: "GUIDANCE", reflection: "Notice which colors feel steady today." }],
    designRationale: "The directions vary contrast while keeping a calm visual rhythm.",
    disclaimer: "For reflection and creative inspiration only."
  },
  colorStory: {
    primaryColor: "#A8C5D1",
    supportColor: "#F2EEE5",
    accentColor: "#B58A63",
    rationale: "Soft blue and warm neutral tones create a balanced palette."
  },
  materialRecommendations: [
    {
      beadProductId: "product-aquamarine-round-8",
      displayName: "Aquamarine round bead",
      crystalName: "Aquamarine",
      colorTags: ["blue"],
      reason: "Its translucent blue supports the selected visual direction."
    }
  ]
};

const createInput = (ownerId: string, parentSessionId?: string) => ({
  ownerId,
  spreadType: "SINGLE" as const,
  theme: "SELF_GROWTH" as const,
  deckVersion: "rws-major-minor-v1",
  ruleVersion: "tarot-design-v1",
  privateDeckState: createPrivateDrawState({
    spreadType: "SINGLE",
    random: new ZeroRandomSource()
  }),
  drawSnapshot: emptyDrawSnapshot(),
  parentSessionId
});

test("Tarot session repository persists validated owner-scoped lifecycle state", { skip: !databaseUrl }, async (t) => {
  const prisma = createPrismaClient(databaseUrl);
  const repository = new TarotSessionRepositoryImpl(prisma);
  const ownerId = "tarot-repository-owner";
  const otherOwnerId = "tarot-repository-other-owner";

  await prisma.$connect();
  try {
    await prisma.user.createMany({
      data: [{ id: ownerId }, { id: otherOwnerId }]
    });

    await t.test("create/read validates snapshots and stores no raw question by default", async () => {
      const created = await repository.create(createInput(ownerId));
      const read = await repository.getOwned(ownerId, created.id);

      assert.equal(read.id, created.id);
      assert.equal(read.ownerId, ownerId);
      assert.equal(read.status, "DRAWING");
      assert.equal(read.stateRevision, 1);
      assert.deepEqual(read.drawSnapshot, { acceptedSelections: [] });
      assert.equal(read.questionCiphertext, null);
      assert.equal(read.questionSavedAt, null);

      const raw = await prisma.tarotSession.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(raw.questionCiphertext, null);
      assert.equal(raw.questionSavedAt, null);
      assert.equal("question" in raw, false);
    });

    await t.test("owner isolation returns NOT_FOUND without revealing cross-owner existence", async () => {
      const created = await repository.create(createInput(ownerId));
      await assert.rejects(
        () => repository.getOwned(otherOwnerId, created.id),
        (error: unknown) => error instanceof PersistenceError && error.code === "NOT_FOUND"
      );
    });

    await t.test("malformed persisted JSON is reported as data corruption", async () => {
      const created = await repository.create(createInput(ownerId));
      await prisma.$executeRawUnsafe(
        'UPDATE "tarot_sessions" SET "draw_snapshot" = $1::jsonb WHERE "id" = $2',
        JSON.stringify({ acceptedSelections: [], privateDeckOrder: ["forbidden"] }),
        created.id
      );

      await assert.rejects(
        () => repository.getOwned(ownerId, created.id),
        (error: unknown) =>
          error instanceof PersistenceError && error.code === "DATA_INTEGRITY_ERROR"
      );
    });

    await t.test("compare-and-swap rejects a stale draw transition", async () => {
      const created = await repository.create(createInput(ownerId));
      const selectedState = selectPosition(created.privateDeckState, {
        slot: "GUIDANCE",
        displayedPosition: 12,
        expectedRevision: 0,
        operationId: "stale-draw-operation"
      });

      await assert.rejects(
        () => repository.updateDraw({
          ownerId,
          sessionId: created.id,
          expectedRevision: 2,
          operationId: "stale-draw-operation",
          status: "DRAWING",
          privateDeckState: selectedState,
          drawSnapshot: toDrawSnapshot(selectedState)
        }),
        (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
      );
    });

    await t.test("selection operation retries are idempotent and conflicting reuse is rejected", async () => {
      const created = await repository.create(createInput(ownerId));
      const selectedState = selectPosition(created.privateDeckState, {
        slot: "GUIDANCE",
        displayedPosition: 12,
        expectedRevision: 0,
        operationId: "select-guidance-once"
      });
      const command = {
        ownerId,
        sessionId: created.id,
        expectedRevision: 1,
        operationId: "select-guidance-once",
        status: "DRAWING" as const,
        privateDeckState: selectedState,
        drawSnapshot: toDrawSnapshot(selectedState)
      };

      const accepted = await repository.updateDraw(command);
      const retry = await repository.updateDraw(command);
      assert.equal(accepted.stateRevision, 2);
      assert.equal(retry.stateRevision, 2);
      assert.deepEqual(retry.privateDeckState.selections, accepted.privateDeckState.selections);

      const conflictingState = {
        ...selectedState,
        selections: [{ ...selectedState.selections[0]!, displayedPosition: 13 }]
      };
      await assert.rejects(
        () => repository.updateDraw({
          ...command,
          privateDeckState: conflictingState,
          drawSnapshot: toDrawSnapshot(conflictingState)
        }),
        (error: unknown) => error instanceof PersistenceError && error.code === "CONFLICT"
      );
    });

    await t.test("recommendations require exactly three distinct ranks and owned designs", async () => {
      const designIds = [1, 2, 3].map((rank) => `tarot-recommendation-design-${rank}`);
      for (const designId of designIds) {
        const snapshot = DesignV1Schema.parse({
          ...structuredClone(standardAiDesignFixture),
          designId,
          designMode: "TAROT_GUIDED"
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
      const created = await repository.create(createInput(ownerId));
      const selected = selectPosition(created.privateDeckState, {
        slot: "GUIDANCE",
        displayedPosition: 12,
        expectedRevision: 0,
        operationId: "recommend-select"
      });
      const selectedRecord = await repository.updateDraw({
        ownerId,
        sessionId: created.id,
        expectedRevision: created.stateRevision,
        operationId: "recommend-select",
        status: "DRAWING",
        privateDeckState: selected,
        drawSnapshot: toDrawSnapshot(selected)
      });
      const revealed = revealDraw(selected, 1);
      const drawn = await repository.updateDraw({
        ownerId,
        sessionId: created.id,
        expectedRevision: selectedRecord.stateRevision,
        status: "DRAWN",
        privateDeckState: revealed.state,
        drawSnapshot: toDrawSnapshot(revealed.state, revealed.cards)
      });

      await assert.rejects(
        () => repository.saveRecommendations({
          ownerId,
          sessionId: created.id,
          expectedRevision: drawn.stateRevision,
          recommendationSnapshot,
          recommendations: [
            { rank: 1, designId: designIds[0]! },
            { rank: 1, designId: designIds[1]! },
            { rank: 3, designId: designIds[2]! }
          ]
        }),
        (error: unknown) => error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
      );
      await assert.rejects(
        () => repository.saveRecommendations({
          ownerId,
          sessionId: created.id,
          expectedRevision: drawn.stateRevision,
          recommendationSnapshot,
          recommendations: [
            { rank: 1, designId: designIds[0]! },
            { rank: 2, designId: designIds[0]! },
            { rank: 3, designId: designIds[2]! }
          ]
        }),
        (error: unknown) => error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
      );

      const recommended = await repository.saveRecommendations({
        ownerId,
        sessionId: created.id,
        expectedRevision: drawn.stateRevision,
        recommendationSnapshot,
        recommendations: designIds.map((designId, index) => ({ rank: index + 1, designId }))
      });
      assert.deepEqual(
        recommended.recommendations.map(({ rank, designId }) => ({ rank, designId })),
        [
          { rank: 1, designId: designIds[0] },
          { rank: 2, designId: designIds[1] },
          { rank: 3, designId: designIds[2] }
        ]
      );

      await assert.rejects(() => prisma.design.delete({ where: { id: designIds[0] } }));
      await assert.rejects(() => prisma.tarotSession.delete({ where: { id: created.id } }));

      await assert.rejects(
        () => repository.markSaved({
          ownerId,
          sessionId: created.id,
          expectedRevision: recommended.stateRevision,
          selectedDesignId: "not-a-session-recommendation"
        }),
        (error: unknown) => error instanceof PersistenceError && error.code === "VALIDATION_ERROR"
      );
      const saved = await repository.markSaved({
        ownerId,
        sessionId: created.id,
        expectedRevision: recommended.stateRevision,
        selectedDesignId: designIds[1]
      });
      assert.equal(saved.status, "SAVED");
      assert.equal(saved.selectedDesignId, designIds[1]);
    });

    await t.test("redraw sessions preserve restrictive owner-scoped parent lineage", async () => {
      const parent = await repository.create(createInput(ownerId));
      const redraw = await repository.create(createInput(ownerId, parent.id));
      assert.equal(redraw.parentSessionId, parent.id);
      await assert.rejects(() => prisma.tarotSession.delete({ where: { id: parent.id } }));

      const otherParent = await repository.create(createInput(otherOwnerId));
      await assert.rejects(
        () => repository.create(createInput(ownerId, otherParent.id)),
        (error: unknown) => error instanceof PersistenceError && error.code === "NOT_FOUND"
      );
    });
  } finally {
    await prisma.$disconnect();
  }
});
