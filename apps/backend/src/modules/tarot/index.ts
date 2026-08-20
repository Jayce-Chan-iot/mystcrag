import type { BackendModule } from "../module.js";

export const tarotModule: BackendModule = {
  name: "tarot",
  description: "Authenticated Tarot draw and restore lifecycle"
};

export { registerTarotRoutes } from "./tarot.routes.js";
export { TarotService } from "./tarot.service.js";
export type { TarotApiService, TarotDesignReader } from "./tarot.types.js";
