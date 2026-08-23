import assert from "node:assert/strict";
import test from "node:test";

import type { ExtractorInput, ExtractorSourceContext } from "../src/extract/extractor.js";
import { GemProfileExtractor } from "../src/extract/gem-profile-extractor.js";

const gemSource: ExtractorSourceContext = {
  sourceId: "source-gemdat-gemstone-pages",
  sourceCategory: "GEMOLOGY",
  reliabilityLevel: "MEDIUM",
  allowedKnowledgeDomains: [
    "knowledge-domain:crystal-gemology",
    "knowledge-domain:crystal-visual-properties"
  ]
};

// Text shape produced by the static-html fetcher on a GemDat gem profile
// (block-level cells space-separated, citations inline after each value).
const AMETHYST_CONTENT = [
  "General Information",
  "A variety or type of: Quartz Chemical Formula SiO 2 Walter Schumann, Gemstones of the world (2001)",
  "Amethyst Treatments Heat treatment between 878 - 1382 degrees F produces light yellow varieties.",
  "Physical Properties of Amethyst Mohs Hardness 7 Herve Nicolas Lazzarelli, Blue Chart Gem Identification (2010)",
  "Specific Gravity 2.65 Ulrich Henn and Claudio C. Milisenda, Gemmological Tables (2004)",
  "Tenacity Brittle Walter Schumann, Gemstones of the world (2001)",
  "Fracture Conchoidal Walter Schumann, Gemstones of the world (2001)",
  "Optical Properties of Amethyst Refractive Index 1.544 to 1.553 Herve Nicolas Lazzarelli, Blue Chart Gem Identification (2010)",
  "Colour (General) Purple, violet, pale red-violet Walter Schumann, Gemstones of the world (2001)",
  "Transparency Transparent,Translucent Ulrich Henn and Claudio C. Milisenda, Gemmological Tables (2004)",
  "Crystallography of Amethyst Crystal System Trigonal Ulrich Henn and Claudio C. Milisenda, Gemmological Tables (2004)"
].join(" ");

function inputFor(
  title: string,
  contentText: string,
  source: ExtractorSourceContext = gemSource
): ExtractorInput {
  return {
    documentId: "doc-gem-198",
    title,
    contentText,
    fetchedAt: "2026-08-22T10:00:00.000Z",
    source
  };
}

function payloadOf(candidate: { payload: unknown }): { property?: string; value?: string } {
  return candidate.payload as { property?: string; value?: string };
}

test("gem profile tables become has-property candidates with verbatim evidence", async () => {
  const extractor = new GemProfileExtractor();
  const candidates = await extractor.extract(
    inputFor("Amethyst gemstone information", AMETHYST_CONTENT)
  );

  const byProperty = new Map(candidates.map((candidate) => [payloadOf(candidate).property, candidate]));
  assert.equal(byProperty.size, candidates.length, "properties must be unique");

  const expected: Record<string, { value: string; type: string }> = {
    mineralFamily: { value: "Quartz", type: "CRYSTAL_GEMOLOGY" },
    chemicalFormula: { value: "SiO 2", type: "CRYSTAL_GEMOLOGY" },
    mohsHardness: { value: "7", type: "CRYSTAL_GEMOLOGY" },
    specificGravity: { value: "2.65", type: "CRYSTAL_GEMOLOGY" },
    refractiveIndex: { value: "1.544 to 1.553", type: "CRYSTAL_GEMOLOGY" },
    tenacity: { value: "Brittle", type: "CRYSTAL_GEMOLOGY" },
    fracture: { value: "Conchoidal", type: "CRYSTAL_GEMOLOGY" },
    crystalSystem: { value: "Trigonal", type: "CRYSTAL_GEMOLOGY" },
    colour: { value: "Purple, violet, pale red-violet", type: "CRYSTAL_VISUAL_PROPERTIES" },
    transparency: { value: "Transparent,Translucent", type: "CRYSTAL_VISUAL_PROPERTIES" }
  };
  for (const [property, { value, type }] of Object.entries(expected)) {
    const candidate = byProperty.get(property);
    assert.ok(candidate !== undefined, `${property} should be extracted`);
    assert.equal(candidate.subject, "material:amethyst");
    assert.equal(candidate.relation, "has-property");
    assert.equal(candidate.knowledgeType, type);
    assert.equal(payloadOf(candidate).value, value);
    assert.equal(candidate.claimType, "GEMOLOGICAL_FACT");
    assert.equal(candidate.status, "NEEDS_REVIEW");
    assert.equal(candidate.sourceId, "source-gemdat-gemstone-pages");
    assert.deepEqual(candidate.sourceRefs, [
      { sourceId: "source-gemdat-gemstone-pages", documentId: "doc-gem-198" }
    ]);
  }
});

test("every candidate's evidence slice reproduces the exact document span", async () => {
  const extractor = new GemProfileExtractor();
  const candidates = await extractor.extract(
    inputFor("Amethyst gemstone information", AMETHYST_CONTENT)
  );
  assert.ok(candidates.length >= 10);
  for (const candidate of candidates) {
    const extraction = (
      candidate.payload as {
        extraction?: {
          extractor?: string;
          method?: string;
          evidence?: Array<{ sentence: string; startOffset: number; endOffset: number }>;
        };
      }
    ).extraction;
    assert.ok(extraction !== undefined, `${candidate.id} must carry extraction evidence`);
    assert.equal(extraction.extractor, "gem-profile-extractor-v1");
    assert.equal(extraction.method, "pattern");
    for (const proof of extraction.evidence ?? []) {
      assert.equal(AMETHYST_CONTENT.slice(proof.startOffset, proof.endOffset), proof.sentence);
      assert.ok(proof.sentence.length > 0);
      assert.ok(proof.sentence.length <= 500);
    }
  }
});

test("the gem subject resolves from the document title, hyphens and apostrophes included", async () => {
  const extractor = new GemProfileExtractor();
  const tigerEye = await extractor.extract(
    inputFor("Tiger's eye gemstone information", AMETHYST_CONTENT)
  );
  assert.ok(tigerEye.length > 0);
  for (const candidate of tigerEye) {
    assert.equal(candidate.subject, "material:tiger-eye");
  }
});

test("non-gem documents and unresolved titles yield no candidates", async () => {
  const extractor = new GemProfileExtractor();
  const editorial = await extractor.extract(
    inputFor("Color theory chapter 3", "Adjacent hues share undertones and calm moods.")
  );
  assert.equal(editorial.length, 0);

  const unknownGem = await extractor.extract(
    inputFor("Mystical blue stone information", AMETHYST_CONTENT)
  );
  assert.equal(unknownGem.length, 0);
});

test("candidates respect the source's allowed knowledge domains", async () => {
  const extractor = new GemProfileExtractor();
  const restricted = await extractor.extract(
    inputFor("Amethyst gemstone information", AMETHYST_CONTENT, {
      ...gemSource,
      allowedKnowledgeDomains: ["knowledge-domain:material-compatibility"]
    })
  );
  assert.equal(restricted.length, 0);
});

test("fingerprint identity includes the value so divergent facts stay separately reviewable", async () => {
  const extractor = new GemProfileExtractor();
  const agreed = await extractor.extract(
    inputFor("Amethyst gemstone information", AMETHYST_CONTENT)
  );
  const divergent = await extractor.extract(
    inputFor(
      "Amethyst gemstone information",
      AMETHYST_CONTENT.replace("Mohs Hardness 7", "Mohs Hardness 6")
    )
  );
  const agreedHardness = agreed.find(
    (candidate) => payloadOf(candidate).property === "mohsHardness"
  );
  const divergentHardness = divergent.find(
    (candidate) => payloadOf(candidate).property === "mohsHardness"
  );
  assert.ok(agreedHardness !== undefined && divergentHardness !== undefined);
  // Same value from a second source deduplicates onto one rule (corroboration);
  // a diverging value keeps its own candidate so review sees the disagreement.
  assert.notEqual(agreedHardness.fingerprint, divergentHardness.fingerprint);
  assert.equal(payloadOf(agreedHardness).value, "7");
  assert.equal(payloadOf(divergentHardness).value, "6");
});

// GIA gem pages lay the FACTS strip out as "Label: Value" runs.
const GIA_SOURCE: ExtractorSourceContext = {
  sourceId: "source-gia-gem-encyclopedia",
  sourceCategory: "OFFICIAL",
  reliabilityLevel: "HIGH",
  allowedKnowledgeDomains: [
    "knowledge-domain:crystal-gemology",
    "knowledge-domain:crystal-visual-properties"
  ]
};

const GIA_MOONSTONE_CONTENT = [
  "Moonstone GIA Gem Encyclopedia",
  "FACTS Mohs Hardness: 6.0 to 6.5 Chemistry: KAlSi3O8 Color: Colorless to White, Gray, Green, Peach, Brown Refractive index: 1.518 to 1.526 Birefringence: 0.05 to 0.008 Specific gravity: 2.58",
  "Moonstone is a birthstone for June, along with pearl and alexandrite."
].join(" ");

test("GIA fact strips with colon separators become has-property candidates", async () => {
  const extractor = new GemProfileExtractor();
  const candidates = await extractor.extract(
    inputFor("Moonstone Gem Encyclopedia", GIA_MOONSTONE_CONTENT, GIA_SOURCE)
  );
  const byProperty = new Map(candidates.map((candidate) => [payloadOf(candidate).property, candidate]));

  const expected: Record<string, string> = {
    mohsHardness: "6.0 to 6.5",
    chemicalFormula: "KAlSi3O8",
    refractiveIndex: "1.518 to 1.526",
    specificGravity: "2.58"
  };
  for (const [property, value] of Object.entries(expected)) {
    const candidate = byProperty.get(property);
    assert.ok(candidate !== undefined, `${property} should be extracted from GIA text`);
    assert.equal(payloadOf(candidate).value, value);
    assert.equal(candidate.subject, "material:moonstone");
    assert.equal(candidate.claimType, "GEMOLOGICAL_FACT");
  }
  const colour = byProperty.get("colour");
  assert.ok(colour !== undefined, "GIA Color row maps to the colour property");
  assert.ok(
    (payloadOf(colour).value ?? "").startsWith("Colorless to White, Gray, Green, Peach, Brown"),
    `colour value runs to the next label, got "${payloadOf(colour).value}"`
  );
});

// Wikipedia infobox rows: "Mohs scale hardness 7", "Crystal system Trigonal".
const WIKIPEDIA_SOURCE: ExtractorSourceContext = {
  sourceId: "source-wikipedia-reference",
  sourceCategory: "ACADEMIC",
  reliabilityLevel: "HIGH",
  allowedKnowledgeDomains: [
    "knowledge-domain:crystal-gemology",
    "knowledge-domain:crystal-visual-properties"
  ]
};

const WIKIPEDIA_AMETHYST_CONTENT = [
  "Amethyst",
  "Category Amethyst: quartz variety Formula (repeating unit) SiO 2 Crystal system Trigonal",
  "Color Purple, violet",
  "Mohs scale hardness 7",
  "Luster Vitreous",
  "Specific gravity 2.65",
  "Amethyst is the purple variety of quartz."
].join(" ");

test("Wikipedia infobox rows with lowercase labels become has-property candidates", async () => {
  const extractor = new GemProfileExtractor();
  const candidates = await extractor.extract(
    inputFor("Amethyst", WIKIPEDIA_AMETHYST_CONTENT, WIKIPEDIA_SOURCE)
  );
  const byProperty = new Map(candidates.map((candidate) => [payloadOf(candidate).property, candidate]));

  const expected: Record<string, string> = {
    chemicalFormula: "SiO 2",
    crystalSystem: "Trigonal",
    mohsHardness: "7",
    specificGravity: "2.65",
    luster: "Vitreous"
  };
  for (const [property, value] of Object.entries(expected)) {
    const candidate = byProperty.get(property);
    assert.ok(candidate !== undefined, `${property} should be extracted from Wikipedia infobox text`);
    assert.equal(payloadOf(candidate).value, value);
    assert.equal(candidate.subject, "material:amethyst");
  }
  const colour = byProperty.get("colour");
  assert.ok(colour !== undefined, "Wikipedia Color row maps to the colour property");
  assert.equal(payloadOf(colour).value, "Purple, violet");
});
