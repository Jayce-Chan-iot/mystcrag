import type { BackendModule } from "../module.js";

export const designModule = {
  name: "design",
  description: "Bracelet design lifecycle boundary."
} satisfies BackendModule;

export * from "./design.service.js";
export * from "./design-api.service.js";
export * from "./inventory.service.js";
export * from "./pricing.service.js";
