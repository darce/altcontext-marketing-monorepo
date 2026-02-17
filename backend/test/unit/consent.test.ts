import assert from "node:assert/strict";
import { test } from "node:test";

import type { PoolClient } from "pg";
import { ConsentStatus } from "../../src/lib/schema-enums.js";

import {
  applyConsentStatus,
  toConsentStatus,
} from "../../src/services/consent.js";

const TEST_TENANT_ID = "00000000-0000-4000-a000-000000000001";

test("toConsentStatus maps explicit values and defaults to pending", () => {
  assert.equal(toConsentStatus(undefined), ConsentStatus.pending);
  assert.equal(toConsentStatus("pending"), ConsentStatus.pending);
  assert.equal(toConsentStatus("express"), ConsentStatus.express);
  assert.equal(toConsentStatus("implied"), ConsentStatus.implied);
  assert.equal(toConsentStatus("withdrawn"), ConsentStatus.withdrawn);
});

test("applyConsentStatus updates lead status when changed and writes audit event", async () => {
  let queries: any[] = [];

  const tx = {
    query: async (text: string, values: any[]) => {
      queries.push({ text, values });
      // lead find:
      if (text.includes('SELECT "consent_status"')) {
        return { rows: [{ consent_status: ConsentStatus.pending }] };
      }
      // lead update:
      if (text.includes("UPDATE") && text.includes('"leads"')) {
        return { rows: [{ id: "lead-1" }] };
      }
      // audit create:
      if (text.includes("INSERT INTO") && text.includes('"consent_events"')) {
        return { rows: [{ id: "event-1" }] };
      }
      return { rows: [] };
    },
  } as unknown as PoolClient;

  await applyConsentStatus(
    tx,
    TEST_TENANT_ID,
    "lead-1",
    ConsentStatus.express,
    "form_submit",
    "ip-hash",
  );

  assert.equal(queries.length, 3);
  const updateQuery = queries.find(
    (q) => q.text.includes("UPDATE") && q.text.includes('"leads"'),
  );
  const insertQuery = queries.find(
    (q) =>
      q.text.includes("INSERT INTO") && q.text.includes('"consent_events"'),
  );
  assert.ok(updateQuery);
  assert.ok(insertQuery);
});

test("applyConsentStatus does not update lead when status is unchanged", async () => {
  let queries: any[] = [];

  const tx = {
    query: async (text: string, values: any[]) => {
      queries.push({ text, values });
      if (text.includes('SELECT "consent_status"')) {
        return { rows: [{ consent_status: ConsentStatus.withdrawn }] };
      }
      if (text.includes("INSERT INTO") && text.includes('"consent_events"')) {
        return { rows: [{ id: "event-1" }] };
      }
      return { rows: [] };
    },
  } as unknown as PoolClient;

  await applyConsentStatus(
    tx,
    TEST_TENANT_ID,
    "lead-1",
    ConsentStatus.withdrawn,
    "unsubscribe",
    "ip-hash",
  );

  const updateQuery = queries.find(
    (q) => q.text.includes("UPDATE") && q.text.includes('"leads"'),
  );
  const insertQuery = queries.find(
    (q) =>
      q.text.includes("INSERT INTO") && q.text.includes('"consent_events"'),
  );
  assert.equal(updateQuery, undefined);
  assert.ok(insertQuery);
});

test("applyConsentStatus no-ops when lead does not exist", async () => {
  let queries: any[] = [];

  const tx = {
    query: async (text: string, values: any[]) => {
      queries.push({ text, values });
      if (text.includes('SELECT "consent_status"')) {
        return { rows: [] }; // no lead
      }
      return { rows: [] };
    },
  } as unknown as PoolClient;

  await applyConsentStatus(
    tx,
    TEST_TENANT_ID,
    "missing-lead",
    ConsentStatus.pending,
    "unknown",
  );

  const insertQuery = queries.find(
    (q) =>
      q.text.includes("INSERT INTO") && q.text.includes('"consent_events"'),
  );
  assert.equal(insertQuery, undefined);
});
