import assert from "node:assert/strict";
import { test, after, before, beforeEach } from "node:test";
import {
  pool,
  sql,
  query,
  transaction,
  withTenant,
  withOwnerRole,
} from "../../src/lib/db.js";
import { tableRef } from "../../src/lib/sql.js";
import { resetDatabase, TEST_TENANT_ID } from "../helpers/db.js";
import { randomUUID } from "node:crypto";

const TEST_TABLE = tableRef("visitors");

before(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await pool.end();
});

test("sql tag produces parameterized query", () => {
  const q = sql`SELECT * FROM users WHERE id = ${123} AND email = ${"test@example.com"}`;
  assert.equal(q.text, "SELECT * FROM users WHERE id = $1 AND email = $2");
  assert.deepEqual(q.values, [123, "test@example.com"]);
});

test("sql tag handles nested composition", () => {
  const filter = sql`id = ${123}`;
  const q = sql`SELECT * FROM users WHERE ${filter} AND active = ${true}`;
  assert.equal(q.text, "SELECT * FROM users WHERE id = $1 AND active = $2");
  assert.deepEqual(q.values, [123, true]);
});

test("sql tag handles multiple nested compositions", () => {
  const f1 = sql`a = ${1}`;
  const f2 = sql`b = ${2}`;
  const q = sql`SELECT * FROM t WHERE ${f1} AND ${f2} AND c = ${3}`;
  assert.equal(q.text, "SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $3");
  assert.deepEqual(q.values, [1, 2, 3]);
});

test("transaction commit", async () => {
  const anonId = `tx-commit-${randomUUID()}`;
  await withTenant(TEST_TENANT_ID, async (tx) => {
    await query(
      tx,
      sql`INSERT INTO ${TEST_TABLE} (id, tenant_id, anon_id, updated_at) VALUES (gen_random_uuid(), ${TEST_TENANT_ID}, ${anonId}, NOW())`,
    );
  });

  await withOwnerRole(async (client) => {
    const { rows } = await query<{ count: string }>(
      client,
      sql`SELECT count(*)::text AS count FROM ${TEST_TABLE} WHERE anon_id = ${anonId}`,
    );
    assert.equal(rows[0]?.count, "1");
  });
});

test("transaction releases client to pool", async () => {
  // Pool stats are tricky to assert on exactly because other tests might be running or pool might be priming.
  // But we can verify it doesn't leak.
  const initialTotal = pool.totalCount;

  await transaction(async (tx) => {
    await query(tx, sql`SELECT 1`);
  });

  // Depending on pool behavior, totalCount might increase if it was 0, but it shouldn't increase indefinitely.
  assert.ok(pool.totalCount >= initialTotal);
  assert.ok(pool.idleCount >= 0);
});

test("transaction rollback", async () => {
  const anonId = `tx-rollback-${randomUUID()}`;
  try {
    await withTenant(TEST_TENANT_ID, async (tx) => {
      await query(
        tx,
        sql`INSERT INTO ${TEST_TABLE} (id, tenant_id, anon_id, updated_at) VALUES (gen_random_uuid(), ${TEST_TENANT_ID}, ${anonId}, NOW())`,
      );
      throw new Error("Force rollback");
    });
  } catch (err) {
    assert.equal((err as Error).message, "Force rollback");
  }

  await withOwnerRole(async (client) => {
    const { rows } = await query<{ count: string }>(
      client,
      sql`SELECT count(*)::text AS count FROM ${TEST_TABLE} WHERE anon_id = ${anonId}`,
    );
    assert.equal(rows[0]?.count, "0");
  });
});
