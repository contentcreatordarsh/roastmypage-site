import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function runtimeHarness({ initialHourly = 1998, cacheHit = true } = {}) {
  const state = {
    hourly: initialHourly,
    globalWrites: [],
    cacheQueries: 0,
    quotaConsumes: 0,
    operationWrites: 0
  };
  const cached = {
    id: "cached-roast",
    url: "https://example.com/",
    url_hash: "unused-by-stub",
    overall_score: 8,
    hero_score: 8,
    cta_score: 8,
    trust_score: 8,
    copy_score: 8,
    design_score: 8,
    roast_response: "Cached roast",
    quick_wins: "[]",
    seo_data: JSON.stringify({ score: 90, video: { present: false, count: 0 } }),
    performance_data: JSON.stringify({ score: 90 }),
    heatmap_data: "{}",
    industry: "saas"
  };
  const env = {
    IP_HASH_SALT: "test-salt",
    ENVIRONMENT: "development",
    CONFIG: {
      async get(key) {
        if (key.startsWith("global_hourly_")) return String(state.hourly);
        return "0";
      },
      async put(key, value) {
        if (key.startsWith("global_hourly_")) {
          state.hourly = Number(value);
          state.globalWrites.push(state.hourly);
        }
      }
    },
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              async all() {
                if (sql.includes("SELECT id, url, url_hash")) {
                  state.cacheQueries += 1;
                  return { results: cacheHit ? [cached] : [] };
                }
                throw new Error(`Unexpected all query: ${sql}`);
              },
              async first() {
                if (sql.includes("INSERT INTO api_v1_counters")) {
                  state.quotaConsumes += 1;
                  return { request_count: 1 };
                }
                if (sql.includes("SELECT request_count FROM api_v1_counters")) return null;
                if (sql.includes("SELECT COALESCE(SUM(request_count)")) return { request_count: 0 };
                if (sql.includes("SELECT COUNT(*) as count")) return { count: 1 };
                if (sql.includes("SELECT request_count, window_start FROM rate_limits")) {
                  return { request_count: 1, window_start: new Date().toISOString() };
                }
                throw new Error(`Unexpected first query: ${sql}`);
              },
              async run() {
                if (sql.includes("INSERT INTO rate_limits")) {
                  state.operationWrites += 1;
                  return { success: true };
                }
                throw new Error(`Unexpected run query: ${sql}`);
              }
            };
          }
        };
      }
    }
  };
  return { env, state };
}

function request(path = "/api/v1/roast") {
  return new Request(`https://roastmypage.site${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.10"
    },
    body: JSON.stringify({ url: "https://example.com" })
  });
}

test("API v1 cache hits preserve shared global hourly capacity", async () => {
  const { env, state } = runtimeHarness();
  const ctx = { waitUntil() { throw new Error("cache hit must not schedule work"); } };

  const first = await worker.fetch(request(), env, ctx);
  const second = await worker.fetch(request(), env, ctx);
  const third = await worker.fetch(request(), env, ctx);
  const siteRoast = await worker.fetch(request("/api/roast"), env, ctx);

  assert.deepEqual([first.status, second.status, third.status, siteRoast.status], [200, 200, 200, 200]);
  assert.deepEqual(state.globalWrites, [1999]);
  assert.equal(state.cacheQueries, 4);
  assert.equal(state.quotaConsumes, 0);
  assert.equal(state.operationWrites, 1);
  assert.equal(first.headers.get("X-Cache"), "HIT");
  assert.equal(second.headers.get("X-Cache"), "HIT");
  assert.equal(third.headers.get("X-Cache"), "HIT");
  assert.equal(siteRoast.headers.get("X-Cache"), "HIT");
});

test("API v1 cache misses remain protected by shared global capacity", async () => {
  const { env, state } = runtimeHarness({ initialHourly: 2000, cacheHit: false });

  const response = await worker.fetch(request(), env, { waitUntil() {} });

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "service_busy");
  assert.equal(state.cacheQueries, 1);
  assert.deepEqual(state.globalWrites, []);
  assert.equal(state.quotaConsumes, 0);
});
