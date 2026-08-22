import assert from "node:assert/strict";
import test from "node:test";

import { PatternExtractor } from "../src/extract/pattern-extractor.js";
import type { ExtractorInput } from "../src/extract/extractor.js";

function inputFor(
  contentText: string,
  overrides?: Partial<ExtractorInput> & {
    sourceCategory?: ExtractorInput["source"]["sourceCategory"];
    reliabilityLevel?: ExtractorInput["source"]["reliabilityLevel"];
    allowedKnowledgeDomains?: readonly string[];
  }
): ExtractorInput {
  return {
    documentId: "doc-test",
    title: "Test document",
    contentText,
    fetchedAt: "2026-08-22T10:00:00.000Z",
    source: {
      sourceId: "source-test",
      sourceCategory: overrides?.sourceCategory ?? "DESIGN_REFERENCE",
      reliabilityLevel: overrides?.reliabilityLevel ?? "HIGH",
      allowedKnowledgeDomains:
        overrides?.allowedKnowledgeDomains ?? [
          "knowledge-domain:color-theory",
          "knowledge-domain:material-compatibility",
          "knowledge-domain:style-rule",
          "knowledge-domain:proportion-rule",
          "knowledge-domain:composition-rule",
          "knowledge-domain:transition-rule",
          "knowledge-domain:focal-rule",
          "knowledge-domain:negative-rule",
          "knowledge-domain:cultural-symbolism",
          "knowledge-domain:tarot",
          "knowledge-domain:market-observation"
        ]
    },
    ...overrides
  };
}

const RELATION_SENTENCES: ReadonlyArray<{
  relation: string;
  knowledgeType: string;
  sentence: string;
}> = [
  { relation: "pairs-well-with", knowledgeType: "COLOR_THEORY", sentence: "Amethyst purple pairs well with citrine yellow on the wheel." },
  { relation: "pairs-well-with", knowledgeType: "MATERIAL_COMPATIBILITY", sentence: "紫水晶搭配月光长石非常协调。" },
  { relation: "conflicts-with", knowledgeType: "NEGATIVE_RULE", sentence: "一条手串不宜同时出现多个抢眼的焦点。" },
  { relation: "avoid-exposure", knowledgeType: "NEGATIVE_RULE", sentence: "Selenite 避免接触水，遇水会溶解雾化。" },
  { relation: "avoid-exposure", knowledgeType: "NEGATIVE_RULE", sentence: "Amethyst should avoid sunlight to keep its purple saturation." },
  { relation: "care-instruction", knowledgeType: "MATERIAL_COMPATIBILITY", sentence: "月光长石日常保养用软布轻拭并单独存放。" },
  { relation: "symbolizes", knowledgeType: "CULTURAL_SYMBOLISM", sentence: "透明石英象征无条件的爱与温柔。" },
  { relation: "symbolizes", knowledgeType: "CULTURAL_SYMBOLISM", sentence: "Clear quartz symbolizes clarity and pure intention." },
  { relation: "suits-style", knowledgeType: "STYLE_RULE", sentence: "银隔珠极简风格适合日常叠戴。" },
  { relation: "proportion-of", knowledgeType: "PROPORTION_RULE", sentence: "主石与陪衬珠的比例接近黄金比例最耐看。" },
  { relation: "proportion-of", knowledgeType: "FOCAL_RULE", sentence: "焦点珠 sizing anchors the proportion of the whole strand." },
  { relation: "transitions-to", knowledgeType: "TRANSITION_RULE", sentence: "直径渐变过渡让整串视觉更顺滑。" },
  { relation: "transitions-to", knowledgeType: "TRANSITION_RULE", sentence: "Use a diameter gradient to transition between sections." },
  { relation: "trending-in", knowledgeType: "MARKET_OBSERVATION", sentence: "莫兰迪灰粉手串今年在年轻群体中流行度上升。" }
];

test("pattern extractor classifies all nine relations with the right knowledge type", async () => {
  const extractor = new PatternExtractor();
  for (const expected of RELATION_SENTENCES) {
    const candidates = await extractor.extract(inputFor(expected.sentence));
    assert.ok(
      candidates.some(
        (candidate) =>
          candidate.relation === expected.relation &&
          candidate.knowledgeType === expected.knowledgeType
      ),
      `sentence "${expected.sentence}" must yield ${expected.relation} × ${expected.knowledgeType}, got ${candidates
        .map((candidate) => `${candidate.relation}×${candidate.knowledgeType}`)
        .join(", ")}`
    );
  }
});

test("evidence offsets slice back to the exact sentence in the document", async () => {
  const contentText =
    "Opening line without signal. Amethyst purple pairs well with blue. Closing line.";
  const extractor = new PatternExtractor();
  const candidates = await extractor.extract(inputFor(contentText));
  assert.ok(candidates.length >= 1);
  for (const candidate of candidates) {
    const extraction = (candidate.payload as { extraction?: { evidence?: Array<{ sentence: string; startOffset: number; endOffset: number }> } }).extraction;
    assert.ok(extraction !== undefined, "payload.extraction metadata is mandatory");
    assert.ok((extraction.evidence?.length ?? 0) >= 1, "pattern candidates carry evidence");
    for (const evidence of extraction.evidence ?? []) {
      assert.equal(
        contentText.slice(evidence.startOffset, evidence.endOffset),
        evidence.sentence
      );
    }
    assert.ok(candidate.sourceRefs.some((ref) => ref.documentId === "doc-test"));
  }
});

test("pattern candidates are always NEEDS_REVIEW with confidence capped at 0.85", async () => {
  const extractor = new PatternExtractor();
  const candidates = await extractor.extract(
    inputFor(RELATION_SENTENCES.map((entry) => entry.sentence).join(" "))
  );
  assert.ok(candidates.length >= 5);
  for (const candidate of candidates) {
    assert.equal(candidate.status, "NEEDS_REVIEW");
    assert.ok(candidate.confidence > 0 && candidate.confidence <= 0.85);
  }
});

test("low reliability sources produce strictly lower confidence than high ones", async () => {
  const extractor = new PatternExtractor();
  const sentence = "Amethyst purple pairs well with blue.";
  const high = (await extractor.extract(inputFor(sentence)))[0];
  const low = (await extractor.extract(inputFor(sentence, { reliabilityLevel: "LOW" })))[0];
  assert.ok(high !== undefined && low !== undefined);
  assert.ok(low.confidence < high.confidence);
});

test("sentences without a relation signal produce no candidates (precision guard)", async () => {
  const extractor = new PatternExtractor();
  const candidates = await extractor.extract(
    inputFor("Purple amethyst and blue lapis sit on a shelf. The weather is nice today.")
  );
  assert.equal(candidates.length, 0);
});

test("forum and social sources may only yield market observation candidates", async () => {
  const extractor = new PatternExtractor();
  const contentText =
    "Amethyst purple pairs well with blue. 莫兰迪灰粉手串今年流行度上升。";
  const forumCandidates = await extractor.extract(
    inputFor(contentText, {
      sourceCategory: "FORUM",
      allowedKnowledgeDomains: [
        "knowledge-domain:color-theory",
        "knowledge-domain:market-observation"
      ]
    })
  );
  assert.ok(forumCandidates.length >= 1);
  for (const candidate of forumCandidates) {
    assert.equal(candidate.knowledgeDomain, "knowledge-domain:market-observation");
    assert.equal(candidate.knowledgeType, "MARKET_OBSERVATION");
  }
});

test("candidates outside the source's allowed knowledge domains are dropped", async () => {
  const extractor = new PatternExtractor();
  const candidates = await extractor.extract(
    inputFor("Amethyst purple pairs well with blue. 粉晶象征无条件的爱。", {
      allowedKnowledgeDomains: ["knowledge-domain:color-theory"]
    })
  );
  assert.ok(candidates.length >= 1);
  for (const candidate of candidates) {
    assert.equal(candidate.knowledgeDomain, "knowledge-domain:color-theory");
  }
});

test("duplicate sentences collapse into one candidate via fingerprint", async () => {
  const extractor = new PatternExtractor();
  const sentence = "Amethyst purple pairs well with blue.";
  const candidates = await extractor.extract(inputFor(`${sentence} ${sentence}`));
  assert.equal(candidates.length, 1);
});

test("every seed carries a claim type appropriate to its knowledge type (task book §12)", async () => {
  const expectedClaimType: Record<string, string> = {
    COLOR_THEORY: "DESIGN_PRINCIPLE",
    MATERIAL_COMPATIBILITY: "DESIGN_HEURISTIC",
    STYLE_RULE: "DESIGN_HEURISTIC",
    PROPORTION_RULE: "DESIGN_PRINCIPLE",
    COMPOSITION_RULE: "DESIGN_PRINCIPLE",
    FOCAL_RULE: "DESIGN_PRINCIPLE",
    TRANSITION_RULE: "DESIGN_PRINCIPLE",
    NEGATIVE_RULE: "DESIGN_HEURISTIC",
    CULTURAL_SYMBOLISM: "CULTURAL_SYMBOLISM",
    MARKET_OBSERVATION: "MARKET_OBSERVATION"
  };
  const extractor = new PatternExtractor();
  const candidates = await extractor.extract(
    inputFor(RELATION_SENTENCES.map((entry) => entry.sentence).join(" "))
  );
  assert.ok(candidates.length >= 5);
  for (const candidate of candidates) {
    const expected = expectedClaimType[candidate.knowledgeType];
    assert.ok(expected !== undefined, `${candidate.knowledgeType} must have a claim type mapping`);
    assert.equal(candidate.claimType, expected);
  }
});
