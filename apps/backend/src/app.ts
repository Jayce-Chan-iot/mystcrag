import Fastify from "fastify";

import { backendModules } from "./modules/index.js";
import {
  registerDesignContractRoutes,
  type DesignStubService
} from "./modules/design/design.routes.js";

export type CreateAppOptions = {
  readonly designService?: DesignStubService;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/api/modules", async () => ({ modules: backendModules }));
  registerDesignContractRoutes(app, options.designService);

  return app;
}
