import Image from "next/image";
import * as React from "react";

const MATERIAL_FILTERS: Array<[string, string]> = [
  ["aquamarine", "sepia(.22) saturate(2.35) hue-rotate(142deg) brightness(1.04)"],
  ["moonstone", "sepia(.12) saturate(1.45) hue-rotate(170deg) brightness(1.04)"],
  ["amethyst", "sepia(.52) saturate(3.25) hue-rotate(218deg) brightness(.76)"],
  ["rose", "sepia(.42) saturate(2.25) hue-rotate(292deg) brightness(1.02)"],
  ["rhodonite", "sepia(.55) saturate(2.7) hue-rotate(294deg) brightness(.78)"],
  ["citrine", "sepia(.72) saturate(2.5) hue-rotate(345deg) brightness(.93)"],
  ["sunstone", "sepia(.72) saturate(2.75) hue-rotate(328deg) brightness(.9)"],
  ["aventurine", "sepia(.48) saturate(1.85) hue-rotate(78deg) brightness(.83)"],
  ["amazonite", "sepia(.38) saturate(2.05) hue-rotate(112deg) brightness(.94)"],
  ["fluorite", "sepia(.42) saturate(2.1) hue-rotate(105deg) brightness(.86)"],
  ["lapis", "sepia(.74) saturate(4.5) hue-rotate(166deg) brightness(.5)"],
  ["garnet", "sepia(.9) saturate(4.8) hue-rotate(292deg) brightness(.44)"],
  ["red-agate", "sepia(.88) saturate(4.3) hue-rotate(306deg) brightness(.62)"],
  ["onyx", "grayscale(1) brightness(.28) contrast(1.5)"],
  ["obsidian", "grayscale(1) brightness(.22) contrast(1.65)"],
  ["tiger-eye", "sepia(.78) saturate(2.35) hue-rotate(350deg) brightness(.63)"],
  ["smoky", "sepia(.46) saturate(.75) brightness(.67)"],
  ["labradorite", "sepia(.2) saturate(1.15) hue-rotate(155deg) brightness(.67)"],
  ["quartz", "none"]
];

export function crystalFilter(materialKey: string): string {
  return MATERIAL_FILTERS.find(([key]) => materialKey.includes(key))?.[1] ?? "sepia(.18) saturate(1.2) hue-rotate(190deg)";
}

export function CrystalBeadImage({
  materialKey,
  alt,
  sizes = "64px",
  priority = false
}: {
  materialKey: string;
  alt: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <span
      aria-hidden={alt ? undefined : true}
      className="relative block h-full w-full drop-shadow-[0_7px_6px_rgb(57_45_67/0.22)]"
      data-photo-real-bead="true"
    >
      <Image
        alt={alt}
        className="h-full w-full scale-[1.34] object-cover"
        height={512}
        fetchPriority={priority ? "high" : "auto"}
        loading="eager"
        sizes={sizes}
        src="/beads/crystal-bead-base.png"
        style={{ clipPath: "circle(36.5% at 50% 49.5%)", filter: crystalFilter(materialKey) }}
        width={512}
      />
    </span>
  );
}
