/**
 * Direct SQL access to THIS run's isolated database, for identity-mapping and
 * isolation assertions that must be proven at the storage layer.
 *
 * The connection string always targets the isolated run database — never a
 * developer database — and is only usable while the stack is up.
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isolatedDatabaseUrl } from "./run-state";

const REPO_ROOT = path.resolve(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "..", "..");

type Pool = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

function loadPg(): { Pool: new (options: { connectionString: string }) => Pool } {
  const require = createRequire(path.join(REPO_ROOT, "packages", "database", "package.json"));
  return require("pg");
}

export async function withIsolatedDatabase<T>(
  execute: (query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>
): Promise<T> {
  const pg = loadPg();
  const pool = new pg.Pool({ connectionString: await isolatedDatabaseUrl() });
  try {
    return await execute((sql, values) => pool.query(sql, values));
  } finally {
    await pool.end();
  }
}

export type ExternalIdentityRow = {
  id: string;
  issuer: string;
  subject: string;
  user_id: string;
  email: string | null;
  email_verified: boolean | null;
  display_name: string | null;
};

export async function externalIdentities(): Promise<ExternalIdentityRow[]> {
  return withIsolatedDatabase(async (query) => {
    const result = await query("SELECT * FROM external_identities ORDER BY subject");
    return result.rows as unknown as ExternalIdentityRow[];
  });
}

export async function userCount(): Promise<number> {
  return withIsolatedDatabase(async (query) => {
    const result = await query("SELECT COUNT(*)::int AS count FROM users");
    return Number(result.rows[0]?.count ?? 0);
  });
}

/** Users that have no external identity mapping (orphan detection). */
export async function orphanUserCount(): Promise<number> {
  return withIsolatedDatabase(async (query) => {
    const result = await query(`
      SELECT COUNT(*)::int AS count FROM users u
      WHERE NOT EXISTS (SELECT 1 FROM external_identities ei WHERE ei.user_id = u.id)
    `);
    return Number(result.rows[0]?.count ?? 0);
  });
}

export async function designOwnerCount(): Promise<number> {
  return withIsolatedDatabase(async (query) => {
    const result = await query("SELECT COUNT(DISTINCT owner_id)::int AS count FROM designs");
    return Number(result.rows[0]?.count ?? 0);
  });
}

export async function designsOwnedBy(userId: string): Promise<string[]> {
  return withIsolatedDatabase(async (query) => {
    const result = await query("SELECT id FROM designs WHERE owner_id = $1 ORDER BY id", [userId]);
    return result.rows.map((row) => String(row.id));
  });
}

export async function tarotSessionOwners(): Promise<Array<{ id: string; owner_id: string }>> {
  return withIsolatedDatabase(async (query) => {
    const result = await query("SELECT id, owner_id FROM tarot_sessions ORDER BY id");
    return result.rows as unknown as Array<{ id: string; owner_id: string }>;
  });
}
