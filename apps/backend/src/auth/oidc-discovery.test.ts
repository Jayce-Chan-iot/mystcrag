import assert from "node:assert/strict";
import test from "node:test";

import { ProviderUnavailableError } from "./auth-errors.js";
import {
  OidcDiscoverySource,
  discoveryDocumentUrl,
  type OidcDiscoveryTransport
} from "./oidc-discovery.js";

const ISSUER = "https://mystcrag-pool.authing.cn/oidc";
const ISSUER_SLASH = "https://mystcrag-pool.authing.cn/oidc/";

function documentFor(issuer: string) {
  return {
    issuer,
    authorization_endpoint: "https://mystcrag-pool.authing.cn/oidc/auth",
    token_endpoint: "https://mystcrag-pool.authing.cn/oidc/token",
    jwks_uri: "https://mystcrag-pool.authing.cn/oidc/keys",
    end_session_endpoint: "https://mystcrag-pool.authing.cn/oidc/session/end"
  };
}

test("discovery document URL normalizes a missing trailing slash", () => {
  assert.equal(
    discoveryDocumentUrl(ISSUER),
    "https://mystcrag-pool.authing.cn/oidc/.well-known/openid-configuration"
  );
  assert.equal(
    discoveryDocumentUrl(ISSUER_SLASH),
    "https://mystcrag-pool.authing.cn/oidc/.well-known/openid-configuration"
  );
});

test("discovery caches a valid Authing document and exposes jwks_uri", async () => {
  let calls = 0;
  const transport: OidcDiscoveryTransport = async (url) => {
    calls += 1;
    assert.equal(
      url,
      "https://mystcrag-pool.authing.cn/oidc/.well-known/openid-configuration"
    );
    return { status: 200, json: async () => documentFor(ISSUER_SLASH) };
  };
  const source = new OidcDiscoverySource({ issuer: ISSUER, transport });
  const first = await source.getDocument();
  const second = await source.getDocument();
  assert.equal(calls, 1);
  assert.equal(first.jwks_uri, "https://mystcrag-pool.authing.cn/oidc/keys");
  assert.equal(first.end_session_endpoint, "https://mystcrag-pool.authing.cn/oidc/session/end");
  assert.equal(second.jwks_uri, first.jwks_uri);
  assert.equal(await source.getJwksUri(), first.jwks_uri);
});

test("discovery rejects a document whose issuer does not match configuration", async () => {
  const transport: OidcDiscoveryTransport = async () => ({
    status: 200,
    json: async () => documentFor("https://evil.example.com/oidc")
  });
  const source = new OidcDiscoverySource({ issuer: ISSUER, transport });
  await assert.rejects(() => source.getDocument(), ProviderUnavailableError);
});

test("discovery rejects non-HTTPS endpoint URLs", async () => {
  const transport: OidcDiscoveryTransport = async () => ({
    status: 200,
    json: async () => ({
      ...documentFor(ISSUER),
      jwks_uri: "http://mystcrag-pool.authing.cn/oidc/keys"
    })
  });
  const source = new OidcDiscoverySource({ issuer: ISSUER, transport });
  await assert.rejects(() => source.getDocument(), ProviderUnavailableError);
});

test("discovery fails closed on non-200 and transport errors", async () => {
  const notFound = new OidcDiscoverySource({
    issuer: ISSUER,
    transport: async () => ({ status: 404, json: async () => ({}) })
  });
  await assert.rejects(() => notFound.getDocument(), ProviderUnavailableError);

  const outage = new OidcDiscoverySource({
    issuer: ISSUER,
    transport: async () => {
      throw new Error("network down");
    }
  });
  await assert.rejects(() => outage.getDocument(), ProviderUnavailableError);
});
