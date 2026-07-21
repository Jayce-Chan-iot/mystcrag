import type { BackendModule } from "../module.js";

export const orderModule = {
  name: "order",
  description: "Production order boundary."
} satisfies BackendModule;

export * from "./order.service.js";
