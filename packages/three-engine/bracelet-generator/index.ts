import type { BraceletConfiguration } from "../contracts";

export type BraceletSceneDescriptor = {
  readonly configuration: BraceletConfiguration;
  readonly targetFrameRate: { readonly min: 30; readonly max: 60 };
};

export interface BraceletGenerator {
  createDescriptor(configuration: BraceletConfiguration): BraceletSceneDescriptor;
}
