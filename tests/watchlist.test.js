import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {
  isWatchlistWebhookUrl,
  scoreChanged,
  buildWatchlistAlertMessage,
  lookupLatestRoastScore,
  processWatchlistAlerts
} from "../src/watchlist.js";

test("isWatchlistWebhookUrl allows Slack and Discord HTTPS webhooks only", () => {
  assert.equal(
    isWatchlistWebhookUrl("https://hooks.slack.com/services/T00/B00/xxx"),
    true
  );
  assert.equal(
    isWatchlistWebhookUrl("https://discord.com/api/webhooks/123/token"),
    true
  );
  assert.equal(
    isWatchlistWebhookUrl("https://discordapp.com/api/webhooks/123/token"),
    true
  );
  assert.equal(isWatchlistWebhookUrl("http://hooks.slack.com/services/T00/B00/xxx"), false);
  assert.equal(isWatchlistWebhookUrl("https://evil.example/webhook"), false);
  assert.equal(isWatchlistWebhookUrl("not-a-url"), false);
});

test("watchlist API rejects email alerts when no email binding exists", async () => {
  const request = new Request("https://roastmypage.site/api/watchlist", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "https://roastmypage.site"
    },
    body: JSON.stringify({
      ownerKey: "owner1234",
      url: "https://competitor.com",
      email: "alerts@example.com"
    })
  });

  const response = await worker.fetch(request, { ENVIRONMENT: "development" }, {});
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.match(body.error, /Email alerts are not configured/i);
});

test("scoreChanged respects threshold and first-score case", () => {
  assert.equal(scoreChanged(null, 7.2), true);
  assert.equal(scoreChanged(7.0, 7.02, 0.05), false);
  assert.equal(scoreChanged(7.0, 7.1, 0.05), true);
  assert.equal(scoreChanged(8.5, 8.0, 0.05), true);
});

test("buildWatchlistAlertMessage includes scores and link", () => {
  const msg = buildWatchlistAlertMessage({
    url: "https://www.competitor.com/pricing",
    previousScore: 6.2,
    newScore: 7.4,
    shareUrl: "https://roastmypage.site/roast/abc123",
    baseUrl: "https://roastmypage.site"
  });
  assert.match(msg.subject, /competitor\.com/);
  assert.match(msg.text, /6\.2/);
  assert.match(msg.text, /7\.4/);
  assert.match(msg.text, /\+1\.2/);
  assert.match(msg.slack.text, /competitor\.com/);
  assert.match(msg.discord.content, /7\.4/);
  assert.match(msg.html, /roast\/abc123/);
});

test("lookupLatestRoastScore never falls back to another path on the same host", async () => {
  const queries = [];
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...binds) {
            return {
              async first() {
                queries.push({ sql, binds });
                if (sql.includes("url_hash")) return null;
                const siblingRoast = {
                  id: "homepage",
                  url: "https://competitor.com/",
                  overall_score: 9,
                  created_at: "2026-08-01T00:00:00Z"
                };
                return binds.includes(siblingRoast.url) ? siblingRoast : null;
              }
            };
          }
        };
      }
    }
  };

  const result = await lookupLatestRoastScore(env, {
    url: "https://competitor.com/pricing",
    urlHash: "missing-pricing-hash"
  });

  assert.equal(result, null);
  assert.equal(queries.some(({ sql }) => sql.includes("LIKE")), false);
});

test("lookupLatestRoastScore exact fallback tolerates a trailing slash", async () => {
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...binds) {
            return {
              async first() {
                if (sql.includes("url_hash")) return null;
                const exactRoast = {
                  id: "pricing",
                  url: "https://competitor.com/pricing/",
                  overall_score: 7.2,
                  created_at: "2026-08-01T00:00:00Z"
                };
                return binds.includes(exactRoast.url) ? exactRoast : null;
              }
            };
          }
        };
      }
    }
  };

  const result = await lookupLatestRoastScore(env, {
    url: "https://competitor.com/pricing",
    urlHash: "missing-pricing-hash"
  });

  assert.equal(result?.id, "pricing");
  assert.equal(result?.overall_score, 7.2);
});

test("processWatchlistAlerts emits alert when score moves and updates row", async () => {
  const calls = [];
  const watchRows = [
    {
      id: "w1",
      owner_key: "owner-1",
      url: "https://competitor.com",
      url_hash: "hash1",
      email: null,
      webhook_url: null,
      last_score: 6.0,
      last_roast_id: "old"
    }
  ];
  const env = {
    DB: {
      prepare(sql) {
        const stmt = {
          _sql: sql,
          _binds: [],
          bind(...args) {
            this._binds = args;
            return this;
          },
          async all() {
            calls.push({ type: "all", sql });
            if (sql.includes("FROM watchlist WHERE active")) {
              return { results: watchRows };
            }
            return { results: [] };
          },
          async first() {
            calls.push({ type: "first", sql, binds: this._binds });
            if (sql.includes("FROM roasts") && sql.includes("url_hash")) {
              return {
                id: "r-new",
                url: "https://competitor.com",
                overall_score: 7.5,
                created_at: "2026-08-01T00:00:00Z"
              };
            }
            return null;
          },
          async run() {
            calls.push({ type: "run", sql, binds: this._binds });
            return { success: true };
          }
        };
        return stmt;
      }
    }
  };

  const result = await processWatchlistAlerts(env, { limit: 10, baseUrl: "https://roastmypage.site" });
  assert.equal(result.checked, 1);
  assert.equal(result.alerted, 1);
  assert.equal(result.alerts[0].newScore, 7.5);
  assert.equal(result.alerts[0].previousScore, 6.0);

  const insertAlert = calls.find((c) => c.type === "run" && c.sql.includes("INSERT INTO watchlist_alerts"));
  assert.ok(insertAlert);
  const updateScore = calls.find(
    (c) => c.type === "run" && c.sql.includes("SET last_score") && c.binds?.[0] === 7.5
  );
  assert.ok(updateScore);
});

test("processWatchlistAlerts skips when score is unchanged", async () => {
  const runs = [];
  const env = {
    DB: {
      prepare(sql) {
        const stmt = {
          bind() { return this; },
          async all() {
            if (sql.includes("FROM watchlist WHERE active")) {
              return {
                results: [{
                  id: "w1",
                  owner_key: "o",
                  url: "https://a.com",
                  url_hash: "h",
                  email: null,
                  webhook_url: null,
                  last_score: 8.0,
                  last_roast_id: "r1"
                }]
              };
            }
            return { results: [] };
          },
          async first() {
            return { id: "r1", url: "https://a.com", overall_score: 8.02, created_at: "x" };
          },
          async run() {
            runs.push(sql);
            return { success: true };
          }
        };
        return stmt;
      }
    }
  };

  const result = await processWatchlistAlerts(env);
  assert.equal(result.alerted, 0);
  assert.ok(runs.some((s) => s.includes("UPDATE watchlist SET updated_at")));
  assert.equal(runs.some((s) => s.includes("INSERT INTO watchlist_alerts")), false);
});

test("processWatchlistAlerts rotates rows that have no roast yet", async () => {
  const runs = [];
  const env = {
    DB: {
      prepare(sql) {
        const stmt = {
          _binds: [],
          bind(...args) {
            this._binds = args;
            return this;
          },
          async all() {
            return {
              results: [{
                id: "no-roast",
                owner_key: "owner",
                url: "https://new-competitor.example",
                url_hash: "missing",
                email: null,
                webhook_url: null,
                last_score: null,
                last_roast_id: null
              }]
            };
          },
          async first() {
            return null;
          },
          async run() {
            runs.push({ sql, binds: this._binds });
            return { success: true };
          }
        };
        return stmt;
      }
    }
  };

  const result = await processWatchlistAlerts(env);

  assert.equal(result.checked, 1);
  assert.equal(result.alerted, 0);
  assert.ok(runs.some(
    (call) =>
      call.sql.includes("UPDATE watchlist SET updated_at") &&
      call.binds[0] === "no-roast"
  ));
});

test("processWatchlistAlerts preserves a score change when webhook delivery fails", async () => {
  const originalFetch = globalThis.fetch;
  const runs = [];
  globalThis.fetch = async () => new Response("rate limited", { status: 429 });
  const env = {
    DB: {
      prepare(sql) {
        const stmt = {
          _binds: [],
          bind(...args) {
            this._binds = args;
            return this;
          },
          async all() {
            return {
              results: [{
                id: "retry-me",
                owner_key: "owner",
                url: "https://competitor.example",
                url_hash: "hash",
                email: null,
                webhook_url: "https://hooks.slack.com/services/T00/B00/token",
                last_score: 6,
                last_roast_id: "old"
              }]
            };
          },
          async first() {
            return {
              id: "new",
              url: "https://competitor.example",
              overall_score: 8,
              created_at: "2026-08-25T00:00:00Z"
            };
          },
          async run() {
            runs.push({ sql, binds: this._binds });
            return { success: true };
          }
        };
        return stmt;
      }
    }
  };

  try {
    const result = await processWatchlistAlerts(env);

    assert.equal(result.checked, 1);
    assert.equal(result.alerted, 0);
    assert.equal(runs.some(({ sql }) => sql.includes("INSERT INTO watchlist_alerts")), false);
    assert.equal(runs.some(({ sql }) => sql.includes("SET last_score")), false);
    assert.ok(runs.some(
      ({ sql, binds }) =>
        sql.includes("UPDATE watchlist SET updated_at") &&
        binds[0] === "retry-me"
    ));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
