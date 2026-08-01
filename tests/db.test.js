import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGlobalRateLimit, purgeExpiredRoasts } from "../src/db.js";

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

test("purgeExpiredRoasts deletes old rows and screenshots", async () => {
  const deletedKeys = [];
  const deletedIds = [];
  const env = {
    SCREENSHOTS: {
      delete: async (key) => deletedKeys.push(key)
    },
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            this._args = args;
            return this;
          },
          async all() {
            if (sql.includes("SELECT id, screenshot_key")) {
              return {
                results: [
                  { id: "old1", screenshot_key: "screenshots/old1.jpg" },
                  { id: "old2", screenshot_key: "screenshots/old2.jpg" }
                ]
              };
            }
            return { results: [] };
          },
          async run() {
            if (sql.includes("DELETE FROM roasts")) {
              deletedIds.push(...(this._args || []));
            }
            return { success: true };
          }
        };
      }
    }
  };

  const result = await purgeExpiredRoasts(env, 90);
  assert.equal(result.deletedRoasts, 2);
  assert.equal(result.deletedScreenshots, 2);
  assert.deepEqual(deletedKeys, ["screenshots/old1.jpg", "screenshots/old2.jpg"]);
  assert.deepEqual(deletedIds, ["old1", "old2"]);
});
