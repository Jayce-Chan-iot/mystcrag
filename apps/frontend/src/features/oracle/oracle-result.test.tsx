import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OracleCastSessionSchema,
  OracleRecommendedSessionSchema
} from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MIN_BRACELET_CIRCUMFERENCE_MM } from "../design/model/bracelet-fit";
import { formatMinorAmount } from "../design/model/format-minor-amount";
import type { OracleCoordinatorSnapshot } from "./oracle-coordinator";
import {
  OracleLines,
  getOracleLineViewModels
} from "./components/oracle-lines";
import {
  OracleResult,
  OracleResultBody,
  OracleDesignCard,
  getOracleRevealPlan,
  isOracleSaveConfirmed,
  recommendationsStateFromSnapshot,
  saveUiStateFromSnapshot
} from "./components/oracle-result";
import { OracleSetup } from "./components/oracle-setup";
import { ORACLE_FULL_REVEAL_MS, ORACLE_SHORT_REVEAL_MS } from "./oracle-motion-preference";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const createdAt = "2026-09-29T08:00:00.000Z";
const sessionId = "oracle-session-1";
const ruleVersion = "oracle-design-rules-v1";

const interpretation = {
  headline: "先稳住节奏，再观察转折",
  summary: "这组结构可作为观察当下节奏的一个角度，设计以沉静层次承接变化。",
  keywords: ["沉静", "节奏", "转折"] as [string, string, string],
  designRationale: "深色主调配一处克制点睛，让动爻只成为视觉转折而非命运判断。",
  disclaimer: "内容仅作文化观察与设计灵感，不构成预测、医疗建议或水晶功效承诺。",
  source: { kind: "MYSTCRAG_ORIGINAL" as const, version: "oracle-copy-v1" }
};

const movingCast = OracleCastSessionSchema.parse({
  sessionId,
  status: "CAST",
  revision: 1,
  locale: "zh-CN",
  currency: "CNY",
  wristCircumferenceMm: 155,
  cast: {
    lines: [7, 8, 9, 6, 7, 8],
    movingLineIndices: [3, 4],
    primaryHexagram: { number: 39, nameZh: "蹇", lowerTrigram: "WATER", upperTrigram: "MOUNTAIN" },
    transformedHexagram: { number: 31, nameZh: "咸", lowerTrigram: "MOUNTAIN", upperTrigram: "LAKE" },
    algorithm: { name: "THREE_COIN", version: "three-coin-v1" }
  },
  signal: {
    ruleVersion,
    primaryColorTags: ["color:black", "color:blue"],
    supportColorTags: ["color:white"],
    styleTags: ["style:eastern-contemporary"],
    rhythmTags: ["rhythm:steady"],
    accentLinePositions: [3, 4]
  },
  interpretation,
  createdAt,
  updatedAt: createdAt
});

const staticCast = OracleCastSessionSchema.parse({
  ...movingCast,
  cast: {
    lines: [7, 8, 7, 8, 7, 8],
    movingLineIndices: [],
    primaryHexagram: { number: 29, nameZh: "坎", lowerTrigram: "WATER", upperTrigram: "WATER" },
    algorithm: { name: "THREE_COIN", version: "three-coin-v1" }
  },
  signal: { ...movingCast.signal, accentLinePositions: [] }
});

const directions = ["BALANCED", "CONTRAST", "NEUTRAL_LED"] as const;
const oracleDesigns = directions.map((direction, index) => {
  const design = structuredClone(standardAiDesignFixture);
  design.designId = `oracle-design-${index + 1}`;
  design.designName = `星台方案${index + 1}`;
  design.designMode = "ORACLE_GUIDED" as typeof design.designMode;
  design.provenance.oracleCandidate = {
    sessionId,
    ruleVersion,
    rank: index + 1,
    direction
  };
  return design;
});

const recommendedSession = OracleRecommendedSessionSchema.parse({
  ...movingCast,
  status: "RECOMMENDED",
  revision: 2,
  recommendations: directions.map((direction, index) => ({
    rank: index + 1,
    direction,
    design: oracleDesigns[index]
  }))
});

function snapshot(partial: Partial<OracleCoordinatorSnapshot> = {}): OracleCoordinatorSnapshot {
  return {
    state: "recommended",
    session: recommendedSession,
    selectedDesignId: null,
    error: null,
    ...partial
  };
}

test("oracle lines render bottom-to-top with solid and broken geometry", () => {
  const viewModels = getOracleLineViewModels({
    lines: movingCast.cast.lines,
    movingLineIndices: movingCast.cast.movingLineIndices,
    revealProgress: 1
  });

  assert.equal(viewModels.length, 6);
  assert.equal(viewModels[0]?.position, 1, "first model is the bottom line");
  assert.equal(viewModels[5]?.position, 6, "last model is the top line");

  assert.equal(viewModels[0]?.kind, "solid", "7 is a solid yang line");
  assert.equal(viewModels[1]?.kind, "broken", "8 is a broken yin line");
  assert.equal(viewModels[2]?.kind, "solid", "9 is a moving yang line rendered solid");
  assert.equal(viewModels[3]?.kind, "broken", "6 is a moving yin line rendered broken");

  const markup = renderToStaticMarkup(
    <OracleLines lines={movingCast.cast.lines} movingLineIndices={movingCast.cast.movingLineIndices} revealProgress={1} />
  );

  assert.equal((markup.match(/data-oracle-line=/g) ?? []).length, 6);
  assert.match(markup, /data-line-position="1"[\s\S]*data-line-kind="solid"/);
  assert.match(markup, /data-line-position="2"[\s\S]*data-line-kind="broken"/);
});

test("moving lines are labelled in text and never rely on colour alone", () => {
  const markup = renderToStaticMarkup(
    <OracleLines lines={movingCast.cast.lines} movingLineIndices={movingCast.cast.movingLineIndices} revealProgress={1} />
  );

  assert.match(markup, /动爻/);
  assert.match(markup, /data-line-moving="true"[^>]*>[^]*动爻/);
  assert.equal((markup.match(/动爻/g) ?? []).length, movingCast.cast.movingLineIndices.length);

  const staticMarkup = renderToStaticMarkup(
    <OracleLines lines={staticCast.cast.lines} movingLineIndices={[]} revealProgress={1} />
  );
  assert.doesNotMatch(staticMarkup, /动爻/);
});

test("static casts omit the transformed hexagram entirely", () => {
  const markup = renderToStaticMarkup(
    <OracleResultBody
      session={staticCast}
      selectedDesignId={null}
      recommendationsState="loading"
      revealProgress={1}
      fullMotion={false}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onSelectDesign={() => {}}
      onEnterDesign={() => {}}
      onRetryRecommendations={() => {}}
    />
  );

  assert.match(markup, /坎/);
  assert.doesNotMatch(markup, /变卦/);
  assert.doesNotMatch(markup, /咸/);
});

test("moving casts show primary to transformed hexagram", () => {
  const markup = renderToStaticMarkup(
    <OracleResultBody
      session={movingCast}
      selectedDesignId={null}
      recommendationsState="loading"
      revealProgress={1}
      fullMotion={false}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onSelectDesign={() => {}}
      onEnterDesign={() => {}}
      onRetryRecommendations={() => {}}
    />
  );

  assert.match(markup, /蹇/);
  assert.match(markup, /变卦/);
  assert.match(markup, /咸/);
});

test("first screen shows one headline and exactly three keywords", () => {
  const markup = renderToStaticMarkup(
    <OracleResultBody
      session={movingCast}
      selectedDesignId={null}
      recommendationsState="loading"
      revealProgress={1}
      fullMotion={false}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onSelectDesign={() => {}}
      onEnterDesign={() => {}}
      onRetryRecommendations={() => {}}
    />
  );

  assert.match(markup, /先稳住节奏，再观察转折/);
  assert.equal((markup.match(/data-oracle-keyword=/g) ?? []).length, 3);
  for (const keyword of interpretation.keywords) {
    assert.match(markup, new RegExp(keyword));
  }
  assert.match(markup, /不构成预测|文化观察|设计灵感/);
});

test("recommendation failure keeps the cast readable and retries only matching", () => {
  const markup = renderToStaticMarkup(
    <OracleResultBody
      session={movingCast}
      selectedDesignId={null}
      recommendationsState="error"
      revealProgress={1}
      fullMotion={false}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onSelectDesign={() => {}}
      onEnterDesign={() => {}}
      onRetryRecommendations={() => {}}
    />
  );

  assert.match(markup, /蹇/, "cast stays visible when recommendations fail");
  assert.match(markup, /先稳住节奏/);
  assert.match(markup, /重新匹配水晶/);
  assert.doesNotMatch(markup, /重新启卦|重新起卦/);
});

test("design cards surface authoritative price and do not invent stock claims", () => {
  const design = oracleDesigns[0]!;
  const expectedPrice = formatMinorAmount({
    amountMinor: design.pricing.totalPriceMinor,
    currency: design.currency,
    locale: design.locale
  });

  const markup = renderToStaticMarkup(
    <OracleDesignCard
      design={design}
      rank={1}
      direction="BALANCED"
      selected={false}
      onSelect={() => {}}
    />
  );

  assert.match(markup, new RegExp(expectedPrice.replace("$", "\\$")));
  assert.match(markup, new RegExp(design.designName));
  assert.match(markup, /data-oracle-design-card="1"/);
  assert.doesNotMatch(markup, /库存充足|现货\d+/);
});

test("generate my bracelet enters the existing DIY design flow", () => {
  const design = oracleDesigns[1]!;
  let entered: string | null = null;

  const markup = renderToStaticMarkup(
    <OracleResultBody
      session={recommendedSession}
      selectedDesignId={design.designId}
      recommendationsState="ready"
      revealProgress={1}
      fullMotion={false}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onSelectDesign={() => {}}
      onEnterDesign={() => {
        entered = `/diy/${design.designId}`;
      }}
      onRetryRecommendations={() => {}}
    />
  );

  assert.match(markup, /生成我的手串/);
  assert.match(markup, /data-oracle-enter-design/);
  assert.equal(entered, null, "static markup does not navigate by itself");
});

test("one disclosure hides culture, algorithm and privacy detail", () => {
  const markup = renderToStaticMarkup(
    <OracleResultBody
      session={movingCast}
      selectedDesignId={null}
      recommendationsState="loading"
      revealProgress={1}
      fullMotion={false}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onSelectDesign={() => {}}
      onEnterDesign={() => {}}
      onRetryRecommendations={() => {}}
    />
  );

  assert.equal((markup.match(/<details/g) ?? []).length, 1);
  assert.match(markup, /查看卦象详情|卦象详情/);
});

test("reveal plan honours reduced motion, opt-out and the 4000 ms budget", () => {
  const full = getOracleRevealPlan({ prefersReducedMotion: false, fullMotionEnabled: true });
  assert.equal(full.durationMs, ORACLE_FULL_REVEAL_MS);
  assert.ok(full.durationMs <= 4000);
  assert.ok(full.durationMs >= 2800);

  const reduced = getOracleRevealPlan({ prefersReducedMotion: true, fullMotionEnabled: true });
  assert.equal(reduced.durationMs, ORACLE_SHORT_REVEAL_MS);
  assert.equal(reduced.mode, "short");

  const optedOut = getOracleRevealPlan({ prefersReducedMotion: false, fullMotionEnabled: false });
  assert.equal(optedOut.durationMs, ORACLE_SHORT_REVEAL_MS);
  assert.equal(optedOut.mode, "short");
});

test("result page source keeps refresh restore free of re-cast entropy", () => {
  const resultSource = readFileSync(new URL("./components/oracle-result.tsx", import.meta.url), "utf8");
  const clientSource = readFileSync(
    new URL("../../../app/oracle/result/[sessionId]/oracle-result-client.tsx", import.meta.url),
    "utf8"
  );
  const pageSource = readFileSync(
    new URL("../../../app/oracle/result/[sessionId]/page.tsx", import.meta.url),
    "utf8"
  );

  assert.match(clientSource, /restore\(/);
  assert.doesNotMatch(clientSource, /oracleApi\.create\(/);
  assert.doesNotMatch(resultSource, /oracleApi\.create\(/);
  assert.doesNotMatch(pageSource, /oracleApi\.create\(/);
  assert.match(pageSource, /sessionId/);
});

test("layout is keyboard-semantic and free of 320px overflow hazards", () => {
  const markup = renderToStaticMarkup(
    <OracleResult
      detailsOpen={false}
      fullMotionEnabled={false}
      onEnterDesign={() => {}}
      onRetryRecommendations={() => {}}
      onSelectDesign={() => {}}
      onToggleDetails={() => {}}
      onToggleFullMotion={() => {}}
      reveal={{ mode: "short", durationMs: ORACLE_SHORT_REVEAL_MS, revealProgress: 1 }}
      sessionId={sessionId}
      snapshot={snapshot({ state: "revealing", session: movingCast })}
    />
  );

  assert.match(markup, /<main[^>]*data-oracle-result/);
  assert.match(markup, /aria-live/);
  assert.doesNotMatch(markup, /style="[^"]*width:\s*100vw/);

  const css = readFileSync(new URL("./oracle.module.css", import.meta.url), "utf8");
  assert.match(css, /overflow-x:\s*clip|overflow-x:\s*hidden/);
  assert.match(css, /min-width:\s*0|max-width:\s*100%/);
});

test("wrist context reuses the shared fit constants", () => {
  const source = readFileSync(new URL("./components/oracle-setup.tsx", import.meta.url), "utf8");
  assert.match(source, /MIN_BRACELET_CIRCUMFERENCE_MM/);
  assert.ok(MIN_BRACELET_CIRCUMFERENCE_MM > 0);
});

test("oracle result mounts through the coordinator snapshot", () => {
  const markup = renderToStaticMarkup(
    <OracleResult
      sessionId={sessionId}
      snapshot={snapshot()}
      reveal={{ mode: "short", durationMs: ORACLE_SHORT_REVEAL_MS, revealProgress: 1 }}
      detailsOpen={false}
      fullMotionEnabled={false}
      onToggleDetails={() => {}}
      onSelectDesign={() => {}}
      onEnterDesign={() => {}}
      onRetryRecommendations={() => {}}
      onToggleFullMotion={() => {}}
    />
  );

  assert.match(markup, /data-oracle-result/);
  assert.match(markup, /生成我的手串|匹配水晶/);
});

test("save confirmation reads the authoritative coordinator snapshot", () => {
  const designId = oracleDesigns[0]!.designId;

  assert.equal(
    isOracleSaveConfirmed(
      {
        state: "recommended",
        session: { ...recommendedSession, status: "SAVED", selectedDesignId: designId },
        selectedDesignId: designId,
        error: null
      },
      designId
    ),
    true
  );

  assert.equal(
    isOracleSaveConfirmed(
      {
        state: "error",
        session: recommendedSession,
        selectedDesignId: designId,
        error: { code: "NETWORK_ERROR", message: "down" } as never
      },
      designId
    ),
    false,
    "failed save must not claim confirmation even when the selection is local"
  );

  assert.equal(
    isOracleSaveConfirmed(
      {
        state: "recommended",
        session: { ...recommendedSession, status: "SAVED", selectedDesignId: "other-design" },
        selectedDesignId: designId,
        error: null
      },
      designId
    ),
    false
  );
});

test("enter-design source navigates only after a confirmed save", () => {
  const clientSource = readFileSync(
    new URL("../../../app/oracle/result/[sessionId]/oracle-result-client.tsx", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(clientSource, /\.finally\(\(\) => \{[\s\S]*router\.push/);
  assert.match(clientSource, /isOracleSaveConfirmed/);
  assert.match(clientSource, /await coordinator\.save/);

  const saveIndex = clientSource.indexOf("coordinator.save");
  const pushIndex = clientSource.indexOf("router.push(`/diy/");
  assert.ok(saveIndex >= 0 && pushIndex > saveIndex, "diy navigation must follow the save await");
});

test("save failure stays on the result page with an actionable retry", () => {
  const designId = oracleDesigns[0]!.designId;
  const markup = renderToStaticMarkup(
    <OracleResultBody
      session={recommendedSession}
      selectedDesignId={designId}
      recommendationsState="ready"
      saveState="error"
      revealProgress={1}
      fullMotion={false}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onSelectDesign={() => {}}
      onEnterDesign={() => {}}
      onRetryRecommendations={() => {}}
    />
  );

  assert.match(markup, /保存未完成，请重试生成手串/);
  assert.match(markup, /生成我的手串/);
  assert.match(markup, /data-oracle-save-state="error"/);
  assert.doesNotMatch(markup, /重新匹配水晶/, "save errors must not surface recommendation retry");
});

test("saving disables the enter CTA and cannot double-navigate", () => {
  const designId = oracleDesigns[0]!.designId;
  const markup = renderToStaticMarkup(
    <OracleResultBody
      session={recommendedSession}
      selectedDesignId={designId}
      recommendationsState="ready"
      saveState="saving"
      revealProgress={1}
      fullMotion={false}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onSelectDesign={() => {}}
      onEnterDesign={() => {}}
      onRetryRecommendations={() => {}}
    />
  );

  const cta = markup.match(/<button[^>]*data-oracle-enter-design="true"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(cta, /正在保存…/);
  assert.match(cta, /\sdisabled(?:\s|=|>)/);
});

test("save errors never masquerade as recommendation failures", () => {
  const saveFailed = {
    state: "error" as const,
    session: recommendedSession,
    selectedDesignId: oracleDesigns[0]!.designId,
    error: { code: "NETWORK_ERROR", message: "save failed" } as never
  };

  assert.equal(recommendationsStateFromSnapshot(saveFailed), "ready");
  assert.equal(saveUiStateFromSnapshot(saveFailed), "error");

  const recFailed = {
    state: "error" as const,
    session: movingCast,
    selectedDesignId: null,
    error: { code: "INVENTORY_CHANGED", message: "materials" } as never
  };
  assert.equal(recommendationsStateFromSnapshot(recFailed), "error");
  assert.equal(saveUiStateFromSnapshot(recFailed), "idle");

  const markup = renderToStaticMarkup(
    <OracleResultBody
      session={recommendedSession}
      selectedDesignId={oracleDesigns[0]!.designId}
      recommendationsState={recommendationsStateFromSnapshot(saveFailed)}
      saveState={saveUiStateFromSnapshot(saveFailed)}
      revealProgress={1}
      fullMotion={false}
      detailsOpen={false}
      onToggleDetails={() => {}}
      onSelectDesign={() => {}}
      onEnterDesign={() => {}}
      onRetryRecommendations={() => {}}
    />
  );

  assert.match(markup, /星台方案1/, "three recommendation cards stay readable");
  assert.match(markup, /data-oracle-design-card="2"/);
  assert.match(markup, /data-oracle-design-card="3"/);
  assert.match(markup, /蹇/, "cast stays readable");
  assert.match(markup, /保存未完成，请重试生成手串/);
  assert.doesNotMatch(markup, /重新匹配水晶/);
  assert.match(markup, /data-oracle-enter-design="true"/);
});

test("privacy copy is truthful about the request-scoped question", () => {
  const setupSource = readFileSync(new URL("./components/oracle-setup.tsx", import.meta.url), "utf8");
  const resultSource = readFileSync(new URL("./components/oracle-result.tsx", import.meta.url), "utf8");

  for (const source of [setupSource, resultSource]) {
    assert.doesNotMatch(source, /页面内存/);
    assert.doesNotMatch(source, /加密/);
    assert.doesNotMatch(source, /只保留在/);
    assert.match(source, /仅用于本次请求/);
    assert.match(source, /不会写入浏览器存储/);
  }

  const setupMarkup = renderToStaticMarkup(
    <OracleSetup
      question=""
      wristCircumferenceMm={undefined}
      isSubmitting={false}
      error={null}
      onQuestionChange={() => {}}
      onWristChange={() => {}}
      onSubmit={() => {}}
    />
  );
  assert.match(setupMarkup, /仅用于本次请求/);
  assert.doesNotMatch(setupMarkup, /页面内存/);

  const resultMarkup = renderToStaticMarkup(
    <OracleResultBody
      session={movingCast}
      selectedDesignId={null}
      recommendationsState="loading"
      revealProgress={1}
      fullMotion={false}
      detailsOpen
      onToggleDetails={() => {}}
      onSelectDesign={() => {}}
      onEnterDesign={() => {}}
      onRetryRecommendations={() => {}}
    />
  );
  assert.match(resultMarkup, /仅用于本次请求/);
  assert.doesNotMatch(resultMarkup, /页面内存/);
});

test("disabled result route never mounts the oracle client", () => {
  const pageSource = readFileSync(
    new URL("../../../app/oracle/result/[sessionId]/page.tsx", import.meta.url),
    "utf8"
  );

  assert.match(pageSource, /isOracleFeatureEnabled/);
  assert.match(pageSource, /notFound\(/);

  const functionBody = pageSource.slice(pageSource.indexOf("export default async function"));
  const gateIndex = functionBody.indexOf("isOracleFeatureEnabled");
  const clientIndex = functionBody.indexOf("OracleResultClient");
  assert.ok(gateIndex >= 0, "result page must gate on the rollout flag");
  assert.ok(clientIndex > gateIndex, "client mount must come after the flag gate");
});
