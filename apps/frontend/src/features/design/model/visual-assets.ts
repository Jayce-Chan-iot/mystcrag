import type { DisplayTrayMaterial } from "./display-tray";

/**
 * The public delivery contract allows exactly one key shape: `approved:` plus
 * the lowercase hex SHA-256 of the delivered bytes. Anything else — legacy
 * texture ids, archive keys, upper-case or wrong-length digests — can never be
 * resolved publicly and must fall back to the static photographic mapping. No
 * code path may derive an approved key from a material name.
 */
export const APPROVED_ASSET_KEY_PATTERN = /^approved:[0-9a-f]{64}$/;

export function isApprovedAssetKey(value: unknown): value is string {
  return typeof value === "string" && APPROVED_ASSET_KEY_PATTERN.test(value);
}

/** The same-origin public route that serves one approved asset. */
export function publicAssetUrlFor(assetKey: string): string {
  return `/api/assets/${encodeURIComponent(assetKey)}`;
}

export type BeadVisualSource = "approved" | "photographic";

export type BeadVisual = {
  /** The visual to render first: the approved asset when its key is valid. */
  src: string;
  filter: "none";
  /** How the primary was chosen, so views can reason about fallbacks. */
  source: BeadVisualSource;
  /** The static photographic surface to switch to when the primary fails. */
  fallbackSrc: string;
};

/** The static table only ever describes the photographic surfaces. */
type PhotographicBeadVisual = Pick<BeadVisual, "src" | "filter">;

/**
 * The subset of an <img> element the export loader drives. The handlers stay
 * `unknown` because real DOM handler signatures and the test doubles assign in
 * both directions; the loader only ever sets them and never reads them back.
 */
export type LoadableImageElement = {
  src: string;
  onload: unknown;
  onerror: unknown;
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
} as const satisfies Record<string, PhotographicBeadVisual>;

const TRAY_VISUALS: Record<DisplayTrayMaterial, TrayVisual> = {
  ACRYLIC_CLEAR: { src: "/trays/clear-acrylic.webp", alt: "透明亚克力展示托盘" },
  BONE_CHINA: { src: "/trays/bone-china.webp", alt: "米白骨瓷展示托盘" },
  WOOD: { src: "/trays/oak-wood.webp", alt: "原木展示托盘" },
  FRENCH_LINEN: { src: "/trays/french-linen.webp", alt: "法式亚麻展示托盘" }
};

export function getBeadVisual(materialKey: string, textureAssetKey?: string | null): BeadVisual {
  const fallback = staticBeadVisual(materialKey);
  if (isApprovedAssetKey(textureAssetKey)) {
    return { src: publicAssetUrlFor(textureAssetKey), filter: "none", source: "approved", fallbackSrc: fallback.src };
  }
  return { src: fallback.src, filter: "none", source: "photographic", fallbackSrc: fallback.src };
}

function staticBeadVisual(materialKey: string): BeadVisual {
  const visual = beadVisualOf(materialKey);
  return { src: visual.src, filter: "none", source: "photographic", fallbackSrc: visual.src };
}

function beadVisualOf(materialKey: string): PhotographicBeadVisual {
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

/**
 * One attempt to load an <img>-like element for the canvas export. The image
 * factory is injected so tests drive real onload/onerror handlers.
 */
function loadImageElement<T extends LoadableImageElement>(
  src: string,
  options: { createImage: () => T }
): Promise<T> {
  return new Promise((resolve, reject) => {
    const image = options.createImage();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("导出失败：无法加载珠子图片。"));
    image.src = src;
  });
}

/**
 * At most a two-step load for the export canvas: the primary visual first —
 * the approved asset when one is attached — and, only if the primary differs
 * from the photographic fallback, one fallback attempt. A failing fallback
 * rejects clearly instead of looping or being swallowed.
 */
export async function loadBeadVisualImage<T extends LoadableImageElement>(
  visual: Pick<BeadVisual, "src" | "fallbackSrc">,
  options: { createImage: () => T }
): Promise<T> {
  let primaryError: unknown;
  try {
    return await loadImageElement(visual.src, options);
  } catch (error) {
    primaryError = error;
  }
  if (visual.fallbackSrc === visual.src) {
    throw primaryError;
  }
  try {
    return await loadImageElement(visual.fallbackSrc, options);
  } catch {
    throw new Error("导出失败：珠子图片加载失败，请稍后重试。");
  }
}

export type BeadImagePhase = "PRIMARY" | "FALLBACK";

export type BeadImageEvent = { type: "RESET" } | { type: "ERROR" };

/**
 * The approved-image fallback state machine: a load error switches to the
 * photographic fallback exactly once, and a failing fallback never cycles back
 * to the approved URL. A reset (new key or material) returns to primary.
 */
export function nextBeadImagePhase(phase: BeadImagePhase, event: BeadImageEvent): BeadImagePhase {
  switch (event.type) {
    case "RESET":
      return "PRIMARY";
    case "ERROR":
      return phase === "PRIMARY" ? "FALLBACK" : phase;
  }
}

export function getTrayVisual(material: DisplayTrayMaterial): TrayVisual {
  return TRAY_VISUALS[material];
}
