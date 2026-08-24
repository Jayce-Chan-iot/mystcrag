import assert from "node:assert/strict";
import test from "node:test";

import { HashEmbeddingProvider } from "../src/index";

const provider = new HashEmbeddingProvider();

function cosine(left: number[], right: number[]): number {
  return left.reduce((total, value, index) => total + value * (right[index] ?? 0), 0);
}

test("hash embeddings are deterministic across calls", async () => {
  const [first] = await provider.embed(["Labradorite iridescent flash"]);
  const [second] = await provider.embed(["Labradorite iridescent flash"]);
  assert.deepEqual(first, second);
});

test("embeddings have the declared dimension and unit L2 norm", async () => {
  const vectors = await provider.embed(["amethyst calm", "紫水晶 平静", ""]);
  for (const vector of vectors) {
    assert.ok(vector !== undefined);
    assert.equal(vector.length, provider.dimensions);
    const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
    if (vector.some((value) => value !== 0)) {
      assert.ok(Math.abs(norm - 1) < 1e-9);
    } else {
      assert.equal(norm, 0);
    }
  }
});

test("similar vocabulary produces a higher cosine similarity than unrelated text", async () => {
  const [query] = await provider.embed(["moonstone calm white glow"]);
  const [related] = await provider.embed(["moonstone glow white calm"]);
  const [unrelated] = await provider.embed(["tiger eye brown gold chatoyant"]);
  assert.ok(query && related && unrelated);
  assert.ok(cosine(query, related) > cosine(query, unrelated));
});

test("Chinese text embeds via CJK bigrams so zh queries are searchable", async () => {
  const [query] = await provider.embed(["月光石"]);
  const [zhDoc] = await provider.embed(["月光石 温润"]);
  const [enDoc] = await provider.embed(["tiger eye brown"]);
  assert.ok(query && zhDoc && enDoc);
  assert.ok(cosine(query, zhDoc) > 0, "zh query should overlap the zh document");
  assert.equal(cosine(query, enDoc), 0, "zh query should not overlap an unrelated en document");
});
