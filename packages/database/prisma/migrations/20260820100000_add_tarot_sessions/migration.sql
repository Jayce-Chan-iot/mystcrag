ALTER TYPE "DesignMode" ADD VALUE 'TAROT_GUIDED';

CREATE TYPE "TarotSpreadType" AS ENUM ('SINGLE', 'PAST_PRESENT_FUTURE');

CREATE TYPE "TarotSessionStatus" AS ENUM ('DRAWING', 'DRAWN', 'RECOMMENDED', 'SAVED', 'ABANDONED');

CREATE TABLE "tarot_sessions" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "spread_type" "TarotSpreadType" NOT NULL,
    "theme" TEXT NOT NULL,
    "status" "TarotSessionStatus" NOT NULL DEFAULT 'DRAWING',
    "state_revision" INTEGER NOT NULL DEFAULT 1,
    "deck_version" TEXT NOT NULL,
    "rule_version" TEXT NOT NULL,
    "private_deck_state" JSONB NOT NULL,
    "draw_snapshot" JSONB NOT NULL,
    "recommendation_snapshot" JSONB,
    "question_ciphertext" TEXT,
    "question_saved_at" TIMESTAMP(3),
    "selected_design_id" TEXT,
    "parent_session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tarot_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tarot_design_recommendations" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "design_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tarot_design_recommendations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tarot_sessions_owner_id_updated_at_idx" ON "tarot_sessions"("owner_id", "updated_at");

CREATE UNIQUE INDEX "tarot_design_recommendations_session_id_rank_key" ON "tarot_design_recommendations"("session_id", "rank");

CREATE UNIQUE INDEX "tarot_design_recommendations_session_id_design_id_key" ON "tarot_design_recommendations"("session_id", "design_id");

ALTER TABLE "tarot_sessions" ADD CONSTRAINT "tarot_sessions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tarot_sessions" ADD CONSTRAINT "tarot_sessions_parent_session_id_fkey" FOREIGN KEY ("parent_session_id") REFERENCES "tarot_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tarot_design_recommendations" ADD CONSTRAINT "tarot_design_recommendations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "tarot_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tarot_design_recommendations" ADD CONSTRAINT "tarot_design_recommendations_design_id_fkey" FOREIGN KEY ("design_id") REFERENCES "designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
