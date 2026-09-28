import assert from "node:assert/strict";
import test from "node:test";

import type { OracleCastDto, OracleDesignSignal } from "@mystcrag/design-contract";

import {
  ORACLE_COPY_POLICY_VERSION,
  OracleCopyInputSchema,
  OracleCopyResultSchema,
  OracleCopyService,
  hasProhibitedOracleClaim,
  type OracleCopyInput,
  type OracleCopyProvider
} from "../src/oracle/index.js";

const cast: OracleCastDto = {
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

const signal: OracleDesignSignal = {
  ruleVersion: "oracle-design-rules-v1",
  primaryColorTags: ["color:white", "color:blue"],
  supportColorTags: ["color:black"],
  styleTags: ["style:delicate", "style:minimal"],
  rhythmTags: ["rhythm:alternating"],
  accentLinePositions: [1, 4]
};

const input: OracleCopyInput = { cast, signal, locale: "zh-CN" };

class FixtureProvider implements OracleCopyProvider {
  readonly providerId = "fixture-oracle-provider";
  readonly providerVersion = "2026-09-29";
  readonly calls: OracleCopyInput[] = [];

  constructor(private readonly output: unknown, private readonly failure?: Error) {}

  async generate(request: OracleCopyInput): Promise<unknown> {
    this.calls.push(structuredClone(request));
    if (this.failure) throw this.failure;
    return structuredClone(this.output);
  }
}

test("copy input is strict, question-free, and independent from the engine domain package", async () => {
  assert.equal(OracleCopyInputSchema.safeParse(input).success, true);
  assert.equal(
    OracleCopyInputSchema.safeParse({ ...input, question: "这段内容不得进入文案服务" }).success,
    false
  );
  assert.equal(
    OracleCopyInputSchema.safeParse({
      ...input,
      signal: { ...signal, accentLinePositions: [2] }
    }).success,
    false
  );

  const manifest = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../package.json", import.meta.url), "utf8")
  );
  assert.equal(manifest.includes("@mystcrag/oracle-engine"), false);
});

test("deterministic localized copy is short, original, and structurally complete", async () => {
  const service = new OracleCopyService();
  const zh = await service.createInterpretation(input);
  const en = await service.createInterpretation({ ...input, locale: "en-US" });

  for (const result of [zh, en]) {
    assert.equal(OracleCopyResultSchema.safeParse(result).success, true);
    assert.equal(result.interpretation.keywords.length, 3);
    assert.ok(result.interpretation.headline.length <= 48);
    assert.ok(result.interpretation.summary.length <= 240);
    assert.equal(result.source.mode, "DETERMINISTIC_FALLBACK");
    assert.equal(result.source.policyVersion, ORACLE_COPY_POLICY_VERSION);
    assert.equal(result.source.algorithmVersion, "three-coin-v1");
    assert.equal(result.source.ruleVersion, "oracle-design-rules-v1");
  }
  assert.match(zh.interpretation.headline, /困/u);
  assert.match(zh.interpretation.summary, /变卦|转折/u);
  assert.match(zh.interpretation.disclaimer, /设计灵感/u);
  assert.match(en.interpretation.disclaimer, /design inspiration/i);
  assert.equal(JSON.stringify(zh).includes("question"), false);
});

test("a static cast does not invent a transformed direction", async () => {
  const staticInput: OracleCopyInput = {
    ...input,
    cast: {
      ...cast,
      lines: [7, 7, 7, 7, 7, 7],
      movingLineIndices: [],
      primaryHexagram: {
        number: 1,
        nameZh: "乾",
        lowerTrigram: "HEAVEN",
        upperTrigram: "HEAVEN"
      },
      transformedHexagram: undefined
    },
    signal: {
      ...signal,
      primaryColorTags: ["color:white", "color:gray"],
      supportColorTags: [],
      styleTags: ["style:minimal", "style:modern"],
      rhythmTags: ["rhythm:steady"],
      accentLinePositions: []
    }
  };

  const result = await new OracleCopyService().createInterpretation(staticInput);
  assert.equal(JSON.stringify(result.interpretation).includes("变卦"), false);
  assert.equal(JSON.stringify(result.interpretation).includes("transformed"), false);
});

test("prohibited efficacy, medical, deterministic, relationship, authority, and copied-copy claims are detected", () => {
  const prohibited = [
    "佩戴即可转运", "招财", "发财", "保平安", "辟邪", "开光", "加持", "治愈焦虑", "疗愈抑郁",
    "旺", "旺夫", "催旺桃花", "让前任挽回", "这是命定的结果", "注定成功", "一定发生", "必定发财", "大师断言",
    "可以治疗失眠", "改善心理疾病", "未来肯定升职", "某人一定会回来", "现代释文原文照录", "转载自当代解读",
    "This crystal heals anxiety", "You will definitely get rich", "Your partner is destined to return",
    "Copied from a modern commentary"
  ];

  for (const value of prohibited) {
    assert.equal(hasProhibitedOracleClaim(value), true, value);
  }
  assert.equal(hasProhibitedOracleClaim("以旺角夜色作为配色观察，不表达任何功效"), false);
  assert.equal(hasProhibitedOracleClaim("留意光泽与留白的关系"), false);
});

test("unsafe or non-template provider prose always falls back without leaking rejected text", async () => {
  const fallback = await new OracleCopyService().createInterpretation(input);
  const attacks = [
    "佩戴即可转运、招财并治愈焦虑。",
    "你注定发财，前任一定会回来。",
    "现代释文原文照录：大师断言此卦必旺。",
    "This crystal heals anxiety and guarantees wealth."
  ];

  for (const summary of attacks) {
    const output = { ...fallback.interpretation, summary };
    const result = await new OracleCopyService({
      provider: new FixtureProvider(output)
    }).createInterpretation(input);
    assert.equal(result.source.mode, "DETERMINISTIC_FALLBACK");
    assert.equal(JSON.stringify(result).includes(summary), false);
  }

  const merelyDifferent = await new OracleCopyService({
    provider: new FixtureProvider({
      ...fallback.interpretation,
      summary: "结构安全但未经服务端审核的自由文案。"
    })
  }).createInterpretation(input);
  assert.equal(merelyDifferent.source.mode, "DETERMINISTIC_FALLBACK");
});

test("only an exact approved template echo can be attributed to a provider", async () => {
  const approved = await new OracleCopyService().createInterpretation(input);
  const provider = new FixtureProvider(approved.interpretation);
  const result = await new OracleCopyService({ provider }).createInterpretation(input);

  assert.equal(result.source.mode, "PROVIDER");
  assert.equal(result.source.providerId, provider.providerId);
  assert.equal(result.interpretation.summary, approved.interpretation.summary);
  assert.equal(Object.hasOwn(provider.calls[0] ?? {}, "question"), false);
});

test("provider failure, malformed output, and hostile metadata fail closed", async () => {
  const approved = await new OracleCopyService().createInterpretation(input);
  const cases: OracleCopyProvider[] = [
    new FixtureProvider(undefined, new Error("secret provider error")),
    new FixtureProvider({ ...approved.interpretation, hiddenReasoning: "private" }),
    { providerId: "bad id with spaces", providerVersion: "1", async generate() { return approved.interpretation; } },
    { providerId: "fixture", providerVersion: "", async generate() { return approved.interpretation; } }
  ];

  for (const provider of cases) {
    const result = await new OracleCopyService({ provider }).createInterpretation(input);
    assert.equal(result.source.mode, "DETERMINISTIC_FALLBACK");
    assert.equal(JSON.stringify(result).includes("secret provider error"), false);
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
});
