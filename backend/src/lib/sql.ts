import { Prisma } from "@prisma/client";

import { databaseSchema } from "./prisma.js";

export const quoteIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;

export const tableRef = (
  tableName: string,
  schemaName: string = databaseSchema,
): Prisma.Sql =>
  Prisma.raw(`${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`);

export const typeRef = (
  typeName: string,
  schemaName: string = databaseSchema,
): Prisma.Sql =>
  Prisma.raw(`${quoteIdentifier(schemaName)}.${quoteIdentifier(typeName)}`);
