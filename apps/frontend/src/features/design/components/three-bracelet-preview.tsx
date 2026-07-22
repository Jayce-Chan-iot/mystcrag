"use client";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import type { MaterialQuality } from "@mystcrag/three-engine";
import type { ScenePerformanceStats } from "@mystcrag/three-engine/react";
import dynamic from "next/dynamic";
import * as React from "react";

import { BraceletPreview } from "./bracelet-preview";
import type { ThreeBraceletSceneClientProps } from "./three-bracelet-scene-client";

const DynamicThreeBraceletScene = dynamic<ThreeBraceletSceneClientProps>(
  async () => {
    if (typeof performance !== "undefined") performance.mark("mystcrag-three-load-start");
    const sceneModule = await import("./three-bracelet-scene-client");
    if (typeof performance !== "undefined") {
      performance.mark("mystcrag-three-load-end");
      performance.measure("mystcrag-three-dynamic-load", "mystcrag-three-load-start", "mystcrag-three-load-end");
    }
    return sceneModule.ThreeBraceletSceneClient;
  },
  {
    ssr: false,
    loading: () => <p className="grid min-h-80 place-items-center text-sm text-[var(--muted)]" role="status">正在加载 3D 引擎…</p>
  }
);

export function supportsWebGl(documentObject: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
  if (!documentObject) return false;
  try {
    const canvas = documentObject.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

class SceneErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Bracelet scene failed", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function AccessibleFallback({
  design,
  selectedComponentId,
  onSelect,
  reason
}: {
  design: PublicDesignV1;
  selectedComponentId?: string;
  onSelect: (componentId: string) => void;
  reason: "WEBGL_UNAVAILABLE" | "SCENE_ERROR";
}) {
  return (
    <div data-scene-fallback={reason}>
      <BraceletPreview design={design} interactive onSelect={onSelect} selectedComponentId={selectedComponentId} />
      <p className="mx-auto -mt-3 max-w-md rounded-full border border-white/80 bg-white/80 px-4 py-2 text-center text-xs text-[var(--muted)]" role="status">
        {reason === "WEBGL_UNAVAILABLE" ? "此设备无法使用 WebGL，已切换为可操作的 2D 预览。" : "3D 场景发生错误，已切换为可操作的 2D 预览。"}
      </p>
    </div>
  );
}

export function ThreeBraceletPreview({
  design,
  selectedComponentId,
  quality,
  onSelect,
  onPerformanceStats,
  webglAvailable
}: {
  design: PublicDesignV1;
  selectedComponentId?: string;
  quality?: MaterialQuality;
  onSelect: (componentId: string) => void;
  onPerformanceStats?: (stats: ScenePerformanceStats) => void;
  webglAvailable?: boolean;
}) {
  const [detectedWebGl, setDetectedWebGl] = React.useState<boolean | null>(webglAvailable ?? null);

  React.useEffect(() => {
    if (webglAvailable !== undefined) return;
    const timer = window.setTimeout(() => setDetectedWebGl(supportsWebGl()), 0);
    return () => window.clearTimeout(timer);
  }, [webglAvailable]);

  if (detectedWebGl === null) {
    return <p className="grid min-h-80 place-items-center text-sm text-[var(--muted)]" role="status">正在检测 3D 能力…</p>;
  }
  if (!detectedWebGl) {
    return <AccessibleFallback design={design} onSelect={onSelect} reason="WEBGL_UNAVAILABLE" selectedComponentId={selectedComponentId} />;
  }

  const errorFallback = <AccessibleFallback design={design} onSelect={onSelect} reason="SCENE_ERROR" selectedComponentId={selectedComponentId} />;
  return (
    <SceneErrorBoundary fallback={errorFallback} key={`${design.designId}:${design.revision}:${quality ?? "AUTO"}`}>
      <DynamicThreeBraceletScene
        design={design}
        onPerformanceStats={onPerformanceStats}
        onSelect={onSelect}
        quality={quality}
        selectedComponentId={selectedComponentId}
      />
    </SceneErrorBoundary>
  );
}
