import type {
  CreateTarotSessionRequest,
  CreateTarotSessionResponse,
  DesignV1,
  GetTarotSessionResponse,
  RevealTarotSessionRequest,
  RevealTarotSessionResponse,
  SaveTarotSessionRequest,
  SaveTarotSessionResponse,
  SelectTarotCardRequest,
  SelectTarotCardResponse
} from "@mystcrag/design-contract";

export interface TarotDesignReader {
  getOwnedDesign(actorId: string, designId: string): Promise<DesignV1>;
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
  get(actorId: string, sessionId: string): Promise<GetTarotSessionResponse>;
  save(
    actorId: string,
    sessionId: string,
    input: SaveTarotSessionRequest
  ): Promise<SaveTarotSessionResponse>;
}
