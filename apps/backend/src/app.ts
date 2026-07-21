import Fastify from "fastify";

import { backendModules } from "./modules/index.js";
import {
  registerDesignContractRoutes,
  type DesignApiService
} from "./modules/design/design.routes.js";
import type { ActorResolver } from "./modules/design/design.controller.js";

export type CreateAppOptions = {
  readonly designService?: DesignApiService;
  readonly actorResolver?: ActorResolver;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/api/modules", async () => ({ modules: backendModules }));
  if (options.designService) {
    registerDesignContractRoutes(app, options.designService, options.actorResolver);
  }

  return app;
}
