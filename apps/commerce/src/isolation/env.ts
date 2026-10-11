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
 * Mystcrag user database while looking different.
 *
 * Query parameters that the PostgreSQL driver applies on top of the URL's own
 * target (host, port, dbname, database) are refused outright on both URLs:
 * pg-connection-string copies them onto the client config and only then falls
 * back to the URL hostname/port, so comparing the URL would compare something
 * other than the real connection target.
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

// Query parameter names that pg-connection-string applies over the URL's own
// host/port/database instead of treating them as extras.
const TARGET_OVERRIDE_QUERY_PARAMS = new Set(["host", "port", "dbname", "database"]);

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
    if (TARGET_OVERRIDE_QUERY_PARAMS.has(name.toLowerCase())) {
      throw new Error(
        `${label} must not set the "${name}" query parameter: the PostgreSQL driver applies it on top of the URL's own ` +
          "host, port and database, so the isolation comparison would not see the real connection target."
      );
    }
  }

  let hostname = url.hostname.trim().toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  if (!hostname) {
    throw new Error(`${label} must include a database host.`);
  }

  let database: string;
  try {
    database = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, "");
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