import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGlobalRateLimit } from "../src/db.js";

test("checkGlobalRateLimit fails closed when KV is unavailable", async () => {
  const env = {
    CONFIG: {
      get: async () => {
        throw new Error("KV unavailable");
      }
    }
  };

  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await checkGlobalRateLimit(env);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /temporarily unavailable/i);
  } finally {
    console.error = originalError;
  }
});

test("checkGlobalRateLimit increments an available hourly bucket", async () => {
  const writes = [];
  const env = {
    CONFIG: {
      get: async () => "0",
      put: async (...args) => writes.push(args)
    }
  };

  const result = await checkGlobalRateLimit(env);
  assert.deepEqual(result, { allowed: true });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1], "1");
  assert.deepEqual(writes[0][2], { expirationTtl: 7200 });
});
