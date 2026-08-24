import assert from "node:assert/strict";
import test from "node:test";

import type { StoredKnowledgeRule } from "@mystcrag/database";
import { ruleFingerprint } from "../src/review/rules.js";
import { computeKnowledgeGraph } from "../src/console/graph.js";

function baseRule(overrides: Partial<StoredKnowledgeRule> = {}): StoredKnowledgeRule {
  const knowledgeType = overrides.knowledgeType ?? "COLOR_THEORY";
  const subject = overrides.subject ?? "color:blue";
  const relation = overrides.relation ?? "harmonizes-with";
  const payload = overrides.payload ?? { topic: "color:teal" };
  return {
    id: "rule-graph-01",
    knowledgeType,
    knowledgeDomain: "knowledge-domain:color-theory",
    subject,
    relation,
    payload,
    conditions: {},
    confidence: 0.9,
    status: "APPROVED",
    claimType: "DESIGN_PRINCIPLE",
    sourceRefs: [
      { sourceId: "source-a", documentId: "doc-1" },
      { sourceId: "source-b", documentId: "doc-2" }
    ],
    version: 1,
    fingerprint: ruleFingerprint(knowledgeType, subject, relation, payload),
    createdAt: "2026-08-21T00:00:00+08:00",
    updatedAt: "2026-08-21T00:00:00+08:00",
    sourceId: "source-a",
    knowledgeVersionId: null,
    ...overrides
  };
}

test("computeKnowledgeGraph projects approved relation rules into edges", () => {
  const graph = computeKnowledgeGraph([
    baseRule({ id: "rule-1", payload: { topic: "color:teal" } })
  ]);

  assert.equal(graph.edges.length, 1);
  const edge = graph.edges[0]!;
  assert.equal(edge.source, "color:blue");
  assert.equal(edge.target, "color:teal");
  assert.equal(edge.relation, "harmonizes-with");
  assert.equal(edge.claimType, "DESIGN_PRINCIPLE");
  assert.equal(edge.sourceCount, 2);
  assert.equal(edge.evidenceCount, 2);
  assert.equal(graph.stats.rulesConsidered, 1);
  assert.equal(graph.stats.truncated, false);
});

test("nodes resolve taxonomy labels and domains", () => {
  const graph = computeKnowledgeGraph([
    baseRule({ id: "rule-1", subject: "color:purple", payload: { topic: "color:white" } })
  ]);

  const purple = graph.nodes.find((node) => node.id === "color:purple");
  assert.ok(purple !== undefined);
  assert.equal(purple.label, "紫");
  assert.equal(purple.domain, "COLOR");
  assert.equal(purple.metadata.isTaxonomyTerm, true);
  assert.equal(purple.status, "APPROVED");
});

test("only the requested status is included and defaults to APPROVED", () => {
  const rules = [
    baseRule({ id: "rule-approved", payload: { topic: "color:teal" } }),
    baseRule({
      id: "rule-review",
      status: "NEEDS_REVIEW",
      payload: { topic: "color:teal" }
    }),
    baseRule({
      id: "rule-rejected",
      status: "REJECTED",
      payload: { topic: "color:teal" }
    })
  ];

  const approved = computeKnowledgeGraph(rules);
  assert.equal(approved.edges.length, 1);
  assert.equal(approved.edges[0]!.status, "APPROVED");

  const review = computeKnowledgeGraph(rules, { status: "NEEDS_REVIEW" });
  assert.equal(review.edges.length, 1);
  assert.equal(review.edges[0]!.status, "NEEDS_REVIEW");

  const rejected = computeKnowledgeGraph(rules, { status: "REJECTED" });
  assert.equal(rejected.edges.length, 0);
});

test("conflicted edges mark incident nodes as CONFLICTED", () => {
  const graph = computeKnowledgeGraph(
    [
      baseRule({
        id: "rule-conflict",
        status: "CONFLICTED",
        payload: { topic: "color:teal" }
      })
    ],
    { status: "CONFLICTED" }
  );

  const blue = graph.nodes.find((node) => node.id === "color:blue");
  assert.ok(blue !== undefined);
  assert.equal(blue.status, "CONFLICTED");
});

test("bench fixtures stay hidden unless includeSynthetic", () => {
  const rules = [
    baseRule({ id: "rule-bench", subject: "material:bench-1", payload: { topic: "003984" } }),
    baseRule({ id: "rule-real", subject: "color:blue", payload: { topic: "color:teal" } })
  ];

  const hidden = computeKnowledgeGraph(rules);
  assert.equal(hidden.edges.length, 1);
  assert.equal(hidden.edges[0]!.source, "color:blue");

  const shown = computeKnowledgeGraph(rules, { includeSynthetic: true });
  assert.equal(shown.edges.length, 2);
});

test("companionColors and companions payloads fan out into multiple edges", () => {
  const graph = computeKnowledgeGraph([
    baseRule({
      id: "rule-fan",
      subject: "color:teal",
      payload: { companionColors: ["color:blue", "color:green"] }
    }),
    baseRule({
      id: "rule-corp",
      subject: "color:brown",
      payload: { companions: ["color:orange"] }
    })
  ]);

  assert.equal(graph.edges.length, 3);
  assert.ok(graph.edges.some((edge) => edge.id === "rule-fan#0"));
  assert.ok(graph.edges.some((edge) => edge.id === "rule-fan#1"));
  assert.ok(graph.edges.some((edge) => edge.target === "color:orange"));
});

test("focus node limits the graph to its depth-hop neighborhood", () => {
  const rules = [
    baseRule({ id: "r1", subject: "color:blue", payload: { topic: "color:teal" } }),
    baseRule({ id: "r2", subject: "color:teal", payload: { topic: "color:green" } }),
    baseRule({ id: "r3", subject: "color:green", payload: { topic: "color:yellow" } })
  ];

  const oneHop = computeKnowledgeGraph(rules, { focusNode: "color:blue", depth: 1 });
  assert.deepEqual(
    oneHop.nodes.map((node) => node.id).sort(),
    ["color:blue", "color:teal"]
  );

  const twoHops = computeKnowledgeGraph(rules, { focusNode: "color:blue", depth: 2 });
  assert.deepEqual(
    twoHops.nodes.map((node) => node.id).sort(),
    ["color:blue", "color:green", "color:teal"]
  );
});

test("focus on an isolated node still returns that node", () => {
  const graph = computeKnowledgeGraph(
    [baseRule({ id: "r1", payload: { topic: "color:teal" } })],
    { focusNode: "color:black", depth: 1 }
  );

  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0]!.id, "color:black");
  assert.equal(graph.edges.length, 0);
});

test("domain filter keeps edges touching that domain", () => {
  const rules = [
    baseRule({ id: "r1", subject: "color:blue", payload: { topic: "color:teal" } })
  ];

  const color = computeKnowledgeGraph(rules, { domain: "COLOR" });
  assert.equal(color.edges.length, 1);

  const material = computeKnowledgeGraph(rules, { domain: "MATERIAL" });
  assert.equal(material.edges.length, 0);
  assert.equal(material.nodes.length, 0);
});

test("claimType filter narrows edges", () => {
  const rules = [
    baseRule({ id: "r1", claimType: "DESIGN_PRINCIPLE", payload: { topic: "color:teal" } }),
    baseRule({ id: "r2", claimType: "GEMOLOGICAL_FACT", payload: { topic: "color:teal" } })
  ];

  const filtered = computeKnowledgeGraph(rules, { claimType: "GEMOLOGICAL_FACT" });
  assert.equal(filtered.edges.length, 1);
  assert.equal(filtered.edges[0]!.claimType, "GEMOLOGICAL_FACT");
});

test("limit truncates by confidence and reports it", () => {
  const rules = [
    baseRule({ id: "r-low", confidence: 0.4, payload: { topic: "color:teal" } }),
    baseRule({ id: "r-high", confidence: 0.95, payload: { topic: "color:teal" } })
  ];

  const graph = computeKnowledgeGraph(rules, { limit: 1 });
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0]!.id, "r-high");
  assert.equal(graph.stats.truncated, true);
});

test("has-property rules count into node propertyCount but never become edges", () => {
  const graph = computeKnowledgeGraph([
    baseRule({ id: "r-prop", relation: "has-property", payload: { property: "mohsHardness", value: "7" } }),
    baseRule({ id: "r-edge", payload: { topic: "color:teal" } })
  ]);

  assert.equal(graph.edges.length, 1);
  const blue = graph.nodes.find((node) => node.id === "color:blue");
  assert.ok(blue !== undefined);
  assert.equal(blue.metadata.propertyCount, 1);
});
