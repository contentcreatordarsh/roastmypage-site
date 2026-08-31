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

test("cached batch roasts do not consume the global browser-session budget", async () => {
  const kvWrites = [];
  const cachedRoast = {
    id: "cached-batch",
    url: "https://example.com/",
    url_hash: "hash",
    overall_score: 7.5,
    hero_score: 8,
    cta_score: 7,
    trust_score: 7,
    copy_score: 8,
    design_score: 7.5,
    roast_response: "Cached roast",
    quick_wins: "[]",
    seo_data: JSON.stringify({ score: 80, video: { present: false, count: 0 } }),
    performance_data: JSON.stringify({ score: 75 }),
    heatmap_data: "{}",
    industry: "other"
  };
  const env = {
    ENVIRONMENT: "development",
    IP_HASH_SALT: "test-salt",
    CONFIG: {
      get: async () => "0",
      put: async (...args) => kvWrites.push(args)
    },
    DB: {
      prepare(sql) {
        const stmt = {
          bind() {
            return stmt;
          },
          run: async () => ({ success: true }),
          async first() {
            if (sql.includes("SELECT request_count, window_start")) {
              return { request_count: 1, window_start: new Date().toISOString() };
            }
            if (sql.includes("SELECT id, url, url_hash")) return cachedRoast;
            if (sql.includes("SELECT COUNT(*) as count")) return { count: 1 };
            throw new Error(`Unexpected query: ${sql}`);
          }
        };
        return stmt;
      }
    }
  };
  const request = new Request("https://roastmypage.site/api/batch-roast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.10"
    },
    body: JSON.stringify({
      urls: ["https://example.com", "https://example.com", "https://example.com"]
    })
  });

  const response = await worker.fetch(request, env, {
    waitUntil() {
      throw new Error("Cache hits must not schedule background work");
    }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.results.length, 3);
  assert.equal(body.results.every((result) => result.cached), true);
  assert.equal(kvWrites.length, 1);
  assert.deepEqual(kvWrites[0][2], { expirationTtl: 7200 });
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
