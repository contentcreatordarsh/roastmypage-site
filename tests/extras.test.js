import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiKey, authenticateApiKey, fireWebhook } from "../src/apiKeys.js";
import { verifyTurnstile, handleExtraRoutes } from "../src/routes/extras.js";

function mockEnv(rows = {}) {
  const store = { ...rows };
  return {
    ENVIRONMENT: "development",
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            this.args = args;
            this.sql = sql;
            return this;
          },
          async run() {
            if (this.sql.includes("INSERT INTO api_keys")) {
              store[this.args[1]] = {
                id: this.args[0],
                key_hash: this.args[1],
                key_prefix: this.args[2],
                label: this.args[3],
                tier: this.args[4],
                daily_limit: this.args[5],
                webhook_url: this.args[6],
                day_key: this.args[7],
                requests_today: 0,
                revoked: 0
              };
            }
            if (this.sql.includes("UPDATE api_keys SET requests_today")) {
              const key = Object.values(store).find((r) => r.id === this.args[2]);
              if (key) {
                key.requests_today = this.args[0];
                key.day_key = this.args[1];
              }
            }
            return { success: true };
          },
          async first() {
            if (this.sql.includes("SELECT * FROM api_keys")) {
              return store[this.args[0]] || null;
            }
            return null;
          }
        };
      }
    }
  };
}

test("createApiKey returns an rmp_ key once", async () => {
  const env = mockEnv();
  const created = await createApiKey(env, { label: "test", tier: "pro" });
  assert.match(created.apiKey, /^rmp_[a-f0-9]+$/);
  assert.equal(created.tier, "pro");
  assert.equal(created.dailyLimit, 200);
});

test("authenticateApiKey accepts a valid key", async () => {
  const env = mockEnv();
  const created = await createApiKey(env, { label: "auth" });
  const req = new Request("https://example.com/api/v1/roast", {
    headers: { Authorization: `Bearer ${created.apiKey}` }
  });
  const authed = await authenticateApiKey(env, req);
  assert.ok(authed);
  assert.equal(authed.limited, false);
});

test("verifyTurnstile skips when secret unset", async () => {
  const result = await verifyTurnstile({}, null, "1.2.3.4");
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test("handleExtraRoutes exposes public /api/config", async () => {
  const req = new Request("https://example.com/api/config");
  const res = await handleExtraRoutes(req, { TURNSTILE_SITE_KEY: "site-abc" }, {}, { corsHeaders: {}, origin: null });
  assert.ok(res);
  const data = await res.json();
  assert.equal(data.turnstileSiteKey, "site-abc");
  assert.equal(data.features.apiKeys, true);
});

test("brandOverlapScore detects brand tokens in titles", async () => {
  const { brandOverlapScore } = await import("../src/threats.js");
  assert.ok(brandOverlapScore("Acme Pay", "Acme Pay Support Portal") >= 0.5);
  assert.equal(brandOverlapScore("Acme", "Totally Unrelated Blog"), 0);
});

test("fireWebhook formats Slack payloads", async () => {
  const originalFetch = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, opts) => {
    seen = { url, body: JSON.parse(opts.body) };
    return new Response("ok");
  };
  try {
    await fireWebhook("https://hooks.slack.com/services/T/B/X", {
      type: "roast.completed",
      data: { url: "https://example.com", scores: { overall: 7.5 }, shareUrl: "https://roastmypage.site/roast/abc" }
    });
    assert.match(seen.url, /hooks\.slack\.com/);
    assert.match(seen.body.text, /7\.5\/10/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
