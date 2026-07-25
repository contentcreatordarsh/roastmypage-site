import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGlobalRateLimit, releaseApiV1Quota } from "../src/db.js";

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

test("releaseApiV1Quota atomically restores a reserved daily quota", async () => {
  let sql;
  let bindings;
  const env = {
    DB: {
      prepare: (statement) => {
        sql = statement;
        return {
          bind: (...values) => {
            bindings = values;
            return {
              run: async () => ({ meta: { changes: 1 } })
            };
          }
        };
      }
    }
  };

  const released = await releaseApiV1Quota(env, "ip-hash");

  assert.equal(released, true);
  assert.match(sql, /request_count = request_count - 1/);
  assert.match(sql, /request_count > 0/);
  assert.match(bindings[0], /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(bindings[1], "ip-hash");
});

test("releaseApiV1Quota does not mask the original request failure", async () => {
  const env = {
    DB: {
      prepare: () => {
        throw new Error("D1 unavailable");
      }
    }
  };

  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await releaseApiV1Quota(env, "ip-hash"), false);
  } finally {
    console.error = originalError;
  }
});
