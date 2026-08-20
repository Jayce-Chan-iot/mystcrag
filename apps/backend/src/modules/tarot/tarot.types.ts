import type {
  CreateTarotSessionRequest,
  CreateTarotSessionResponse,
  DesignV1,
  GenerateDesignRequest,
  GenerateDesignResponse,
  GenerateTarotRecommendationsRequest,
  GenerateTarotRecommendationsResponse,
  GetTarotSessionResponse,
  RevealTarotSessionRequest,
  RevealTarotSessionResponse,
  SaveTarotSessionRequest,
  SaveTarotSessionResponse,
  SelectTarotCardRequest,
  SelectTarotCardResponse
} from "@mystcrag/design-contract";
import type {
  CatalogMaterialProduct,
  TarotRecommendationSnapshot
} from "@mystcrag/database";
import type {
  RevealedTarotCard,
  TarotDesignSignals
} from "@mystcrag/tarot-engine";

export interface TarotDesignReader {
  getOwnedDesign(actorId: string, designId: string): Promise<DesignV1>;
}

export interface TarotCatalogPort {
  listActiveCatalogProducts(
    currency: "CNY" | "TWD"
  ): Promise<readonly CatalogMaterialProduct[]>;
}

export interface TarotDesignGenerator {
  generateFromCandidate(input: {
    actorId: string;
    request: GenerateDesignRequest;
    candidate: unknown;
    designMode: "TAROT_GUIDED";
    designId: string;
  }): Promise<GenerateDesignResponse>;
}

export interface TarotRecommendationCopyPort {
  createSnapshot(input: {
    cards: readonly RevealedTarotCard[];
    signals: TarotDesignSignals;
    materials: readonly CatalogMaterialProduct[];
    locale: string;
    question?: string;
  }): Promise<TarotRecommendationSnapshot>;
}

export interface TarotApiService {
  create(
    actorId: string,
    input: CreateTarotSessionRequest
  ): Promise<CreateTarotSessionResponse>;
  select(
    actorId: string,
    sessionId: string,
    input: SelectTarotCardRequest
  ): Promise<SelectTarotCardResponse>;
  reveal(
    actorId: string,
    sessionId: string,
    input: RevealTarotSessionRequest
  ): Promise<RevealTarotSessionResponse>;
  recommendations(
    actorId: string,
    sessionId: string,
    input: GenerateTarotRecommendationsRequest
  ): Promise<GenerateTarotRecommendationsResponse>;
  get(actorId: string, sessionId: string): Promise<GetTarotSessionResponse>;
  save(
    actorId: string,
    sessionId: string,
    input: SaveTarotSessionRequest
  ): Promise<SaveTarotSessionResponse>;
}
