import type { PublicDesignV1 } from "@mystcrag/design-contract";

import { BraceletPreview } from "../../design/components/bracelet-preview";
import { formatMinorAmount } from "../../design/model/format-minor-amount";
import { tarotStyles as styles } from "../tarot-styles";

export function getDesignMaterialNames(
  design: PublicDesignV1,
  materialNamesByProductId: ReadonlyMap<string, string>
): readonly string[] {
  return [...new Set(design.beads.map((bead) =>
    materialNamesByProductId.get(bead.beadProductId) ?? bead.materialKey
  ))];
}

export function TarotRecommendationCard({
  design,
  rank,
  selected,
  disabled = false,
  materialNamesByProductId,
  onSelect
}: Readonly<{
  design: PublicDesignV1;
  rank: number;
  selected: boolean;
  disabled?: boolean;
  materialNamesByProductId: ReadonlyMap<string, string>;
  onSelect(designId: string): void;
}>) {
  const materials = getDesignMaterialNames(design, materialNamesByProductId);
  const price = formatMinorAmount({
    amountMinor: design.pricing.totalPriceMinor,
    currency: design.currency,
    locale: design.locale
  });
  const wristSize = (design.bracelet.wristCircumferenceMm / 10).toFixed(1);

  return (
    <article
      className={styles.recommendationCard}
      data-design-selected={selected}
      data-tarot-recommendation={rank}
    >
      <button
        aria-label={selected ? `已选择 ${design.designName}` : `选择 ${design.designName}`}
        aria-pressed={selected}
        className={styles.recommendationSelect}
        disabled={disabled}
        onClick={() => onSelect(design.designId)}
        type="button"
      >
        <span className={styles.recommendationRank}>{String(rank).padStart(2, "0")}</span>
        <strong>{design.designName}</strong>
        <span className={styles.selectionIndicator} aria-hidden="true">{selected ? "已选" : "选择"}</span>
      </button>

      <div className={styles.recommendationPreview}>
        <BraceletPreview compact design={design} />
      </div>

      <div className={styles.recommendationBody}>
        <div className={styles.paletteDots} aria-label={`配色 ${design.story.colorPalette.join("、")}`}>
          {design.story.colorPalette.slice(0, 4).map((color) => (
            <span key={color} style={{ backgroundColor: color }} title={color} />
          ))}
        </div>
        <p className={styles.recommendationMaterials}>{materials.join(" · ")}</p>
        <p className={styles.recommendationStory}>{design.story.designStory}</p>
        <div className={styles.recommendationFacts}>
          <span>手围 {wristSize} cm</span>
          <strong>{price}</strong>
        </div>
      </div>
    </article>
  );
}
