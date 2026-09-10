import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import worker from "../src/index.js";
import {
  cloudflareAccountTag,
  cloudflareZoneTag,
  hasCloudflareAnalyticsConfig
} from "../src/utils.js";

const root = dirname(fileURLToPath(import.meta.url));

function wranglerVars(fileName) {
  return readFileSync(join(root, "..", fileName), "utf8");
}

function rateLimitDb() {
  return {
    prepare() {
      const stmt = {
        bind() {
          return stmt;
        },
        run: async () => ({ success: true }),
        first: async () => ({ request_count: 1, window_start: new Date().toISOString() }),
        all: async () => ({ results: [] })
      };
      return stmt;
    }
  };
}

function platformStatsDb() {
  return {
    prepare(sql) {
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          if (sql.includes("COUNT(DISTINCT country)")) return { country_count: 0 };
          if (sql.includes("AVG(JULIANDAY")) return { avg_seconds: 0 };
          return { total_roasts: 0, roasts_24h: 0, roasts_previous_24h: 0 };
        },
        async all() {
          return { results: [] };
        },
        run: async () => ({ success: true })
      };
      return stmt;
    }
  };
}

function techScanEnv(overrides = {}) {
  return {
    ENVIRONMENT: "development",
    IP_HASH_SALT: "test-salt",
    URL_SCANNER_TOKEN: "scanner-token",
    CONFIG: {
      get: async () => null,
      put: async () => {}
    },
    DB: rateLimitDb(),
    ...overrides
  };
}

test("cloudflareAccountTag / cloudflareZoneTag trim blank identifiers", () => {
  assert.equal(cloudflareAccountTag({}), "");
  assert.equal(cloudflareAccountTag({ CF_ACCOUNT_TAG: "  abc  " }), "abc");
  assert.equal(cloudflareZoneTag({ CF_ZONE_TAG: "   " }), "");
});

test("hasCloudflareAnalyticsConfig requires token plus both tags", () => {
  assert.equal(hasCloudflareAnalyticsConfig({
    ANALYTICS_API_TOKEN: "tok",
    CF_ACCOUNT_TAG: "acct",
    CF_ZONE_TAG: "zone"
  }), true);
  assert.equal(hasCloudflareAnalyticsConfig({
    ANALYTICS_API_TOKEN: "tok",
    CF_ACCOUNT_TAG: "acct"
  }), false);
  assert.equal(hasCloudflareAnalyticsConfig({
    CF_ACCOUNT_TAG: "acct",
    CF_ZONE_TAG: "zone"
  }), false);
});

test("wrangler.toml keeps account/zone identifiers in [vars] for both envs", () => {
  const toml = wranglerVars("wrangler.toml");
  const accountTags = toml.match(/CF_ACCOUNT_TAG\s*=\s*"[^"]+"/g) || [];
  const zoneTags = toml.match(/CF_ZONE_TAG\s*=\s*"[^"]+"/g) || [];
  assert.equal(accountTags.length, 2);
  assert.equal(zoneTags.length, 2);
  assert.match(toml, /\[vars\][\s\S]*CF_ACCOUNT_TAG/);
  assert.match(toml, /\[env\.production\.vars\][\s\S]*CF_ACCOUNT_TAG/);
});

test("wrangler.dev.toml keeps local identifiers as vars, not secrets", () => {
  const toml = wranglerVars("wrangler.dev.toml");
  assert.match(toml, /CF_ACCOUNT_TAG\s*=\s*"[^"]+"/);
  assert.match(toml, /CF_ZONE_TAG\s*=\s*"[^"]+"/);
});

test("tech-scan POST returns 503 when the account tag is missing", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args[0]);
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await worker.fetch(
      new Request("https://roastmypage.site/api/tech-scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.10"
        },
        body: JSON.stringify({ url: "https://example.com" })
      }),
      techScanEnv({ CF_ACCOUNT_TAG: "" }),
      { waitUntil() {} }
    );
    const body = await response.json();
    assert.equal(response.status, 503);
    assert.equal(body.error, "URL Scanner not configured");
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tech-scan GET returns 503 when the account tag is missing", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args[0]);
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await worker.fetch(
      new Request("https://roastmypage.site/api/tech-scan/abcdefghijklmnopqrstuvwxyz", {
        method: "GET",
        headers: { "CF-Connecting-IP": "203.0.113.10" }
      }),
      techScanEnv({ CF_ACCOUNT_TAG: "   " }),
      { waitUntil() {} }
    );
    assert.equal(response.status, 503);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("tech-scan POST uses the wrangler account tag in the URL Scanner path", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ result: { uuid: "scan-uuid-1234567890" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const response = await worker.fetch(
      new Request("https://roastmypage.site/api/tech-scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.10"
        },
        body: JSON.stringify({ url: "https://example.com" })
      }),
      techScanEnv({ CF_ACCOUNT_TAG: "0fa4850c978886b80a15821863df3855" }),
      { waitUntil() {} }
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.scanId, "scan-uuid-1234567890");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/accounts\/0fa4850c978886b80a15821863df3855\/urlscanner\//);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("platform-stats skips GraphQL when the token is set but tags are missing", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await worker.fetch(
      new Request("https://roastmypage.site/api/platform-stats"),
      {
        ENVIRONMENT: "development",
        ANALYTICS_API_TOKEN: "analytics-token",
        CONFIG: {
          get: async () => null,
          put: async () => {}
        },
        DB: platformStatsDb()
      },
      { waitUntil() {} }
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.cdnRequests24h, 0);
    assert.equal(body.workerCalls24h, 0);
    assert.equal(calls.some((url) => url.includes("graphql")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("platform-stats queries GraphQL when token and identifiers are present", async () => {
  const originalFetch = globalThis.fetch;
  const graphqlBodies = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("graphql")) {
      graphqlBodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ data: { viewer: { zones: [], accounts: [] } } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const response = await worker.fetch(
      new Request("https://roastmypage.site/api/platform-stats"),
      {
        ENVIRONMENT: "development",
        ANALYTICS_API_TOKEN: "analytics-token",
        CF_ACCOUNT_TAG: "acct-tag",
        CF_ZONE_TAG: "zone-tag",
        CONFIG: {
          get: async () => null,
          put: async () => {}
        },
        DB: platformStatsDb()
      },
      { waitUntil() {} }
    );
    assert.equal(response.status, 200);
    assert.equal(graphqlBodies.length, 4);
    assert.equal(graphqlBodies.every((body) => body.variables.zoneTag === "zone-tag" || body.variables.accountTag === "acct-tag"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
