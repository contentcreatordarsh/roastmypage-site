import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG } from "../src/config.js";
import { checkOperationRateLimit, getCachedRoast } from "../src/db.js";
import worker from "../src/index.js";

// #22 — integration-style coverage for the POST roast/compare/batch path. These exercise
// the real db.js logic against a minimal D1 stub (no network, no live worker), so the
// per-IP throttle and the cache self-heal can't silently regress.
//
// Minimal D1 statement/DB stub: prepare().bind().run() / .first().
// firstVal may be a value or a () => value factory (evaluated per .first() call).
function makeStmt(firstVal) {
  const stmt = {
    bind: () => stmt,
    run: async () => ({ success: true, meta: {} }),
    first: async () => (typeof firstVal === "function" ? firstVal() : firstVal),
    all: async () => ({ results: [] })
  };
  return stmt;
}

function mockDb(firstVal) {
  return { prepare: () => makeStmt(firstVal) };
}

// --- checkOperationRateLimit: the per-IP D1 limiter guarding the roast/compare/batch POSTs ---

test("checkOperationRateLimit allows a request under the per-operation limit", async () => {
  const env = { DB: mockDb({ request_count: 1, window_start: new Date().toISOString() }) };
  const result = await checkOperationRateLimit(env, "ip-hash", "roast");
  assert.equal(result.allowed, true);
  assert.equal(result.remaining, CONFIG.RATE_LIMIT_MAX_REQUESTS - 1);
});

test("checkOperationRateLimit blocks once the count exceeds the limit", async () => {
  const env = { DB: mockDb({ request_count: CONFIG.RATE_LIMIT_MAX_REQUESTS + 1, window_start: new Date().toISOString() }) };
  const result = await checkOperationRateLimit(env, "ip-hash", "roast");
  assert.equal(result.allowed, false);
  assert.equal(result.remaining, 0);
});

test("checkOperationRateLimit applies the tighter batch limit for the batch operation", async () => {
  // batch max (3) is stricter than roast max (30): a count just past the batch cap must be
  // blocked even though the same count is fine for a plain roast — proves the op→limit map.
  const env = { DB: mockDb({ request_count: CONFIG.RATE_LIMIT_BATCH_MAX + 1, window_start: new Date().toISOString() }) };
  const blocked = await checkOperationRateLimit(env, "ip-hash", "batch");
  assert.equal(blocked.allowed, false);
});

// --- getCachedRoast: self-heal (#89) — never serve an incomplete cached roast ---

test("getCachedRoast treats a row missing SEO data as a cache miss", async () => {
  const env = { DB: mockDb({ id: "abc", url: "https://example.com", url_hash: "h", overall_score: 7, seo_data: null, performance_data: '{"loadTime":1000}' }) };
  const result = await getCachedRoast(env, "h", "https://example.com");
  assert.equal(result, null);
});

test("getCachedRoast treats a row missing performance data as a cache miss", async () => {
  const env = { DB: mockDb({ id: "abc", url: "https://example.com", url_hash: "h", overall_score: 7, seo_data: '{"score":80}', performance_data: null }) };
  const result = await getCachedRoast(env, "h", "https://example.com");
  assert.equal(result, null);
});

test("getCachedRoast treats a pre-video audit row as a cache miss", async () => {
  const env = {
    DB: mockDb({
      id: "legacy-video",
      url: "https://example.com",
      url_hash: "h",
      overall_score: 7,
      seo_data: '{"score":80}',
      performance_data: '{"loadTime":1000}'
    })
  };
  const result = await getCachedRoast(env, "h", "https://example.com");
  assert.equal(result, null);
});

test("getCachedRoast accepts a current audit with no detected video", async () => {
  const video = { present: false, count: 0 };
  const env = {
    DB: mockDb({
      id: "current-video",
      url: "https://example.com",
      url_hash: "h",
      overall_score: 7,
      seo_data: JSON.stringify({ score: 80, video }),
      performance_data: '{"loadTime":1000}'
    })
  };
  const result = await getCachedRoast(env, "h", "https://example.com");
  assert.equal(result.id, "current-video");
  assert.deepEqual(result.video, video);
});

test("getCachedRoast returns null on a genuine cache miss", async () => {
  const env = { DB: mockDb(null) };
  const result = await getCachedRoast(env, "h", "https://example.com");
  assert.equal(result, null);
});

test("invalid expensive POSTs do not consume the shared hourly capacity", async () => {
  const globalWrites = [];
  const env = {
    DB: mockDb({ request_count: 0 }),
    CONFIG: {
      get: async () => "0",
      put: async (...args) => globalWrites.push(args)
    },
    IP_HASH_SALT: "test-salt",
    ENVIRONMENT: "development"
  };
  const cases = [
    ["/api/roast", {}],
    ["/api/compare", {}],
    ["/api/batch-roast", { urls: [] }],
    ["/api/roast-stream", {}],
    ["/api/threat-scan", {}],
    ["/api/tech-scan", {}],
    ["/api/v1/roast", {}]
  ];

  for (const [pathname, body] of cases) {
    const response = await worker.fetch(
      new Request(`https://roastmypage.site${pathname}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.10"
        },
        body: JSON.stringify(body)
      }),
      env,
      { waitUntil() {} }
    );
    assert.equal(response.status, 400, pathname);
  }

  assert.equal(globalWrites.length, 0);
});

test("per-IP throttling runs before the shared hourly capacity check", async () => {
  const globalWrites = [];
  const now = new Date().toISOString();
  const env = {
    DB: mockDb({
      request_count: CONFIG.RATE_LIMIT_MAX_REQUESTS + 1,
      window_start: now
    }),
    CONFIG: {
      get: async () => "0",
      put: async (...args) => globalWrites.push(args)
    },
    IP_HASH_SALT: "test-salt",
    ENVIRONMENT: "development"
  };

  const response = await worker.fetch(
    new Request("https://roastmypage.site/api/roast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "203.0.113.10"
      },
      body: JSON.stringify({ url: "https://example.com" })
    }),
    env,
    { waitUntil() {} }
  );

  assert.equal(response.status, 429);
  assert.equal(globalWrites.length, 0);
});
