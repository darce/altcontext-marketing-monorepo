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

const schema = resolveSchemaName(datasourceUrl) ?? fallbackSchema;

const adapter = new PrismaPg(
  {
    connectionString: datasourceUrl,
  },
  schema ? { schema } : undefined,
);

export const prisma = new PrismaClient({
  adapter,
});
