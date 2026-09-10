import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { signUpgradeToken } from "../src/billing.js";

function memoryDb(handlers = {}) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (handlers.first) return handlers.first(sql, values);
              if (sql.includes("INSERT INTO api_keys")) {
                return {
                  id: values[0],
                  key_prefix: values[2],
                  tier: "free",
                  label: values[3],
                  created_at: "2026-09-10 00:00:00",
                  last_used_at: null,
                  revoked: 0
                };
              }
              if (sql.includes("SELECT request_count FROM api_v1_counters")) return { request_count: 0 };
              if (sql.includes("SELECT COALESCE(SUM")) return { request_count: 0 };
              if (sql.includes("INSERT INTO api_v1_counters")) return { request_count: 1 };
              if (sql.includes("SELECT request_count, window_start FROM rate_limits")) {
                return { request_count: 1, window_start: new Date().toISOString() };
              }
              return null;
            },
            async run() {
              return { meta: { changes: 1 } };
            },
            async all() {
              return { results: [] };
            }
          };
        }
      };
    }
  };
}

function envWithDb(db) {
  const kv = new Map();
  return {
    DB: db,
    CONFIG: {
      get: async (key) => kv.get(key) || "0",
      put: async (key, value) => { kv.set(key, value); }
    },
    IP_HASH_SALT: "test-salt",
    ENVIRONMENT: "development",
    TIER_UPGRADE_SECRET: "upgrade-secret"
  };
}

test("GET /api/v1/billing/plans lists paid features without Stripe", async () => {
  const res = await worker.fetch(new Request("https://roastmypage.site/api/v1/billing/plans"), envWithDb(memoryDb()), { waitUntil() {} });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.checkoutEnabled, false);
  assert.equal(body.plans.find((p) => p.id === "pro").webhooks, true);
});

test("POST /api/v1/keys mints a free rmp_ key", async () => {
  const res = await worker.fetch(new Request("https://roastmypage.site/api/v1/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" },
    body: JSON.stringify({ label: "CI" })
  }), envWithDb(memoryDb()), { waitUntil() {} });
  const body = await res.json();
  assert.equal(res.status, 201);
  assert.match(body.key, /^rmp_/);
  assert.equal(body.tier, "free");
  assert.equal(body.limits.apiDaily, 25);
});

test("anonymous webhookUrl on /api/v1/roast is rejected", async () => {
  const res = await worker.fetch(new Request("https://roastmypage.site/api/v1/roast", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.11" },
    body: JSON.stringify({ url: "https://example.com", callbackUrl: "https://hooks.example.com/x" })
  }), envWithDb(memoryDb()), { waitUntil() {} });
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.error, "webhook_requires_paid_tier");
});

test("POST /api/v1/keys/upgrade accepts a signed token", async () => {
  const keyId = "11111111-1111-4111-8111-111111111111";
  const exp = Math.floor(Date.now() / 1000) + 300;
  const token = await signUpgradeToken("upgrade-secret", keyId, "pro", String(exp));
  const plaintext = "rmp_dddddddddddddddddddddddddddddddd";
  const env = envWithDb(memoryDb({
    first(sql, values) {
      if (sql.includes("FROM api_keys") && sql.includes("key_hash")) {
        return {
          id: keyId,
          key_prefix: "rmp_dddddddd",
          tier: "free",
          label: "CI",
          created_at: "2026-09-10 00:00:00",
          last_used_at: null,
          revoked: 0
        };
      }
      if (sql.includes("UPDATE api_keys")) {
        return {
          id: keyId,
          key_prefix: "rmp_dddddddd",
          tier: values[0],
          label: "CI",
          created_at: "2026-09-10 00:00:00",
          last_used_at: null,
          revoked: 0
        };
      }
      return null;
    }
  }));

  const res = await worker.fetch(new Request("https://roastmypage.site/api/v1/keys/upgrade", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${plaintext}`
    },
    body: JSON.stringify({ tier: "pro", exp, token })
  }), env, { waitUntil() {} });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.tier, "pro");
  assert.equal(body.paid, true);
  assert.equal(body.limits.apiDaily, 500);
});

test("OPTIONS /api/v1/roast allows Authorization", async () => {
  const res = await worker.fetch(new Request("https://roastmypage.site/api/v1/roast", {
    method: "OPTIONS"
  }), envWithDb(memoryDb()), { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Access-Control-Allow-Headers") || "", /Authorization/);
});
