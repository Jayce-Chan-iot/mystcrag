import Fastify from "fastify";

import type { AuthProvider } from "./auth/auth-provider.js";
import { resolveTarotFeatureEnabled } from "./config/tarot-feature.js";
import { backendModules, tarotModule } from "./modules/index.js";
import {
  registerDesignContractRoutes,
  type DesignApiService
} from "./modules/design/design.routes.js";
import {
  registerRecommendationRoutes,
  type RecommendationApiService
} from "./modules/design/recommendation.routes.js";
import { registerTarotRoutes } from "./modules/tarot/tarot.routes.js";
import type { TarotApiService } from "./modules/tarot/tarot.types.js";

export type CreateAppOptions = {
  readonly designService?: DesignApiService;
  readonly recommendationService?: RecommendationApiService;
  readonly tarotService?: TarotApiService;
  readonly authProvider?: AuthProvider;
  readonly tarotEnabled?: boolean;
  readonly logger?: false | { readonly stream: { write(message: string): void } };
};

export function createApp(options: CreateAppOptions = {}) {
  const app = Fastify(
    options.logger === false
      ? { logger: false }
      : options.logger
        ? { logger: { stream: options.logger.stream } }
        : { logger: true }
  );
  const registeredModules = options.tarotService
    ? [...backendModules, tarotModule]
    : backendModules;

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/api/modules", async () => ({ modules: registeredModules }));
  if ((options.designService || options.tarotService || options.recommendationService) && !options.authProvider) {
    throw new Error("An authentication provider is required for protected API routes.");
  }
  if (options.designService && options.authProvider) {
    registerDesignContractRoutes(app, options.designService, options.authProvider);
  }
  if (options.recommendationService && options.authProvider) {
    registerRecommendationRoutes(app, options.recommendationService, options.authProvider);
  }
  if (options.tarotService && options.authProvider) {
    registerTarotRoutes(
      app,
      options.tarotService,
      options.authProvider,
      options.tarotEnabled ?? resolveTarotFeatureEnabled(process.env.MYSTCRAG_TAROT_ENABLED)
    );
  }

  return app;
}
