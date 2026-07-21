import type { DatabaseClient } from "./prisma-client.js";

export async function withDatabaseClient<T>(
  client: DatabaseClient,
  operation: (client: DatabaseClient) => Promise<T>
): Promise<T> {
  try {
    await client.$connect();
    return await operation(client);
  } finally {
    await client.$disconnect();
  }
}
