import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGlobalRateLimit, getCachedRoast, releaseApiV1Quota } from "../src/db.js";

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
  assert.equal(cached.device, "desktop");
  assert.equal(cached.fullPage, false);
});

test("getCachedRoast returns stored device and fullPage metadata", async () => {
  const storedRoast = {
    id: "stored-1",
    url: "https://example.com/",
    url_hash: "hash",
    overall_score: 8,
    hero_score: 8,
    cta_score: 8,
    trust_score: 8,
    copy_score: 8,
    design_score: 8,
    roast_response: "Stored roast",
    quick_wins: "[]",
    device: "mobile",
    full_page: 1,
    seo_data: JSON.stringify({ score: 90 }),
    performance_data: JSON.stringify({ score: 85 }),
    heatmap_data: null,
    industry: "other"
  };
  let selectSql = "";
  const env = {
    DB: {
      prepare(sql) {
        if (sql.includes("SELECT id, url")) selectSql = sql;
        return {
          bind() {
            return {
              first: async () => sql.includes("SELECT id, url") ? storedRoast : { count: 1 }
            };
          }
        };
      }
    }
  };

  const cached = await getCachedRoast(env, "hash", storedRoast.url);

  assert.match(selectSql, /device/);
  assert.match(selectSql, /full_page/);
  assert.equal(cached.id, "stored-1");
  assert.equal(cached.device, "mobile");
  assert.equal(cached.fullPage, true);
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
