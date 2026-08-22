import { createHash } from "node:crypto";

import {
  isRelationAllowedForKnowledgeType,
  knowledgeDomainForType,
  listTaxonomyTerms,
  type JsonValue,
  type KnowledgeType
} from "@mystcrag/design-contract";

import {
  confidenceFor,
  isCandidateAllowedForSource,
  type ExtractorInput,
  type KnowledgeExtractor,
  type KnowledgeRuleSeed
} from "./extractor.js";

/**
 * Batch B Crystal Core Knowledge: GemDat-style gem profile pages lay out
 * physical/optical facts as label-value tables (Mohs Hardness, Crystal
 * System, Chemical Formula...). This extractor turns each labelled fact into
 * a `has-property` candidate — a GEMOLOGICAL_FACT with verbatim evidence —
 * so 60+ crystals can accumulate canonical gemology from real datasheets
 * instead of bootstrap templates.
 */

type GemProperty = {
  key: string;
  labelPattern: RegExp;
  valuePattern: RegExp;
  knowledgeType: KnowledgeType;
};

/**
 * Values end either at the next known label or where the inline reference
 * citation begins ("Walter Schumann, Gemstones of the world (2001)" — two
 * consecutive capitalized words after the value).
 */
const CITE_LOOKAHEAD = String.raw`(?=\s+(?:[A-Z][a-z]+ [A-Z][a-z]+|Chemical Formula|Mohs Hardness|Specific Gravity|Crystal System|Refractive Index|Transparency|Colour|Tenacity|Fracture|Cleavage|Habit|Dispersion|Birefringence|Pleochroism|Lustre|Luster|Treatments|Synthetic|Physical Properties|Optical Properties|Crystallography|$))`;

const GEM_PROPERTIES: readonly GemProperty[] = [
  {
    key: "mineralFamily",
    labelPattern: /A variety or type of:/,
    valuePattern: new RegExp(String.raw`^\s*([A-Z][A-Za-z'-]*(?: [A-Za-z'-]+)*?)${CITE_LOOKAHEAD}`),
    knowledgeType: "CRYSTAL_GEMOLOGY"
  },
  {
    key: "chemicalFormula",
    labelPattern: /Chemical Formula/,
    valuePattern: new RegExp(String.raw`^\s*([A-Za-z0-9()·]+(?: [A-Za-z0-9()·]+)*?)${CITE_LOOKAHEAD}`),
    knowledgeType: "CRYSTAL_GEMOLOGY"
  },
  {
    key: "mohsHardness",
    labelPattern: /Mohs Hardness/,
    valuePattern: /^\s*(\d+(?:\.\d+)?(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?)/,
    knowledgeType: "CRYSTAL_GEMOLOGY"
  },
  {
    key: "specificGravity",
    labelPattern: /Specific Gravity/,
    valuePattern: /^\s*(\d+(?:\.\d+)?(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?)/,
    knowledgeType: "CRYSTAL_GEMOLOGY"
  },
  {
    key: "refractiveIndex",
    labelPattern: /Refractive Index/,
    valuePattern: /^\s*(\d\.\d{3}(?:\s*(?:-|–|to)\s*\d\.\d{3})?)/,
    knowledgeType: "CRYSTAL_GEMOLOGY"
  },
  {
    key: "tenacity",
    labelPattern: /Tenacity/,
    valuePattern: /^\s*([A-Za-z]+)/,
    knowledgeType: "CRYSTAL_GEMOLOGY"
  },
  {
    key: "fracture",
    labelPattern: /Fracture/,
    valuePattern: /^\s*([A-Za-z]+)/,
    knowledgeType: "CRYSTAL_GEMOLOGY"
  },
  {
    key: "crystalSystem",
    labelPattern: /Crystal System/,
    valuePattern:
      /^\s*(Triclinic|Monoclinic|Orthorhombic|Tetragonal|Trigonal|Hexagonal|Cubic|Isometric|Amorphous)/i,
    knowledgeType: "CRYSTAL_GEMOLOGY"
  },
  {
    key: "colour",
    labelPattern: /Colour \(General\)/,
    valuePattern: new RegExp(String.raw`^\s*([A-Za-z,\- ]+?)${CITE_LOOKAHEAD}`),
    knowledgeType: "CRYSTAL_VISUAL_PROPERTIES"
  },
  {
    key: "transparency",
    labelPattern: /Transparency/,
    valuePattern: /^\s*((?:(?:Transparent|Translucent|Opaque)[a-z]*,?)+)/i,
    knowledgeType: "CRYSTAL_VISUAL_PROPERTIES"
  }
];

/** Normalize for matching: lowercase, drop apostrophes, split on separators. */
function normalizeForMatch(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
    .trim();
}

type MaterialMatchTerm = { id: string; normalized: string; length: number };

const MATERIAL_MATCH_TERMS: readonly MaterialMatchTerm[] = listTaxonomyTerms("MATERIAL").flatMap(
  (term) => {
    const keys = [
      term.id.slice("material:".length),
      term.displayName.en,
      term.displayName.zh,
      ...term.aliases
    ];
    const seen = new Set<string>();
    const terms: MaterialMatchTerm[] = [];
    for (const key of keys) {
      const normalized = normalizeForMatch(key);
      if (normalized.length === 0 || seen.has(normalized)) continue;
      seen.add(normalized);
      terms.push({ id: term.id, normalized, length: normalized.length });
    }
    return terms;
  }
);

/** Longest material-name match inside the document title wins. */
function resolveGemSubject(title: string): string | null {
  const normalizedTitle = ` ${normalizeForMatch(title)} `;
  let best: MaterialMatchTerm | null = null;
  for (const term of MATERIAL_MATCH_TERMS) {
    if (best !== null && term.length <= best.length) continue;
    if (normalizedTitle.includes(` ${term.normalized} `)) best = term;
  }
  return best === null ? null : best.id;
}

const BASE_CONFIDENCE = 0.85;

export class GemProfileExtractor implements KnowledgeExtractor {
  readonly id = "gem-profile-extractor-v1";
  readonly method = "pattern" as const;

  async extract(input: ExtractorInput): Promise<KnowledgeRuleSeed[]> {
    const subject = resolveGemSubject(input.title);
    if (subject === null) return [];

    const seeds: KnowledgeRuleSeed[] = [];
    for (const property of GEM_PROPERTIES) {
      const labelMatch = property.labelPattern.exec(input.contentText);
      if (labelMatch === null) continue;

      const afterLabel = labelMatch.index + labelMatch[0].length;
      const valueMatch = property.valuePattern.exec(input.contentText.slice(afterLabel));
      if (valueMatch === null || valueMatch.index !== 0) continue;

      const rawValue = (valueMatch[1] ?? "").trim();
      if (rawValue.length === 0 || rawValue.length > 120) continue;
      const value = rawValue.replace(/\s+/g, " ");

      if (!isRelationAllowedForKnowledgeType("has-property", property.knowledgeType)) continue;
      const knowledgeDomain = knowledgeDomainForType(property.knowledgeType);
      if (!isCandidateAllowedForSource(knowledgeDomain, input.source)) continue;

      // Evidence spans the label plus the value, exactly as they appear.
      const startOffset = labelMatch.index;
      const endOffset = afterLabel + valueMatch[0].length;
      const sentence = input.contentText.slice(startOffset, endOffset);

      const payload = {
        property: property.key,
        value,
        extraction: {
          extractor: this.id,
          method: this.method,
          evidence: [
            {
              documentId: input.documentId,
              sentence,
              startOffset,
              endOffset
            }
          ]
        }
      };
      // Identity fingerprint (type + subject + relation + property): the same
      // fact from a second source deduplicates, and a diverging value surfaces
      // as a reviewable conflict rather than a silent second rule.
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            knowledgeType: property.knowledgeType,
            subject,
            relation: "has-property",
            property: property.key
          })
        )
        .digest("hex");

      seeds.push({
        id: `cand-${fingerprint.slice(0, 24)}`,
        sourceId: input.source.sourceId,
        knowledgeType: property.knowledgeType,
        knowledgeDomain,
        subject,
        relation: "has-property",
        payload: payload as JsonValue,
        conditions: {},
        confidence: confidenceFor(BASE_CONFIDENCE, input.source.reliabilityLevel),
        claimType: "GEMOLOGICAL_FACT",
        status: "NEEDS_REVIEW",
        sourceRefs: [{ sourceId: input.source.sourceId, documentId: input.documentId }],
        version: 1,
        fingerprint,
        createdAt: input.fetchedAt,
        updatedAt: input.fetchedAt
      });
    }
    return seeds;
  }
}
