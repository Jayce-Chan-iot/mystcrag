import { createApp } from "./app.js";
import { createPrismaClient } from "@mystcrag/database";
import { createAuthProviderFromEnvironment } from "./auth/auth-provider.factory.js";
import { createDesignApplicationService } from "./modules/design/design.service.js";

const defaultPort = 4000;
const configuredPort = Number(process.env.BACKEND_PORT ?? defaultPort);
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : defaultPort;

const authProvider = createAuthProviderFromEnvironment();
const database = createPrismaClient();
await database.$connect();
const app = createApp({
  designService: createDesignApplicationService(database),
  authProvider
});
app.addHook("onClose", async () => database.$disconnect());

let closing = false;
const shutdown = async (signal: NodeJS.Signals) => {
  if (closing) {
    return;
  }
  closing = true;
  app.log.info({ signal }, "Shutting down Backend");
  try {
    await app.close();
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
