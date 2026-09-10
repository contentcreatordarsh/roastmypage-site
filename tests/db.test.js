import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apiV1RateLimitHeaders,
  checkGlobalRateLimit,
  getApiV1DailyLimit,
  getCachedRoast,
  getWebHourlyLimit,
  releaseApiV1Quota
} from "../src/db.js";

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
              first: async () => sql.includes("SELECT id, url") ? legacyRoast : { count: 1 },
              all: async () => ({ results: sql.includes("SELECT id, url") ? [legacyRoast] : [] })
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

test("getCachedRoast falls back past a newer stored challenge roast", async () => {
  const url = "https://cache-shadow.example/";
  const urlHash = "shared-hash";
  const validSeo = JSON.stringify({
    score: 92,
    title: { text: "Acme — Ship faster", length: 18, status: "good" },
    video: { present: false, count: 0 }
  });
  const rows = [
    {
      id: "newer-challenge",
      url,
      url_hash: urlHash,
      created_at: "2026-09-07T10:00:00.000Z",
      overall_score: 4.2,
      hero_score: 4,
      cta_score: 4,
      trust_score: 4,
      copy_score: 5,
      design_score: 4,
      roast_response: "Roast of an interstitial",
      quick_wins: "[]",
      seo_data: JSON.stringify({
        score: 75,
        title: { text: "Just a moment...", length: 16, status: "short" },
        video: { present: false, count: 0 }
      }),
      performance_data: '{"loadTime":500}',
      heatmap_data: null,
      industry: "other"
    },
    {
      id: "older-valid",
      url,
      url_hash: urlHash,
      created_at: "2026-09-07T09:00:00.000Z",
      overall_score: 8.1,
      hero_score: 8,
      cta_score: 8,
      trust_score: 8,
      copy_score: 8,
      design_score: 9,
      roast_response: "Valid landing-page roast",
      quick_wins: '["Clarify the CTA"]',
      seo_data: validSeo,
      performance_data: '{"loadTime":700}',
      heatmap_data: null,
      industry: "other"
    }
  ];
  const queryTrace = {};
  const env = {
    DB: {
      prepare(sql) {
        if (sql.includes("SELECT id, url")) queryTrace.sql = sql;
        return {
          bind(hash, expiry) {
            queryTrace.bindings = [hash, expiry];
            return {
              async all() {
                const candidates = rows
                  .filter((row) => row.url_hash === hash && row.created_at > expiry)
                  .sort((left, right) => right.created_at.localeCompare(left.created_at));
                return { results: candidates };
              },
              first: async () => null
            };
          }
        };
      }
    }
  };

  const cached = await getCachedRoast(env, urlHash, url);

  assert.match(queryTrace.sql, /ORDER BY created_at DESC/);
  assert.doesNotMatch(queryTrace.sql, /LIMIT 1/);
  assert.equal(cached?.id, "older-valid");
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

test("paid API keys use their own daily limit and skip anonymous global headers", () => {
  const dailyLimit = getApiV1DailyLimit("pro");
  const headers = apiV1RateLimitHeaders(12, 99, {
    dailyLimit,
    includeGlobal: false,
    tier: "pro",
    priority: true
  });

  assert.equal(dailyLimit, 500);
  assert.equal(getWebHourlyLimit("pro"), 200);
  assert.equal(headers["X-RateLimit-Limit"], "500");
  assert.equal(headers["X-RateLimit-Remaining"], "488");
  assert.equal(headers["X-RateLimit-Tier"], "pro");
  assert.equal(headers["X-Queue-Priority"], "high");
  assert.equal(headers["X-RateLimit-Global-Limit"], undefined);
});

test("checkGlobalRateLimit reserves capacity for paid keys", async () => {
  const env = {
    CONFIG: {
      get: async (key) => key.startsWith("global_hourly_") ? "1850" : "0",
      put: async () => {}
    }
  };

  const free = await checkGlobalRateLimit(env);
  assert.equal(free.allowed, false);

  const paid = await checkGlobalRateLimit(env, { priority: true });
  assert.equal(paid.allowed, true);
});
