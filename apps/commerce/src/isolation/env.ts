/**
 * Isolation guard for the Phase 1 Medusa base (TASK-COMMERCE-MEDUSA-BASE-001).
 *
 * The commerce service owns a dedicated database. It must never reuse the
 * Mystcrag user database and must never fall back to DATABASE_URL: a missing,
 * blank or shared configuration fails closed at config load time, before any
 * connection is attempted.
 */

export const COMMERCE_DATABASE_URL_ENV = "COMMERCE_DATABASE_URL";

export const COMMERCE_LOCAL_CORS_DEFAULT = ["http://localhost:9000", "http://127.0.0.1:9000"];

type Env = Record<string, string | undefined>;

export function resolveCommerceDatabaseUrl(env: Env): string {
  const isolated = env[COMMERCE_DATABASE_URL_ENV]?.trim();
  if (!isolated) {
    throw new Error(
      `${COMMERCE_DATABASE_URL_ENV} is required for the isolated commerce service. ` +
        "The commerce service never falls back to DATABASE_URL."
    );
  }
  const userDatabaseUrl = env.DATABASE_URL?.trim();
  if (userDatabaseUrl && userDatabaseUrl === isolated) {
    throw new Error(
      `${COMMERCE_DATABASE_URL_ENV} must be a separate database from DATABASE_URL. ` +
        "Point it at the isolated commerce database instead of the Mystcrag user database."
    );
  }
  return isolated;
}

export function resolveCommerceCorsUrl(name: string, env: Env): string {
  const value = env[name]?.trim();
  return value && value.length > 0 ? value : COMMERCE_LOCAL_CORS_DEFAULT.join(",");
}

export function resolveCommerceSecret(name: string, env: Env): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the isolated commerce service.`);
  }
  return value;
}