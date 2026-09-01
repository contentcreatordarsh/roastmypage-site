import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isWatchlistWebhookUrl,
  scoreChanged,
  buildWatchlistAlertMessage,
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

test("processWatchlistAlerts ignores stored bot-challenge scores", async () => {
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
                  url: "https://blocked.example",
                  url_hash: "blocked-hash",
                  email: null,
                  webhook_url: null,
                  last_score: 8.0,
                  last_roast_id: "real-roast"
                }]
              };
            }
            return { results: [] };
          },
          async first() {
            return {
              id: "challenge-roast",
              url: "https://blocked.example",
              overall_score: 2.0,
              created_at: "2026-08-01T00:00:00Z",
              seo_data: JSON.stringify({ title: { text: "Just a moment..." } })
            };
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
  assert.equal(result.checked, 1);
  assert.equal(result.alerted, 0);
  assert.equal(runs.length, 0);
});
