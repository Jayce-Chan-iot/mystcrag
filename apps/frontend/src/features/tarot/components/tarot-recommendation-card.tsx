import type { PublicDesignV1 } from "@mystcrag/design-contract";

import { BraceletPreview } from "../../design/components/bracelet-preview";
import { formatMinorAmount } from "../../design/model/format-minor-amount";
import { tarotStyles as styles } from "../tarot-styles";

const CRYSTAL_NAMES: Readonly<Record<string, string>> = {
  "crystal-aquamarine": "海蓝宝",
  "crystal-moonstone": "月光石",
  "crystal-clear-quartz": "白水晶",
  "crystal-amethyst": "紫水晶",
  "crystal-kunzite": "紫锂辉石",
  "crystal-blue-lace-agate": "蓝纹玛瑙"
};

export function getDesignMaterialNames(design: PublicDesignV1): readonly string[] {
  return [...new Set(design.beads.map((bead) =>
    CRYSTAL_NAMES[bead.crystalId] ?? bead.crystalId.replace(/^crystal-/, "").replaceAll("-", " ")
  ))];
}

export function TarotRecommendationCard({
  design,
  rank,
  selected,
  disabled = false,
  onSelect
}: Readonly<{
  design: PublicDesignV1;
  rank: number;
  selected: boolean;
  disabled?: boolean;
  onSelect(designId: string): void;
}>) {
  const materials = getDesignMaterialNames(design);
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
