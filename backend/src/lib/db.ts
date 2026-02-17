import pg from "pg";
import { env } from "../config/env.js";
import {
  resolveDatabaseSchema,
  toSearchPathOptions,
} from "./database-schema.js";

// Ensure the pg driver serialises and parses Date values in UTC so that
// `date` columns are not shifted by the server's local-time offset.
pg.defaults.parseInputDatesAsUTC = true;

// The `timestamp without time zone` columns (OID 1114) are stored without
// timezone info.  By default the pg driver interprets them using the
// process's local timezone.  Force UTC interpretation so that values
// round-trip correctly regardless of the host machine's timezone.
pg.types.setTypeParser(1114, (str: string) => new Date(str + "Z"));

export const databaseSchema = resolveDatabaseSchema({
  databaseUrl: env.DATABASE_URL,
  explicitSchema: process.env.DATABASE_SCHEMA,
});

const resolvePoolConfig = (): pg.PoolConfig => {
  const config: pg.PoolConfig = { connectionString: env.DATABASE_URL };
  const options = toSearchPathOptions(databaseSchema);
  if (options) {
    config.options = options;
  }
  return config;
};

export const pool = new pg.Pool(resolvePoolConfig());

// Initial role for all connections
pool.on("connect", (client) => {
  void client.query("SET ROLE app_user");
});

export interface SqlQuery {
  text: string;
  values: unknown[];
}

export const sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
): SqlQuery => {
  let text = strings[0] ?? "";
  const composedValues: unknown[] = [];

  for (let i = 0; i < values.length; i++) {
    const value = values[i];

    if (
      typeof value === "object" &&
      value !== null &&
      "text" in value &&
      "values" in value &&
      Array.isArray((value as SqlQuery).values)
    ) {
      const nestedSql = value as SqlQuery;
      // Re-index nested parameters
      const nestedText = nestedSql.text.replace(/\$(\d+)/g, (_, index) => {
        return `$${parseInt(index, 10) + composedValues.length}`;
      });
      text += nestedText + (strings[i + 1] ?? "");
      composedValues.push(...nestedSql.values);
    } else {
      composedValues.push(value);
      text += `$${composedValues.length}` + (strings[i + 1] ?? "");
    }
  }

  return { text, values: composedValues };
};

export const rawSql = (raw: string): SqlQuery => ({ text: raw, values: [] });

export const emptySql = (): SqlQuery => ({ text: "", values: [] });

export const query = <T extends pg.QueryResultRow>(
  client: pg.PoolClient | pg.Pool,
  q: SqlQuery,
): Promise<pg.QueryResult<T>> => client.query<T>(q.text, q.values);

// ts-prune-ignore-next — used in tests; low-level primitive for non-tenant-scoped operations
export const transaction = async <T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ts-prune-ignore-next — consumed by service layer in MT-1 Phase 3
export const withTenant = async <T>(
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Ensure we are app_user (in case connection was leaked or reset)
    await client.query("SET ROLE app_user");
    // Set tenant context for RLS via DB function and active schema.
    await client.query("SELECT public.set_tenant_context($1::uuid, $2::text)", [
      tenantId,
      databaseSchema,
    ]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Escapes RLS by resetting the role to the table owner.
 * Used for background scripts (rollups, purge) that need cross-tenant access.
 */
export const withOwnerRole = async <T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("RESET ROLE");
    const result = await fn(client);
    return result;
  } finally {
    // Restore app_user for the next user of this connection
    await client.query("SET ROLE app_user").catch(() => {});
    client.release();
  }
};

/**
 * Escapes RLS by resetting the role to the table owner and starting a transaction.
 * Used for maintenance DDL (materialized view init/refresh).
 */
export const withOwnerTransaction = async <T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("RESET ROLE");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    // Restore app_user for the next user of this connection
    await client.query("SET ROLE app_user").catch(() => {});
    client.release();
  }
};
