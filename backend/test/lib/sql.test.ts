import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDatabaseSchema } from "../../src/lib/database-schema.js";
import { quoteIdentifier, tableRef, typeRef } from "../../src/lib/sql.js";

test("quoteIdentifier quotes correctly", () => {
  assert.equal(quoteIdentifier("users"), '"users"');
  assert.equal(quoteIdentifier('table "name"'), '"table ""name"""');
});

test("tableRef produces schema-qualified reference", () => {
  const schema = resolveDatabaseSchema();
  const ref = tableRef("visitors");
  assert.equal(ref.text, `"${schema}"."visitors"`);
  assert.equal(ref.values.length, 0);

  const customRef = tableRef("visitors", "custom");
  assert.equal(customRef.text, '"custom"."visitors"');
});

test("typeRef produces schema-qualified reference", () => {
  const schema = resolveDatabaseSchema();
  const ref = typeRef("ConsentStatus");
  assert.equal(ref.text, `"${schema}"."ConsentStatus"`);
  assert.equal(ref.values.length, 0);

  const customRef = typeRef("ConsentStatus", "auth");
  assert.equal(customRef.text, '"auth"."ConsentStatus"');
});
