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
  SelectTarotCardResponse,
  TarotTheme
} from "@mystcrag/design-contract";
import type {
  AvailableCatalogMaterialProduct,
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
  ): Promise<readonly AvailableCatalogMaterialProduct[]>;
}

export interface TarotDesignPreferences {
  readonly wristCircumferenceMm?: number;
  readonly budget?: {
    readonly minMinor?: number;
    readonly maxMinor?: number;
  };
}

export interface TarotPreferencePort {
  getDesignPreferences(actorId: string): Promise<TarotDesignPreferences | undefined>;
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
    materials: readonly AvailableCatalogMaterialProduct[];
    locale: string;
    theme: TarotTheme;
    question?: string;
  }): Promise<TarotRecommendationSnapshot>;
}

export interface TarotQuestionEncryptionPort {
  encrypt(question: string): Promise<string>;
  matchesIdentity(question: string, ciphertext: string): Promise<boolean>;
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
