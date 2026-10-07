import type { OracleCopyInput, OracleCopyResult } from "@mystcrag/ai-agent/oracle";
import type {
  CreateOracleSessionRequest,
  CreateOracleSessionResponse,
  DesignV1,
  GenerateDesignRequest,
  GenerateDesignResponse,
  GenerateOracleRecommendationsRequest,
  GenerateOracleRecommendationsResponse,
  GetOracleSessionResponse,
  OraclePresentationResponse,
  PresentationLocale,
  SaveOracleSessionRequest,
  SaveOracleSessionResponse
} from "@mystcrag/design-contract";
import type { AvailableCatalogMaterialProduct } from "@mystcrag/database";

export interface OracleCopyPort {
  createInterpretation(input: OracleCopyInput): Promise<Pick<OracleCopyResult, "interpretation">>;
}

export interface OracleDesignReader {
  getOwnedDesign(actorId: string, designId: string): Promise<DesignV1>;
}

export interface OracleCatalogPort {
  listActiveCatalogProducts(
    currency: "CNY" | "TWD"
  ): Promise<readonly AvailableCatalogMaterialProduct[]>;
}

export interface OracleDesignGenerator {
  generateFromCandidate(input: {
    actorId: string;
    request: GenerateDesignRequest;
    candidate: unknown;
    designMode: "ORACLE_GUIDED";
    designId: string;
  }): Promise<GenerateDesignResponse>;
}

export interface OracleApiService {
  create(actorId: string, input: CreateOracleSessionRequest): Promise<CreateOracleSessionResponse>;
  recommendations(
    actorId: string,
    sessionId: string,
    input: GenerateOracleRecommendationsRequest
  ): Promise<GenerateOracleRecommendationsResponse>;
  get(actorId: string, sessionId: string): Promise<GetOracleSessionResponse>;
  presentation(
    actorId: string,
    sessionId: string,
    locale: PresentationLocale
  ): Promise<OraclePresentationResponse>;
  save(
    actorId: string,
    sessionId: string,
    input: SaveOracleSessionRequest
  ): Promise<SaveOracleSessionResponse>;
}
