import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/client/client.js";

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

export type DatabaseClient = PrismaClient;
