import { Canvas, useThree } from "@react-three/fiber";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { isMobileViewport, resolveMaterialQuality, MATERIAL_QUALITY_PROFILES, type MaterialQuality } from "../runtime/quality";
import type { BraceletSceneDescriptor } from "../runtime/scene-descriptor";
import { BraceletScene, type ScenePerformanceStats } from "./BraceletScene";

export type BraceletCanvasProps = {
  readonly descriptor: BraceletSceneDescriptor;
  readonly selectedComponentId?: string;
  readonly quality?: MaterialQuality;
  readonly className?: string;
  readonly onSelectComponent?: (componentId: string) => void;
  readonly onPerformanceStats?: (stats: ScenePerformanceStats) => void;
};

function CameraControls() {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 55;
    controls.maxDistance = 180;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.8;
    controls.update();
    controlsRef.current = controls;
    return () => {
      controlsRef.current = null;
      controls.dispose();
    };
  }, [camera, gl]);
  useFrame(() => controlsRef.current?.update());
  return null;
}

function detectMobile(): boolean {
  if (typeof window === "undefined") return false;
  return isMobileViewport(
    window.innerWidth,
    typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches
  );
}

export default function BraceletCanvas({
  descriptor,
  selectedComponentId,
  quality: requestedQuality,
  className,
  onSelectComponent,
  onPerformanceStats
}: BraceletCanvasProps) {
  const quality = resolveMaterialQuality(requestedQuality, detectMobile());
  const maxDpr = MATERIAL_QUALITY_PROFILES[quality].maxDpr;
  return (
    <div className={className} style={{ width: "100%", height: "100%", minHeight: 320 }}>
      <Canvas
        dpr={[0.75, maxDpr]}
        camera={{ position: [0, 0, 92], fov: 42, near: 0.1, far: 500 }}
        gl={{ antialias: quality !== "LOW", alpha: true, powerPreference: "high-performance" }}
        shadows={quality !== "LOW"}
      >
        <BraceletScene
          descriptor={descriptor}
          selectedComponentId={selectedComponentId}
          quality={quality}
          onSelectComponent={onSelectComponent}
          onPerformanceStats={onPerformanceStats}
        />
        <CameraControls />
      </Canvas>
    </div>
  );
}
