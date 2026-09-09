import { register } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

register("./mock-cloudflare-puppeteer-loader.js", import.meta.url);

const { default: worker } = await import("../src/index.js?api-v1-bot-quota");
const { configureChallenge, browserLaunches } = await import("@cloudflare/puppeteer");

function quotaDb() {
  const state = { count: 0, releases: 0 };
  return {
    state,
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("INSERT INTO api_v1_counters")) {
                state.count += 1;
                return { request_count: state.count };
              }
              if (sql.includes("SELECT id, url, url_hash")) return null;
              if (sql.includes("SELECT request_count FROM api_v1_counters")) {
                return { request_count: state.count };
              }
              if (sql.includes("SELECT COALESCE(SUM(request_count)")) {
                return { request_count: state.count };
              }
              throw new Error(`Unexpected first query: ${sql}`);
            },
            async run() {
              if (sql.includes("UPDATE api_v1_counters")) {
                state.releases += 1;
                state.count = Math.max(0, state.count - 1);
                return { meta: { changes: 1 } };
              }
              throw new Error(`Unexpected run query: ${sql}`);
            }
          };
        }
      };
    }
  };
}

function quotaEnv(db) {
  const kv = new Map();
  return {
    DB: db,
    CONFIG: {
      async get(key) {
        return kv.get(key) || "0";
      },
      async put(key, value) {
        kv.set(key, value);
      }
    },
    BROWSER: {},
    IP_HASH_SALT: "test-salt",
    ENVIRONMENT: "development"
  };
}

function roastRequest() {
  return new Request("https://roastmypage.site/api/v1/roast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.10"
    },
    body: JSON.stringify({ url: "https://attacker.example" })
  });
}

test("API v1 bot challenges consume quota after Browser Rendering starts", async () => {
  const quota = quotaDb();
  const env = quotaEnv(quota);
  const scenarios = [
    { status: 403, signals: { title: "Ordinary title", bodyTextLength: 500, markers: {} } },
    { status: 200, signals: { title: "Just a moment...", bodyTextLength: 0, markers: {} } }
  ];
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, _delay, ...args) => originalSetTimeout(callback, 0, ...args);
  try {
    for (const scenario of scenarios) {
      configureChallenge(scenario.signals, scenario.status);
      const response = await worker.fetch(roastRequest(), env, { waitUntil() {} });
      const body = await response.json();
      assert.equal(response.status, 422);
      assert.equal(body.error, "blocked_by_bot_protection");
    }
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  const usageResponse = await worker.fetch(new Request(
    "https://roastmypage.site/api/v1/usage",
    { headers: { "CF-Connecting-IP": "203.0.113.10" } }
  ), env, { waitUntil() {} });
  const usage = await usageResponse.json();

  assert.equal(browserLaunches(), scenarios.length);
  assert.equal(quota.state.releases, 0);
  assert.equal(quota.state.count, scenarios.length);
  assert.equal(usage.limits.perIp.used, scenarios.length);
  assert.equal(usage.limits.global.used, scenarios.length);
});
