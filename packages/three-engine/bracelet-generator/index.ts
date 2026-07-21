import type { BraceletConfiguration } from "../contracts";
import type { BraceletSceneDescriptor } from "../src/runtime/scene-descriptor";

export type { BraceletSceneDescriptor } from "../src/runtime/scene-descriptor";

/** @deprecated Use designV1ToSceneDescriptor with the shared DesignV1 contract. */
export interface BraceletGenerator {
  createDescriptor(configuration: BraceletConfiguration): BraceletSceneDescriptor;
}
