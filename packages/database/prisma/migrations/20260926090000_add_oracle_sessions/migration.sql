ALTER TYPE "DesignMode" ADD VALUE 'ORACLE_GUIDED';

CREATE TYPE "OracleSessionStatus" AS ENUM ('CAST', 'RECOMMENDED', 'SAVED');

CREATE TABLE "oracle_sessions" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "operation_id" TEXT NOT NULL,
    "status" "OracleSessionStatus" NOT NULL DEFAULT 'CAST',
    "state_revision" INTEGER NOT NULL DEFAULT 1,
    "locale" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "wrist_circumference_mm" INTEGER,
    "cast_snapshot" JSONB NOT NULL,
    "signal_snapshot" JSONB NOT NULL,
    "interpretation_snapshot" JSONB NOT NULL,
    "algorithm_version" TEXT NOT NULL,
    "rule_version" TEXT NOT NULL,
    "recommendation_operation_id" TEXT,
    "save_operation_id" TEXT,
    "selected_design_id" TEXT,
    "parent_session_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oracle_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "oracle_design_recommendations" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "design_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oracle_design_recommendations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "oracle_sessions_owner_id_operation_id_key" ON "oracle_sessions"("owner_id", "operation_id");
CREATE INDEX "oracle_sessions_owner_id_updated_at_idx" ON "oracle_sessions"("owner_id", "updated_at");
CREATE UNIQUE INDEX "oracle_design_recommendations_session_id_rank_key" ON "oracle_design_recommendations"("session_id", "rank");
CREATE UNIQUE INDEX "oracle_design_recommendations_session_id_design_id_key" ON "oracle_design_recommendations"("session_id", "design_id");

ALTER TABLE "oracle_sessions" ADD CONSTRAINT "oracle_sessions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oracle_sessions" ADD CONSTRAINT "oracle_sessions_parent_session_id_fkey" FOREIGN KEY ("parent_session_id") REFERENCES "oracle_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oracle_design_recommendations" ADD CONSTRAINT "oracle_design_recommendations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "oracle_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "oracle_design_recommendations" ADD CONSTRAINT "oracle_design_recommendations_design_id_fkey" FOREIGN KEY ("design_id") REFERENCES "designs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
