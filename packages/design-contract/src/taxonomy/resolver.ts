import { IdentifierSchema } from "../schemas/component.schema";
import type { TaxonomyDomain, TaxonomyTerm } from "../schemas/taxonomy.schema";
import { TAXONOMY_TERMS } from "./terms";

const byId = new Map<string, TaxonomyTerm>();
const byNormalizedKey = new Map<string, TaxonomyTerm>();

for (const term of TAXONOMY_TERMS) {
  if (byId.has(term.id)) {
    throw new Error(`DUPLICATE_TAXONOMY_ID: ${term.id}`);
  }
  byId.set(term.id, term);
  for (const key of [term.id, ...term.aliases]) {
    const normalized = normalizeTaxonomyKey(key);
    const existing = byNormalizedKey.get(normalized);
    if (existing !== undefined && existing.id !== term.id) {
      throw new Error(`DUPLICATE_TAXONOMY_KEY: ${normalized} (${existing.id} vs ${term.id})`);
    }
    byNormalizedKey.set(normalized, term);
  }
}

export function normalizeTaxonomyKey(raw: string): string {
  return raw.trim().toLowerCase();
}

export function resolveTaxonomyId(raw: string, domain?: TaxonomyDomain): string | null {
  const term = byNormalizedKey.get(normalizeTaxonomyKey(raw));
  if (term === undefined) return null;
  if (domain !== undefined && term.domain !== domain) return null;
  return term.id;
}

export function getTaxonomyTerm(id: string): TaxonomyTerm | null {
  return byId.get(id) ?? null;
}

export function isTaxonomyId(id: string, domain?: TaxonomyDomain): boolean {
  const term = byId.get(id);
  if (term === undefined) return false;
  return domain === undefined || term.domain === domain;
}

export function listTaxonomyTerms(domain?: TaxonomyDomain): readonly TaxonomyTerm[] {
  if (domain === undefined) return TAXONOMY_TERMS;
  return TAXONOMY_TERMS.filter((term) => term.domain === domain);
}

export function TaxonomyRefSchema(domain: TaxonomyDomain) {
  return IdentifierSchema.refine(
    (id) => resolveTaxonomyId(id, domain) === id,
    "UNKNOWN_TAXONOMY_ID"
  );
}

export const VISUAL_TAXONOMY_DOMAINS: readonly TaxonomyDomain[] = [
  "TEXTURE",
  "LUSTER",
  "TRANSPARENCY",
  "TEMPERATURE",
  "SATURATION_LEVEL",
  "LIGHTNESS_LEVEL"
];

export const VisualTaxonomyRefSchema = IdentifierSchema.refine((id) => {
  const term = byId.get(id);
  return term !== undefined && VISUAL_TAXONOMY_DOMAINS.includes(term.domain);
}, "UNKNOWN_VISUAL_TAXONOMY_ID");
