import { createHash } from "node:crypto";

import {
  isRelationAllowedForKnowledgeType,
  knowledgeDomainForType,
  listTaxonomyTerms,
  type ExtractionRelation,
  type JsonValue,
  type KnowledgeType,
  type TaxonomyDomain
} from "@mystcrag/design-contract";

import {
  confidenceFor,
  isCandidateAllowedForSource,
  type ExtractorInput,
  type KnowledgeExtractor,
  type KnowledgeRuleSeed
} from "./extractor.js";

type SentenceSpan = { sentence: string; startOffset: number; endOffset: number };

const SUBJECT_DOMAINS: readonly TaxonomyDomain[] = [
  "COLOR",
  "MATERIAL",
  "STYLE",
  "EMOTION",
  "COMPOSITION_ROLE"
];

/** Ordered by specificity: the first matching relation wins per sentence. */
const RELATION_PATTERNS: ReadonlyArray<{
  relation: ExtractionRelation;
  pattern: RegExp;
  base: number;
}> = [
  {
    relation: "avoid-exposure",
    pattern:
      /(避免|忌|不要|切勿|远离)[^\n]{0,6}(水|阳光|高温|汗|海|化学|紫外|漂白|潮湿)|溶于水|遇水|avoid[^\n]{0,12}(water|sunlight|heat|sweat|chemical|ultraviolet|moisture)|dissolves? in water/i,
    base: 0.8
  },
  {
    relation: "care-instruction",
    pattern: /(保养|护理|清洁|擦拭|存放|收纳|换线|care|clean(ing)?|stor(e|age)|maintain)/i,
    base: 0.7
  },
  {
    relation: "conflicts-with",
    pattern: /(不宜|相克|冲突|抵触|避免.{0,4}(混|同|叠)|conflicts?|clashes?|avoid (?:mixing|pairing|combining))/i,
    base: 0.7
  },
  {
    relation: "symbolizes",
    pattern: /(象征|寓意|代表着|意味着|象征著|symboli[sz]e[sd]?|stands? for|represent[sd]?)/i,
    base: 0.75
  },
  {
    relation: "trending-in",
    pattern: /(流行|趋势|走红|热议|爆款|搜索量|trend(ing|s|ed)?|popular(ity)?|demand)/i,
    base: 0.7
  },
  {
    relation: "transitions-to",
    pattern: /(渐变|过渡|衔接|gradient|transition)/i,
    base: 0.7
  },
  {
    relation: "proportion-of",
    pattern: /(比例|占比|数量分配|主石|焦点|视觉重心|proportion|ratio|focal)/i,
    base: 0.65
  },
  {
    relation: "suits-style",
    pattern: /(风格|适配|极简风|复古风|\bstyle\b|\bsuits?\b|in the style of|aesthetic)/i,
    base: 0.65
  },
  {
    relation: "pairs-well-with",
    pattern: /(搭配|相配|很搭|组合和谐|协调|pairs?\b[^.!?]{0,30}\bwith|complement[sd]?|match(?:es)?\b[^.!?]{0,30}\bwith|go(?:es)? well with)/i,
    base: 0.7
  }
];

const SUBJECT_TERMS = listTaxonomyTerms().flatMap((term) =>
  SUBJECT_DOMAINS.includes(term.domain)
    ? [{ id: term.id, domain: term.domain, alias: term.id, ascii: true }, ...term.aliases.map((alias) => ({ id: term.id, domain: term.domain, alias, ascii: /^[a-z0-9-]+$/i.test(alias) }))]
    : []
);

const DEFAULT_SUBJECT_BY_RELATION: Record<ExtractionRelation, string> = {
  "pairs-well-with": "general",
  "conflicts-with": "general",
  "avoid-exposure": "general",
  "care-instruction": "general",
  symbolizes: "general",
  "suits-style": "general",
  "proportion-of": "strand",
  "transitions-to": "strand",
  "trending-in": "market"
};

function splitSentences(contentText: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const pattern = /[^.!?。！？\n]+[.!?。！？]*\s*/gu;
  for (const match of contentText.matchAll(pattern)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const leading = raw.length - raw.trimStart().length;
    const sentence = raw.trim();
    if (sentence.length === 0) continue;
    const startOffset = start + leading;
    spans.push({ sentence, startOffset, endOffset: startOffset + sentence.length });
  }
  return spans;
}

type SubjectMatch = { id: string; domain: TaxonomyDomain; start: number; end: number };

function matchSubjects(sentence: string): Map<TaxonomyDomain, string[]> {
  const matches: SubjectMatch[] = [];
  for (const term of SUBJECT_TERMS) {
    if (term.ascii) {
      const pattern = new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapeRegExp(term.alias)}([^\\p{L}\\p{N}]|$)`,
        "giu"
      );
      for (const match of sentence.matchAll(pattern)) {
        const leading = match[1] === undefined ? 0 : match[1].length;
        const start = (match.index ?? 0) + leading;
        matches.push({ id: term.id, domain: term.domain, start, end: start + term.alias.length });
      }
    } else {
      let from = 0;
      for (;;) {
        const start = sentence.indexOf(term.alias, from);
        if (start === -1) break;
        matches.push({ id: term.id, domain: term.domain, start, end: start + term.alias.length });
        from = start + term.alias.length;
      }
    }
  }
  // Chinese gem compounds like 紫水晶 read as one material word: a color
  // character glued to a material match is part of the gem name, not a color
  // subject (紫 in 紫水晶 must not surface color:purple).
  const materialRanges = matches.filter((match) => match.domain === "MATERIAL");
  const kept = matches.filter(
    (match) =>
      match.domain !== "COLOR" ||
      !materialRanges.some(
        (material) => match.start === material.end || match.end === material.start
      )
  );

  const matched = new Map<TaxonomyDomain, string[]>();
  for (const match of kept) {
    const existing = matched.get(match.domain) ?? [];
    if (!existing.includes(match.id)) existing.push(match.id);
    matched.set(match.domain, existing);
  }
  return matched;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectRelation(sentence: string): { relation: ExtractionRelation; base: number } | null {
  for (const entry of RELATION_PATTERNS) {
    if (entry.pattern.test(sentence)) return entry;
  }
  return null;
}

function resolveKnowledgeType(
  relation: ExtractionRelation,
  subjects: Map<TaxonomyDomain, string[]>
): KnowledgeType | null {
  switch (relation) {
    case "pairs-well-with":
      if (subjects.has("COLOR")) return "COLOR_THEORY";
      if (subjects.has("MATERIAL")) return "MATERIAL_COMPATIBILITY";
      if (subjects.has("STYLE")) return "STYLE_RULE";
      return null;
    case "conflicts-with":
      if (subjects.has("MATERIAL")) return "MATERIAL_COMPATIBILITY";
      if (subjects.has("COLOR")) return "COLOR_THEORY";
      return "NEGATIVE_RULE";
    case "avoid-exposure":
      return "NEGATIVE_RULE";
    case "care-instruction":
      return subjects.has("MATERIAL") ? "MATERIAL_COMPATIBILITY" : null;
    case "symbolizes":
      return "CULTURAL_SYMBOLISM";
    case "suits-style":
      return "STYLE_RULE";
    case "proportion-of": {
      const roles = subjects.get("COMPOSITION_ROLE") ?? [];
      if (roles.length >= 2) return "COMPOSITION_RULE";
      if (roles.includes("composition-role:focal")) return "FOCAL_RULE";
      return "PROPORTION_RULE";
    }
    case "transitions-to":
      return "TRANSITION_RULE";
    case "trending-in":
      return "MARKET_OBSERVATION";
  }
}

/**
 * Deterministic free-text extraction (Quality Phase Q2): sentence spans with
 * offsets, taxonomy subject recognition (CJK substring + ASCII word-boundary
 * aliases), first-match relation inference over the nine-relation vocabulary,
 * and reliability-weighted confidence — every candidate lands NEEDS_REVIEW
 * with the exact evidence sentence attached for human review.
 */
export class PatternExtractor implements KnowledgeExtractor {
  readonly id = "pattern-extractor-v1";
  readonly method = "pattern" as const;

  async extract(input: ExtractorInput): Promise<KnowledgeRuleSeed[]> {
    const seeds: KnowledgeRuleSeed[] = [];
    const seen = new Set<string>();

    for (const span of splitSentences(input.contentText)) {
      const relationMatch = detectRelation(span.sentence);
      if (relationMatch === null) continue;
      const subjects = matchSubjects(span.sentence);
      const knowledgeType = resolveKnowledgeType(relationMatch.relation, subjects);
      if (knowledgeType === null) continue;
      if (!isRelationAllowedForKnowledgeType(relationMatch.relation, knowledgeType)) continue;

      const knowledgeDomain = knowledgeDomainForType(knowledgeType);
      if (!isCandidateAllowedForSource(knowledgeDomain, input.source)) continue;

      const subjectIds = [...subjects.values()].flat().sort().slice(0, 2);
      const subject =
        subjectIds.length > 0 ? subjectIds.join("+") : DEFAULT_SUBJECT_BY_RELATION[relationMatch.relation];

      const payload = {
        extraction: {
          extractor: this.id,
          method: this.method,
          evidence: [
            {
              documentId: input.documentId,
              sentence: span.sentence.slice(0, 500),
              startOffset: span.startOffset,
              endOffset: span.endOffset
            }
          ]
        },
        matchedDomains: [...subjects.keys()].sort()
      };
      // Fingerprints cover knowledge identity only — evidence offsets vary
      // per occurrence and must not split one rule into many.
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            knowledgeType,
            subject,
            relation: relationMatch.relation,
            matchedDomains: payload.matchedDomains
          })
        )
        .digest("hex");
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      seeds.push({
        id: `cand-${fingerprint.slice(0, 24)}`,
        sourceId: input.source.sourceId,
        knowledgeType,
        knowledgeDomain,
        subject,
        relation: relationMatch.relation,
        payload: payload as JsonValue,
        conditions: {},
        confidence: confidenceFor(relationMatch.base, input.source.reliabilityLevel),
        status: "NEEDS_REVIEW",
        sourceRefs: [
          { sourceId: input.source.sourceId, documentId: input.documentId }
        ],
        version: 1,
        fingerprint,
        createdAt: input.fetchedAt,
        updatedAt: input.fetchedAt
      });
    }
    return seeds;
  }
}
