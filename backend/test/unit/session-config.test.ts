import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSecureSessionOptions } from "../../src/lib/session-config.js";

const SESSION_SECRET =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

test("buildSecureSessionOptions sets secure cookie in production", () => {
  const options = buildSecureSessionOptions({
    NODE_ENV: "production",
    SESSION_SECRET,
  });

  assert.equal(options.cookie?.secure, true);
  assert.equal(options.cookie?.httpOnly, true);
  assert.equal(options.cookie?.sameSite, "lax");
  assert.equal(options.key.length, 32);
});

test("buildSecureSessionOptions disables secure cookie outside production", () => {
  const options = buildSecureSessionOptions({
    NODE_ENV: "test",
    SESSION_SECRET,
  });

  assert.equal(options.cookie?.secure, false);
});
