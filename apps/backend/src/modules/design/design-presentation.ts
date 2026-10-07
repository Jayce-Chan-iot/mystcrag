import {
  DesignPresentationResponseSchema,
  PresentationLocaleSchema,
  PublicDesignV1Schema,
  type DesignPresentationResponse,
  type PresentationLocale,
  type PublicDesignV1
} from "@mystcrag/design-contract";

import { designMaterialLabel, designPresentationStory, designPresentationTitle } from "./design-presentation.templates.js";

/**
 * A real, sellable catalog material row used to label one bead. It carries only the display facts
 * the projection reads; stock and price stay out of the response.
 */
export type DesignPresentationCatalogProduct = {
  readonly beadProductId: string;
  readonly crystalId: string;
  readonly crystalNameCn: string;
  readonly crystalNameEn: string;
  readonly shape: string;
  readonly diameterMm: number;
  readonly availableQuantity: number;
};

/**
 * Projects a persisted, owner-owned design into reviewed, read-only display copy for one locale.
 *
 * It reads only the saved design's structural facts and a real catalog snapshot: it never re-prices,
 * re-recommends, mutates the saved design, persists a translation, or invents a product, price, or
 * stock value. `sourceRevision` always mirrors the saved design revision and `designId` is the
 * original design ID. Material labels keep the real `beadProductId` even when the product is no
 * longer listed or carries a prohibited name.
 */
export function projectDesignPresentation(
  design: PublicDesignV1,
  locale: PresentationLocale,
  catalog: readonly DesignPresentationCatalogProduct[]
): DesignPresentationResponse {
  const source = PublicDesignV1Schema.parse(design);
  const targetLocale = PresentationLocaleSchema.parse(locale);

  const catalogByProductId = new Map(catalog.map((product) => [product.beadProductId, product]));

  const materialLabels = source.beads.map((bead) => {
    const product = catalogByProductId.get(bead.beadProductId);
    return {
      beadProductId: bead.beadProductId,
      label: designMaterialLabel(targetLocale, {
        crystalId: product?.crystalId ?? bead.crystalId,
        ...(product === undefined ? {} : { crystalNameCn: product.crystalNameCn, crystalNameEn: product.crystalNameEn }),
        shape: product?.shape ?? bead.shape,
        diameterMm: product?.diameterMm ?? bead.diameterMm
      })
    };
  });

  return DesignPresentationResponseSchema.parse({
    designId: source.designId,
    sourceRevision: source.revision,
    locale: targetLocale,
    title: designPresentationTitle(targetLocale),
    story: designPresentationStory(targetLocale, source.beads.length),
    materialLabels
  });
}