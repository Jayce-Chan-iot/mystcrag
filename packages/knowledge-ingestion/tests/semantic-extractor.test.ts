import assert from "node:assert/strict";
import test from "node:test";

import { SemanticExtractor } from "../src/extract/semantic-extractor.js";
import type { ExtractorInput } from "../src/extract/extractor.js";

const DOCUMENT_TEXT =
  "Selenite dissolves in water, so keep it dry. 莫兰迪灰粉手串今年流行度上升。";

function inputFor(overrides?: Partial<ExtractorInput>): ExtractorInput {
  return {
    documentId: "doc-semantic",
    title: "Care notes",
    contentText: DOCUMENT_TEXT,
    fetchedAt: "2026-08-22T10:00:00.000Z",
    source: {
      sourceId: "source-semantic",
      sourceCategory: "DESIGN_REFERENCE",
      reliabilityLevel: "HIGH",
      allowedKnowledgeDomains: [
        "knowledge-domain:negative-rule",
        "knowledge-domain:market-observation"
      ]
    },
    ...overrides
  };
}

function chatResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function llmPayload(items: unknown[]): string {
  return JSON.stringify({ candidates: items });
}

test("semantic extractor without an endpoint is inactive and returns nothing", async () => {
  const extractor = new SemanticExtractor({ endpoint: undefined });
  assert.equal(extractor.active, false);
  const candidates = await extractor.extract(inputFor());
  assert.equal(candidates.length, 0);
});

test("valid LLM candidates become NEEDS_REVIEW rules with resolvable evidence", async () => {
  const fetchCalls: string[] = [];
  const extractor = new SemanticExtractor({
    endpoint: "https://llm.internal/v1/chat/completions",
    model: "test-model",
    apiKey: "secret",
    fetchImpl: async (url, init) => {
      fetchCalls.push(String(url));
      assert.equal(String(url), "https://llm.internal/v1/chat/completions");
      const body = JSON.parse(String(init?.body)) as { model: string };
      assert.equal(body.model, "test-model");
      return chatResponse(
        llmPayload([
          {
            knowledgeType: "NEGATIVE_RULE",
            relation: "avoid-exposure",
            subject: "material:selenite",
            confidence: 0.9,
            evidence: "Selenite dissolves in water, so keep it dry."
          },
          {
            knowledgeType: "MARKET_OBSERVATION",
            relation: "trending-in",
            subject: "color:pink",
            confidence: 0.7,
            evidence: "莫兰迪灰粉手串今年流行度上升。"
          }
        ])
      );
    }
  });
  assert.equal(extractor.active, true);
  const candidates = await extractor.extract(inputFor());
  assert.equal(fetchCalls.length, 1);
  assert.equal(candidates.length, 2);
  for (const candidate of candidates) {
    assert.equal(candidate.status, "NEEDS_REVIEW");
    assert.ok(candidate.confidence <= 0.85);
    const extraction = (candidate.payload as { extraction?: { method?: string; evidence?: Array<{ sentence: string; startOffset: number; endOffset: number }> } }).extraction;
    assert.equal(extraction?.method, "semantic");
    for (const evidence of extraction?.evidence ?? []) {
      assert.equal(DOCUMENT_TEXT.slice(evidence.startOffset, evidence.endOffset), evidence.sentence);
    }
  }
});

test("hallucinated evidence that does not appear in the document is dropped", async () => {
  const extractor = new SemanticExtractor({
    endpoint: "https://llm.internal/v1/chat/completions",
    fetchImpl: async () =>
      chatResponse(
        llmPayload([
          {
            knowledgeType: "NEGATIVE_RULE",
            relation: "avoid-exposure",
            subject: "material:selenite",
            confidence: 0.8,
            evidence: "This sentence was invented by the model."
          }
        ])
      )
  });
  const candidates = await extractor.extract(inputFor());
  assert.equal(candidates.length, 0);
});

test("relation × knowledgeType violations are filtered against the vocabulary", async () => {
  const extractor = new SemanticExtractor({
    endpoint: "https://llm.internal/v1/chat/completions",
    fetchImpl: async () =>
      chatResponse(
        llmPayload([
          {
            knowledgeType: "COLOR_THEORY",
            relation: "trending-in",
            subject: "color:purple",
            confidence: 0.8,
            evidence: "Selenite dissolves in water, so keep it dry."
          }
        ])
      )
  });
  const candidates = await extractor.extract(inputFor());
  assert.equal(candidates.length, 0);
});

test("malformed LLM output degrades to zero candidates instead of throwing", async () => {
  const extractor = new SemanticExtractor({
    endpoint: "https://llm.internal/v1/chat/completions",
    fetchImpl: async () => chatResponse("not json at all <div>")
  });
  const candidates = await extractor.extract(inputFor());
  assert.equal(candidates.length, 0);
});

test("forum sources clamp semantic candidates to market observation", async () => {
  const extractor = new SemanticExtractor({
    endpoint: "https://llm.internal/v1/chat/completions",
    fetchImpl: async () =>
      chatResponse(
        llmPayload([
          {
            knowledgeType: "NEGATIVE_RULE",
            relation: "avoid-exposure",
            subject: "material:selenite",
            confidence: 0.9,
            evidence: "Selenite dissolves in water, so keep it dry."
          },
          {
            knowledgeType: "MARKET_OBSERVATION",
            relation: "trending-in",
            subject: "color:pink",
            confidence: 0.7,
            evidence: "莫兰迪灰粉手串今年流行度上升。"
          }
        ])
      )
  });
  const candidates = await extractor.extract(
    inputFor({
      source: {
        sourceId: "source-forum",
        sourceCategory: "FORUM",
        reliabilityLevel: "LOW",
        allowedKnowledgeDomains: [
          "knowledge-domain:negative-rule",
          "knowledge-domain:market-observation"
        ]
      }
    })
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.knowledgeType, "MARKET_OBSERVATION");
});
