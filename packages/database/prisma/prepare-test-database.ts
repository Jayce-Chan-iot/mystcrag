import pg from "pg";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for pnpm db:test");
}

const target = new URL(testDatabaseUrl);
const databaseName = decodeURIComponent(target.pathname.slice(1));
const ownerName = decodeURIComponent(target.username);
if (!/^mystcrag_[a-z0-9_]*test[a-z0-9_]*$/.test(databaseName)) {
  throw new Error(
    "TEST_DATABASE_URL must target a dedicated database named mystcrag_*test*"
  );
}
if (!/^[a-z_][a-z0-9_]*$/.test(ownerName)) {
  throw new Error("TEST_DATABASE_URL must use a simple PostgreSQL role name");
}

const admin = new URL(target);
admin.pathname = "/postgres";
admin.searchParams.delete("schema");

const adminClient = new pg.Client({ connectionString: admin.toString() });
await adminClient.connect();
try {
  const existing = await adminClient.query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
    [databaseName]
  );
  if (!existing.rows[0]?.exists) {
    await adminClient.query(`CREATE DATABASE "${databaseName}" OWNER "${ownerName}"`);
    console.log(`Created isolated PostgreSQL test database ${databaseName}`);
  } else {
    const targetClient = new pg.Client({ connectionString: target.toString() });
    await targetClient.connect();
    try {
      const tables = await targetClient.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM information_schema.tables WHERE table_schema = 'public'"
      );
      if (tables.rows[0]?.count !== "0") {
        throw new Error(
          `Test database ${databaseName} is not empty; provide a fresh TEST_DATABASE_URL`
        );
      }
      console.log(`Using existing empty PostgreSQL test database ${databaseName}`);
    } finally {
      await targetClient.end();
    }
  }
} finally {
  await adminClient.end();
}
