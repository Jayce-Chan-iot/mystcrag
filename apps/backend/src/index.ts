import { createApp } from "./app.js";
import {
  DesignRepository,
  ExternalIdentityRepository,
  KnowledgeRepository,
  KnowledgeUsageEventRepository,
  ProductRepository,
  OracleSessionRepositoryImpl,
  TarotSessionRepositoryImpl,
  createPrismaClient
} from "@mystcrag/database";
import { NodeCryptoRandomSource } from "@mystcrag/tarot-engine";
import { NodeCryptoCoinSource } from "@mystcrag/oracle-engine";
import {
  KnowledgeConsoleService,
  KnowledgeReviewService,
  KnowledgeSourceAdminService
} from "@mystcrag/knowledge-core";
import { KnowledgeAdminApplicationService } from "./modules/knowledge-admin/knowledge-admin.service.js";
import { TarotAiRecommendationCopyPort, TarotService } from "./modules/tarot/tarot.service.js";
import { TarotCopyService } from "@mystcrag/ai-agent/tarot";
import { OracleCopyService } from "@mystcrag/ai-agent/oracle";
import { OracleService } from "./modules/oracle/oracle.service.js";
import { createAccessTokenVerifierFromEnvironment } from "./auth/auth-provider.factory.js";
import { AuthenticatedActorProvider } from "./auth/authenticated-actor-provider.js";
import { knowledgeUsageRecorderFromRepository } from "./observability/knowledge-usage-recorder.js";
import {
  createDesignApplicationService,
  createRecommendationApplicationService
} from "./modules/design/design.service.js";
import { createTarotQuestionEncryptionFromEnvironment } from "./modules/tarot/tarot-question-encryption.js";
import { fileURLToPath } from "node:url";
import {
  ASSET_RUNTIME_STARTUP_ERROR_MESSAGE,
  initializeAssetImportRuntime
} from "./modules/bead-asset-import/bead-asset-import.runtime.js";

const defaultPort = 4000;
const configuredPort = Number(process.env.BACKEND_PORT ?? defaultPort);
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : defaultPort;

const accessTokenVerifier = createAccessTokenVerifierFromEnvironment();
const tarotQuestionEncryption = createTarotQuestionEncryptionFromEnvironment(process.env);
const database = createPrismaClient();
await database.$connect();
let assetRuntime;
try {
  assetRuntime = await initializeAssetImportRuntime({
    database,
    env: process.env,
    startDir: fileURLToPath(new URL("../../..", import.meta.url)),
    disconnect: () => database.$disconnect()
  });
} catch {
  console.error(ASSET_RUNTIME_STARTUP_ERROR_MESSAGE);
  process.exit(1);
}
const externalIdentities = new ExternalIdentityRepository(database);
const authProvider = new AuthenticatedActorProvider({
  provider: accessTokenVerifier,
  identities: externalIdentities
});
const designRepository = new DesignRepository(database);
const productRepository = new ProductRepository(database);
const designApplicationService = createDesignApplicationService(database);

// Knowledge Console V1: the admin API is only exposed when an operator
// configures KNOWLEDGE_ADMIN_API_KEY (fail closed in createApp otherwise).
// The key never leaves the server; the Console frontend proxies through it.
const knowledgeAdminApiKey = process.env.KNOWLEDGE_ADMIN_API_KEY;
let knowledgeAdminService: KnowledgeAdminApplicationService | undefined;
if (knowledgeAdminApiKey) {
  const knowledgeRepository = new KnowledgeRepository(database);
  knowledgeAdminService = new KnowledgeAdminApplicationService({
    reviewService: new KnowledgeReviewService({ database, repository: knowledgeRepository }),
    sourceAdminService: new KnowledgeSourceAdminService({ repository: knowledgeRepository }),
    consoleService: new KnowledgeConsoleService({ database, repository: knowledgeRepository })
  });
}

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
        return productRepository.listAvailableCatalogMaterialProducts(currency);
      }
    },
    designGenerator: designApplicationService,
    copy: new TarotAiRecommendationCopyPort(new TarotCopyService()),
    questionEncryption: tarotQuestionEncryption,
    usage: knowledgeUsageRecorderFromRepository(new KnowledgeUsageEventRepository(database)),
    preferences: {
      async getDesignPreferences() {
        return undefined;
      }
    }
  }),
  oracleService: new OracleService({
    repository: new OracleSessionRepositoryImpl(database),
    coins: new NodeCryptoCoinSource(),
    copy: new OracleCopyService(),
    designReader: {
      async getOwnedDesign(actorId, designId) {
        return (await designRepository.getDesign(actorId, designId)).snapshot;
      }
    },
    catalog: {
      async listActiveCatalogProducts(currency) {
        return productRepository.listAvailableCatalogMaterialProducts(currency);
      }
    },
    designGenerator: designApplicationService
  }),
  knowledgeAdminService,
  ...(knowledgeAdminApiKey === undefined ? {} : { knowledgeAdminApiKey }),
  ...(assetRuntime ?? {}),
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
