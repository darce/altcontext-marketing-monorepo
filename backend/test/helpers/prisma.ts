import { config as loadEnv } from "dotenv";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  resolveDatabaseSchema,
  toSearchPathOptions,
} from "../../src/lib/database-schema.js";

loadEnv();

// Test-only Prisma client instance using pg adapter.
// Required because driverAdapters preview feature is enabled in schema.
// Runtime code uses pg directly (src/lib/db.ts).

const connectionString = process.env.DATABASE_URL;
const resolvePoolConfig = (): ConstructorParameters<typeof Pool>[0] => {
  const config: ConstructorParameters<typeof Pool>[0] = { connectionString };
  const schema = resolveDatabaseSchema({
    databaseUrl: connectionString,
    explicitSchema: process.env.DATABASE_SCHEMA,
  });
  const options = toSearchPathOptions(schema);
  if (options) {
    config.options = options;
  }
  return config;
};

const pool = new Pool(resolvePoolConfig());
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
