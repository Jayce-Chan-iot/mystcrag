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

export type RenderItem = {
  readonly componentId: string;
  readonly componentType: "BEAD" | "ACCESSORY";
  readonly sequenceIndex: number;
  readonly anchorComponentId?: string;
  readonly transform: NumericTransform;
  readonly geometryKey: string;
  readonly materialKey: string;
  readonly textureAssetKey?: string;
  readonly interactionState: {
    readonly selected: false;
    readonly hovered: false;
    readonly draggable: true;
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
