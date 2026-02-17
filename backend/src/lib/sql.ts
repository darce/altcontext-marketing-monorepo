import type { SqlQuery } from "./db.js";
import { rawSql, emptySql } from "./db.js";
import { resolveDatabaseSchema } from "./database-schema.js";

const databaseSchema = resolveDatabaseSchema();

export const quoteIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

export const tableRef = (
  tableName: string,
  schemaName: string = databaseSchema,
): SqlQuery =>
  rawSql(`${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`);

export const typeRef = (
  typeName: string,
  schemaName: string = databaseSchema,
): SqlQuery =>
  rawSql(`${quoteIdentifier(schemaName)}.${quoteIdentifier(typeName)}`);

export { emptySql };
