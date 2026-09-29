"use client";

import {
  ORACLE_FULL_REVEAL_MS,
  ORACLE_SHORT_REVEAL_MS,
  MAX_ORACLE_REVEAL_MS,
  resolveOracleRevealDurationMs,
  shouldPlayFullOracleReveal
} from "../oracle-motion-preference";
import type { OracleLineValue } from "./oracle-lines";
import { OracleLines } from "./oracle-lines";

export type OracleRevealPlan = {
  readonly mode: "full" | "short";
  readonly durationMs: number;
};

export function getOracleRevealPlan({
  prefersReducedMotion,
  fullMotionEnabled
}: {
  prefersReducedMotion: boolean;
  fullMotionEnabled: boolean;
}): OracleRevealPlan {
  const full = shouldPlayFullOracleReveal({ prefersReducedMotion, fullMotionEnabled });
  const durationMs = resolveOracleRevealDurationMs({ prefersReducedMotion, fullMotionEnabled });
  if (durationMs > MAX_ORACLE_REVEAL_MS) {
    return { mode: "short", durationMs: ORACLE_SHORT_REVEAL_MS };
  }
  return { mode: full ? "full" : "short", durationMs };
}

export type OracleRevealProps = Readonly<{
  lines: readonly OracleLineValue[];
  movingLineIndices: readonly number[];
  revealProgress: number;
  plan: OracleRevealPlan;
  primaryNameZh: string;
  transformedNameZh?: string | undefined;
}>;

export function OracleReveal({
  lines,
  movingLineIndices,
  revealProgress,
  plan,
  primaryNameZh,
  transformedNameZh
}: OracleRevealProps) {
  return (
    <section aria-label="卦象揭示" className="oracleRevealStage" data-oracle-reveal="true" data-reveal-mode={plan.mode}>
      <OracleLines
        lines={lines}
        movingLineIndices={movingLineIndices}
        revealProgress={revealProgress}
      />
      <p className="oracleHexagramSummary" data-oracle-hexagram="true">
        <strong className="oracleHexagramName">{primaryNameZh}</strong>
        {transformedHexagramLabel(transformedNameZh)}
      </p>
      <p className="oracleStatus" aria-live="polite">
        {revealProgress >= 1 ? "卦象已显现" : "星轨正在校准…"}
      </p>
    </section>
  );
}

function transformedHexagramLabel(transformedNameZh: string | undefined) {
  if (transformedNameZh === undefined) return null;
  return (
    <>
      <span aria-hidden="true">→</span>
      <span data-oracle-transformed="true">变卦</span>
      <strong className="oracleHexagramName">{transformedNameZh}</strong>
    </>
  );
}

export { ORACLE_FULL_REVEAL_MS };
