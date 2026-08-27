/**
 * Synthetic OIDC provider for the AUTH-006 isolated E2E stack (test tenant only).
 *
 * Implements the exact subset of OIDC that the Auth0 Next.js SDK (oauth4webapi) and the
 * backend Auth0AccessTokenVerifier consume:
 *
 *   GET  /.well-known/openid-configuration — discovery (issuer must match exactly)
 *   GET  /.well-known/jwks.json            — RS256 public keys (rotatable)
 *   GET  /authorize                        — authorization code + PKCE S256
 *   POST /oauth/token                      — authorization_code and refresh_token grants
 *   GET  /userinfo                         — profile for issued access tokens
 *   GET  /oidc/logout                      — end-session redirect
 *
 * A separate plain-HTTP admin endpoint (Bearer token protected) lets the test suite
 * steer the tenant at runtime: select the next authenticated user, simulate provider
 * outages, revoke refresh tokens, and rotate signing keys.
 *
 * Every value is synthetic: no real Auth0 tenant, credential, or user is involved.
 */

import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import fs from "node:fs";

const DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS = 12;
const CODE_LIFETIME_SECONDS = 120;
const REFRESH_TOKEN_LIFETIME_SECONDS = 14 * 24 * 3600;

function generateSigningKey(kid) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { format: "jwk" },
    privateKeyEncoding: { format: "jwk" }
  });
  return {
    kid,
    privateKey: crypto.createPrivateKey({ key: privateKey, format: "jwk" }),
    jwk: {
      kty: publicKey.kty,
      kid,
      use: "sig",
      alg: "RS256",
      n: publicKey.n,
      e: publicKey.e
    }
  };
}

function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signJwt(key, header, claims) {
  const encodedHeader = b64url(JSON.stringify(header));
  const encodedClaims = b64url(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signingInput), key.privateKey);
  return `${signingInput}.${signature.toString("base64url")}`;
}

function sha256B64Url(input) {
  return crypto.createHash("sha256").update(input).digest("base64url");
}

function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function readBody(request) {
  return new Promise((resolve) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", () => resolve(""));
  });
}

function decodeBasic(header) {
  if (!header || !header.startsWith("Basic ")) return undefined;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return undefined;
  return { clientId: decoded.slice(0, separator), clientSecret: decoded.slice(separator + 1) };
}

export type SyntheticProviderOptions = {
  issuer: string;
  audience: string;
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  logoutUrl: string;
  tlsPort: number;
  adminPort: number;
  adminToken: string;
  tlsKey: string;
  tlsCert: string;
  accessTokenLifetimeSeconds?: number;
};

export function createSyntheticProvider(options: SyntheticProviderOptions) {
  const config = {
    issuer: options.issuer,
    audience: options.audience,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    callbackUrl: options.callbackUrl,
    logoutUrl: options.logoutUrl,
    tlsPort: options.tlsPort,
    adminPort: options.adminPort,
    adminToken: options.adminToken,
    tlsKey: options.tlsKey,
    tlsCert: options.tlsCert,
    accessTokenLifetimeSeconds: options.accessTokenLifetimeSeconds ?? DEFAULT_ACCESS_TOKEN_LIFETIME_SECONDS
  };

  let keySequence = 0;
  let keys = [generateSigningKey(`auth006-key-${++keySequence}`)];
  let nextUser = null;
  let outage = "off";
  const codes = new Map();
  const refreshTokens = new Map();
  const accessTokens = new Map();

  function currentKey() {
    return keys[0];
  }

  function mintTokensFor(user, nonce, includeRefresh) {
    const now = Math.floor(Date.now() / 1000);
    const key = currentKey();
    const accessToken = signJwt(
      key,
      { alg: "RS256", kid: key.kid, typ: "at+jwt" },
      {
        iss: config.issuer,
        sub: user.sub,
        aud: [config.audience],
        exp: now + config.accessTokenLifetimeSeconds,
        iat: now,
        jti: randomToken(),
        scope: "openid profile email",
        email: user.email,
        email_verified: user.emailVerified,
        name: user.name
      }
    );
    const idToken = signJwt(
      key,
      { alg: "RS256", kid: key.kid, typ: "JWT" },
      {
        iss: config.issuer,
        sub: user.sub,
        aud: [config.clientId],
        exp: now + config.accessTokenLifetimeSeconds,
        iat: now,
        ...(nonce ? { nonce } : {}),
        email: user.email,
        email_verified: user.emailVerified,
        name: user.name,
        sid: randomToken()
      }
    );
    accessTokens.set(accessToken, { sub: user.sub, expiresAt: now + config.accessTokenLifetimeSeconds });
    const tokenSet = {
      access_token: accessToken,
      id_token: idToken,
      token_type: "Bearer",
      expires_in: config.accessTokenLifetimeSeconds,
      scope: "openid profile email"
    };
    if (includeRefresh) {
      const refreshToken = randomToken();
      refreshTokens.set(refreshToken, {
        user: {
          sub: user.sub,
          email: user.email,
          emailVerified: user.emailVerified,
          name: user.name
        },
        expiresAt: now + REFRESH_TOKEN_LIFETIME_SECONDS,
        revoked: false
      });
      tokenSet.refresh_token = refreshToken;
    }
    return tokenSet;
  }

  function oauthError(res, status, error, description) {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ error, error_description: description }));
  }

  function handleAuthorize(req, res, url) {
    if (outage === "all" || outage === "authorize") {
      res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "temporarily_unavailable" }));
      return;
    }
    const clientId = url.searchParams.get("client_id");
    const redirectUri = url.searchParams.get("redirect_uri");
    const responseType = url.searchParams.get("response_type");
    const state = url.searchParams.get("state");
    const nonce = url.searchParams.get("nonce");
    const challenge = url.searchParams.get("code_challenge");
    const challengeMethod = url.searchParams.get("code_challenge_method");

    if (clientId !== config.clientId) {
      return oauthError(res, 400, "unauthorized_client", "Unknown client_id.");
    }
    if (redirectUri !== config.callbackUrl) {
      return oauthError(res, 400, "invalid_request", "redirect_uri is not registered.");
    }
    if (responseType !== "code") {
      return oauthError(res, 400, "unsupported_response_type", "Only code is supported.");
    }
    if (!challenge || challengeMethod !== "S256") {
      return oauthError(res, 400, "invalid_request", "PKCE S256 code_challenge is required.");
    }
    if (!state || !nonce) {
      return oauthError(res, 400, "invalid_request", "state and nonce are required.");
    }
    if (!nextUser) {
      return oauthError(res, 500, "server_error", "No synthetic user selected.");
    }

    const code = randomToken();
    codes.set(code, {
      challenge,
      nonce,
      user: nextUser,
      redirectUri,
      expiresAt: Date.now() + CODE_LIFETIME_SECONDS * 1000
    });
    const target = new URL(redirectUri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", state);
    res.writeHead(302, { location: target.toString(), "cache-control": "no-store" });
    res.end();
  }

  async function handleToken(req, res) {
    if (outage === "all" || outage === "token") {
      // Stable, provider-side failure: the BFF must keep the decryptable session.
      res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "server_error", error_description: "Synthetic provider outage." }));
      return;
    }
    const bodyText = await readBody(req);
    const body = new URLSearchParams(bodyText);
    const basic = decodeBasic(req.headers.authorization ?? "");
    const clientId = body.get("client_id") ?? basic?.clientId;
    const clientSecret = body.get("client_secret") ?? basic?.clientSecret;
    const grantType = body.get("grant_type");

    if (clientId !== config.clientId || clientSecret !== config.clientSecret) {
      return oauthError(res, 401, "invalid_client", "Client authentication failed.");
    }

    if (grantType === "authorization_code") {
      const code = body.get("code");
      const redirectUri = body.get("redirect_uri");
      const verifier = body.get("code_verifier");
      const record = code ? codes.get(code) : undefined;
      if (!record) {
        return oauthError(res, 400, "invalid_grant", "Unknown authorization code.");
      }
      if (Date.now() > record.expiresAt) {
        codes.delete(code);
        return oauthError(res, 400, "invalid_grant", "Authorization code expired.");
      }
      if (redirectUri !== record.redirectUri) {
        return oauthError(res, 400, "invalid_grant", "redirect_uri mismatch.");
      }
      if (!verifier || sha256B64Url(verifier) !== record.challenge) {
        return oauthError(res, 400, "invalid_grant", "PKCE verification failed.");
      }
      codes.delete(code);
      const tokenSet = mintTokensFor(record.user, record.nonce, true);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(tokenSet));
      return;
    }

    if (grantType === "refresh_token") {
      const token = body.get("refresh_token");
      const record = token ? refreshTokens.get(token) : undefined;
      if (!record) {
        return oauthError(res, 400, "invalid_grant", "Refresh token is invalid.");
      }
      if (record.revoked) {
        return oauthError(res, 400, "invalid_grant", "Refresh token has been revoked.");
      }
      if (Date.now() > record.expiresAt * 1000) {
        refreshTokens.delete(token);
        return oauthError(res, 400, "invalid_grant", "Refresh token expired.");
      }
      refreshTokens.delete(token);
      const tokenSet = mintTokensFor(record.user, undefined, true);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(tokenSet));
      return;
    }

    return oauthError(res, 400, "unsupported_grant_type", "Unsupported grant_type.");
  }

  function handleJwks(res) {
    if (outage === "all" || outage === "jwks") {
      res.writeHead(500, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "server_error" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ keys: keys.map((key) => key.jwk) }));
  }

  function handleDiscovery(res) {
    if (outage === "all" || outage === "discovery") {
      res.writeHead(503, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "temporarily_unavailable" }));
      return;
    }
    const origin = config.issuer;
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(
      JSON.stringify({
        issuer: config.issuer,
        authorization_endpoint: `${origin}authorize`,
        token_endpoint: `${origin}oauth/token`,
        jwks_uri: `${origin}.well-known/jwks.json`,
        userinfo_endpoint: `${origin}userinfo`,
        end_session_endpoint: `${origin}oidc/logout`,
        revocation_endpoint: `${origin}oauth/revoke`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"]
      })
    );
  }

  function handleUserinfo(req, res) {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : undefined;
    const record = token ? accessTokens.get(token) : undefined;
    if (!record || Date.now() > record.expiresAt * 1000) {
      return oauthError(res, 401, "invalid_token", "Access token is invalid or expired.");
    }
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ sub: record.sub }));
  }

  function handleLogout(req, res, url) {
    const clientId = url.searchParams.get("client_id");
    const postLogoutRedirect = url.searchParams.get("post_logout_redirect_uri");
    if (clientId !== config.clientId) {
      return oauthError(res, 400, "invalid_request", "Unknown client_id.");
    }
    if (postLogoutRedirect !== config.logoutUrl) {
      return oauthError(res, 400, "invalid_request", "post_logout_redirect_uri is not registered.");
    }
    res.writeHead(302, { location: postLogoutRedirect, "cache-control": "no-store" });
    res.end();
  }

  function handleRevoke(req, res) {
    // The frontend logout contract never calls the provider before redirecting; the SDK
    // revocation path is accepted here so upstream logout navigation stays functional.
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({}));
  }

  const tlsServer = https.createServer(
    { key: fs.readFileSync(config.tlsKey), cert: fs.readFileSync(config.tlsCert) },
    (req, res) => {
      const url = new URL(req.url, config.issuer);
      Promise.resolve()
        .then(async () => {
          if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
            return handleDiscovery(res);
          }
          if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") {
            return handleJwks(res);
          }
          if (req.method === "GET" && url.pathname === "/authorize") {
            return handleAuthorize(req, res, url);
          }
          if (req.method === "POST" && url.pathname === "/oauth/token") {
            return handleToken(req, res);
          }
          if (req.method === "POST" && url.pathname === "/oauth/revoke") {
            return handleRevoke(req, res);
          }
          if (req.method === "GET" && url.pathname === "/userinfo") {
            return handleUserinfo(req, res);
          }
          if (req.method === "GET" && url.pathname === "/oidc/logout") {
            return handleLogout(req, res, url);
          }
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "not_found" }));
        })
        .catch(() => {
          if (!res.headersSent) {
            res.writeHead(500, { "content-type": "application/json" });
          }
          res.end(JSON.stringify({ error: "server_error" }));
        });
    }
  );

  const adminServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${config.adminPort}`);
    const header = req.headers.authorization ?? "";
    if (header !== `Bearer ${config.adminToken}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    let body = {};
    try {
      const bodyText = await readBody(req);
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid_json" }));
      return;
    }
    const ok = () => {
      res.writeHead(204);
      res.end();
    };
    if (req.method === "POST" && url.pathname === "/admin/next-user") {
      nextUser = {
        sub: String(body.sub),
        email: body.email === undefined ? undefined : String(body.email),
        emailVerified: body.emailVerified === undefined ? undefined : Boolean(body.emailVerified),
        name: body.name === undefined ? undefined : String(body.name)
      };
      return ok();
    }
    if (req.method === "POST" && url.pathname === "/admin/outage") {
      outage = String(body.mode);
      return ok();
    }
    if (req.method === "POST" && url.pathname === "/admin/rotate-key") {
      keys = [generateSigningKey(`auth006-key-${++keySequence}`)];
      return ok();
    }
    if (req.method === "POST" && url.pathname === "/admin/revoke-refresh-tokens") {
      const sub = body.sub === undefined ? undefined : String(body.sub);
      for (const [, record] of refreshTokens) {
        if (sub === undefined || record.user.sub === sub) record.revoked = true;
      }
      return ok();
    }
    if (req.method === "POST" && url.pathname === "/admin/reset") {
      outage = "off";
      nextUser = null;
      return ok();
    }
    if (req.method === "GET" && url.pathname === "/admin/stats") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          outage,
          keys: keys.map((key) => key.kid),
          outstandingCodes: codes.size,
          outstandingRefreshTokens: refreshTokens.size,
          nextUserSub: nextUser?.sub ?? null
        })
      );
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  return {
    async start() {
      await new Promise((resolve) => tlsServer.listen(config.tlsPort, "127.0.0.1", resolve));
      await new Promise((resolve) => adminServer.listen(config.adminPort, "127.0.0.1", resolve));
    },
    async stop() {
      await new Promise((resolve) => {
        tlsServer.closeAllConnections?.();
        tlsServer.close(() => resolve());
      });
      await new Promise((resolve) => {
        adminServer.closeAllConnections?.();
        adminServer.close(() => resolve());
      });
    },
    currentKid() {
      return currentKey().kid;
    }
  };
}
