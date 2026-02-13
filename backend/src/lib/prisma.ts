import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const datasourceUrl = process.env.DATABASE_URL;
const fallbackSchema = process.env.DATABASE_SCHEMA?.trim();

if (!datasourceUrl) {
  throw new Error("DATABASE_URL is required to initialize PrismaClient");
}

const resolveSchemaName = (connectionString: string): string | undefined => {
  try {
    const parsed = new URL(connectionString);
    const schema = parsed.searchParams.get("schema")?.trim();
    return schema && schema.length > 0 ? schema : undefined;
  } catch {
    return undefined;
  }
};

export const databaseSchema =
  resolveSchemaName(datasourceUrl) ?? fallbackSchema ?? "public";

const adapter = new PrismaPg(
  {
    connectionString: datasourceUrl,
  },
  databaseSchema ? { schema: databaseSchema } : undefined,
);

export const prisma = new PrismaClient({
  adapter,
});
