export type NumericVector3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export type NumericTransform = {
  readonly position: NumericVector3;
  readonly rotation: NumericVector3;
  readonly scale: NumericVector3;
  readonly radialOffsetMm: number;
};

export type RenderGeometry =
  | { readonly kind: "SPHERE"; readonly diameterMm: number }
  | { readonly kind: "CYLINDER"; readonly diameterMm: number; readonly depthMm: number }
  | {
      readonly kind: "BOX";
      readonly widthMm: number;
      readonly heightMm: number;
      readonly depthMm: number;
    };

export type RenderItem = {
  readonly componentId: string;
  readonly componentType: "BEAD" | "ACCESSORY";
  readonly accessoryType?: "SPACER" | "PENDANT" | "METAL_PART" | "CONNECTOR";
  readonly placementMode: "INLINE" | "ANCHORED";
  readonly sequenceIndex: number;
  readonly anchorComponentId?: string;
  readonly anchorSlot?: number;
  readonly transform: NumericTransform;
  readonly geometryKey: string;
  readonly geometry: RenderGeometry;
  readonly materialKey: string;
  readonly textureAssetKey?: string;
  readonly assetStatus: "AVAILABLE" | "FALLBACK";
  readonly interactionState: {
    readonly selectable: true;
    readonly draggable: false;
  };
};

export type BraceletGeometryDescriptor = {
  readonly targetInnerCircumferenceMm: number;
  readonly braceletRadiusMm: number;
  readonly beadGapMm: number;
};

export type SceneConversionWarning = {
  readonly code: "ASSET_NOT_FOUND";
  readonly componentId: string;
  readonly assetKey: string;
  readonly message: string;
};

export type BraceletSceneDescriptor = {
  readonly designId: string;
  readonly revision: number;
  readonly layout: "CIRCLE";
  readonly geometry: BraceletGeometryDescriptor;
  readonly renderItems: readonly RenderItem[];
  readonly cameraPreset: "JEWELRY_ORBIT";
  readonly environmentPreset: "SOFT_STUDIO";
  readonly warnings: readonly SceneConversionWarning[];
};
