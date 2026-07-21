import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  MeshPhysicalMaterial,
  SphereGeometry
} from "three";

import { AssetCache } from "../runtime/asset-cache";
import { MATERIAL_QUALITY_PROFILES, type MaterialQuality } from "../runtime/quality";
import type { RenderGeometry, RenderItem } from "../runtime/scene-descriptor";

export type SceneResourceBundle = {
  readonly geometries: AssetCache<BufferGeometry>;
  readonly materials: AssetCache<MeshPhysicalMaterial>;
  readonly geometryKeys: readonly string[];
  readonly materialKeys: readonly string[];
};

export function geometryCacheKey(geometry: RenderGeometry): string {
  return JSON.stringify(geometry);
}

function createGeometry(geometry: RenderGeometry, quality: MaterialQuality): BufferGeometry {
  const segments = quality === "LOW" ? 16 : quality === "MEDIUM" ? 28 : 40;
  if (geometry.kind === "SPHERE") {
    return new SphereGeometry(geometry.diameterMm / 2, segments, Math.max(12, segments / 2));
  }
  if (geometry.kind === "CYLINDER") {
    return new CylinderGeometry(
      geometry.diameterMm / 2,
      geometry.diameterMm / 2,
      geometry.depthMm,
      segments
    );
  }
  return new BoxGeometry(geometry.widthMm, geometry.heightMm, geometry.depthMm);
}

function stableColor(key: string): number {
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const saturation = key.includes("SILVER") ? 8 : 38;
  return hslToHex(hue, saturation, key.includes("SILVER") ? 72 : 64);
}

function hslToHex(hue: number, saturation: number, lightness: number): number {
  const s = saturation / 100;
  const l = lightness / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const section = hue / 60;
  const x = chroma * (1 - Math.abs((section % 2) - 1));
  const [red, green, blue] =
    section < 1 ? [chroma, x, 0] :
    section < 2 ? [x, chroma, 0] :
    section < 3 ? [0, chroma, x] :
    section < 4 ? [0, x, chroma] :
    section < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const match = l - chroma / 2;
  return (
    (Math.round((red + match) * 255) << 16) |
    (Math.round((green + match) * 255) << 8) |
    Math.round((blue + match) * 255)
  );
}

function createMaterial(key: string, quality: MaterialQuality): MeshPhysicalMaterial {
  const profile = MATERIAL_QUALITY_PROFILES[quality];
  const metallic = key.includes("SILVER") || key.includes("METAL");
  return new MeshPhysicalMaterial({
    color: stableColor(key),
    metalness: metallic ? 0.85 : 0.05,
    roughness: metallic ? 0.16 : profile.roughness,
    transmission: metallic ? 0 : profile.transmission,
    thickness: metallic ? 0 : quality === "HIGH" ? 3 : 1,
    ior: metallic ? 1.5 : profile.indexOfRefraction,
    envMapIntensity: profile.environmentIntensity,
    transparent: !metallic,
    opacity: quality === "LOW" && !metallic ? 0.82 : 1
  });
}

export function createSceneResourceBundle(
  items: readonly RenderItem[],
  quality: MaterialQuality
): SceneResourceBundle {
  const geometries = new AssetCache<BufferGeometry>();
  const materials = new AssetCache<MeshPhysicalMaterial>();
  const geometryKeys = [...new Set(items.map((item) => geometryCacheKey(item.geometry)))];
  const materialKeys = [...new Set(items.map((item) => `${quality}:${item.materialKey}`))];
  for (const key of geometryKeys) {
    const geometry = items.find((item) => geometryCacheKey(item.geometry) === key)!.geometry;
    geometries.acquire(key, () => createGeometry(geometry, quality));
  }
  for (const key of materialKeys) {
    const materialKey = key.slice(quality.length + 1);
    materials.acquire(key, () => createMaterial(materialKey, quality));
  }
  return { geometries, materials, geometryKeys, materialKeys };
}

export function disposeSceneResourceBundle(bundle: SceneResourceBundle): void {
  bundle.geometries.clear();
  bundle.materials.clear();
}
