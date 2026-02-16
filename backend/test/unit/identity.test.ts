import assert from "node:assert/strict";
import { test } from "node:test";
import { LinkSource } from "@prisma/client";
import {
  linkHeuristicVisitors,
  linkLeadToVisitor,
} from "../../src/services/identity.js";

// Mock pg.PoolClient
const createMockTx = (
  queryHandler: (text: string, values: any[]) => Promise<any>,
) =>
  ({
    query: async (text: string, values: any[]) => queryHandler(text, values),
    connect: async () => {},
    release: async () => {},
  }) as any;

test("linkLeadToVisitor does not overwrite stronger confidence", async () => {
  let updateCalled = false;
  let createCalled = false;

  const tx = createMockTx(async (text, values) => {
    // Mock SELECT lead_identities (find existing)
    if (text.includes('SELECT "id", "confidence"')) {
      return {
        rows: [
          { id: "identity-1", confidence: 0.9, link_source: "form_submit" },
        ],
      };
    }
    // Mock UPDATE
    if (text.includes("UPDATE")) {
      updateCalled = true;
      return { rows: [] };
    }
    // Mock INSERT
    if (text.includes("INSERT")) {
      createCalled = true;
      return { rows: [] };
    }
    return { rows: [] };
  });

  await linkLeadToVisitor(
    tx,
    "lead-1",
    "visitor-1",
    LinkSource.form_submit,
    0.5, // weaker than 0.9
  );

  assert.equal(updateCalled, false);
  assert.equal(createCalled, false);
});

test("linkLeadToVisitor updates weaker existing confidence", async () => {
  let updatedConfidence = 0;

  const tx = createMockTx(async (text, values) => {
    // Mock SELECT (find existing weak)
    if (text.includes('SELECT "id"')) {
      return {
        rows: [
          { id: "identity-1", confidence: 0.3, link_source: "form_submit" },
        ],
      };
    }
    // Mock UPDATE
    if (text.includes("UPDATE")) {
      // Extract confidence from values.
      // Query: UPDATE ... SET "confidence" = $1 ... WHERE "id" = $2
      // Actually values order depends on sql definition.
      // "confidence" = ${confidence}, "linked_at" = NOW() WHERE "id" = ${existing.id}
      updatedConfidence = values[0];
      return { rows: [] };
    }
    return { rows: [] };
  });

  await linkLeadToVisitor(tx, "lead-1", "visitor-1", LinkSource.form_submit, 1);

  assert.equal(updatedConfidence, 1);
});

test("linkHeuristicVisitors creates links for matching candidates", async () => {
  let createdLinksCount = 0;
  let updateManyCalled = false;
  let insertManyCalled = false;

  const tx = createMockTx(async (text, values) => {
    // Mock SELECT candidates
    if (
      text.includes("SELECT") &&
      text.includes('"visitors"') &&
      text.includes('"last_ip_hash"')
    ) {
      return { rows: [{ id: "visitor-2" }, { id: "visitor-3" }] };
    }

    // Mock UPDATE existing links
    if (text.includes("UPDATE") && text.includes('"lead_identities"')) {
      updateManyCalled = true;
      return { rows: [] };
    }

    // Mock INSERT new links
    if (text.includes("INSERT INTO") && text.includes('"lead_identities"')) {
      insertManyCalled = true;
      // The candidates array is passed in values.
      // values index depends on query construction.
      // FROM UNNEST(${candidateVisitorIds}::text[])
      // verify one of values is the array
      const candidates = values.find((v) => Array.isArray(v));
      if (candidates && candidates.includes("visitor-2")) {
        createdLinksCount = candidates.length;
      }
      return { rows: [] };
    }

    return { rows: [] };
  });

  const count = await linkHeuristicVisitors(
    tx,
    "lead-1",
    "visitor-1",
    "ip-hash",
    "ua-hash",
  );

  assert.equal(count, 2);
  assert.equal(updateManyCalled, true);
  assert.equal(insertManyCalled, true);
  // We can't easily capture the precise inserted rows without parsing SQL/values deeply,
  // but checking the mocked return count effectively verifies logic flow.
});
