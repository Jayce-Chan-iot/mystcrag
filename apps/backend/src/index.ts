import { createApp } from "./app.js";
import { createPrismaClient } from "@mystcrag/database";
import { createDesignApplicationService } from "./modules/design/design.service.js";

const defaultPort = 4000;
const configuredPort = Number(process.env.BACKEND_PORT ?? defaultPort);
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : defaultPort;

const database = createPrismaClient();
await database.$connect();
const app = createApp({ designService: createDesignApplicationService(database) });
app.addHook("onClose", async () => database.$disconnect());

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
