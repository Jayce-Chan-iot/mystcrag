import { resolveAuthConfig } from "../../../apps/frontend/src/features/auth/model/auth-config.ts";

process.env.NODE_ENV = "production";
process.env.MYSTCRAG_APP_ORIGIN = "https://app.mystcrag.auth006.internal:18446";
process.env.MYSTCRAG_AUTH_PROVIDER = "auth0";
process.env.MYSTCRAG_AUTH_ISSUER = "https://synthetic.auth006.internal/";
process.env.MYSTCRAG_AUTH_AUDIENCE = "https://api.mystcrag.internal";
process.env.MYSTCRAG_AUTH_CLIENT_ID = "auth006-synthetic-client";
process.env.MYSTCRAG_AUTH_CLIENT_SECRET = "a".repeat(64);
process.env.MYSTCRAG_AUTH_CALLBACK_URL = "https://app.mystcrag.auth006.internal:18446/auth/callback";
process.env.MYSTCRAG_AUTH_LOGOUT_URL = "https://app.mystcrag.auth006.internal:18446";
process.env.MYSTCRAG_AUTH_SESSION_SECRET = "b".repeat(64);
process.env.MYSTCRAG_BACKEND_ORIGIN = "https://api.mystcrag.auth006.internal:18447";
process.env.MYSTCRAG_TAROT_ENABLED = "true";

try {
  const config = resolveAuthConfig();
  console.log("CONFIG OK:", JSON.stringify(config, null, 2));
} catch (error) {
  console.log("CONFIG THREW:", error instanceof Error ? error.message : error);
}
