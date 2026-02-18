import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BOOTSTRAP_PASSWORD_MIN_LENGTH,
  isBootstrapPasswordValid,
} from "../../src/services/auth.js";

test("isBootstrapPasswordValid enforces minimum bootstrap password length", () => {
  assert.equal(isBootstrapPasswordValid("x".repeat(11)), false);
  assert.equal(isBootstrapPasswordValid("x".repeat(12)), true);
  assert.equal(
    isBootstrapPasswordValid("x".repeat(BOOTSTRAP_PASSWORD_MIN_LENGTH)),
    true,
  );
});
