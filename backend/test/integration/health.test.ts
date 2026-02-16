import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createApp } from "../../src/app.js";
import { closeDatabase, resetDatabase } from "../helpers/db.js";

let app: Awaited<ReturnType<typeof createApp>>;

before(async () => {
  app = await createApp();
  await resetDatabase();
});

after(async () => {
  await app.close();
  await closeDatabase();
});

test("GET /v1/healthz returns 200 OK", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/v1/healthz",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "backend");
});
