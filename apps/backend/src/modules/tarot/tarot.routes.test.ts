import assert from "node:assert/strict";
import test from "node:test";

import type {
  CreateTarotSessionResponse,
  GetTarotSessionResponse,
  RevealTarotSessionResponse,
  SaveTarotSessionResponse,
  SelectTarotCardResponse
} from "@mystcrag/design-contract";
import { DesignV1Schema, toPublicDesign } from "@mystcrag/design-contract";
import { standardAiDesignFixture } from "@mystcrag/design-contract/fixtures";

import { createApp } from "../../app.js";
import type { AuthProvider, VerifiedAuthClaims } from "../../auth/auth-provider.js";
import { DomainApiError } from "../../contracts/api-error.js";
import type { TarotApiService } from "./tarot.types.js";

const fixedNow = "2026-08-20T12:00:00.000Z";
const actorId = "route-tarot-owner";

class RouteAuthProvider implements AuthProvider {
  async verifyAccessToken(token: string): Promise<VerifiedAuthClaims> {
    if (token !== "valid-route-token") throw new Error("invalid credential");
    return {
      subject: actorId,
      issuer: "https://auth.test.mystcrag.local",
      audience: ["mystcrag-backend"],
      expiresAtEpochSeconds: 2_000_000_000
    };
  }
}

const drawingResponse = (requestId: string): CreateTarotSessionResponse => ({
  requestId,
  session: {
    sessionId: "route-session",
    spreadType: "SINGLE",
    theme: "SELF_GROWTH",
    status: "DRAWING",
    revision: 1,
    slots: ["GUIDANCE"],
    acceptedSelections: [],
    createdAt: fixedNow,
    updatedAt: fixedNow
  },
  cardBack: {
    assetFile: "mystcrag-tarot-card-back.svg",
    altText: "Mystcrag Tarot card back"
  }
});

const revealedCard = {
  slot: "GUIDANCE" as const,
  displayedPosition: 12,
  cardId: "00-the-fool",
  number: 0,
  nameZh: "愚者",
  nameEn: "The Fool",
  assetFile: "00-TheFool.png",
  orientation: "UPRIGHT" as const,
  keywords: ["beginnings", "adventure"]
};

const publicRecommendations = [1, 2, 3].map((rank) => ({
  rank,
  design: toPublicDesign(
    DesignV1Schema.parse({
      ...structuredClone(standardAiDesignFixture),
      designId: `route-tarot-design-${rank}`,
      designName: `Route Tarot design ${rank}`,
      designMode: "TAROT_GUIDED"
    })
  )
}));

const recommendationDetails = {
  interpretation: {
    headline: "A grounded next step",
    summary: "Use the imagery as a reflective prompt for a balanced design direction.",
    cardReflections: [
      { slot: "GUIDANCE" as const, reflection: "Notice the colors that feel steady today." }
    ],
    designRationale: "Three visual directions vary contrast and focus.",
    disclaimer: "For reflection and creative inspiration only."
  },
  colorStory: {
    primaryColor: "#A8C5D1",
    supportColor: "#F2EEE5",
    accentColor: "#B58A63",
    rationale: "Soft blue and warm neutral tones create balance."
  },
  materialRecommendations: [
    {
      beadProductId: "product-aquamarine-round-8",
      displayName: "Aquamarine round bead",
      crystalName: "Aquamarine",
      colorTags: ["blue"],
      reason: "Its translucent blue supports the visual direction."
    }
  ],
  recommendations: publicRecommendations
};

class RouteTarotService implements TarotApiService {
  async create(
    _actorId: string,
    input: { requestId: string }
  ): Promise<CreateTarotSessionResponse> {
    return drawingResponse(input.requestId);
  }

  async select(
    _actorId: string,
    _sessionId: string,
    input: { requestId: string }
  ): Promise<SelectTarotCardResponse> {
    return {
      requestId: input.requestId,
      session: {
        ...drawingResponse(input.requestId).session,
        status: "DRAWN",
        revision: 2,
        acceptedSelections: [
          {
            slot: "GUIDANCE",
            displayedPosition: 12,
            operationId: "route-select-operation"
          }
        ],
        updatedAt: "2026-08-20T12:01:00.000Z"
      }
    };
  }

  async reveal(
    _actorId: string,
    _sessionId: string,
    input: { requestId: string }
  ): Promise<RevealTarotSessionResponse> {
    return {
      requestId: input.requestId,
      session: {
        ...drawingResponse(input.requestId).session,
        status: "DRAWN",
        revision: 3,
        acceptedSelections: [
          {
            slot: "GUIDANCE",
            displayedPosition: 12,
            operationId: "route-select-operation"
          }
        ],
        revealedCards: [revealedCard],
        updatedAt: "2026-08-20T12:02:00.000Z"
      }
    };
  }

  async get(_actorId: string, sessionId: string): Promise<GetTarotSessionResponse> {
    if (sessionId === "another-owner-session") {
      throw new DomainApiError("NOT_FOUND", "Tarot session not found");
    }
    const { cardBack: _cardBack, ...response } = drawingResponse("restore-request");
    return response;
  }

  async save(
    _actorId: string,
    _sessionId: string,
    input: { requestId: string; selectedDesignId?: string }
  ): Promise<SaveTarotSessionResponse> {
    return {
      requestId: input.requestId,
      session: {
        ...drawingResponse(input.requestId).session,
        status: "SAVED",
        revision: 5,
        acceptedSelections: [
          {
            slot: "GUIDANCE",
            displayedPosition: 12,
            operationId: "route-select-operation"
          }
        ],
        revealedCards: [revealedCard],
        ...recommendationDetails,
        ...(input.selectedDesignId === undefined
          ? {}
          : { selectedDesignId: input.selectedDesignId }),
        updatedAt: "2026-08-20T12:04:00.000Z"
      }
    };
  }
}

const authProvider = new RouteAuthProvider();
const tarotService = new RouteTarotService();
const validCreatePayload = {
  requestId: "route-create",
  spreadType: "SINGLE",
  theme: "SELF_GROWTH"
};

test("Tarot routes require a valid bearer credential", async () => {
  const app = createApp({ tarotService, authProvider, tarotEnabled: true, logger: false });

  for (const headers of [undefined, { authorization: "Bearer invalid-route-token" }]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/tarot/sessions",
      headers,
      payload: validCreatePayload
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "UNAUTHORIZED");
    assert.equal(response.json().error.message, "Authentication is required.");
    assert.equal(typeof response.json().error.requestId, "string");
  }

  await app.close();
});

test("disabled Tarot creation uses the stable error envelope while restore stays available", async () => {
  const app = createApp({ tarotService, authProvider, tarotEnabled: false, logger: false });
  const headers = { authorization: "Bearer valid-route-token" };

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/tarot/sessions",
    headers,
    payload: validCreatePayload
  });
  assert.equal(createResponse.statusCode, 501);
  assert.deepEqual(createResponse.json(), {
    error: {
      code: "NOT_IMPLEMENTED",
      message: "Tarot session creation is disabled.",
      requestId: "route-create"
    }
  });

  const restoreResponse = await app.inject({
    method: "GET",
    url: "/api/tarot/sessions/route-session",
    headers
  });
  assert.equal(restoreResponse.statusCode, 200);
  assert.equal(restoreResponse.json().session.sessionId, "route-session");

  await app.close();
});

test("malformed Tarot DTOs fail at the real Fastify boundary", async () => {
  const app = createApp({ tarotService, authProvider, tarotEnabled: true, logger: false });
  const response = await app.inject({
    method: "POST",
    url: "/api/tarot/sessions",
    headers: { authorization: "Bearer valid-route-token" },
    payload: {
      requestId: "malformed-tarot",
      spreadType: "CLIENT_INVENTED_SPREAD",
      theme: "SELF_GROWTH",
      deckOrder: ["browser-must-not-submit-this"]
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, "VALIDATION_ERROR");
  assert.equal(response.json().error.requestId, "malformed-tarot");
  assert.ok(response.json().error.fieldErrors.length >= 1);
  await app.close();
});

test("select, reveal, and save endpoints validate lifecycle requests and responses", async () => {
  const app = createApp({ tarotService, authProvider, tarotEnabled: true, logger: false });
  const headers = { authorization: "Bearer valid-route-token" };

  const selectResponse = await app.inject({
    method: "POST",
    url: "/api/tarot/sessions/route-session/select",
    headers,
    payload: {
      requestId: "route-select",
      slot: "GUIDANCE",
      displayedPosition: 12,
      expectedRevision: 1,
      operationId: "route-select-operation"
    }
  });
  assert.equal(selectResponse.statusCode, 200);
  assert.equal(selectResponse.json().session.status, "DRAWN");
  assert.equal("revealedCards" in selectResponse.json().session, false);

  const revealResponse = await app.inject({
    method: "POST",
    url: "/api/tarot/sessions/route-session/reveal",
    headers,
    payload: { requestId: "route-reveal", expectedRevision: 2 }
  });
  assert.equal(revealResponse.statusCode, 200);
  assert.equal(revealResponse.json().session.revealedCards[0].cardId, "00-the-fool");

  const saveResponse = await app.inject({
    method: "POST",
    url: "/api/tarot/sessions/route-session/save",
    headers,
    payload: {
      requestId: "route-save",
      expectedRevision: 4,
      selectedDesignId: "route-tarot-design-2"
    }
  });
  assert.equal(saveResponse.statusCode, 200);
  assert.equal(saveResponse.json().session.status, "SAVED");
  assert.equal(saveResponse.json().session.recommendations.length, 3);
  assert.equal(saveResponse.json().session.selectedDesignId, "route-tarot-design-2");

  await app.close();
});

test("owner-scoped missing Tarot sessions map to the generic forbidden response", async () => {
  const app = createApp({ tarotService, authProvider, tarotEnabled: true, logger: false });
  const response = await app.inject({
    method: "GET",
    url: "/api/tarot/sessions/another-owner-session",
    headers: { authorization: "Bearer valid-route-token" }
  });

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.json(), {
    error: {
      code: "FORBIDDEN",
      message: "You do not have access to this resource.",
      requestId: response.json().error.requestId
    }
  });
  await app.close();
});

test("Tarot is listed only when its routes are registered and no recommendation placeholder exists", async () => {
  const withoutTarot = createApp({ logger: false });
  const withTarot = createApp({ tarotService, authProvider, tarotEnabled: true, logger: false });

  const absentModules = (await withoutTarot.inject({ method: "GET", url: "/api/modules" })).json();
  const presentModules = (await withTarot.inject({ method: "GET", url: "/api/modules" })).json();
  assert.equal(absentModules.modules.some(({ name }: { name: string }) => name === "tarot"), false);
  assert.equal(presentModules.modules.some(({ name }: { name: string }) => name === "tarot"), true);

  const missingRecommendationRoute = await withTarot.inject({
    method: "POST",
    url: "/api/tarot/sessions/route-session/recommendations",
    headers: { authorization: "Bearer valid-route-token" },
    payload: {}
  });
  assert.equal(missingRecommendationRoute.statusCode, 404);

  await withoutTarot.close();
  await withTarot.close();
});

test("Tarot request logs omit bearer credentials, bodies, and raw question text", async () => {
  let logs = "";
  const app = createApp({
    tarotService,
    authProvider,
    tarotEnabled: true,
    logger: {
      stream: { write: (message: string) => { logs += message; } }
    }
  });
  const privateQuestion = "private question that must never enter logs";
  const privateToken = "valid-route-token";
  const response = await app.inject({
    method: "POST",
    url: "/api/tarot/sessions",
    headers: { authorization: `Bearer ${privateToken}` },
    payload: {
      ...validCreatePayload,
      question: privateQuestion
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(logs.includes(privateQuestion), false);
  assert.equal(logs.includes(privateToken), false);
  assert.equal(logs.includes('"body"'), false);
  assert.equal(logs.includes('"authorization"'), false);
  await app.close();
});

test("createApp rejects protected Tarot registration without authentication", () => {
  assert.throws(
    () => createApp({ tarotService, tarotEnabled: true, logger: false }),
    /authentication provider/i
  );
});
