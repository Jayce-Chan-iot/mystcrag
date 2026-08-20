import assert from "node:assert/strict";
import test from "node:test";

import {
  TAXONOMY_TERMS,
  TAXONOMY_VERSION,
  TaxonomyDomainSchema,
  TaxonomyRefSchema,
  TaxonomyTermSchema,
  getTaxonomyTerm,
  isTaxonomyId,
  listTaxonomyTerms,
  resolveTaxonomyId
} from "../src/index";

const domainPrefix = (domain: string): string => domain.toLowerCase().replace(/_/g, "-");

test("taxonomy version is stable-formatted and the vocabulary is non-trivial", () => {
  assert.match(TAXONOMY_VERSION, /^taxonomy-\d{4}-\d{2}-v\d+$/);
  assert.ok(TAXONOMY_TERMS.length >= 50, `expected >= 50 terms, got ${TAXONOMY_TERMS.length}`);
});

test("every taxonomy term parses its schema, has zh/en display names, and a domain-prefixed id", () => {
  for (const term of TAXONOMY_TERMS) {
    const parsed = TaxonomyTermSchema.safeParse(term);
    assert.equal(parsed.success, true, `invalid term: ${JSON.stringify(term)}`);
    assert.ok(term.displayName.zh.trim().length > 0, `missing zh name: ${term.id}`);
    assert.ok(term.displayName.en.trim().length > 0, `missing en name: ${term.id}`);
    assert.equal(
      term.id.split(":")[0],
      domainPrefix(term.domain),
      `id prefix mismatch for ${term.id} in ${term.domain}`
    );
  }
});

test("term ids are globally unique, parents resolve, and parent chains contain no cycles", () => {
  const ids = new Set(TAXONOMY_TERMS.map((term) => term.id));
  assert.equal(ids.size, TAXONOMY_TERMS.length);

  for (const term of TAXONOMY_TERMS) {
    if (term.parentId === null) continue;
    assert.ok(ids.has(term.parentId), `unknown parentId ${term.parentId} on ${term.id}`);

    const visited = new Set<string>([term.id]);
    let cursor: string | null = term.parentId;
    while (cursor !== null) {
      assert.ok(!visited.has(cursor), `parent cycle detected at ${cursor}`);
      visited.add(cursor);
      cursor = getTaxonomyTerm(cursor)?.parentId ?? null;
    }
  }
});

test("normalized ids and aliases are globally unique across the whole taxonomy", () => {
  const seen = new Map<string, string>();
  for (const term of TAXONOMY_TERMS) {
    for (const key of [term.id, ...term.aliases]) {
      const normalized = key.trim().toLowerCase();
      const owner = seen.get(normalized);
      assert.ok(
        owner === undefined,
        `duplicate taxonomy key "${normalized}" for ${term.id} and ${owner}`
      );
      seen.set(normalized, term.id);
    }
  }
});

test("resolveTaxonomyId maps canonical ids, aliases, and Chinese labels; rejects unknown input", () => {
  assert.equal(resolveTaxonomyId("color:purple"), "color:purple");
  assert.equal(resolveTaxonomyId("  Violet "), "color:purple");
  assert.equal(resolveTaxonomyId("紫色"), "color:purple");
  assert.equal(resolveTaxonomyId("淡紫"), "color:purple");
  assert.equal(resolveTaxonomyId("eastern", "STYLE"), "style:eastern-contemporary");
  assert.equal(resolveTaxonomyId("calm", "EMOTION"), "emotion:calm");
  assert.equal(resolveTaxonomyId("material:agate"), "material:agate");
  assert.equal(resolveTaxonomyId("not-a-real-tag"), null);
  assert.equal(resolveTaxonomyId("purple", "STYLE"), null);
  assert.equal(resolveTaxonomyId("   "), null);
});

test("the legacy catalog vocabulary resolves to canonical taxonomy ids", () => {
  const legacyCatalogColorTags = [
    "blue", "cool", "translucent", "white", "iridescent", "clear", "neutral",
    "purple", "deep", "pink", "warm", "soft", "yellow", "gold", "green",
    "natural", "brown", "red", "wine", "gray", "black", "orange", "fresh"
  ];
  const legacyStyleTags = [
    "minimal", "contemporary-eastern", "eastern-contemporary",
    "romantic", "natural", "modern", "vintage"
  ];
  const legacyEmotionTags = [
    "calm", "focus", "confidence", "joy", "connection", "renewal", "calm-aesthetic"
  ];

  for (const tag of [...legacyCatalogColorTags, ...legacyStyleTags, ...legacyEmotionTags]) {
    assert.ok(resolveTaxonomyId(tag) !== null, `unmapped legacy tag: ${tag}`);
  }

  assert.equal(resolveTaxonomyId("cool"), "temperature:cool");
  assert.equal(resolveTaxonomyId("natural"), "style:natural");
  assert.equal(resolveTaxonomyId("deep"), "lightness-level:low");
  assert.equal(resolveTaxonomyId("calm-aesthetic"), "emotion:calm");
  assert.equal(resolveTaxonomyId("contemporary-eastern"), "style:eastern-contemporary");
  assert.equal(resolveTaxonomyId("iridescent"), "texture:iridescent-sheen");
  assert.equal(resolveTaxonomyId("fresh"), "temperature:cool");
});

test("taxonomy ref schemas accept canonical in-domain ids and reject unknown or out-of-domain ids", () => {
  const emotionRef = TaxonomyRefSchema("EMOTION");
  assert.equal(emotionRef.safeParse("emotion:calm").success, true);
  assert.equal(emotionRef.safeParse("emotion:hope").success, true);
  assert.equal(emotionRef.safeParse("color:purple").success, false);
  assert.equal(emotionRef.safeParse("emotion:unknown").success, false);
  assert.equal(emotionRef.safeParse("calm").success, false, "refs must be canonical ids, not aliases");
});

test("domain schema, lookups, and per-domain listing behave correctly", () => {
  assert.equal(TaxonomyDomainSchema.safeParse("COLOR").success, true);
  assert.equal(TaxonomyDomainSchema.safeParse("NOT_A_DOMAIN").success, false);

  assert.ok(isTaxonomyId("color:purple"));
  assert.ok(!isTaxonomyId("color:unknown"));
  assert.equal(getTaxonomyTerm("color:purple")?.displayName.zh, "紫");

  const colors = listTaxonomyTerms("COLOR");
  assert.ok(colors.length >= 10);
  assert.ok(colors.every((term) => term.domain === "COLOR"));
  assert.ok(listTaxonomyTerms().length === TAXONOMY_TERMS.length);
});
