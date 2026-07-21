export type CrystalMaterialPreset = {
  readonly id: string;
  readonly transmission: number;
  readonly roughness: number;
  readonly indexOfRefraction: number;
};

export interface MaterialSystem {
  getPreset(id: string): CrystalMaterialPreset | undefined;
}
