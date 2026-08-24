import type { DisplayTrayMaterial } from "./display-tray";

export type BeadVisual = {
  src: string;
  filter: "none";
};

export type TrayVisual = {
  src: string;
  alt: string;
};

const BEAD_VISUALS = {
  clear: { src: "/beads/photographic/clear-quartz.webp", filter: "none" },
  aquamarine: { src: "/beads/photographic/aquamarine.webp", filter: "none" },
  moonstone: { src: "/beads/photographic/moonstone.webp", filter: "none" },
  amethyst: { src: "/beads/photographic/amethyst.webp", filter: "none" },
  smoky: { src: "/beads/photographic/smoky-quartz.webp", filter: "none" },
  roseQuartz: { src: "/beads/photographic/rose-quartz.webp", filter: "none" },
  garnet: { src: "/beads/photographic/garnet.webp", filter: "none" },
  citrine: { src: "/beads/photographic/citrine.webp", filter: "none" },
  lapisLazuli: { src: "/beads/photographic/lapis-lazuli.webp", filter: "none" },
  obsidian: { src: "/beads/photographic/obsidian.webp", filter: "none" },
  blackOnyx: { src: "/beads/photographic/black-onyx.webp", filter: "none" },
  tigerEye: { src: "/beads/photographic/tiger-eye.webp", filter: "none" },
  amazonite: { src: "/beads/photographic/amazonite.webp", filter: "none" },
  labradorite: { src: "/beads/photographic/labradorite.webp", filter: "none" },
  sunstone: { src: "/beads/photographic/sunstone.webp", filter: "none" },
  redAgate: { src: "/beads/photographic/red-agate.webp", filter: "none" },
  greenAventurine: { src: "/beads/photographic/green-aventurine.webp", filter: "none" },
  fluorite: { src: "/beads/photographic/fluorite.webp", filter: "none" },
  prehnite: { src: "/beads/photographic/prehnite.webp", filter: "none" },
  rhodonite: { src: "/beads/photographic/rhodonite.webp", filter: "none" }
} as const satisfies Record<string, BeadVisual>;

const TRAY_VISUALS: Record<DisplayTrayMaterial, TrayVisual> = {
  ACRYLIC_CLEAR: { src: "/trays/clear-acrylic.webp", alt: "透明亚克力展示托盘" },
  BONE_CHINA: { src: "/trays/bone-china.webp", alt: "米白骨瓷展示托盘" },
  WOOD: { src: "/trays/oak-wood.webp", alt: "原木展示托盘" },
  FRENCH_LINEN: { src: "/trays/french-linen.webp", alt: "法式亚麻展示托盘" }
};

export function getBeadVisual(materialKey: string): BeadVisual {
  if (materialKey.includes("aquamarine")) return BEAD_VISUALS.aquamarine;
  if (materialKey.includes("moonstone")) return BEAD_VISUALS.moonstone;
  if (materialKey.includes("amethyst")) return BEAD_VISUALS.amethyst;
  if (materialKey.includes("smoky")) return BEAD_VISUALS.smoky;
  if (materialKey.includes("rose-quartz")) return BEAD_VISUALS.roseQuartz;
  if (materialKey.includes("garnet")) return BEAD_VISUALS.garnet;
  if (materialKey.includes("citrine")) return BEAD_VISUALS.citrine;
  if (materialKey.includes("lapis")) return BEAD_VISUALS.lapisLazuli;
  if (materialKey.includes("obsidian")) return BEAD_VISUALS.obsidian;
  if (materialKey.includes("black-onyx")) return BEAD_VISUALS.blackOnyx;
  if (materialKey.includes("tiger-eye")) return BEAD_VISUALS.tigerEye;
  if (materialKey.includes("amazonite")) return BEAD_VISUALS.amazonite;
  if (materialKey.includes("labradorite")) return BEAD_VISUALS.labradorite;
  if (materialKey.includes("sunstone")) return BEAD_VISUALS.sunstone;
  if (materialKey.includes("red-agate")) return BEAD_VISUALS.redAgate;
  if (materialKey.includes("green-aventurine")) return BEAD_VISUALS.greenAventurine;
  if (materialKey.includes("fluorite")) return BEAD_VISUALS.fluorite;
  if (materialKey.includes("prehnite")) return BEAD_VISUALS.prehnite;
  if (materialKey.includes("rhodonite")) return BEAD_VISUALS.rhodonite;
  return BEAD_VISUALS.clear;
}

export function getTrayVisual(material: DisplayTrayMaterial): TrayVisual {
  return TRAY_VISUALS[material];
}
