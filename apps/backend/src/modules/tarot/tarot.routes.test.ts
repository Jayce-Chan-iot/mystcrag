import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../../app.js";
import type { AuthProvider, VerifiedAuthClaims } from "../../auth/auth-provider.js";
import { TarotService } from "./tarot.service.js";
import {
  InMemoryTarotRepository,
  ZeroRandomSource
} from "./tarot.test-utils.js";

const actorId = "route-tarot-owner";
const otherActorId = "route-tarot-other-owner";

class RouteAuthProvider implements AuthProvider {
  async verifyAccessToken(token: string): Promise<VerifiedAuthClaims> {
    const subject =
      token === "valid-route-token"
        ? actorId
        : token === "valid-other-route-token"
          ? otherActorId
          : undefined;
    if (!subject) throw new Error("invalid credential");
    return {
      subject,
      issuer: "https://auth.test.mystcrag.local",
      audience: ["mystcrag-backend"],
      expiresAtEpochSeconds: 2_000_000_000
    };
  }
}

const authProvider = new RouteAuthProvider();
const ownerHeaders = { authorization: "Bearer valid-route-token" };
const validCreatePayload = {
  requestId: "route-create",
  spreadType: "SINGLE" as const,
  theme: "SELF_GROWTH" as const
};

function createRouteHarness(options: {
  readonly tarotEnabled?: boolean;
  readonly logger?: false | { readonly stream: { write(message: string): void } };
} = {}) {
  const repository = new InMemoryTarotRepository();
  const tarotService = new TarotService({
    repository,
    random: new ZeroRandomSource()
  });
  const app = createApp({
    tarotService,
    authProvider,
    tarotEnabled: options.tarotEnabled ?? true,
    logger: options.logger ?? false
  });
  return { app, repository, tarotService };
}

test("Tarot routes require a valid bearer credential", async () => {
  const { app } = createRouteHarness();

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

test("disabled Tarot creation uses the stable error envelope while existing draw routes remain available", async () => {
  const repository = new InMemoryTarotRepository();
  const tarotService = new TarotService({
    repository,
    random: new ZeroRandomSource()
  });
  const existing = await tarotService.create(actorId, {
    ...validCreatePayload,
    requestId: "existing-before-disable"
  });
  const app = createApp({
    tarotService,
    authProvider,
    tarotEnabled: false,
    logger: false
  });

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/tarot/sessions",
    headers: ownerHeaders,
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

  const sessionId = existing.session.sessionId;
  const selected = await app.inject({
    method: "POST",
    url: `/api/tarot/sessions/${sessionId}/select`,
    headers: ownerHeaders,
    payload: {
      requestId: "select-while-disabled",
      slot: "GUIDANCE",
      displayedPosition: 12,
      expectedRevision: 1,
      operationId: "select-while-disabled"
    }
  });
  assert.equal(selected.statusCode, 200);
  const restored = await app.inject({
    method: "GET",
    url: `/api/tarot/sessions/${sessionId}`,
    headers: ownerHeaders
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().session.revision, 2);

  await app.close();
});

test("malformed Tarot lifecycle DTOs fail at the real Fastify boundary", async () => {
  const { app } = createRouteHarness();
  const createResponse = await app.inject({
    method: "POST",
    url: "/api/tarot/sessions",
    headers: ownerHeaders,
    payload: {
      requestId: "malformed-tarot",
      spreadType: "CLIENT_INVENTED_SPREAD",
      theme: "SELF_GROWTH",
      deckOrder: ["browser-must-not-submit-this"]
    }
  });
  assert.equal(createResponse.statusCode, 400);
  assert.equal(createResponse.json().error.code, "VALIDATION_ERROR");
  assert.equal(createResponse.json().error.requestId, "malformed-tarot");
  assert.ok(createResponse.json().error.fieldErrors.length >= 1);

  const saveResponse = await app.inject({
    method: "POST",
    url: "/api/tarot/sessions/unknown/save",
    headers: ownerHeaders,
    payload: { requestId: "malformed-save", expectedRevision: 0 }
  });
  assert.equal(saveResponse.statusCode, 400);
  assert.equal(saveResponse.json().error.code, "VALIDATION_ERROR");
  assert.equal(saveResponse.json().error.requestId, "malformed-save");

  await app.close();
});

test("create, final select, restore, and reveal preserve one owner-scoped lifecycle", async () => {
  const { app } = createRouteHarness();
  const created = await app.inject({
    method: "POST",
    url: "/api/tarot/sessions",
    headers: ownerHeaders,
    payload: {
      requestId: "route-lifecycle-create",
      spreadType: "SINGLE",
      theme: "SELF_GROWTH"
    }
  });
  assert.equal(created.statusCode, 200);
  const sessionId = created.json().session.sessionId as string;

  const selected = await app.inject({
    method: "POST",
    url: `/api/tarot/sessions/${sessionId}/select`,
    headers: ownerHeaders,
    payload: {
      requestId: "route-lifecycle-select",
      slot: "GUIDANCE",
      displayedPosition: 12,
      expectedRevision: 1,
      operationId: "route-lifecycle-select-operation"
    }
  });
  assert.equal(selected.statusCode, 200);
  assert.equal(selected.json().session.sessionId, sessionId);
  assert.equal(selected.json().session.status, "DRAWING");
  assert.equal(selected.json().session.revision, 2);
  assert.equal(selected.json().session.acceptedSelections.length, 1);
  assert.equal("revealedCards" in selected.json().session, false);

  const restoredSelection = await app.inject({
    method: "GET",
    url: `/api/tarot/sessions/${sessionId}`,
    headers: ownerHeaders
  });
  assert.equal(restoredSelection.statusCode, 200);
  assert.equal(
    restoredSelection.json().session.sessionId,
    selected.json().session.sessionId
  );
  assert.equal(restoredSelection.json().session.status, selected.json().session.status);
  assert.equal(restoredSelection.json().session.revision, selected.json().session.revision);
  assert.deepEqual(
    restoredSelection.json().session.acceptedSelections,
    selected.json().session.acceptedSelections
  );
  assert.equal("revealedCards" in restoredSelection.json().session, false);

  const forbidden = await app.inject({
    method: "GET",
    url: `/api/tarot/sessions/${sessionId}`,
    headers: { authorization: "Bearer valid-other-route-token" }
  });
  assert.equal(forbidden.statusCode, 403);
  assert.deepEqual(forbidden.json(), {
    error: {
      code: "FORBIDDEN",
      message: "You do not have access to this resource.",
      requestId: forbidden.json().error.requestId
    }
  });

  const revealed = await app.inject({
    method: "POST",
    url: `/api/tarot/sessions/${sessionId}/reveal`,
    headers: ownerHeaders,
    payload: { requestId: "route-lifecycle-reveal", expectedRevision: 2 }
  });
  assert.equal(revealed.statusCode, 200);
  assert.equal(revealed.json().session.sessionId, sessionId);
  assert.equal(revealed.json().session.status, "DRAWN");
  assert.equal(revealed.json().session.revision, 3);
  assert.equal(revealed.json().session.revealedCards.length, 1);

  const restoredReveal = await app.inject({
    method: "GET",
    url: `/api/tarot/sessions/${sessionId}`,
    headers: ownerHeaders
  });
  assert.equal(restoredReveal.statusCode, 200);
  assert.equal(restoredReveal.json().session.sessionId, revealed.json().session.sessionId);
  assert.equal(restoredReveal.json().session.status, revealed.json().session.status);
  assert.equal(restoredReveal.json().session.revision, revealed.json().session.revision);
  assert.deepEqual(
    restoredReveal.json().session.acceptedSelections,
    revealed.json().session.acceptedSelections
  );
  assert.deepEqual(
    restoredReveal.json().session.revealedCards,
    revealed.json().session.revealedCards
  );

  await app.close();
});

test("Tarot is listed only when its routes are registered and no recommendation placeholder exists", async () => {
  const withoutTarot = createApp({ logger: false });
  const { app: withTarot } = createRouteHarness();

  const absentModules = (await withoutTarot.inject({ method: "GET", url: "/api/modules" })).json();
  const presentModules = (await withTarot.inject({ method: "GET", url: "/api/modules" })).json();
  assert.equal(absentModules.modules.some(({ name }: { name: string }) => name === "tarot"), false);
  assert.equal(presentModules.modules.some(({ name }: { name: string }) => name === "tarot"), true);

  const missingRecommendationRoute = await withTarot.inject({
    method: "POST",
    url: "/api/tarot/sessions/unknown/recommendations",
    headers: ownerHeaders,
    payload: {}
  });
  assert.equal(missingRecommendationRoute.statusCode, 404);

  await withoutTarot.close();
  await withTarot.close();
});

test("Tarot request logs omit bearer credentials, bodies, and raw question text", async () => {
  let logs = "";
  const { app } = createRouteHarness({
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
  const tarotService = new TarotService({
    repository: new InMemoryTarotRepository(),
    random: new ZeroRandomSource()
  });
  assert.throws(
    () => createApp({ tarotService, tarotEnabled: true, logger: false }),
    /authentication provider/i
  );
});
