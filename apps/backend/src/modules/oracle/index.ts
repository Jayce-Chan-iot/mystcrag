import type { BackendModule } from "../module.js";

export const oracleModule: BackendModule = {
  name: "oracle",
  description: "Authenticated one-tap Oracle cast and design lifecycle"
};

export { registerOracleRoutes } from "./oracle.routes.js";
export { OracleService } from "./oracle.service.js";
export type {
  OracleApiService,
  OracleCatalogPort,
  OracleCopyPort,
  OracleDesignGenerator,
  OracleDesignReader
} from "./oracle.types.js";
