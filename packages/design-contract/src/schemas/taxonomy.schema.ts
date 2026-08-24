import { z } from "zod";

import { IdentifierSchema } from "./component.schema";

export const TaxonomyDomainSchema = z.enum([
  "MATERIAL",
  "COLOR",
  "STYLE",
  "EMOTION",
  "TEXTURE",
  "TRANSPARENCY",
  "LUSTER",
  "TEMPERATURE",
  "COMPOSITION_ROLE",
  "KNOWLEDGE_DOMAIN",
  "CONTEXT_SOURCE",
  "SATURATION_LEVEL",
  "LIGHTNESS_LEVEL",
  "TAROT",
  "WUXING",
  "ZODIAC"
]);

export type TaxonomyDomain = z.infer<typeof TaxonomyDomainSchema>;

const TAXONOMY_DOMAIN_PREFIXES: Record<TaxonomyDomain, string> = {
  MATERIAL: "material",
  COLOR: "color",
  STYLE: "style",
  EMOTION: "emotion",
  TEXTURE: "texture",
  TRANSPARENCY: "transparency",
  LUSTER: "luster",
  TEMPERATURE: "temperature",
  COMPOSITION_ROLE: "composition-role",
  KNOWLEDGE_DOMAIN: "knowledge-domain",
  CONTEXT_SOURCE: "context-source",
  SATURATION_LEVEL: "saturation-level",
  LIGHTNESS_LEVEL: "lightness-level",
  TAROT: "tarot",
  WUXING: "wuxing",
  ZODIAC: "zodiac"
};

export function taxonomyDomainPrefix(domain: TaxonomyDomain): string {
  return TAXONOMY_DOMAIN_PREFIXES[domain];
}

export const TaxonomyTermStatusSchema = z.enum(["ACTIVE", "DEPRECATED"]);

export const TaxonomyTermSchema = z
  .strictObject({
    id: IdentifierSchema,
    domain: TaxonomyDomainSchema,
    displayName: z.strictObject({
      zh: z.string().trim().min(1).max(40),
      en: z.string().trim().min(1).max(60)
    }),
    aliases: z.array(z.string().trim().min(1).max(60)).max(16).default([]),
    parentId: IdentifierSchema.nullable().default(null),
    status: TaxonomyTermStatusSchema.default("ACTIVE")
  })
  .superRefine((term, context) => {
    const addIssue = (path: PropertyKey[], message: string) => {
      context.addIssue({ code: "custom", message, path });
    };

    if (term.id.split(":")[0] !== taxonomyDomainPrefix(term.domain)) {
      addIssue(["id"], "taxonomy id prefix must match the term domain");
    }
    if (term.parentId === term.id) {
      addIssue(["parentId"], "a taxonomy term cannot be its own parent");
    }
  });

export type TaxonomyTerm = z.infer<typeof TaxonomyTermSchema>;
export type TaxonomyTermInput = z.input<typeof TaxonomyTermSchema>;
export type TaxonomyTermStatus = z.infer<typeof TaxonomyTermStatusSchema>;
