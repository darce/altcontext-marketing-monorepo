import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// Test-only Prisma client instance using pg adapter.
// Required because driverAdapters preview feature is enabled in schema.
// Runtime code uses pg directly (src/lib/db.ts).

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });
