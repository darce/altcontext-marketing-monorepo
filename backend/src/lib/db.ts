import pg from "pg";

// Ensure the pg driver serialises and parses Date values in UTC so that
// `date` columns are not shifted by the server's local-time offset.
pg.defaults.parseInputDatesAsUTC = true;

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

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

export const transaction = async <T>(
  // eslint-disable-next-line no-unused-vars
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
