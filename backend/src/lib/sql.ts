import type { SqlQuery } from "./db.js";
import { rawSql, emptySql } from "./db.js";

const databaseSchema = process.env.DATABASE_SCHEMA || "public";

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
