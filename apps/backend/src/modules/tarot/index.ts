import type { BackendModule } from "../module.js";

export const tarotModule: BackendModule = {
  name: "tarot",
  description: "Authenticated Tarot draw and restore lifecycle"
};

export { registerTarotRoutes } from "./tarot.routes.js";
export {
  DeterministicTarotRecommendationCopyPort,
  TarotAiRecommendationCopyPort,
  TarotService
} from "./tarot.service.js";
export {
  AesGcmTarotQuestionEncryption,
  createTarotQuestionEncryptionFromEnvironment
} from "./tarot-question-encryption.js";
export type {
  TarotApiService,
  TarotCatalogPort,
  TarotDesignPreferences,
  TarotDesignGenerator,
  TarotDesignReader,
  TarotPreferencePort,
  TarotQuestionEncryptionPort,
  TarotRecommendationCopyPort,
  TarotStockPort
} from "./tarot.types.js";
