import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  OracleDesignSignalSchema,
  RecommendationContextSchema,
  type OracleCastDto
} from "@mystcrag/design-contract";

import { mergeContexts } from "../src/merge.js";
import {
  ORACLE_DESIGN_RULE_VERSION,
  ORACLE_SOURCE_WEIGHT,
  deriveOracleDesignSignal,
  resolveOracleContext
} from "../src/oracle.js";
import { resolveManualContext } from "../src/questionnaire.js";

const MOVING_CAST: OracleCastDto = {
  lines: [6, 7, 8, 9, 7, 8],
  movingLineIndices: [1, 4],
  primaryHexagram: {
    number: 47,
    nameZh: "困",
    lowerTrigram: "WATER",
    upperTrigram: "LAKE"
  },
  transformedHexagram: {
    number: 60,
    nameZh: "节",
    lowerTrigram: "LAKE",
    upperTrigram: "WATER"
  },
  algorithm: { name: "THREE_COIN", version: "three-coin-v1" }
};

const STATIC_HEAVEN_CAST: OracleCastDto = {
  lines: [7, 7, 7, 7, 7, 7],
  movingLineIndices: [],
  primaryHexagram: {
    number: 1,
    nameZh: "乾",
    lowerTrigram: "HEAVEN",
    upperTrigram: "HEAVEN"
  },
  algorithm: { name: "THREE_COIN", version: "three-coin-v1" }
};

const HIGH_MOTION_CAST: OracleCastDto = {
  lines: [6, 9, 6, 8, 9, 9],
  movingLineIndices: [1, 2, 3, 5, 6],
  primaryHexagram: {
    number: 59,
    nameZh: "涣",
    lowerTrigram: "WATER",
    upperTrigram: "WIND"
  },
  transformedHexagram: {
    number: 36,
    nameZh: "明夷",
    lowerTrigram: "FIRE",
    upperTrigram: "EARTH"
  },
  algorithm: { name: "THREE_COIN", version: "three-coin-v1" }
};

test("known casts map deterministically to controlled design signals", () => {
  const moving = deriveOracleDesignSignal(MOVING_CAST);
  assert.deepEqual(moving, {
    ruleVersion: ORACLE_DESIGN_RULE_VERSION,
    primaryColorTags: ["color:white", "color:blue"],
    supportColorTags: ["color:black"],
    styleTags: ["style:delicate", "style:romantic", "style:ethereal", "style:minimal"],
    rhythmTags: ["rhythm:alternating"],
    accentLinePositions: [1, 4]
  });
  assert.equal(OracleDesignSignalSchema.safeParse(moving).success, true);

  const staticHeaven = deriveOracleDesignSignal(STATIC_HEAVEN_CAST);
  assert.deepEqual(staticHeaven.rhythmTags, ["rhythm:steady"]);
  assert.deepEqual(staticHeaven.accentLinePositions, []);
});

test("yin-yang ratio controls rhythm while moving count and transformed trigrams control contrast", () => {
  const balancedStatic = deriveOracleDesignSignal({
    ...STATIC_HEAVEN_CAST,
    lines: [7, 8, 7, 8, 7, 8]
  });
  const gradualStatic = deriveOracleDesignSignal({
    ...STATIC_HEAVEN_CAST,
    lines: [7, 7, 7, 7, 8, 8]
  });
  const highMotion = deriveOracleDesignSignal(HIGH_MOTION_CAST);

  assert.deepEqual(balancedStatic.rhythmTags, ["rhythm:alternating"]);
  assert.deepEqual(gradualStatic.rhythmTags, ["rhythm:gradual"]);
  assert.deepEqual(highMotion.rhythmTags, ["rhythm:punctuated"]);
  assert.deepEqual(highMotion.primaryColorTags, ["color:green", "color:teal"]);
  assert.deepEqual(highMotion.supportColorTags, [
    "color:blue",
    "color:black",
    "color:yellow",
    "color:brown",
    "color:red",
    "color:orange"
  ]);
});

test("every trigram mapping emits registered color and style taxonomy ids", () => {
  const trigrams = [
    "HEAVEN", "LAKE", "FIRE", "THUNDER", "WIND", "WATER", "MOUNTAIN", "EARTH"
  ] as const;

  for (const lowerTrigram of trigrams) {
    for (const upperTrigram of trigrams) {
      const cast: OracleCastDto = {
        ...STATIC_HEAVEN_CAST,
        primaryHexagram: {
          ...STATIC_HEAVEN_CAST.primaryHexagram,
          lowerTrigram,
          upperTrigram
        }
      };
      assert.equal(
        OracleDesignSignalSchema.safeParse(deriveOracleDesignSignal(cast)).success,
        true,
        `${lowerTrigram}/${upperTrigram} must stay inside controlled taxonomy`
      );
    }
  }
});

test("Oracle context is soft, deterministic, private, and carries only the supplied wrist", () => {
  const signal = deriveOracleDesignSignal(MOVING_CAST);
  const first = resolveOracleContext({
    cast: MOVING_CAST,
    signal,
    wristCircumferenceMm: 158,
    locale: "zh-CN",
    currency: "CNY"
  });
  const second = resolveOracleContext({
    cast: MOVING_CAST,
    signal,
    wristCircumferenceMm: 158,
    locale: "zh-CN",
    currency: "CNY"
  });

  assert.equal(RecommendationContextSchema.safeParse(first).success, true);
  assert.equal(first.contextId, second.contextId);
  assert.deepEqual(first.sources, [
    { sourceType: "context-source:oracle", weight: ORACLE_SOURCE_WEIGHT }
  ]);
  assert.deepEqual(first.hardConstraints, {
    wristCircumferenceMm: 158,
    requiredProductIds: [],
    excludedProductIds: [],
    mustKeepComponentIds: []
  });
  assert.deepEqual(first.avoidances, { materialIds: [], colorFamilyIds: [] });
  assert.deepEqual(first.preferences.colorPreferences, ["color:white", "color:blue", "color:black"]);
  assert.equal(JSON.stringify(first).includes("question"), false);
});

test("Oracle context rejects a signal whose accents do not exactly match moving lines", () => {
  const signal = deriveOracleDesignSignal(MOVING_CAST);
  assert.throws(
    () =>
      resolveOracleContext({
        cast: MOVING_CAST,
        signal: { ...signal, accentLinePositions: [2] },
        wristCircumferenceMm: 158,
        locale: "zh-CN",
        currency: "CNY"
      }),
    /accent line positions must exactly match/
  );
});

test("Oracle context validates the user-supplied wrist at its public boundary", () => {
  assert.throws(() =>
    resolveOracleContext({
      cast: MOVING_CAST,
      signal: deriveOracleDesignSignal(MOVING_CAST),
      wristCircumferenceMm: 0,
      locale: "zh-CN",
      currency: "CNY"
    })
  );
});

test("Oracle never overrides or injects non-Oracle hard constraints during merge", () => {
  const manual = resolveManualContext({
    wristCircumferenceMm: 164,
    targetInnerCircumferenceMm: 171,
    maxBudgetMinor: 32000,
    requiredProductIds: ["product-required"],
    excludedProductIds: ["product-excluded"],
    mustKeepComponentIds: ["component-locked"],
    emotionTags: ["calm"],
    styleTags: ["minimal"],
    colorTags: ["white"]
  });
  const oracle = resolveOracleContext({
    cast: MOVING_CAST,
    signal: deriveOracleDesignSignal(MOVING_CAST),
    wristCircumferenceMm: 140,
    locale: "zh-CN",
    currency: "CNY"
  });
  const hostileOracle = {
    ...oracle,
    hardConstraints: {
      ...oracle.hardConstraints,
      maxBudgetMinor: 1,
      requiredProductIds: ["oracle-must-not-require"],
      excludedProductIds: ["oracle-must-not-exclude"],
      mustKeepComponentIds: ["oracle-must-not-lock"]
    }
  };

  for (const contexts of [[hostileOracle, manual], [manual, hostileOracle]]) {
    const merged = mergeContexts(contexts);
    assert.equal(merged.hardConstraints.wristCircumferenceMm, 164);
    assert.equal(merged.hardConstraints.targetInnerCircumferenceMm, 171);
    assert.equal(merged.hardConstraints.maxBudgetMinor, 32000);
    assert.deepEqual(merged.hardConstraints.requiredProductIds, ["product-required"]);
    assert.deepEqual(merged.hardConstraints.excludedProductIds, ["product-excluded"]);
    assert.deepEqual(merged.hardConstraints.mustKeepComponentIds, ["component-locked"]);
  }
});

test("Oracle filtering preserves pre-existing Tarot arrays in a three-way merge", () => {
  const manual = resolveManualContext({
    wristCircumferenceMm: 164,
    emotionTags: [],
    styleTags: [],
    colorTags: []
  });
  const oracle = resolveOracleContext({
    cast: MOVING_CAST,
    signal: deriveOracleDesignSignal(MOVING_CAST),
    wristCircumferenceMm: 140,
    locale: "zh-CN",
    currency: "CNY"
  });
  const tarot = {
    ...structuredClone(oracle),
    contextId: "ctx-tarot-regression",
    sources: [{ sourceType: "context-source:tarot" as const, weight: 0.5 }],
    hardConstraints: {
      ...oracle.hardConstraints,
      requiredProductIds: ["tarot-required"],
      excludedProductIds: ["tarot-excluded"],
      mustKeepComponentIds: ["tarot-component"]
    },
    avoidances: {
      materialIds: ["material:quartz"],
      colorFamilyIds: ["color:red"]
    }
  };

  const merged = mergeContexts([oracle, tarot, manual]);
  assert.deepEqual(merged.hardConstraints.requiredProductIds, ["tarot-required"]);
  assert.deepEqual(merged.hardConstraints.excludedProductIds, ["tarot-excluded"]);
  assert.deepEqual(merged.hardConstraints.mustKeepComponentIds, ["tarot-component"]);
  assert.deepEqual(merged.avoidances.materialIds, ["material:quartz"]);
  assert.deepEqual(merged.avoidances.colorFamilyIds, ["color:red"]);
  assert.equal(merged.hardConstraints.wristCircumferenceMm, 164);
});

test("context resolver does not depend on the Oracle engine domain package", async () => {
  const [manifest, source] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../src/oracle.ts", import.meta.url), "utf8")
  ]);
  assert.equal(manifest.includes("@mystcrag/oracle-engine"), false);
  assert.equal(source.includes("@mystcrag/oracle-engine"), false);
});
