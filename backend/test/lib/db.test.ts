import assert from "node:assert/strict";
import { test, after, before, beforeEach } from "node:test";
import { pool, sql, query, transaction } from "../../src/lib/db.js";
import { tableRef } from "../../src/lib/sql.js";
import { resetDatabase } from "../helpers/db.js";
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
  await transaction(async (tx) => {
    await query(
      tx,
      sql`INSERT INTO ${TEST_TABLE} (id, anon_id, updated_at) VALUES (gen_random_uuid(), ${anonId}, NOW())`,
    );
  });

  const { rows } = await pool.query(
    `SELECT count(*) FROM ${TEST_TABLE.text} WHERE anon_id = '${anonId}'`,
  );
  assert.equal(rows[0].count, "1");
});

test("transaction releases client to pool", async () => {
  const initialTotal = pool.totalCount;
  const initialIdle = pool.idleCount;

  await transaction(async (tx) => {
    await query(tx, sql`SELECT 1`);
  });

  assert.equal(pool.totalCount, initialTotal);
  assert.equal(pool.idleCount, initialIdle);
});

test("transaction rollback", async () => {
  const anonId = `tx-rollback-${randomUUID()}`;
  try {
    await transaction(async (tx) => {
      await query(
        tx,
        sql`INSERT INTO ${TEST_TABLE} (id, anon_id, updated_at) VALUES (gen_random_uuid(), ${anonId}, NOW())`,
      );
      throw new Error("Force rollback");
    });
  } catch (err) {
    assert.equal((err as Error).message, "Force rollback");
  }

  const { rows } = await pool.query(
    `SELECT count(*) FROM ${TEST_TABLE.text} WHERE anon_id = 'tx-rollback'`,
  );
  assert.equal(rows[0].count, "0");
});
