import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveDatabaseSchema,
  toSearchPathOptions,
} from "../../src/lib/database-schema.js";

test("resolveDatabaseSchema prefers explicit schema when URL has none", () => {
  const schema = resolveDatabaseSchema({
    databaseUrl: "postgresql://localhost:5432/altcontext_dev",
    explicitSchema: "backend_test",
  });
  assert.equal(schema, "backend_test");
});

test("resolveDatabaseSchema reads schema from DATABASE_URL query param", () => {
  const schema = resolveDatabaseSchema({
    databaseUrl:
      "postgresql://localhost:5432/altcontext_dev?schema=backend_test",
  });
  assert.equal(schema, "backend_test");
});

test("resolveDatabaseSchema rejects conflicting URL and explicit schema", () => {
  assert.throws(
    () =>
      resolveDatabaseSchema({
        databaseUrl:
          "postgresql://localhost:5432/altcontext_dev?schema=backend_test",
        explicitSchema: "public",
      }),
    /does not match/,
  );
});

test("toSearchPathOptions omits options for public schema", () => {
  assert.equal(toSearchPathOptions("public"), undefined);
  assert.equal(
    toSearchPathOptions("backend_test"),
    "-c search_path=backend_test",
  );
});
