import Fastify from "fastify";

import type { AuthProvider } from "./auth/auth-provider.js";
import { backendModules } from "./modules/index.js";
import {
  registerDesignContractRoutes,
  type DesignApiService
} from "./modules/design/design.routes.js";

export type CreateAppOptions = {
  readonly designService?: DesignApiService;
  readonly authProvider?: AuthProvider;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/api/modules", async () => ({ modules: backendModules }));
  if (options.designService) {
    if (!options.authProvider) {
      throw new Error("An authentication provider is required for Design API routes.");
    }
    registerDesignContractRoutes(app, options.designService, options.authProvider);
  }

  return app;
}
