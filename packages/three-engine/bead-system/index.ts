export type BeadGeometryDescriptor = {
  readonly id: string;
  readonly diameterMm: number;
  readonly assetUrl?: string;
};

export interface BeadSystem {
  getGeometry(id: string): BeadGeometryDescriptor | undefined;
}
