import Fastify from "fastify";

import type { AuthProvider } from "./auth/auth-provider.js";
import { resolveTarotFeatureEnabled } from "./config/tarot-feature.js";
import { designModule, tarotModule } from "./modules/index.js";
import type { BackendModule } from "./modules/module.js";
import {
  registerDesignContractRoutes,
  type DesignApiService
} from "./modules/design/design.routes.js";
import {
  registerRecommendationRoutes,
  type RecommendationApiService
} from "./modules/design/recommendation.routes.js";
import {
  registerKnowledgeAdminRoutes
} from "./modules/knowledge-admin/knowledge-admin.routes.js";
import type { KnowledgeAdminApplicationService } from "./modules/knowledge-admin/knowledge-admin.service.js";
import { assertAssetAdminApiKeyConfigured } from "./modules/bead-asset-import/bead-asset-import.auth.js";
import { registerAssetImportRoutes } from "./modules/bead-asset-import/bead-asset-import.routes.js";
import type { AssetImportApplicationService } from "./modules/bead-asset-import/bead-asset-import.service.js";
import { registerProductAssetRoutes } from "./modules/product-assets/product-asset.routes.js";
import type { ProductAssetService } from "./modules/product-assets/product-asset.service.js";
import { registerTarotRoutes } from "./modules/tarot/tarot.routes.js";
import type { TarotApiService } from "./modules/tarot/tarot.types.js";

export type CreateAppOptions = {
  readonly designService?: DesignApiService;
  readonly recommendationService?: RecommendationApiService;
  readonly tarotService?: TarotApiService;
  readonly authProvider?: AuthProvider;
  readonly tarotEnabled?: boolean;
  readonly knowledgeAdminService?: KnowledgeAdminApplicationService;
  readonly knowledgeAdminApiKey?: string;
  readonly assetImportEnabled?: boolean;
  readonly assetImportService?: AssetImportApplicationService;
  readonly productAssetService?: ProductAssetService;
  readonly assetAdminApiKey?: string;
  readonly logger?: false | { readonly stream: { write(message: string): void } };
};

const loggerRedaction = {
  paths: [
    "req.headers.x-admin-key",
    "req.headers.authorization",
    "req.headers.cookie",
    "headers.x-admin-key",
    "headers.authorization",
    "headers.cookie",
    "req.body",
    "body",
    "raw"
  ],
  censor: "[Redacted]"
};

export function createApp(options: CreateAppOptions = {}) {
  const app = Fastify(
    options.logger === false
      ? { logger: false }
      : options.logger
        ? { logger: { stream: options.logger.stream, redact: loggerRedaction } }
        : { logger: { redact: loggerRedaction } }
  );
  const modules: BackendModule[] = [];
  if (options.designService || options.recommendationService) {
    modules.push(designModule);
  }
  if (options.tarotService) {
    modules.push(tarotModule);
  }

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/api/modules", async () => ({ modules }));
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
  if (options.knowledgeAdminService) {
    if (options.knowledgeAdminApiKey === undefined || options.knowledgeAdminApiKey.length < 16) {
      throw new Error(
        "knowledgeAdminApiKey (>=16 chars, e.g. KNOWLEDGE_ADMIN_API_KEY) is required to expose the knowledge admin API."
      );
    }
    registerKnowledgeAdminRoutes(
      app,
      options.knowledgeAdminService,
      options.knowledgeAdminApiKey
    );
  }
  if (options.assetImportEnabled === true) {
    assertAssetAdminApiKeyConfigured(options.assetAdminApiKey);
    if (!options.assetImportService || !options.productAssetService) {
      throw new Error(
        "assetImportService and productAssetService are required when asset import is enabled."
      );
    }
    registerAssetImportRoutes(app, options.assetImportService, options.assetAdminApiKey);
  }
  if (options.productAssetService) {
    registerProductAssetRoutes(app, options.productAssetService);
  }

  return app;
}
