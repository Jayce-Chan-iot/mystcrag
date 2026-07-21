import Fastify from "fastify";

import { backendModules } from "./modules/index.js";

export function createApp() {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/api/modules", async () => ({ modules: backendModules }));

  return app;
}
