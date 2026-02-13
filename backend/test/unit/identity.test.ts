import assert from "node:assert/strict";
import { test } from "node:test";

import { LinkSource, type Prisma } from "@prisma/client";

import {
  linkHeuristicVisitors,
  linkLeadToVisitor,
} from "../../src/services/identity.js";

test("linkLeadToVisitor does not overwrite stronger confidence", async () => {
  let updateCalled = false;
  let createCalled = false;

  const tx = {
    leadIdentity: {
      findFirst: async () => ({ id: "identity-1", confidence: 0.9 }),
      update: async () => {
        updateCalled = true;
      },
      create: async () => {
        createCalled = true;
      },
    },
  } as unknown as Prisma.TransactionClient;

  await linkLeadToVisitor(
    tx,
    "lead-1",
    "visitor-1",
    LinkSource.form_submit,
    0.5,
  );

  assert.equal(updateCalled, false);
  assert.equal(createCalled, false);
});

test("linkLeadToVisitor updates weaker existing confidence", async () => {
  let updatedConfidence = 0;

  const tx = {
    leadIdentity: {
      findFirst: async () => ({ id: "identity-1", confidence: 0.3 }),
      update: async (input: { data: { confidence: number } }) => {
        updatedConfidence = input.data.confidence;
      },
      create: async () => {
        throw new Error("unexpected create call");
      },
    },
  } as unknown as Prisma.TransactionClient;

  await linkLeadToVisitor(tx, "lead-1", "visitor-1", LinkSource.form_submit, 1);

  assert.equal(updatedConfidence, 1);
});

test("linkHeuristicVisitors creates links for matching candidates", async () => {
  const createdLinks: Array<{
    leadId: string;
    visitorId: string;
    linkSource: LinkSource;
    confidence: number;
  }> = [];
  let updateManyCalled = false;

  const tx = {
    visitor: {
      findMany: async () => [{ id: "visitor-2" }, { id: "visitor-3" }],
    },
    leadIdentity: {
      updateMany: async () => {
        updateManyCalled = true;
      },
      createMany: async (input: {
        data: Array<{
          leadId: string;
          visitorId: string;
          linkSource: LinkSource;
          confidence: number;
        }>;
      }) => {
        createdLinks.push(...input.data);
      },
    },
  } as unknown as Prisma.TransactionClient;

  const createdCount = await linkHeuristicVisitors(
    tx,
    "lead-1",
    "visitor-1",
    "ip-hash",
    "ua-hash",
  );

  assert.equal(createdCount, 2);
  assert.deepEqual(
    createdLinks.map((link) => link.visitorId),
    ["visitor-2", "visitor-3"],
  );
  assert.deepEqual(
    createdLinks.map((link) => link.linkSource),
    [LinkSource.same_ip_ua_window, LinkSource.same_ip_ua_window],
  );
  assert.deepEqual(
    createdLinks.map((link) => link.confidence),
    [0.35, 0.35],
  );
  assert.equal(updateManyCalled, true);
});
