const DEFAULT_DATABASE_SCHEMA = "public";
const IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

const normalizeSchemaName = (
  value: string | null | undefined,
): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (!IDENTIFIER_REGEX.test(trimmed)) {
    throw new Error(`Invalid database schema name: ${value}`);
  }

  return trimmed;
};

const readSchemaFromUrl = (databaseUrl: string | undefined): string | null => {
  if (!databaseUrl) {
    return null;
  }

  try {
    const parsed = new URL(databaseUrl);
    return normalizeSchemaName(parsed.searchParams.get("schema"));
  } catch {
    return null;
  }
};

export interface ResolveDatabaseSchemaOptions {
  databaseUrl?: string | undefined;
  explicitSchema?: string | null | undefined;
}

export const resolveDatabaseSchema = (
  options: ResolveDatabaseSchemaOptions = {},
): string => {
  const explicitSchema = normalizeSchemaName(
    options.explicitSchema ?? process.env.DATABASE_SCHEMA,
  );
  const urlSchema = readSchemaFromUrl(
    options.databaseUrl ?? process.env.DATABASE_URL,
  );

  if (explicitSchema && urlSchema && explicitSchema !== urlSchema) {
    throw new Error(
      `DATABASE_SCHEMA (${explicitSchema}) does not match DATABASE_URL schema (${urlSchema})`,
    );
  }

  return explicitSchema ?? urlSchema ?? DEFAULT_DATABASE_SCHEMA;
};

export const toSearchPathOptions = (schema: string): string | undefined =>
  schema === DEFAULT_DATABASE_SCHEMA ? undefined : `-c search_path=${schema}`;
