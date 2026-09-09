import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGlobalRateLimit, getCachedRoast, purgeExpiredScreenshots, pruneExpiredRateLimitRows, runRetentionCleanup, releaseApiV1Quota } from "../src/db.js";

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

test("getCachedRoast can return legacy audit data for non-persisting callers", async () => {
  const legacyRoast = {
    id: "legacy-1",
    url: "https://example.com/",
    url_hash: "hash",
    overall_score: 7,
    hero_score: 7,
    cta_score: 7,
    trust_score: 7,
    copy_score: 7,
    design_score: 7,
    roast_response: "Legacy roast",
    quick_wins: "[]",
    seo_data: null,
    performance_data: null,
    heatmap_data: null,
    industry: "other"
  };
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              first: async () => sql.includes("SELECT id, url") ? legacyRoast : { count: 1 }
            };
          }
        };
      }
    }
  };

  assert.equal(await getCachedRoast(env, "hash", legacyRoast.url), null);

  const cached = await getCachedRoast(
    env,
    "hash",
    legacyRoast.url,
    { requireAuditData: false }
  );
  assert.equal(cached.id, "legacy-1");
  assert.equal(cached.seo, null);
  assert.equal(cached.performance, null);
});

function mockDbRouter(handlers) {
  return {
    prepare(statement) {
      const handler = Object.entries(handlers).find(([needle]) => statement.includes(needle));
      if (!handler) {
        throw new Error(`Unexpected SQL: ${statement}`);
      }
      return handler[1](statement);
    }
  };
}

test("purgeExpiredScreenshots deletes R2 objects and clears keys without deleting roast rows", async () => {
  const selectBatches = [
    [{ id: "old-1", screenshot_key: "screenshots/old-1.jpg" }],
    [{ id: "old-2", screenshot_key: "screenshots/old-2.jpg" }],
    []
  ];
  const deletedScreenshots = [];
  const updateBatches = [];
  let selectCount = 0;
  let selectSql = "";
  let selectBindings = [];
  const env = {
    DB: mockDbRouter({
      "SELECT id, screenshot_key": () => ({
        bind(...values) {
          selectBindings = values;
          return {
            all: async () => ({ results: selectBatches[selectCount++] || [] })
          };
        }
      }),
      "UPDATE roasts SET screenshot_key = NULL": (statement) => {
        selectSql = selectSql || statement;
        return {
          bind(...ids) {
            updateBatches.push(ids);
            return {
              run: async () => ({ meta: { changes: ids.length } })
            };
          }
        };
      }
    }),
    SCREENSHOTS: {
      delete: async (key) => deletedScreenshots.push(key)
    }
  };

  const summary = await purgeExpiredScreenshots(env, { days: 7, batchSize: 1 });

  assert.equal(selectBindings[1], 1);
  assert.ok(deletedScreenshots.includes("screenshots/old-1.jpg"));
  assert.ok(deletedScreenshots.includes("screenshots/old-2.jpg"));
  assert.deepEqual(updateBatches, [["old-1"], ["old-2"]]);
  assert.equal(summary.days, 7);
  assert.equal(summary.scanned, 2);
  assert.equal(summary.deletedScreenshots, 2);
  assert.equal(summary.clearedKeys, 2);
  assert.equal(summary.batches, 2);
});

test("purgeExpiredScreenshots uses SCREENSHOT_RETENTION_DAYS env override", async () => {
  let selectBindings = [];
  const env = {
    SCREENSHOT_RETENTION_DAYS: "30",
    DB: mockDbRouter({
      "SELECT id, screenshot_key": () => ({
        bind(...values) {
          selectBindings = values;
          return { all: async () => ({ results: [] }) };
        }
      })
    }),
    SCREENSHOTS: { delete: async () => {} }
  };

  const summary = await purgeExpiredScreenshots(env);
  assert.equal(summary.days, 30);
  assert.match(selectBindings[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(selectBindings[1], 100);
});

test("purgeExpiredScreenshots keeps screenshot_key when R2 delete fails", async () => {
  const updateBatches = [];
  const env = {
    DB: mockDbRouter({
      "SELECT id, screenshot_key": () => ({
        bind() {
          return {
            all: async () => ({
              results: [
                { id: "bad-screenshot", screenshot_key: "screenshots/bad.jpg" },
                { id: "ok-screenshot", screenshot_key: "screenshots/ok.jpg" }
              ]
            })
          };
        }
      }),
      "UPDATE roasts SET screenshot_key = NULL": () => ({
        bind(...ids) {
          updateBatches.push(ids);
          return { run: async () => ({ meta: { changes: ids.length } }) };
        }
      })
    }),
    SCREENSHOTS: {
      delete: async (key) => {
        if (key.includes("bad")) throw new Error("R2 unavailable");
      }
    }
  };

  const originalError = console.error;
  console.error = () => {};
  try {
    const summary = await purgeExpiredScreenshots(env, { days: 90 });
    assert.deepEqual(updateBatches, [["ok-screenshot"]]);
    assert.equal(summary.clearedKeys, 1);
    assert.equal(summary.deletedScreenshots, 1);
    assert.equal(summary.failedScreenshots, 1);
  } finally {
    console.error = originalError;
  }
});

test("purgeExpiredScreenshots never issues DELETE FROM roasts", async () => {
  const statements = [];
  const env = {
    DB: {
      prepare(statement) {
        statements.push(statement);
        return {
          bind() {
            return {
              all: async () => ({ results: [] }),
              run: async () => ({ meta: { changes: 0 } })
            };
          }
        };
      }
    },
    SCREENSHOTS: { delete: async () => {} }
  };

  await purgeExpiredScreenshots(env, { days: 90 });
  assert.equal(statements.some((sql) => /DELETE\s+FROM\s+roasts/i.test(sql)), false);
});

test("pruneExpiredRateLimitRows deletes stale rate_limits and api_v1_counters", async () => {
  const deletes = [];
  const env = {
    DB: {
      prepare(statement) {
        return {
          bind(...values) {
            deletes.push({ statement, values });
            return {
              run: async () => ({ meta: { changes: statement.includes("rate_limits") ? 4 : 2 } })
            };
          }
        };
      }
    }
  };

  const summary = await pruneExpiredRateLimitRows(env);
  assert.equal(deletes.length, 2);
  assert.match(deletes[0].statement, /DELETE FROM rate_limits WHERE last_request < \?/);
  assert.match(deletes[1].statement, /DELETE FROM api_v1_counters WHERE day_key < \?/);
  assert.match(deletes[0].values[0], /^\d{4}-\d{2}-\d{2}T/);
  assert.match(deletes[1].values[0], /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(summary.deletedRateLimits, 4);
  assert.equal(summary.deletedApiCounters, 2);
});

test("runRetentionCleanup returns screenshot and counter summaries", async () => {
  const env = {
    DB: mockDbRouter({
      "SELECT id, screenshot_key": () => ({
        bind() {
          return { all: async () => ({ results: [] }) };
        }
      }),
      "DELETE FROM rate_limits": () => ({
        bind() {
          return { run: async () => ({ meta: { changes: 1 } }) };
        }
      }),
      "DELETE FROM api_v1_counters": () => ({
        bind() {
          return { run: async () => ({ meta: { changes: 3 } }) };
        }
      })
    }),
    SCREENSHOTS: { delete: async () => {} }
  };

  const summary = await runRetentionCleanup(env, { days: 90 });
  assert.equal(summary.screenshots.days, 90);
  assert.equal(summary.screenshots.scanned, 0);
  assert.equal(summary.counters.deletedRateLimits, 1);
  assert.equal(summary.counters.deletedApiCounters, 3);
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
