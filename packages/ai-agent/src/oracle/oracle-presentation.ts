import {
  OraclePresentationResponseSchema,
  OraclePublicSessionSchema,
  PresentationLocaleSchema,
  type CatalogMaterialProduct,
  type OraclePresentationCard,
  type OraclePresentationCue,
  type OraclePresentationMaterial,
  type OraclePresentationResponse,
  type OraclePublicSession
} from "@mystcrag/design-contract";

import {
  oracleAccentCue,
  oracleCardDescription,
  oracleCardTitle,
  oracleColorCue,
  oracleColorLabel,
  oracleGenericColorCue,
  oracleHeadline,
  oracleMaterialLabel,
  oracleRhythmCue,
  oracleRhythmLabel,
  oracleSummary
} from "./oracle-presentation.templates.js";

const MAX_MATERIALS = 24;

const resolvedColorLabels = (
  locale: OraclePresentationResponse["locale"],
  tags: readonly string[]
): string[] =>
  tags
    .map((tag) => oracleColorLabel(locale, tag))
    .filter((label): label is string => label !== undefined);

const collectMaterials = (
  locale: OraclePresentationResponse["locale"],
  recommendations: OraclePublicSession["recommendations"],
  catalog: readonly CatalogMaterialProduct[]
): OraclePresentationMaterial[] => {
  const catalogById = new Map(catalog.map((product) => [product.beadProductId, product]));
  const materials: OraclePresentationMaterial[] = [];
  const seen = new Set<string>();

  for (const recommendation of recommendations ?? []) {
    for (const bead of recommendation.design.beads) {
      if (seen.has(bead.beadProductId)) continue;
      seen.add(bead.beadProductId);

      const product = catalogById.get(bead.beadProductId);
      if (!product || product.availableQuantity <= 0) continue;

      materials.push({
        beadProductId: product.beadProductId,
        role: bead.role,
        label: oracleMaterialLabel(locale, product)
      });
      if (materials.length >= MAX_MATERIALS) return materials;
    }
  }

  return materials;
};

/**
 * Projects a persisted Oracle session into reviewed, read-only display copy for one display locale.
 *
 * It reads only validated session facts and a real catalog snapshot: it never re-casts, re-recommends,
 * calls an entropy source or provider, persists a translation, mutates the saved interpretation, or
 * invents a product, price, or stock value. `sourceRevision` always mirrors the source session revision.
 */
export function projectOraclePresentation(
  session: OraclePublicSession,
  locale: OraclePresentationResponse["locale"],
  catalog: readonly CatalogMaterialProduct[]
): OraclePresentationResponse {
  const source = OraclePublicSessionSchema.parse(session);
  const targetLocale = PresentationLocaleSchema.parse(locale);

  const movingLines = source.cast.movingLineIndices;
  const recommendations = [...(source.recommendations ?? [])].sort((left, right) => left.rank - right.rank);

  const primaryLabels = resolvedColorLabels(targetLocale, source.signal.primaryColorTags);
  const supportLabels = resolvedColorLabels(targetLocale, source.signal.supportColorTags);
  const rhythmTag = source.signal.rhythmTags[0];
  const rhythmLabel = rhythmTag === undefined ? undefined : oracleRhythmLabel(targetLocale, rhythmTag);

  const cues: OraclePresentationCue[] = [
    {
      kind: "COLOR",
      text:
        primaryLabels.length > 0 || supportLabels.length > 0
          ? oracleColorCue(targetLocale, primaryLabels, supportLabels)
          : oracleGenericColorCue(targetLocale)
    }
  ];
  if (rhythmLabel !== undefined) {
    cues.push({ kind: "RHYTHM", text: oracleRhythmCue(targetLocale, rhythmLabel) });
  }
  if (movingLines.length > 0) {
    cues.push({ kind: "ACCENT", text: oracleAccentCue(targetLocale, movingLines) });
  }

  const cards: OraclePresentationCard[] = recommendations.map((recommendation) => ({
    designId: recommendation.design.designId,
    title: oracleCardTitle(targetLocale, recommendation.direction),
    description: oracleCardDescription(
      targetLocale,
      recommendation.direction,
      recommendation.design.beads.length
    )
  }));

  return OraclePresentationResponseSchema.parse({
    sessionId: source.sessionId,
    sourceRevision: source.revision,
    locale: targetLocale,
    headline: oracleHeadline(targetLocale),
    summary: oracleSummary(targetLocale, movingLines.length > 0, primaryLabels, rhythmLabel),
    cues,
    materials: collectMaterials(targetLocale, source.recommendations, catalog),
    cards
  });
}