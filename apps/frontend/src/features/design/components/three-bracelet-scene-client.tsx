"use client";

import type { PublicDesignV1 } from "@mystcrag/design-contract";
import { designV1ToSceneDescriptor, type MaterialQuality } from "@mystcrag/three-engine";
import { LazyBraceletScene, type ScenePerformanceStats } from "@mystcrag/three-engine/react";
import * as React from "react";

export type ThreeBraceletSceneClientProps = {
  readonly design: PublicDesignV1;
  readonly selectedComponentId?: string;
  readonly quality?: MaterialQuality;
  readonly onSelect: (componentId: string) => void;
  readonly onPerformanceStats?: (stats: ScenePerformanceStats) => void;
};

export function ThreeBraceletSceneClient({
  design,
  selectedComponentId,
  quality,
  onSelect,
  onPerformanceStats
}: ThreeBraceletSceneClientProps) {
  const descriptor = React.useMemo(() => designV1ToSceneDescriptor(design), [design]);

  return (
    <div
      className="relative h-[min(74vw,38rem)] min-h-80 w-[min(88vw,48rem)] max-w-full"
      data-design-id={descriptor.designId}
      data-scene-revision={descriptor.revision}
    >
      <LazyBraceletScene
        className="h-full w-full"
        descriptor={descriptor}
        fallback={<p className="grid h-full place-items-center text-sm text-[var(--muted)]" role="status">正在初始化 3D 场景…</p>}
        onPerformanceStats={onPerformanceStats}
        onSelectComponent={onSelect}
        quality={quality}
        selectedComponentId={selectedComponentId}
      />
      {descriptor.warnings.length > 0 ? (
        <p className="absolute inset-x-4 bottom-3 rounded-full bg-white/80 px-4 py-2 text-center text-xs text-[var(--muted)]" data-error-code="THREE_ASSET_FALLBACK" role="status">
          {descriptor.warnings.length} 个资源使用程序化替代外观
        </p>
      ) : null}
    </div>
  );
}
