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
