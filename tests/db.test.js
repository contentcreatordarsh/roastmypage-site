import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGlobalRateLimit, getCachedRoast, purgeExpiredRoasts, releaseApiV1Quota } from "../src/db.js";

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

test("purgeExpiredRoasts deletes expired screenshots and rows in batches", async () => {
  const selectBatches = [
    [{ id: "old-1", screenshot_key: "screenshots/old-1.jpg" }],
    [{ id: "old-2", screenshot_key: "screenshots/old-2.jpg" }],
    []
  ];
  const deletedScreenshots = [];
  const deleteBatches = [];
  let selectCount = 0;
  let selectSql = "";
  let selectBindings = [];

  const env = {
    DB: {
      prepare(statement) {
        if (statement.includes("SELECT id, screenshot_key")) {
          selectSql = statement;
          return {
            bind(...values) {
              selectBindings = values;
              return {
                all: async () => ({ results: selectBatches[selectCount++] })
              };
            }
          };
        }

        assert.match(statement, /DELETE FROM roasts WHERE id IN/);
        return {
          bind(...ids) {
            deleteBatches.push(ids);
            return {
              run: async () => ({ meta: { changes: ids.length } })
            };
          }
        };
      }
    },
    SCREENSHOTS: {
      delete: async (key) => deletedScreenshots.push(key)
    }
  };

  const summary = await purgeExpiredRoasts(env, { days: 7, batchSize: 1 });

  assert.match(selectSql, /WHERE created_at < \?/);
  assert.equal(selectBindings[1], 1);
  assert.deepEqual(deletedScreenshots, ["screenshots/old-1.jpg", "screenshots/old-2.jpg"]);
  assert.deepEqual(deleteBatches, [["old-1"], ["old-2"]]);
  assert.equal(summary.days, 7);
  assert.equal(summary.scanned, 2);
  assert.equal(summary.deletedScreenshots, 2);
  assert.equal(summary.deletedRows, 2);
  assert.equal(summary.batches, 2);
});

test("purgeExpiredRoasts uses RETENTION_DAYS env override when days is omitted", async () => {
  let selectBindings = [];
  const env = {
    RETENTION_DAYS: "30",
    DB: {
      prepare() {
        return {
          bind(...values) {
            selectBindings = values;
            return {
              all: async () => ({ results: [] })
            };
          }
        };
      }
    },
    SCREENSHOTS: {
      delete: async () => {}
    }
  };

  const summary = await purgeExpiredRoasts(env);

  assert.equal(summary.days, 30);
  assert.match(selectBindings[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(selectBindings[1], 100);
});

test("purgeExpiredRoasts keeps a row when its screenshot deletion fails", async () => {
  const deleteBatches = [];
  const env = {
    DB: {
      prepare(statement) {
        if (statement.includes("SELECT id, screenshot_key")) {
          return {
            bind() {
              return {
                all: async () => ({
                  results: [
                    { id: "bad-screenshot", screenshot_key: "screenshots/bad.jpg" },
                    { id: "no-screenshot", screenshot_key: null }
                  ]
                })
              };
            }
          };
        }

        return {
          bind(...ids) {
            deleteBatches.push(ids);
            return {
              run: async () => ({ meta: { changes: ids.length } })
            };
          }
        };
      }
    },
    SCREENSHOTS: {
      delete: async () => {
        throw new Error("R2 unavailable");
      }
    }
  };

  const originalError = console.error;
  console.error = () => {};
  try {
    const summary = await purgeExpiredRoasts(env, { days: 90 });

    assert.deepEqual(deleteBatches, [["no-screenshot"]]);
    assert.equal(summary.deletedRows, 1);
    assert.equal(summary.deletedScreenshots, 0);
    assert.equal(summary.failedScreenshots, 1);
  } finally {
    console.error = originalError;
  }
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
