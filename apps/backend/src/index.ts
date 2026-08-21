import { createApp } from "./app.js";
import {
  DesignRepository,
  ProductRepository,
  TarotSessionRepositoryImpl,
  createPrismaClient
} from "@mystcrag/database";
import { NodeCryptoRandomSource } from "@mystcrag/tarot-engine";
import { TarotCopyService } from "@mystcrag/ai-agent/tarot";
import { createAuthProviderFromEnvironment } from "./auth/auth-provider.factory.js";
import {
  createDesignApplicationService,
  createRecommendationApplicationService
} from "./modules/design/design.service.js";
import {
  TarotAiRecommendationCopyPort,
  TarotService
} from "./modules/tarot/tarot.service.js";
import { createTarotQuestionEncryptionFromEnvironment } from "./modules/tarot/tarot-question-encryption.js";

const defaultPort = 4000;
const configuredPort = Number(process.env.BACKEND_PORT ?? defaultPort);
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : defaultPort;

const authProvider = createAuthProviderFromEnvironment();
const tarotQuestionEncryption = createTarotQuestionEncryptionFromEnvironment(process.env);
const database = createPrismaClient();
await database.$connect();
const designRepository = new DesignRepository(database);
const productRepository = new ProductRepository(database);
const designApplicationService = createDesignApplicationService(database);
const app = createApp({
  designService: designApplicationService,
  recommendationService: createRecommendationApplicationService(database),
  tarotService: new TarotService({
    repository: new TarotSessionRepositoryImpl(database),
    random: new NodeCryptoRandomSource(),
    designReader: {
      async getOwnedDesign(actorId, designId) {
        return (await designRepository.getDesign(actorId, designId)).snapshot;
      }
    },
    catalog: {
      async listActiveCatalogProducts(currency) {
        return (await productRepository.listActiveCatalogProducts(currency)).filter(
          (product) => product.productType === "MATERIAL"
        );
      }
    },
    designGenerator: designApplicationService,
    copy: new TarotAiRecommendationCopyPort(new TarotCopyService()),
    questionEncryption: tarotQuestionEncryption,
    preferences: {
      async getDesignPreferences() {
        return undefined;
      }
    }
  }),
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
