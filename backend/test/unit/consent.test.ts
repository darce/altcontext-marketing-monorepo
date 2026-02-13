import assert from "node:assert/strict";
import { test } from "node:test";

import { ConsentStatus, type Prisma } from "@prisma/client";

import {
  applyConsentStatus,
  toConsentStatus,
} from "../../src/services/consent.js";

test("toConsentStatus maps explicit values and defaults to pending", () => {
  assert.equal(toConsentStatus(undefined), ConsentStatus.pending);
  assert.equal(toConsentStatus("pending"), ConsentStatus.pending);
  assert.equal(toConsentStatus("express"), ConsentStatus.express);
  assert.equal(toConsentStatus("implied"), ConsentStatus.implied);
  assert.equal(toConsentStatus("withdrawn"), ConsentStatus.withdrawn);
});

test("applyConsentStatus updates lead status when changed and writes audit event", async () => {
  let updateCalls = 0;
  let createdEvents = 0;

  const tx = {
    lead: {
      findUnique: async () => ({ consentStatus: ConsentStatus.pending }),
      update: async () => {
        updateCalls += 1;
      },
    },
    consentEvent: {
      create: async () => {
        createdEvents += 1;
      },
    },
  } as unknown as Prisma.TransactionClient;

  await applyConsentStatus(
    tx,
    "lead-1",
    ConsentStatus.express,
    "form_submit",
    "ip-hash",
  );

  assert.equal(updateCalls, 1);
  assert.equal(createdEvents, 1);
});

test("applyConsentStatus does not update lead when status is unchanged", async () => {
  let updateCalls = 0;
  let createdEvents = 0;

  const tx = {
    lead: {
      findUnique: async () => ({ consentStatus: ConsentStatus.withdrawn }),
      update: async () => {
        updateCalls += 1;
      },
    },
    consentEvent: {
      create: async () => {
        createdEvents += 1;
      },
    },
  } as unknown as Prisma.TransactionClient;

  await applyConsentStatus(
    tx,
    "lead-1",
    ConsentStatus.withdrawn,
    "unsubscribe",
    "ip-hash",
  );

  assert.equal(updateCalls, 0);
  assert.equal(createdEvents, 1);
});

test("applyConsentStatus no-ops when lead does not exist", async () => {
  let createdEvents = 0;

  const tx = {
    lead: {
      findUnique: async () => null,
      update: async () => {
        throw new Error("unexpected update call");
      },
    },
    consentEvent: {
      create: async () => {
        createdEvents += 1;
      },
    },
  } as unknown as Prisma.TransactionClient;

  await applyConsentStatus(
    tx,
    "missing-lead",
    ConsentStatus.pending,
    "unknown",
  );

  assert.equal(createdEvents, 0);
});
