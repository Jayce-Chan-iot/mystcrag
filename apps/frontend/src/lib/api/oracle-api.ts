import {
  CreateOracleSessionRequestSchema,
  CreateOracleSessionResponseSchema,
  GenerateOracleRecommendationsRequestSchema,
  GenerateOracleRecommendationsResponseSchema,
  GetOracleSessionResponseSchema,
  SaveOracleSessionRequestSchema,
  SaveOracleSessionResponseSchema,
  type CreateOracleSessionRequest,
  type CreateOracleSessionResponse,
  type GenerateOracleRecommendationsRequest,
  type GenerateOracleRecommendationsResponse,
  type GetOracleSessionResponse,
  type SaveOracleSessionRequest,
  type SaveOracleSessionResponse
} from "@mystcrag/design-contract";

import { FrontendApiError, type FrontendErrorCode } from "./frontend-api-error";

type FetchLike = typeof fetch;
type RuntimeSchema<T> = {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
};

const SERVER_CODES = new Set<FrontendErrorCode>([
  "VALIDATION_ERROR",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "PRICE_CHANGED",
  "INVENTORY_CHANGED",
  "COMPLIANCE_BLOCKED",
  "CONSENT_REQUIRED",
  "NOT_IMPLEMENTED",
  "INTERNAL_ERROR"
]);

async function parseError(response: Response): Promise<FrontendApiError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return new FrontendApiError("NETWORK_ERROR", `Backend returned HTTP ${response.status}.`);
  }

  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "object" && error !== null) {
      const record = error as Record<string, unknown>;
      const code =
        typeof record.code === "string" && SERVER_CODES.has(record.code as FrontendErrorCode)
          ? (record.code as FrontendErrorCode)
          : "INTERNAL_ERROR";
      return new FrontendApiError(
        code,
        typeof record.message === "string" ? record.message : "Backend request failed.",
        typeof record.requestId === "string" ? record.requestId : undefined
      );
    }
  }

  return new FrontendApiError("INTERNAL_ERROR", `Backend returned HTTP ${response.status}.`);
}

async function callApi<T>(
  path: string,
  schema: RuntimeSchema<T>,
  options: { method?: "GET" | "POST"; body?: unknown },
  fetcher: FetchLike
): Promise<T> {
  // Authorization is handled by the BFF proxy using the Auth0 session cookie.
  let response: Response;
  try {
    response = await fetcher(path, {
      method: options.method ?? "POST",
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" })
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: "no-store"
    });
  } catch (error) {
    throw new FrontendApiError(
      "NETWORK_ERROR",
      error instanceof Error ? error.message : "Backend is unavailable."
    );
  }

  if (!response.ok) throw await parseError(response);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new FrontendApiError("INTERNAL_ERROR", "Backend returned an unreadable Oracle response.");
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new FrontendApiError(
      "INTERNAL_ERROR",
      "Backend response did not match the public Oracle contract."
    );
  }
  return parsed.data;
}

export interface OracleApiClient {
  create(input: CreateOracleSessionRequest): Promise<CreateOracleSessionResponse>;
  recommendations(
    sessionId: string,
    input: GenerateOracleRecommendationsRequest
  ): Promise<GenerateOracleRecommendationsResponse>;
  get(sessionId: string): Promise<GetOracleSessionResponse>;
  save(sessionId: string, input: SaveOracleSessionRequest): Promise<SaveOracleSessionResponse>;
}

export type OracleApiClientOptions = {
  fetcher?: FetchLike;
};

export function createOracleApiClient({ fetcher = fetch }: OracleApiClientOptions = {}): OracleApiClient {
  const sessionPath = (sessionId: string) =>
    `/api/oracle/sessions/${encodeURIComponent(sessionId)}`;

  return {
    async create(input) {
      const request = CreateOracleSessionRequestSchema.parse(input);
      return callApi(
        "/api/oracle/sessions",
        CreateOracleSessionResponseSchema,
        { body: request },
        fetcher
      );
    },

    async recommendations(sessionId, input) {
      const request = GenerateOracleRecommendationsRequestSchema.parse(input);
      return callApi(
        `${sessionPath(sessionId)}/recommendations`,
        GenerateOracleRecommendationsResponseSchema,
        { body: request },
        fetcher
      );
    },

    async get(sessionId) {
      return callApi(sessionPath(sessionId), GetOracleSessionResponseSchema, { method: "GET" }, fetcher);
    },

    async save(sessionId, input) {
      const request = SaveOracleSessionRequestSchema.parse(input);
      return callApi(
        `${sessionPath(sessionId)}/save`,
        SaveOracleSessionResponseSchema,
        { body: request },
        fetcher
      );
    }
  };
}

export const oracleApi = createOracleApiClient();
