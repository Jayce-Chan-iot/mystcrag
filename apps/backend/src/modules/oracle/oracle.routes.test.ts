import assert from "node:assert/strict";
import test from "node:test";

import { createApp } from "../../app.js";
import { AuthenticatedActorProvider } from "../../auth/authenticated-actor-provider.js";
import { CredentialRejectedError } from "../../auth/auth-errors.js";
import { InMemoryExternalIdentityMapping } from "../../auth/auth.test-utils.js";
import type { AccessTokenVerifier, VerifiedAuthClaims } from "../../auth/auth-provider.js";
import { OracleService } from "./oracle.service.js";
import { InMemoryOracleRepository } from "./oracle.test-utils.js";
import type { OracleApiService } from "./oracle.types.js";

const issuer = "https://oracle-auth.test";
const verifier: AccessTokenVerifier = {
  async verifyAccessToken(token: string): Promise<VerifiedAuthClaims> {
    const subject = token === "owner-token" ? "owner-subject" : token === "other-token" ? "other-subject" : undefined;
    if (!subject) throw new CredentialRejectedError("signature");
    return { subject, issuer, audience: ["mystcrag-backend"], expiresAtEpochSeconds: 2_000_000_000 };
  }
};
const authProvider = new AuthenticatedActorProvider({
  provider: verifier,
  identities: new InMemoryExternalIdentityMapping([
    [issuer, "owner-subject", "oracle-owner"],
    [issuer, "other-subject", "oracle-other"]
  ])
});
const ownerHeaders = { authorization: "Bearer owner-token" };

class RepeatingCoins {
  private index = 0;
  nextCoin(): 2 | 3 {
    const pattern = [2, 2, 3] as const;
    return pattern[this.index++ % pattern.length]!;
  }
}

const createBody = {
  requestId: "oracle-route-create",
  operationId: "oracle-route-operation",
  locale: "zh-CN" as const,
  currency: "CNY" as const,
  question: "不得出现在日志或响应里的问题"
};

test("Oracle routes require authentication and disabled creation does not block restore", async () => {
  const service = new OracleService({ repository: new InMemoryOracleRepository(), coins: new RepeatingCoins() });
  const existing = await service.create("oracle-owner", createBody);
  const app = createApp({ oracleService: service, oracleEnabled: false, authProvider, logger: false });

  const unauthenticated = await app.inject({ method: "POST", url: "/api/oracle/sessions", payload: createBody });
  assert.equal(unauthenticated.statusCode, 401);

  const disabled = await app.inject({ method: "POST", url: "/api/oracle/sessions", headers: ownerHeaders, payload: createBody });
  assert.equal(disabled.statusCode, 501);
  assert.equal(disabled.json().error.code, "NOT_IMPLEMENTED");

  const restored = await app.inject({ method: "GET", url: `/api/oracle/sessions/${existing.session.sessionId}`, headers: ownerHeaders });
  assert.equal(restored.statusCode, 200);
  assert.equal(JSON.stringify(restored.json()).includes(createBody.question), false);
  await app.close();
});

test("Oracle routes reject unknown request fields and hide cross-owner existence", async () => {
  const service = new OracleService({ repository: new InMemoryOracleRepository(), coins: new RepeatingCoins() });
  const app = createApp({ oracleService: service, oracleEnabled: true, authProvider, logger: false });
  const created = await app.inject({
    method: "POST",
    url: "/api/oracle/sessions",
    headers: ownerHeaders,
    payload: { ...createBody, unexpected: true }
  });
  assert.equal(created.statusCode, 400);
  assert.equal(created.json().error.code, "VALIDATION_ERROR");

  const valid = await app.inject({ method: "POST", url: "/api/oracle/sessions", headers: ownerHeaders, payload: createBody });
  assert.equal(valid.statusCode, 200);
  const forbidden = await app.inject({
    method: "GET",
    url: `/api/oracle/sessions/${valid.json().session.sessionId}`,
    headers: { authorization: "Bearer other-token" }
  });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.json().error.code, "FORBIDDEN");

  const invalidRecommendations = await app.inject({
    method: "POST",
    url: `/api/oracle/sessions/${valid.json().session.sessionId}/recommendations`,
    headers: ownerHeaders,
    payload: { requestId: "strict-recommend", operationId: "strict-recommend-operation", expectedRevision: 1, unexpected: true }
  });
  assert.equal(invalidRecommendations.statusCode, 400);
  assert.equal(invalidRecommendations.json().error.code, "VALIDATION_ERROR");

  const invalidSave = await app.inject({
    method: "POST",
    url: `/api/oracle/sessions/${valid.json().session.sessionId}/save`,
    headers: ownerHeaders,
    payload: { requestId: "strict-save", operationId: "strict-save-operation", expectedRevision: 2, selectedDesignId: "design-1", unexpected: true }
  });
  assert.equal(invalidSave.statusCode, 400);
  assert.equal(invalidSave.json().error.code, "VALIDATION_ERROR");
  await app.close();
});

test("Oracle routes preserve stable lifecycle error codes", async () => {
  for (const expectedCode of ["CONFLICT", "PRICE_CHANGED", "INVENTORY_CHANGED", "COMPLIANCE_BLOCKED"] as const) {
    const lifecycleError = Object.assign(new Error(`expected ${expectedCode}`), { code: expectedCode });
    const service: OracleApiService = {
      async create(): Promise<never> { throw lifecycleError; },
      async recommendations(): Promise<never> { throw lifecycleError; },
      async get(): Promise<never> { throw lifecycleError; },
      async presentation(): Promise<never> { throw lifecycleError; },
      async save(): Promise<never> { throw lifecycleError; }
    };
    const app = createApp({ oracleService: service, oracleEnabled: true, authProvider, logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/api/oracle/sessions/oracle-session-1/recommendations",
      headers: ownerHeaders,
      payload: { requestId: `error-${expectedCode}`, operationId: `operation-${expectedCode}`, expectedRevision: 1 }
    });
    assert.equal(response.json().error.code, expectedCode);
    assert.equal(response.statusCode, expectedCode === "COMPLIANCE_BLOCKED" ? 403 : 409);
    await app.close();
  }
});

test("Oracle presentation route serves owner-scoped three-locale copy without mutating the session", async () => {
  const repository = new InMemoryOracleRepository();
  const service = new OracleService({ repository, coins: new RepeatingCoins() });
  const created = await service.create("oracle-owner", createBody);
  const sessionId = created.session.sessionId;
  const app = createApp({ oracleService: service, oracleEnabled: true, authProvider, logger: false });

  const before = await repository.getOwned("oracle-owner", sessionId);
  const headlines = new Set<string>();
  for (const locale of ["zh-CN", "zh-TW", "en-US"] as const) {
    const response = await app.inject({
      method: "GET",
      url: `/api/oracle/sessions/${sessionId}/presentation?locale=${locale}`,
      headers: ownerHeaders
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.sessionId, sessionId);
    assert.equal(body.sourceRevision, created.session.revision);
    assert.equal(body.locale, locale);
    headlines.add(body.headline);
  }
  assert.equal(headlines.size, 3, "each locale must render distinct reviewed copy");

  const repeat = await app.inject({
    method: "GET",
    url: `/api/oracle/sessions/${sessionId}/presentation?locale=zh-CN`,
    headers: ownerHeaders
  });
  const again = await app.inject({
    method: "GET",
    url: `/api/oracle/sessions/${sessionId}/presentation?locale=zh-CN`,
    headers: ownerHeaders
  });
  assert.deepEqual(again.json(), repeat.json());
  assert.deepEqual(await repository.getOwned("oracle-owner", sessionId), before, "presentation must not write");

  const unauthenticated = await app.inject({
    method: "GET",
    url: `/api/oracle/sessions/${sessionId}/presentation?locale=zh-CN`
  });
  assert.equal(unauthenticated.statusCode, 401);

  const missingLocale = await app.inject({
    method: "GET",
    url: `/api/oracle/sessions/${sessionId}/presentation`,
    headers: ownerHeaders
  });
  assert.equal(missingLocale.statusCode, 400);
  assert.equal(missingLocale.json().error.code, "VALIDATION_ERROR");

  const invalidLocale = await app.inject({
    method: "GET",
    url: `/api/oracle/sessions/${sessionId}/presentation?locale=ja-JP`,
    headers: ownerHeaders
  });
  assert.equal(invalidLocale.statusCode, 400);

  const crossOwner = await app.inject({
    method: "GET",
    url: `/api/oracle/sessions/${sessionId}/presentation?locale=zh-CN`,
    headers: { authorization: "Bearer other-token" }
  });
  assert.equal(crossOwner.statusCode, 403);
  assert.equal(crossOwner.json().error.code, "FORBIDDEN");

  const missingSession = await app.inject({
    method: "GET",
    url: "/api/oracle/sessions/oracle-missing/presentation?locale=zh-CN",
    headers: ownerHeaders
  });
  assert.equal(missingSession.statusCode, 403);
  assert.equal(missingSession.json().error.code, "FORBIDDEN");

  await app.close();
});

test("Oracle request bodies and bearer credentials are redacted from logs", async () => {
  let logs = "";
  const service = new OracleService({ repository: new InMemoryOracleRepository(), coins: new RepeatingCoins() });
  const app = createApp({
    oracleService: service,
    oracleEnabled: true,
    authProvider,
    logger: { stream: { write(message) { logs += message; } } }
  });
  await app.inject({ method: "POST", url: "/api/oracle/sessions", headers: ownerHeaders, payload: createBody });
  await app.close();
  assert.equal(logs.includes(createBody.question), false);
  assert.equal(logs.includes("owner-token"), false);
});
