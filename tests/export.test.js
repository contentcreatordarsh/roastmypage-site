import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function makeExportEnv({ rateLimited = false } = {}) {
  const subscriberRows = [
    { id: "sub-1", email: "user@example.com", roast_id: "abc12345", created_at: "2026-08-01 10:00:00" },
    { id: "sub-2", email: "other@example.com", roast_id: "def67890", created_at: "2026-08-01 11:00:00" }
  ];
  const feedbackRows = [
    {
      id: "fb-1",
      vote: "up",
      context: "roast",
      reasons: "",
      message: "Nice",
      email: "User@Example.com",
      roast_id: "abc12345",
      url: "https://example.com",
      ip_hash: "must-not-leak",
      country: "US",
      created_at: "2026-08-01 12:00:00"
    },
    {
      id: "fb-2",
      vote: "down",
      context: "roast",
      reasons: "slow",
      message: "Nope",
      email: "other@example.com",
      roast_id: "def67890",
      url: "https://other.example",
      ip_hash: "also-secret",
      country: "GB",
      created_at: "2026-08-01 13:00:00"
    }
  ];
  const exportSelects = [];

  return {
    env: {
      ENVIRONMENT: "development",
      IP_HASH_SALT: "test-salt",
      DB: {
        prepare(sql) {
          return {
            bind(...bindings) {
              return {
                run: async () => ({ success: true }),
                first: async () => {
                  if (/SELECT request_count/.test(sql)) {
                    return {
                      request_count: rateLimited ? 999 : 1,
                      window_start: new Date().toISOString()
                    };
                  }
                  return null;
                },
                all: async () => {
                  const email = bindings[0];
                  if (/FROM email_subscribers/.test(sql)) {
                    exportSelects.push(sql);
                    return {
                      results: subscriberRows.filter((row) => row.email.toLowerCase() === email)
                    };
                  }
                  if (/FROM feedback/.test(sql)) {
                    exportSelects.push(sql);
                    const rows = feedbackRows.filter((row) => row.email.toLowerCase() === email);
                    if (/SELECT\s+\*/i.test(sql) || /\bip_hash\b/i.test(sql)) {
                      return { results: rows };
                    }
                    return {
                      results: rows.map(({ ip_hash, ...row }) => row)
                    };
                  }
                  return { results: [] };
                }
              };
            }
          };
        }
      }
    },
    exportSelects
  };
}

test("GET /api/export returns only rows for the requested email without ip_hash", async () => {
  const { env, exportSelects } = makeExportEnv();
  const response = await worker.fetch(
    new Request("https://roastmypage.site/api/export?email=USER%40EXAMPLE.COM", {
      headers: { "CF-Connecting-IP": "203.0.113.10" }
    }),
    env,
    { waitUntil: () => {} }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.email, "user@example.com");
  assert.equal(body.emailSubscribers.length, 1);
  assert.equal(body.feedback.length, 1);
  assert.equal(body.emailSubscribers[0].email, "user@example.com");
  assert.equal(body.feedback[0].email, "User@Example.com");
  assert.equal(body.feedback[0].ip_hash, undefined);
  assert.doesNotMatch(JSON.stringify(body), /ip_hash|must-not-leak|also-secret/);
  assert.equal(exportSelects.length, 2);
  assert.ok(exportSelects.every((sql) => !/\bip_hash\b/i.test(sql)));
});

test("POST /api/export is rate limited by requester IP", async () => {
  const { env } = makeExportEnv({ rateLimited: true });
  const response = await worker.fetch(
    new Request("https://roastmypage.site/api/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "203.0.113.10"
      },
      body: JSON.stringify({ email: "user@example.com" })
    }),
    env,
    { waitUntil: () => {} }
  );

  assert.equal(response.status, 429);
  const body = await response.json();
  assert.match(body.error, /too many export requests/i);
});
