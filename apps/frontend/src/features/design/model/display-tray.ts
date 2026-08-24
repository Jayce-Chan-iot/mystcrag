export const DISPLAY_TRAY_OPTIONS = [
  { id: "ACRYLIC_CLEAR", label: "透明亚克力" },
  { id: "BONE_CHINA", label: "米白骨瓷" },
  { id: "WOOD", label: "原木" },
  { id: "FRENCH_LINEN", label: "法式亚麻" }
] as const;

export type DisplayTrayMaterial = (typeof DISPLAY_TRAY_OPTIONS)[number]["id"];

const DISPLAY_TRAY_CANVAS_PALETTES: Record<DisplayTrayMaterial, { surface: string; rim: string; highlight: string }> = {
  ACRYLIC_CLEAR: { surface: "#edf1ef", rim: "#cfd7d3", highlight: "#ffffff" },
  BONE_CHINA: { surface: "#f6f0e7", rim: "#d8cec0", highlight: "#fffdfa" },
  WOOD: { surface: "#c99567", rim: "#93603d", highlight: "#e1bb91" },
  FRENCH_LINEN: { surface: "#d9cebd", rim: "#b9aa94", highlight: "#ede5da" }
};

export function displayTrayCanvasPalette(material: DisplayTrayMaterial) {
  return DISPLAY_TRAY_CANVAS_PALETTES[material];
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const DEFAULT_DISPLAY_TRAY: DisplayTrayMaterial = "BONE_CHINA";
const DISPLAY_TRAY_STORAGE_PREFIX = "mystcrag:display-tray:";
const DISPLAY_TRAY_RADIUS_RATIO = 0.47;

function browserStorage(): StorageLike | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function isDisplayTrayMaterial(value: string | null): value is DisplayTrayMaterial {
  return DISPLAY_TRAY_OPTIONS.some((option) => option.id === value);
}

export function displayTrayStorageKey(designId: string): string {
  return `${DISPLAY_TRAY_STORAGE_PREFIX}${designId}`;
}

export function loadDisplayTray(
  designId: string,
  storage: StorageLike | undefined = browserStorage()
): DisplayTrayMaterial {
  if (!storage) return DEFAULT_DISPLAY_TRAY;
  try {
    const stored = storage.getItem(displayTrayStorageKey(designId));
    return isDisplayTrayMaterial(stored) ? stored : DEFAULT_DISPLAY_TRAY;
  } catch {
    return DEFAULT_DISPLAY_TRAY;
  }
}

export function saveDisplayTray(
  designId: string,
  material: DisplayTrayMaterial,
  storage: StorageLike | undefined = browserStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(displayTrayStorageKey(designId), material);
  } catch {
    // The display preference is optional; storage denial must not block editing.
  }
}

export function isPointOutsideTray(
  point: { x: number; y: number },
  rect: { width: number; height: number },
  radiusRatio = DISPLAY_TRAY_RADIUS_RATIO
): boolean {
  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const trayRadius = Math.min(rect.width, rect.height) * radiusRatio;
  return Math.hypot(point.x - centerX, point.y - centerY) > trayRadius;
}
