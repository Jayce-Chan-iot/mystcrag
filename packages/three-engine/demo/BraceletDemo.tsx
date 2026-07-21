import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";
import { useMemo, useState } from "react";

import { designV1ToSceneDescriptor } from "../src/adapters/design-v1-to-scene-descriptor";
import { replacePreviewComponent, type PreviewReplacement } from "../src/interactions/replace-preview";
import { LazyBraceletScene } from "../src/react/LazyBraceletScene";
import type { ScenePerformanceStats } from "../src/react/BraceletScene";
import type { MaterialQuality } from "../src/runtime/quality";
import type { BraceletSceneDescriptor } from "../src/runtime/scene-descriptor";

const MATERIAL_OPTIONS: readonly { readonly label: string; readonly value: PreviewReplacement }[] = [
  {
    label: "海蓝宝 8mm",
    value: {
      materialKey: "aquamarine-clear-v1",
      textureAssetKey: "aquamarine-clear-texture-v1",
      geometryKey: "sphere-round-8mm-v1",
      geometry: { kind: "SPHERE", diameterMm: 8 }
    }
  },
  {
    label: "月光石 6mm",
    value: {
      materialKey: "moonstone-soft-v1",
      textureAssetKey: "moonstone-soft-texture-v1",
      geometryKey: "sphere-round-6mm-v1",
      geometry: { kind: "SPHERE", diameterMm: 6 }
    }
  },
  {
    label: "白水晶 10mm",
    value: {
      materialKey: "clear-quartz-v1",
      textureAssetKey: "clear-quartz-texture-v1",
      geometryKey: "sphere-round-10mm-v1",
      geometry: { kind: "SPHERE", diameterMm: 10 }
    }
  }
];

export function BraceletDemo() {
  const initial = useMemo(() => designV1ToSceneDescriptor(standardAiDesignFixture), []);
  const [descriptor, setDescriptor] = useState<BraceletSceneDescriptor>(initial);
  const [selectedComponentId, setSelectedComponentId] = useState<string>();
  const [quality, setQuality] = useState<MaterialQuality>("MEDIUM");
  const [stats, setStats] = useState<ScenePerformanceStats>();
  const replaceSelected = (replacement: PreviewReplacement) => {
    if (!selectedComponentId) return;
    setDescriptor((current) => replacePreviewComponent(current, selectedComponentId, replacement));
  };
  return (
    <section style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)", color: "#292524" }}>
      <div style={{ height: "min(68vh, 640px)", minHeight: 360, borderRadius: 24, background: "#f7f3eb" }}>
        <LazyBraceletScene
          descriptor={descriptor}
          selectedComponentId={selectedComponentId}
          quality={quality}
          onSelectComponent={setSelectedComponentId}
          onPerformanceStats={setStats}
          fallback={<div style={{ padding: 24 }}>正在加载 3D 场景…</div>}
        />
      </div>
      <div aria-live="polite">
        当前选中：{selectedComponentId ?? "请点击一颗珠子"}
      </div>
      {stats ? (
        <output>
          {stats.quality} · {stats.initializationMs}ms · {stats.drawCalls} draw calls · {stats.triangles} triangles · {stats.materialCount} materials · {stats.textureCount} textures · DPR {stats.dpr}
        </output>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {MATERIAL_OPTIONS.map((option) => (
          <button key={option.label} type="button" disabled={!selectedComponentId} onClick={() => replaceSelected(option.value)}>
            替换为{option.label}
          </button>
        ))}
      </div>
      <label>
        画质：
        <select value={quality} onChange={(event) => setQuality(event.target.value as MaterialQuality)}>
          <option value="LOW">LOW</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="HIGH">HIGH（移动端自动降为 LOW）</option>
        </select>
      </label>
    </section>
  );
}
