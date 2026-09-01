// Local-only diagnostic (not part of the suite): replicates the exact Auth0Client
// construction from apps/frontend/src/features/auth/server/auth0-server.ts and the
// middleware call from proxy.ts, so the swallowed error surfaces.
//
// Run:  cd apps/frontend && node ../../tests/auth-e2e/scripts/diag-sdk.mjs

import { NextRequest } from "next/server.js";
import { Auth0Client } from "@auth0/nextjs-auth0/server.js";

const hex = (c) => c.repeat(64);
const routes = {
  login: "/auth/__sdk_login",
  callback: "/auth/callback",
  logout: "/auth/__sdk_logout",
  profile: "/auth/__sdk_profile",
  accessToken: "/auth/__sdk_access_token",
  backChannelLogout: "/auth/__sdk_bcl",
  connectAccount: "/auth/__sdk_connect",
  mfaAuthenticators: "/auth/__sdk_mfa_authenticators",
  mfaChallenge: "/auth/__sdk_mfa_challenge",
  mfaAssociate: "/auth/__sdk_mfa_associate",
  mfaVerify: "/auth/__sdk_mfa_verify",
  passwordlessStart: "/auth/__sdk_passwordless_start",
  passwordlessVerify: "/auth/__sdk_passwordless_verify",
  passwordlessDbOtpChallenge: "/auth/__sdk_passwordless_db_challenge",
  passwordlessDbGetToken: "/auth__sdk_passwordless_db_token",
  passkeyRegister: "/auth/__sdk_passkey_register",
  passkeyChallenge: "/auth/__sdk_passkey_challenge",
  passkeyGetToken: "/auth__sdk_passkey_token",
  passkeyEnrollmentChallenge: "/auth__sdk_passkey_enroll_challenge",
  passkeyEnrollmentVerify: "/auth__sdk_passkey_enroll_verify"
};

function buildClient(appBaseUrl, cookieName, secure) {
  return new Auth0Client({
    domain: "synthetic.auth006.internal",
    clientId: "auth006-synthetic-client",
    clientSecret: hex("a"),
    appBaseUrl,
    secret: hex("b"),
    authorizationParameters: {
      audience: "https://api.mystcrag.auth006.internal/",
      scope: "openid profile email",
      response_type: "code"
    },
    session: {
      rolling: true,
      inactivityDuration: 28800,
      absoluteDuration: 604800,
      cookie: { name: cookieName, sameSite: "lax", path: "/", secure }
    },
    enableAccessTokenEndpoint: false,
    enableConnectAccountEndpoint: false,
    onCallback: async () => new Response(null, { status: 303 }),
    routes
  });
}

async function attempt(label, appBaseUrl, cookieName, secure, requestUrl) {
  try {
    const client = buildClient(appBaseUrl, cookieName, secure);
    const req = new NextRequest(requestUrl);
    const res = await client.middleware(req);
    console.log(`${label}: OK (status ${res.status})`);
    return true;
  } catch (error) {
    console.log(`${label}: THREW`);
    console.log("  name:", error?.name);
    console.log("  message:", error?.message);
    console.log("  stack:", String(error?.stack).split("\n").slice(0, 6).join("\n    "));
    return false;
  }
}

const appBaseUrl = process.env.DIAG_APP_BASE_URL ?? "https://app.mystcrag.auth006.internal:18446";
const requestUrl = process.env.DIAG_REQUEST_URL ?? "http://127.0.0.1:18461/";
console.log(`NODE_ENV=${process.env.NODE_ENV} appBaseUrl=${appBaseUrl} requestUrl=${requestUrl}`);
await attempt("prod-cookie __Host- on appBaseUrl origin", appBaseUrl, "__Host-mystcrag_session", true, requestUrl);
