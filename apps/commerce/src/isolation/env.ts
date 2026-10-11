/**
 * Isolation guard for the Phase 1 Medusa base (TASK-COMMERCE-MEDUSA-BASE-001).
 *
 * The commerce service owns a dedicated database. It must never reuse the
 * Mystcrag user database and must never fall back to DATABASE_URL: a missing,
 * blank or shared configuration fails closed at config load time, before any
 * connection is attempted.
 *
 * The separation check compares the parsed PostgreSQL connection target
 * (host, port, database), not the raw string, so scheme aliases
 * (postgres/postgresql), credentials and loopback aliases cannot describe the
 * Mystcrag user database while looking different. Decoding follows the
 * installed pg-connection-string semantics exactly: the database name comes
 * from decodeURI of the URL path (reserved characters like "?" stay encoded,
 * so "foo%253F" and "foo%3F" are the same database) and the host from
 * decodeURIComponent (so "127%2E0%2E0%2E1" is loopback). A malformed
 * percent-escape cannot be resolved by the driver and fails closed.
 *
 * Query parameters that could influence the connection target are refused
 * outright on both URLs: "host" and "port" provably replace the URL's own
 * host/port in pg-connection-string, and "dbname"/"database" are refused
 * conservatively even though the installed build overwrites both from the URL
 * path, so the comparison never depends on one driver build's behaviour.
 *
 * A local .env file that declares COMMERCE_DATABASE_URL is refused outright:
 * the Medusa CLI preloads .env before medusa-config runs, so a value loaded
 * that way cannot be attributed to its source and must fail closed instead.
 * Detection follows dotenv's actual grammar (KEY=value and KEY: value, each
 * with an optional "export " prefix), not one chosen spelling.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

export const COMMERCE_DATABASE_URL_ENV = "COMMERCE_DATABASE_URL";

export const COMMERCE_LOCAL_CORS_DEFAULT = ["http://localhost:9000", "http://127.0.0.1:9000"];

type Env = Record<string, string | undefined>;

type PostgresTarget = {
  host: string;
  port: string;
  database: string;
};

const KNOWN_ENVIRONMENTS = ["staging", "production", "test"] as const;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

// Query parameters pg-connection-string applies over the URL's own host/port
// (verified against the installed build: "?host=...&port=..." wins over the
// URL's own values).
const PROVEN_OVERRIDE_QUERY_PARAMS = new Set(["host", "port"]);

// Database-name parameters are refused conservatively: the installed build
// overwrites both from the URL path, but the guard must not depend on one
// driver build's behaviour for its separation proof.
const CONSERVATIVELY_REFUSED_QUERY_PARAMS = new Set(["dbname", "database"]);

// dotenv's LINE regex accepts both "KEY=value" and "KEY: value", each with an
// optional "export " prefix; match the declaration the loader would honour.
const LOCAL_ENV_DECLARATION = /^\s*(?:export\s+)?COMMERCE_DATABASE_URL\s*[:=]/m;

function parsePostgresTarget(label: string, raw: string): PostgresTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL (postgres:// or postgresql://).`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${label} must be a PostgreSQL URL; received protocol "${url.protocol}".`);
  }

  for (const name of url.searchParams.keys()) {
    const parameter = name.toLowerCase();
    if (PROVEN_OVERRIDE_QUERY_PARAMS.has(parameter)) {
      throw new Error(
        `${label} must not set the "${name}" query parameter: the PostgreSQL driver applies it over the URL's own ` +
          "host and port, so the isolation comparison would not see the real connection target."
      );
    }
    if (CONSERVATIVELY_REFUSED_QUERY_PARAMS.has(parameter)) {
      throw new Error(
        `${label} must not set the "${name}" query parameter: the isolation guard compares the URL's own database ` +
          "path and refuses database-name parameters outright rather than depend on driver-version behaviour."
      );
    }
  }

  let hostname: string;
  try {
    // pg-connection-string decodes the hostname with decodeURIComponent, so an
    // encoded spelling like "127%2E0%2E0%2E1" reaches the driver as 127.0.0.1
    // and must compare as the same host here as well; a malformed escape fails
    // closed because the driver could not resolve it either.
    hostname = decodeURIComponent(url.hostname).trim().toLowerCase();
  } catch {
    throw new Error(`${label} must include a database host with valid percent-encoding.`);
  }
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  if (!hostname) {
    throw new Error(`${label} must include a database host.`);
  }

  let database: string;
  try {
    // pg-connection-string resolves the database with decodeURI, which keeps
    // reserved characters (like "?" and "/") encoded; two spellings the driver
    // maps to the same name ("foo%253F" and "foo%3F") must compare equal here.
    database = decodeURI(url.pathname).replace(/^\/+|\/+$/g, "");
  } catch {
    throw new Error(`${label} must name exactly one database in its URL path.`);
  }
  if (!database || database.includes("/")) {
    throw new Error(`${label} must name exactly one database in its URL path.`);
  }

  return {
    host: LOOPBACK_HOSTS.has(hostname) ? "loopback" : hostname,
    port: url.port || "5432",
    database
  };
}

function samePostgresTarget(left: PostgresTarget, right: PostgresTarget): boolean {
  return left.host === right.host && left.port === right.port && left.database === right.database;
}

export function resolveCommerceDatabaseUrl(env: Env): string {
  const isolated = env[COMMERCE_DATABASE_URL_ENV]?.trim();
  if (!isolated) {
    throw new Error(
      `${COMMERCE_DATABASE_URL_ENV} is required for the isolated commerce service. ` +
        "The commerce service never falls back to DATABASE_URL."
    );
  }
  const isolatedTarget = parsePostgresTarget(COMMERCE_DATABASE_URL_ENV, isolated);

  const userDatabaseUrl = env.DATABASE_URL?.trim();
  if (userDatabaseUrl) {
    const userTarget = parsePostgresTarget("DATABASE_URL", userDatabaseUrl);
    if (samePostgresTarget(userTarget, isolatedTarget)) {
      throw new Error(
        `${COMMERCE_DATABASE_URL_ENV} must be a separate database from DATABASE_URL. ` +
          "Point it at the isolated commerce database instead of the Mystcrag user database."
      );
    }
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

function localEnvFilesLoadedByMedusa(nodeEnv: string | undefined): string[] {
  const environment = (nodeEnv ?? "").trim() || "development";
  return (KNOWN_ENVIRONMENTS as readonly string[]).includes(environment)
    ? [`.env.${environment}`, ".env"]
    : [".env"];
}

function readLocalEnvFile(directory: string, fileName: string): string | undefined {
  try {
    return readFileSync(path.join(directory, fileName), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export function findLocalEnvFileDeclaringCommerceDatabaseUrl(
  directory: string,
  nodeEnv?: string
): string | undefined {
  for (const fileName of localEnvFilesLoadedByMedusa(nodeEnv)) {
    const source = readLocalEnvFile(directory, fileName);
    if (source && LOCAL_ENV_DECLARATION.test(source)) {
      return fileName;
    }
  }
  return undefined;
}

export function assertCommerceDatabaseUrlNotDeclaredInLocalEnv(directory: string, nodeEnv?: string): void {
  const fileName = findLocalEnvFileDeclaringCommerceDatabaseUrl(directory, nodeEnv);
  if (fileName) {
    throw new Error(
      `${COMMERCE_DATABASE_URL_ENV} is declared in ${fileName}. The isolated commerce database URL ` +
        `must be provided through the process environment so the isolation guard can attribute its source; ` +
        `remove the declaration from ${fileName} and export the variable instead.`
    );
  }
}