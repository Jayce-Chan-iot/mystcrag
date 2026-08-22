import assert from "node:assert/strict";
import test from "node:test";

import { KnowledgeSourceSchema, type SourceCategory } from "@mystcrag/design-contract";

import { SOURCE_REGISTRY_CANDIDATES } from "../src/fixtures/source-registry-candidates.js";

const REQUIRED_CATEGORIES: readonly SourceCategory[] = [
  "OFFICIAL",
  "ACADEMIC",
  "BOOK",
  "GEMOLOGY",
  "DESIGN_REFERENCE",
  "JEWELRY_REFERENCE",
  "INDUSTRY",
  "FORUM",
  "SOCIAL_OBSERVATION",
  "MANUAL"
];

test("source registry bootstrap carries at least 30 unique, schema-valid candidates", () => {
  assert.ok(
    SOURCE_REGISTRY_CANDIDATES.length >= 30,
    `expected >=30 candidates, got ${SOURCE_REGISTRY_CANDIDATES.length}`
  );
  const ids = new Set(SOURCE_REGISTRY_CANDIDATES.map((source) => source.id));
  assert.equal(ids.size, SOURCE_REGISTRY_CANDIDATES.length, "candidate ids must be unique");
  for (const source of SOURCE_REGISTRY_CANDIDATES) {
    KnowledgeSourceSchema.parse(source);
  }
});

test("forum and social sources only feed market observation (Q0 policy)", () => {
  for (const source of SOURCE_REGISTRY_CANDIDATES) {
    if (source.sourceCategory === "FORUM" || source.sourceCategory === "SOCIAL_OBSERVATION") {
      assert.deepEqual(
        source.allowedKnowledgeDomains,
        ["knowledge-domain:market-observation"],
        `${source.id} must be pinned to market observation`
      );
      assert.ok(source.authorityScore <= 0.55, `${source.id} must stay low-authority`);
    }
  }
});

test("candidate registry covers the editorial spread required for review", () => {
  const categories = new Set(SOURCE_REGISTRY_CANDIDATES.map((source) => source.sourceCategory));
  for (const required of REQUIRED_CATEGORIES) {
    assert.ok(categories.has(required), `missing source category ${required}`);
  }
  const domains = new Set(
    SOURCE_REGISTRY_CANDIDATES.flatMap((source) => source.allowedKnowledgeDomains)
  );
  assert.ok(domains.size >= 8, `expected >=8 knowledge domains covered, got ${domains.size}`);

  const crawlable = SOURCE_REGISTRY_CANDIDATES.filter((source) => source.sourceType !== "MANUAL");
  for (const source of crawlable) {
    assert.ok(source.baseUrl, `${source.id} needs a base URL to be crawlable`);
    assert.ok(source.rateLimit, `${source.id} must declare a rate limit`);
    assert.ok(
      source.crawlStrategy === undefined || source.crawlStrategy.followLinks === false,
      `${source.id} should not follow links in bootstrap form`
    );
  }
});

test("acquisition round-1 source registry updates", () => {
  const ids = new Set(SOURCE_REGISTRY_CANDIDATES.map((s) => s.id));
  assert.equal(ids.has("source-tarot-heritage-archive"), false, "rejected source must be removed");
  assert.equal(ids.size, 41, `expected 41 sources, got ${ids.size}`);
  const byId = new Map(SOURCE_REGISTRY_CANDIDATES.map((s) => [s.id, s]));

  assert.equal(
    byId.get("source-pictorial-key-tarot")?.baseUrl,
    "https://www.sacred-texts.com/tarot/pkt/index.htm"
  );
  assert.equal(
    byId.get("source-ganoksin-bench-articles")?.baseUrl,
    "https://www.ganoksin.com/learning-center/"
  );
  assert.equal(
    byId.get("source-rijksmuseum-jewelry")?.baseUrl,
    "https://www.rijksmuseum.nl/en/research/our-research/fine-and-decorative-arts/decorative-arts/renaissance-jewellery"
  );
  assert.equal(byId.get("source-bnf-tarot-marseille")?.baseUrl, "https://gallica.bnf.fr");

  for (const id of [
    "source-ctext-wuxing-classics",
    "source-wikipedia-reference",
    "source-wikisource-pictorial-key",
    "source-american-gem-society",
    "source-astrologyic-zodiac-stones",
    "source-fengsuihk-wuxing-crystals"
  ]) {
    assert.equal(ids.has(id), true, `${id} should be registered`);
  }
  assert.ok(
    byId.get("source-ctext-wuxing-classics")?.allowedKnowledgeDomains.includes("knowledge-domain:wuxing")
  );
  assert.ok(
    byId.get("source-astrologyic-zodiac-stones")?.allowedKnowledgeDomains.includes("knowledge-domain:zodiac-crystal-association")
  );
  assert.ok(
    byId.get("source-fengsuihk-wuxing-crystals")?.allowedKnowledgeDomains.includes("knowledge-domain:wuxing-crystal-association")
  );

  for (const source of SOURCE_REGISTRY_CANDIDATES) {
    assert.ok(
      source.reviewStatus === undefined || source.reviewStatus === "NEEDS_REVIEW",
      `${source.id} must stay NEEDS_REVIEW in seed form`
    );
    assert.ok(
      source.enabled === undefined || source.enabled === false,
      `${source.id} must stay disabled in seed form`
    );
  }
});

test("phase-1 authority calibration is written back to the seed", () => {
  const byId = new Map(SOURCE_REGISTRY_CANDIDATES.map((s) => [s.id, s]));
  const expected = new Map([
    ["source-cie-color-standards", 0.75],
    ["source-mjsa-articles", 0.55],
    ["source-art-jewelry-forum", 0.5],
    ["source-pictorial-key-tarot", 0.8],
    ["source-rijksmuseum-jewelry", 0.75],
    ["source-ganoksin-bench-articles", 0.55],
    ["source-munsell-color-education", 0.65],
    ["source-pantone-trend-reports", 0.65],
    ["source-color-matters-education", 0.55],
    ["source-met-tarot-cards", 0.75],
    ["source-tarot-iconography-abstracts", 0.55],
    ["source-etsy-crystal-bracelet-search", 0.3],
    ["source-taobao-crystal-category", 0.25],
    ["source-xiaohongshu-crystal-notes", 0.2],
    ["source-google-trends-crystal", 0.3],
    ["source-weibo-crystal-hashtag", 0.15],
    ["source-bijuturu-design-proportions", 0.65],
    ["source-itten-art-of-color", 0.7]
  ]);
  for (const [id, authority] of expected) {
    assert.equal(byId.get(id)?.authorityScore, authority, `${id} authority mismatch`);
  }
});

test("britannica covers wuxing and zodiac entries on the same site", () => {
  const britannica = SOURCE_REGISTRY_CANDIDATES.find((s) => s.id === "source-britannica-symbolism");
  assert.ok(britannica);
  assert.ok(britannica.allowedKnowledgeDomains.includes("knowledge-domain:wuxing"));
  assert.ok(britannica.allowedKnowledgeDomains.includes("knowledge-domain:zodiac"));
});
