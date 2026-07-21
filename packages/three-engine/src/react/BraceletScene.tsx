import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, PMREMGenerator } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

import { AdaptiveDpr } from "../runtime/adaptive-dpr";
import { MATERIAL_QUALITY_PROFILES, type MaterialQuality } from "../runtime/quality";
import type { BraceletSceneDescriptor, RenderItem } from "../runtime/scene-descriptor";
import {
  createSceneResourceBundle,
  disposeSceneResourceBundle,
  geometryCacheKey
} from "./scene-resources";

export type ScenePerformanceStats = {
  readonly initializationMs: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly materialCount: number;
  readonly textureCount: number;
  readonly dpr: number;
  readonly quality: MaterialQuality;
};

export type BraceletSceneProps = {
  readonly descriptor: BraceletSceneDescriptor;
  readonly selectedComponentId?: string;
  readonly quality: MaterialQuality;
  readonly onSelectComponent?: (componentId: string) => void;
  readonly onPerformanceStats?: (stats: ScenePerformanceStats) => void;
};

type InstanceGroup = {
  readonly key: string;
  readonly items: readonly RenderItem[];
};

function groupInstances(items: readonly RenderItem[], quality: MaterialQuality): InstanceGroup[] {
  const groups = new Map<string, RenderItem[]>();
  for (const item of items) {
    const key = `${geometryCacheKey(item.geometry)}|${quality}:${item.materialKey}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups].map(([key, groupedItems]) => ({ key, items: groupedItems }));
}

function InstanceMeshGroup({
  group,
  quality,
  resources,
  onSelect
}: {
  readonly group: InstanceGroup;
  readonly quality: MaterialQuality;
  readonly resources: ReturnType<typeof createSceneResourceBundle>;
  readonly onSelect?: (componentId: string) => void;
}) {
  const mesh = useRef<InstancedMesh>(null);
  const first = group.items[0]!;
  const geometry = resources.geometries.acquire(geometryCacheKey(first.geometry), () => {
    throw new Error("Geometry cache was not primed");
  });
  const material = resources.materials.acquire(`${quality}:${first.materialKey}`, () => {
    throw new Error("Material cache was not primed");
  });
  useEffect(() => {
    const temporary = new Object3D();
    group.items.forEach((item, index) => {
      temporary.position.set(
        item.transform.position.x,
        item.transform.position.y,
        item.transform.position.z
      );
      temporary.rotation.set(
        item.transform.rotation.x,
        item.transform.rotation.y,
        item.transform.rotation.z
      );
      temporary.scale.set(item.transform.scale.x, item.transform.scale.y, item.transform.scale.z);
      temporary.updateMatrix();
      mesh.current?.setMatrixAt(index, temporary.matrix);
    });
    if (mesh.current) mesh.current.instanceMatrix.needsUpdate = true;
  }, [group.items]);
  useEffect(
    () => () => {
      resources.geometries.release(geometryCacheKey(first.geometry));
      resources.materials.release(`${quality}:${first.materialKey}`);
    }, [first.geometry, first.materialKey, quality, resources]
  );
  const handlePointer = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    const item = event.instanceId === undefined ? undefined : group.items[event.instanceId];
    if (item?.componentType === "BEAD") onSelect?.(item.componentId);
  };
  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, material, group.items.length]}
      onClick={handlePointer}
      castShadow
      receiveShadow
    />
  );
}

function SelectionHighlight({ item }: { readonly item: RenderItem }) {
  const matrix = useMemo(() => {
    const value = new Matrix4();
    const object = new Object3D();
    object.position.set(item.transform.position.x, item.transform.position.y, item.transform.position.z);
    object.rotation.set(item.transform.rotation.x, item.transform.rotation.y, item.transform.rotation.z);
    object.scale.setScalar(1.16);
    object.updateMatrix();
    value.copy(object.matrix);
    return value;
  }, [item]);
  const geometry = useMemo(() => {
    const bundle = createSceneResourceBundle([item], "LOW");
    const key = bundle.geometryKeys[0]!;
    const value = bundle.geometries.acquire(key, () => {
      throw new Error("Selection geometry cache was not primed");
    });
    return { bundle, value };
  }, [item]);
  const material = useMemo(
    () => new MeshBasicMaterial({ color: 0x8b5cf6, wireframe: true, transparent: true, opacity: 0.9 }),
    []
  );
  useEffect(
    () => () => {
      geometry.bundle.geometries.clear();
      geometry.bundle.materials.clear();
      material.dispose();
    }, [geometry, material]
  );
  return <mesh geometry={geometry.value} material={material} matrix={matrix} matrixAutoUpdate={false} />;
}

function RuntimeController({
  quality,
  initializationStartedAt,
  materialCount,
  onStats
}: {
  readonly quality: MaterialQuality;
  readonly initializationStartedAt: number;
  readonly materialCount: number;
  readonly onStats?: (stats: ScenePerformanceStats) => void;
}) {
  const { gl, setDpr } = useThree();
  const controller = useMemo(
    () => new AdaptiveDpr({ maxDpr: MATERIAL_QUALITY_PROFILES[quality].maxDpr }),
    [quality]
  );
  const frames = useRef(0);
  const elapsed = useRef(0);
  const reported = useRef(false);
  useFrame((_, delta) => {
    frames.current += 1;
    elapsed.current += delta;
    if (frames.current % 30 === 0) {
      const dpr = controller.sample(30 / elapsed.current);
      setDpr(dpr);
      elapsed.current = 0;
    }
    if (!reported.current && frames.current >= 2) {
      reported.current = true;
      onStats?.({
        initializationMs: Number((performance.now() - initializationStartedAt).toFixed(2)),
        drawCalls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        materialCount,
        textureCount: gl.info.memory.textures,
        dpr: gl.getPixelRatio(),
        quality
      });
    }
  });
  return null;
}

function StudioEnvironment({ quality }: { readonly quality: MaterialQuality }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    if (quality === "LOW") {
      scene.environment = null;
      return;
    }
    const generator = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, quality === "HIGH" ? 0.06 : 0.12);
    scene.environment = target.texture;
    return () => {
      scene.environment = null;
      target.dispose();
      room.dispose();
      generator.dispose();
    };
  }, [gl, quality, scene]);
  return null;
}

export function BraceletScene({
  descriptor,
  selectedComponentId,
  quality,
  onSelectComponent,
  onPerformanceStats
}: BraceletSceneProps) {
  const initializationStartedAt = useMemo(() => performance.now(), [descriptor, quality]);
  const resources = useMemo(
    () => createSceneResourceBundle(descriptor.renderItems, quality),
    [descriptor, quality]
  );
  useEffect(() => () => disposeSceneResourceBundle(resources), [resources]);
  const groups = useMemo(
    () => groupInstances(descriptor.renderItems, quality),
    [descriptor.renderItems, quality]
  );
  const selected = descriptor.renderItems.find((item) => item.componentId === selectedComponentId);
  return (
    <>
      <ambientLight intensity={quality === "LOW" ? 1.1 : 0.65} />
      <directionalLight position={[30, 42, 55]} intensity={1.7} castShadow={quality !== "LOW"} />
      <directionalLight position={[-35, -20, 28]} intensity={0.7} />
      {groups.map((group) => (
        <InstanceMeshGroup
          key={group.key}
          group={group}
          quality={quality}
          resources={resources}
          onSelect={onSelectComponent}
        />
      ))}
      {selected ? <SelectionHighlight item={selected} /> : null}
      <StudioEnvironment quality={quality} />
      <RuntimeController
        quality={quality}
        initializationStartedAt={initializationStartedAt}
        materialCount={resources.materials.size}
        onStats={onPerformanceStats}
      />
    </>
  );
}
