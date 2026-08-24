import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { StoredKnowledgeRule, StoredKnowledgeSource } from "@mystcrag/database";
import {
  KnowledgeSourceSchema,
  type KnowledgeRule,
  type KnowledgeType,
  type RecommendationContext
} from "@mystcrag/design-contract";

import {
  DEFAULT_MIN_SOURCE_AUTHORITY,
  compileDecisionRules
} from "../src/compiler/rule-compiler.js";

const TIMESTAMP = "2026-08-21T08:00:00+08:00";

const HANDBOOK_SOURCE: StoredKnowledgeSource = KnowledgeSourceSchema.parse({
  id: "source-handbook",
  name: "玄矶设计手册",
  sourceType: "MANUAL",
  authorityScore: 0.95,
  allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
  language: "zh-CN",
  enabled: true
});

const LOW_AUTHORITY_SOURCE: StoredKnowledgeSource = KnowledgeSourceSchema.parse({
  id: "source-forum",
  name: "论坛摘录",
  sourceType: "STATIC_HTML",
  authorityScore: 0.3,
  allowedKnowledgeDomains: ["knowledge-domain:color-theory"],
  language: "zh-CN",
  enabled: true
});

const SOURCES = new Map([
  [HANDBOOK_SOURCE.id, HANDBOOK_SOURCE],
  [LOW_AUTHORITY_SOURCE.id, LOW_AUTHORITY_SOURCE]
]);

type RuleInput = {
  id: string;
  knowledgeType: KnowledgeType;
  subject: string;
  relation: string;
  payload: KnowledgeRule["payload"];
  confidence?: number;
  status?: KnowledgeRule["status"];
  sourceId?: string;
};

function storedRule(input: RuleInput): StoredKnowledgeRule {
  return {
    id: input.id,
    knowledgeType: input.knowledgeType,
    knowledgeDomain: `knowledge-domain:${input.knowledgeType
      .toLowerCase()
      .replace(/_/g, "-")}`,
    subject: input.subject,
    relation: input.relation,
    payload: input.payload,
    conditions: {},
    confidence: input.confidence ?? 0.9,
    status: input.status ?? "APPROVED",
    sourceRefs: [{ sourceId: input.sourceId ?? HANDBOOK_SOURCE.id }],
    version: 1,
    fingerprint: createHash("sha256").update(input.id).digest("hex"),
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    sourceId: input.sourceId ?? HANDBOOK_SOURCE.id,
    knowledgeVersionId: null
  };
}

const FULL_CATALOG = {
  productCatalogVersion: "catalog-test-v1",
  availableTaxonomyRefs: [
    "color:blue",
    "color:teal",
    "color:white",
    "color:silver",
    "color:gold",
    "color:red",
    "color:pink",
    "color:purple",
    "color:black",
    "material:quartz",
    "material:moonstone",
    "material:pyrite",
    "material:hematite",
    "material:sterling-silver",
    "style:minimal",
    "emotion:calm",
    "tarot:major-17-the-star",
    "composition-role:main"
  ]
};

function compile(rules: readonly StoredKnowledgeRule[], options?: Parameters<typeof compileDecisionRules>[0]["options"]) {
  return compileDecisionRules({
    knowledgeVersion: "knowledge-test-v1",
    rules,
    sources: SOURCES,
    catalog: FULL_CATALOG,
    options
  });
}

test("maps knowledge types onto the task-book priority ladder", () => {
  const compiled = compile([
    storedRule({
      id: "r-material",
      knowledgeType: "MATERIAL_COMPATIBILITY",
      subject: "material:quartz",
      relation: "compatible-with",
      payload: { companions: ["material:moonstone"] }
    }),
    storedRule({
      id: "r-color",
      knowledgeType: "COLOR_THEORY",
      subject: "color:blue",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:teal"] }
    }),
    storedRule({
      id: "r-style",
      knowledgeType: "STYLE_RULE",
      subject: "style:minimal",
      relation: "prefers-colors",
      payload: { companionColors: ["color:white"] }
    }),
    storedRule({
      id: "r-tarot",
      knowledgeType: "TAROT",
      subject: "tarot:major-17-the-star",
      relation: "prefers-colors",
      payload: { companionColors: ["color:white"] }
    }),
    storedRule({
      id: "r-proportion",
      knowledgeType: "PROPORTION_RULE",
      subject: "composition-role:main",
      relation: "suggests-proportion",
      payload: { ratio: 0.6 }
    }),
    storedRule({
      id: "r-market",
      knowledgeType: "MARKET_OBSERVATION",
      subject: "color:purple",
      relation: "observed-trend",
      payload: { popularity: "rising" }
    })
  ]);

  const byId = new Map(compiled.rules.map((rule) => [rule.id, rule]));
  assert.equal(byId.get("dr-r-material")?.priority, "P3");
  assert.equal(byId.get("dr-r-color")?.priority, "P4");
  assert.equal(byId.get("dr-r-style")?.priority, "P5");
  assert.equal(byId.get("dr-r-tarot")?.priority, "P6");
  assert.equal(byId.get("dr-r-proportion")?.priority, "P7");
  assert.equal(byId.get("dr-r-market")?.priority, "P8");

  const priorities = compiled.rules.map((rule) => rule.priority);
  assert.deepEqual(priorities, ["P3", "P4", "P5", "P6", "P7", "P8"]);
});

test("negative rules are hard at material level and soft at color level", () => {
  const compiled = compile([
    storedRule({
      id: "r-neg-material",
      knowledgeType: "NEGATIVE_RULE",
      subject: "material:pyrite",
      relation: "conflicts-with",
      payload: { conflictsWith: ["material:hematite"] }
    }),
    storedRule({
      id: "r-neg-color",
      knowledgeType: "NEGATIVE_RULE",
      subject: "color:red",
      relation: "conflicts-with",
      payload: { conflictsWith: ["color:pink"] }
    })
  ]);

  const byId = new Map(compiled.rules.map((rule) => [rule.id, rule]));
  assert.equal(byId.get("dr-r-neg-material")?.hardness, "HARD");
  assert.equal(byId.get("dr-r-neg-material")?.priority, "P3");
  assert.equal(byId.get("dr-r-neg-color")?.hardness, "SOFT");
  assert.equal(byId.get("dr-r-neg-color")?.priority, "P4");
});

test("only APPROVED rules compile", () => {
  const compiled = compile([
    storedRule({
      id: "r-approved",
      knowledgeType: "COLOR_THEORY",
      subject: "color:blue",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:teal"] }
    }),
    storedRule({
      id: "r-rejected",
      knowledgeType: "COLOR_THEORY",
      subject: "color:blue",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:teal"] },
      status: "REJECTED"
    }),
    storedRule({
      id: "r-needs-review",
      knowledgeType: "COLOR_THEORY",
      subject: "color:blue",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:teal"] },
      status: "NEEDS_REVIEW"
    })
  ]);

  assert.equal(compiled.rules.length, 1);
  assert.equal(compiled.rules[0]?.id, "dr-r-approved");
  assert.equal(compiled.stats.statusFiltered, 2);
});

test("rules from sources below the authority threshold are dropped", () => {
  const compiled = compile([
    storedRule({
      id: "r-trusted",
      knowledgeType: "COLOR_THEORY",
      subject: "color:blue",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:teal"] }
    }),
    storedRule({
      id: "r-untrusted",
      knowledgeType: "COLOR_THEORY",
      subject: "color:blue",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:teal"] },
      sourceId: LOW_AUTHORITY_SOURCE.id
    })
  ]);

  assert.deepEqual(
    compiled.rules.map((rule) => rule.id),
    ["dr-r-trusted"]
  );
  assert.equal(compiled.stats.authorityFiltered, 1);
  assert.equal(DEFAULT_MIN_SOURCE_AUTHORITY, 0.6);
});

test("catalog feasibility drops rules whose subject has no active catalog coverage", () => {
  const compiled = compile([
    storedRule({
      id: "r-available-color",
      knowledgeType: "COLOR_THEORY",
      subject: "color:blue",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:teal"] }
    }),
    storedRule({
      id: "r-unavailable-color",
      knowledgeType: "COLOR_THEORY",
      subject: "color:orange",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:red"] }
    }),
    storedRule({
      id: "r-unavailable-material",
      knowledgeType: "MATERIAL_COMPATIBILITY",
      subject: "material:topaz",
      relation: "compatible-with",
      payload: { companions: ["material:quartz"] }
    }),
    storedRule({
      id: "r-structural-kept",
      knowledgeType: "PROPORTION_RULE",
      subject: "composition-role:main",
      relation: "suggests-proportion",
      payload: { ratio: 0.6 }
    })
  ]);

  assert.deepEqual(
    compiled.rules.map((rule) => rule.id),
    ["dr-r-available-color", "dr-r-structural-kept"]
  );
  assert.equal(compiled.stats.infeasible, 2);
});

test("scope filters restrict compilation by type and subject", () => {
  const compiled = compile(
    [
      storedRule({
        id: "r-color",
        knowledgeType: "COLOR_THEORY",
        subject: "color:blue",
        relation: "harmonizes-with",
        payload: { companionColors: ["color:teal"] }
      }),
      storedRule({
        id: "r-material",
        knowledgeType: "MATERIAL_COMPATIBILITY",
        subject: "material:quartz",
        relation: "compatible-with",
        payload: { companions: ["material:moonstone"] }
      })
    ],
    { scope: { knowledgeTypes: ["COLOR_THEORY"], subjects: ["color:blue"] } }
  );

  assert.deepEqual(
    compiled.rules.map((rule) => rule.id),
    ["dr-r-color"]
  );
  assert.equal(compiled.stats.scopeFiltered, 1);
});

test("duplicate fingerprints compile once", () => {
  const first = storedRule({
    id: "r-dup-a",
    knowledgeType: "COLOR_THEORY",
    subject: "color:blue",
    relation: "harmonizes-with",
    payload: { companionColors: ["color:teal"] }
  });
  const second = {
    ...storedRule({
      id: "r-dup-b",
      knowledgeType: "COLOR_THEORY",
      subject: "color:blue",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:teal"] }
    }),
    fingerprint: first.fingerprint
  };

  const compiled = compile([first, second]);
  assert.deepEqual(
    compiled.rules.map((rule) => rule.id),
    ["dr-r-dup-a"]
  );
  assert.equal(compiled.stats.duplicates, 1);
});

test("conflicting rules resolve by weight within a type group", () => {
  const compiled = compile([
    storedRule({
      id: "r-conflict-soft",
      knowledgeType: "COLOR_THEORY",
      subject: "color:white",
      relation: "pairs-with",
      payload: { companionColors: ["color:silver"] },
      confidence: 0.95
    }),
    storedRule({
      id: "r-conflict-negative",
      knowledgeType: "NEGATIVE_RULE",
      subject: "color:white",
      relation: "pairs-with",
      payload: { companionColors: ["color:gold"] },
      confidence: 0.85
    }),
    storedRule({
      id: "r-conflict-weight",
      knowledgeType: "COLOR_THEORY",
      subject: "color:white",
      relation: "pairs-with",
      payload: { companionColors: ["color:black"] },
      confidence: 0.7
    })
  ]);

  // Conflict groups key on (type, subject, relation): the two COLOR_THEORY
  // rules conflict and the higher weight (0.95 * 0.95) wins over (0.7 * 0.95).
  // The color-level NEGATIVE_RULE is a separate group and survives as a SOFT
  // P4 rule; within P4 the survivors order by weight desc.
  assert.deepEqual(
    compiled.rules.map((rule) => rule.id),
    ["dr-r-conflict-soft", "dr-r-conflict-negative"]
  );
  assert.equal(compiled.stats.conflictDropped, 1);
  assert.ok(
    compiled.warnings.some((warning) => warning.includes("r-conflict-weight"))
  );
});

test("same-priority conflicts break ties by weight then id", () => {
  const compiled = compile([
    storedRule({
      id: "r-tie-b",
      knowledgeType: "COLOR_THEORY",
      subject: "color:purple",
      relation: "suggests-palette",
      payload: { companionColors: ["color:teal"] },
      confidence: 0.9
    }),
    storedRule({
      id: "r-tie-a",
      knowledgeType: "COLOR_THEORY",
      subject: "color:purple",
      relation: "suggests-palette",
      payload: { companionColors: ["color:white"] },
      confidence: 0.9
    })
  ]);

  assert.deepEqual(
    compiled.rules.map((rule) => rule.id),
    ["dr-r-tie-a"]
  );
});

test("user context annotates contextRefs and drops avoided subjects", () => {
  const context: RecommendationContext = {
    contextId: "ctx-test",
    locale: "zh-CN",
    currency: "CNY",
    sources: [{ sourceType: "context-source:manual", weight: 1 }],
    hardConstraints: {
      wristCircumferenceMm: 160,
      requiredProductIds: [],
      excludedProductIds: [],
      mustKeepComponentIds: []
    },
    preferences: {
      emotionTags: ["emotion:calm"],
      styleTags: [],
      colorPreferences: ["color:blue"],
      visualPreferences: []
    },
    avoidances: {
      materialIds: ["material:pyrite"],
      colorFamilyIds: []
    },
    contextWeights: {}
  };

  const compiled = compile(
    [
      storedRule({
        id: "r-preferred-color",
        knowledgeType: "COLOR_THEORY",
        subject: "color:blue",
        relation: "harmonizes-with",
        payload: { companionColors: ["color:teal"] }
      }),
      storedRule({
        id: "r-avoided-material",
        knowledgeType: "NEGATIVE_RULE",
        subject: "material:pyrite",
        relation: "conflicts-with",
        payload: { conflictsWith: ["material:hematite"] }
      }),
      storedRule({
        id: "r-emotion",
        knowledgeType: "STYLE_RULE",
        subject: "emotion:calm",
        relation: "suggests-emotion",
        payload: { companionColors: ["color:blue"] }
      })
    ],
    { context }
  );

  const byId = new Map(compiled.rules.map((rule) => [rule.id, rule]));
  assert.deepEqual(byId.get("dr-r-preferred-color")?.contextRefs, ["color:blue"]);
  assert.equal(byId.get("dr-r-avoided-material"), undefined);
  assert.deepEqual(byId.get("dr-r-emotion")?.contextRefs, ["emotion:calm"]);
  assert.equal(compiled.stats.contextFiltered, 1);
});

test("context filter keeps structural rules and matching preference rules only", () => {
  const context: RecommendationContext = {
    contextId: "ctx-filter",
    locale: "zh-CN",
    currency: "CNY",
    sources: [{ sourceType: "context-source:manual", weight: 1 }],
    hardConstraints: {
      wristCircumferenceMm: 160,
      requiredProductIds: [],
      excludedProductIds: [],
      mustKeepComponentIds: []
    },
    preferences: {
      emotionTags: [],
      styleTags: [],
      colorPreferences: ["color:blue"],
      visualPreferences: []
    },
    avoidances: { materialIds: [], colorFamilyIds: [] },
    contextWeights: {}
  };

  const compiled = compile(
    [
      storedRule({
        id: "r-matching-color",
        knowledgeType: "COLOR_THEORY",
        subject: "color:blue",
        relation: "harmonizes-with",
        payload: { companionColors: ["color:teal"] }
      }),
      storedRule({
        id: "r-unmatching-color",
        knowledgeType: "COLOR_THEORY",
        subject: "color:red",
        relation: "harmonizes-with",
        payload: { companionColors: ["color:pink"] }
      }),
      storedRule({
        id: "r-structural",
        knowledgeType: "COMPOSITION_RULE",
        subject: "composition-role:main",
        relation: "prefers-layout",
        payload: { layout: "symmetric" }
      })
    ],
    { context, contextFilter: true }
  );

  assert.deepEqual(
    compiled.rules.map((rule) => rule.id),
    ["dr-r-matching-color", "dr-r-structural"]
  );
});

test("rule weight multiplies confidence by source authority", () => {
  const compiled = compile([
    storedRule({
      id: "r-weighted",
      knowledgeType: "COLOR_THEORY",
      subject: "color:blue",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:teal"] },
      confidence: 0.8
    })
  ]);

  const rule = compiled.rules[0];
  assert.ok(rule);
  assert.equal(rule.weight, 0.76);
  assert.equal(rule.confidence, 0.8);
  assert.deepEqual(rule.knowledgeRefs, ["r-weighted"]);
});

test("conditions target context facts for context-driven subjects and design facts otherwise", () => {
  const compiled = compile([
    storedRule({
      id: "r-tarot-card",
      knowledgeType: "TAROT",
      subject: "tarot:major-17-the-star",
      relation: "prefers-colors",
      payload: { companionColors: ["color:white"] }
    }),
    storedRule({
      id: "r-style-tag",
      knowledgeType: "STYLE_RULE",
      subject: "style:minimal",
      relation: "prefers-colors",
      payload: { companionColors: ["color:white"] }
    }),
    storedRule({
      id: "r-design-color",
      knowledgeType: "COLOR_THEORY",
      subject: "color:blue",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:teal"] }
    })
  ]);

  const byId = new Map(compiled.rules.map((rule) => [rule.id, rule]));
  assert.deepEqual(byId.get("dr-r-tarot-card")?.conditions, {
    fact: "contextTaxonomyRefs",
    operator: "contains",
    value: "tarot:major-17-the-star"
  });
  assert.deepEqual(byId.get("dr-r-style-tag")?.conditions, {
    fact: "contextTaxonomyRefs",
    operator: "contains",
    value: "style:minimal"
  });
  assert.deepEqual(byId.get("dr-r-design-color")?.conditions, {
    fact: "designTaxonomyRefs",
    operator: "contains",
    value: "color:blue"
  });
  assert.equal(byId.get("dr-r-design-color")?.action.kind, "harmonizes-with");
});

test("authored conditions are preserved when present", () => {
  const authored = storedRule({
    id: "r-authored",
    knowledgeType: "PROPORTION_RULE",
    subject: "composition-role:main",
    relation: "suggests-proportion",
    payload: { ratio: 0.6 }
  });
  authored.conditions = {
    all: [
      { fact: "beadCount", operator: "greaterThan", value: 12 },
      { fact: "designTaxonomyRefs", operator: "contains", value: "composition-role:main" }
    ]
  };

  const compiled = compile([authored]);
  assert.deepEqual(compiled.rules[0]?.conditions, authored.conditions);
});

test("rules guarded by different conditions are complementary, not conflicts", () => {
  const ethereal = storedRule({
    id: "r-cond-ethereal",
    knowledgeType: "COLOR_THEORY",
    subject: "temperature:cool",
    relation: "harmonizes-with",
    payload: { companionColors: ["color:white"] }
  });
  ethereal.conditions = { appliesToStyleTags: ["style:ethereal"] };
  const modern = storedRule({
    id: "r-cond-modern",
    knowledgeType: "COLOR_THEORY",
    subject: "temperature:cool",
    relation: "harmonizes-with",
    payload: { companionColors: ["color:silver"] }
  });
  modern.conditions = { appliesToStyleTags: ["style:modern"] };

  const compiled = compile([ethereal, modern]);
  assert.equal(compiled.rules.length, 2);
  assert.equal(compiled.stats.conflictDropped, 0);
});

test("unconditional divergent rules on the same key still conflict", () => {
  const compiled = compile([
    storedRule({
      id: "r-uncond-a",
      knowledgeType: "COLOR_THEORY",
      subject: "color:teal",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:blue"] },
      confidence: 0.9
    }),
    storedRule({
      id: "r-uncond-b",
      knowledgeType: "COLOR_THEORY",
      subject: "color:teal",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:green"] },
      confidence: 0.8
    })
  ]);

  assert.deepEqual(
    compiled.rules.map((rule) => rule.id),
    ["dr-r-uncond-a"]
  );
  assert.equal(compiled.stats.conflictDropped, 1);
});

test("compilation is deterministic across 100 runs", () => {
  const rules = [
    storedRule({
      id: "r-det-1",
      knowledgeType: "COLOR_THEORY",
      subject: "color:blue",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:teal"] },
      confidence: 0.88
    }),
    storedRule({
      id: "r-det-2",
      knowledgeType: "MATERIAL_COMPATIBILITY",
      subject: "material:quartz",
      relation: "compatible-with",
      payload: { companions: ["material:moonstone"] },
      confidence: 0.92
    }),
    storedRule({
      id: "r-det-3",
      knowledgeType: "NEGATIVE_RULE",
      subject: "color:red",
      relation: "conflicts-with",
      payload: { conflictsWith: ["color:pink"] },
      confidence: 0.85
    })
  ];

  const baseline = JSON.stringify(compile(rules));
  for (let run = 0; run < 100; run += 1) {
    assert.equal(JSON.stringify(compile(rules)), baseline);
  }
  const baselineSet = compile(rules);
  assert.equal(baselineSet.decisionRuleSetVersion, compile(rules).decisionRuleSetVersion);
});

test("output ordering is priority, then weight, then id", () => {
  const compiled = compile([
    storedRule({
      id: "r-order-c",
      knowledgeType: "COLOR_THEORY",
      subject: "color:purple",
      relation: "suggests-palette",
      payload: { companionColors: ["color:teal"] },
      confidence: 0.9
    }),
    storedRule({
      id: "r-order-a",
      knowledgeType: "COLOR_THEORY",
      subject: "color:white",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:silver"] },
      confidence: 0.9
    }),
    storedRule({
      id: "r-order-b",
      knowledgeType: "COLOR_THEORY",
      subject: "color:teal",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:blue"] },
      confidence: 0.95
    })
  ]);

  // Same P4 priority: weight desc (0.95*0.95 > 0.9*0.95), then id asc for ties.
  assert.deepEqual(
    compiled.rules.map((rule) => rule.id),
    ["dr-r-order-b", "dr-r-order-a", "dr-r-order-c"]
  );
});

test("stats account for every input rule", () => {
  const compiled = compile([
    storedRule({
      id: "r-stat-1",
      knowledgeType: "COLOR_THEORY",
      subject: "color:blue",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:teal"] }
    }),
    storedRule({
      id: "r-stat-2",
      knowledgeType: "COLOR_THEORY",
      subject: "color:orange",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:red"] }
    }),
    storedRule({
      id: "r-stat-3",
      knowledgeType: "COLOR_THEORY",
      subject: "color:blue",
      relation: "harmonizes-with",
      payload: { companionColors: ["color:teal"] },
      status: "REJECTED"
    })
  ]);

  assert.equal(compiled.stats.input, 3);
  assert.equal(compiled.stats.statusFiltered, 1);
  assert.equal(compiled.stats.infeasible, 1);
  assert.equal(compiled.stats.output, 1);
  assert.equal(
    compiled.stats.input,
    compiled.stats.statusFiltered +
      compiled.stats.scopeFiltered +
      compiled.stats.authorityFiltered +
      compiled.stats.contextFiltered +
      compiled.stats.infeasible +
      compiled.stats.duplicates +
      compiled.stats.conflictDropped +
      compiled.stats.output
  );
});
