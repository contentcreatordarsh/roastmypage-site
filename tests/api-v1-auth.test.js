import { test } from "node:test";
import assert from "node:assert/strict";
import { hashApiKey } from "../src/apiKeys.js";
import worker from "../src/index.js";

function stmt(handlers) {
  return {
    bind(...values) {
      return {
        async run() {
          if (handlers.run) return handlers.run(values);
          return { success: true, meta: {} };
        },
        async first() {
          if (handlers.first) return handlers.first(values);
          return null;
        },
        async all() {
          if (handlers.all) return handlers.all(values);
          return { results: [] };
        }
      };
    }
  };
}

function keyAwareDb({ keyRow = null, usageCount = 0, activeKeyCount = 0 } = {}) {
  const queries = [];
  return {
    queries,
    prepare(sql) {
      queries.push(sql);
      if (sql.includes("INSERT INTO rate_limits")) {
        return stmt({ run: () => ({ success: true, meta: {} }) });
      }
      if (sql.includes("SELECT request_count, window_start FROM rate_limits")) {
        return stmt({
          first: () => ({ request_count: 1, window_start: new Date().toISOString() })
        });
      }
      if (sql.includes("COUNT(*)") && sql.includes("api_keys")) {
        return stmt({ first: () => ({ count: activeKeyCount }) });
      }
      if (sql.includes("INSERT INTO api_keys")) {
        return stmt({
          first: (values) => ({
            id: values[0],
            key_prefix: values[2],
            email: values[3],
            tier: "free",
            label: values[4],
            daily_limit: 50,
            created_at: "2026-09-10 00:00:00",
            last_used_at: null,
            is_active: 1
          })
        });
      }
      if (sql.includes("FROM api_keys") && sql.includes("key_hash")) {
        return stmt({ first: () => keyRow });
      }
      if (sql.includes("UPDATE api_keys")) {
        return stmt({ run: () => ({ meta: { changes: 1 } }) });
      }
      if (sql.includes("FROM api_usage") || sql.includes("INSERT INTO api_usage")) {
        return stmt({ first: () => ({ request_count: usageCount }) });
      }
      if (sql.includes("SELECT request_count FROM api_v1_counters")) {
        return stmt({ first: () => ({ request_count: 1 }) });
      }
      if (sql.includes("SELECT COALESCE(SUM(request_count)")) {
        return stmt({ first: () => ({ request_count: 1 }) });
      }
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
}

function envFor(db) {
  return {
    DB: db,
    CONFIG: { get: async () => "0", put: async () => {} },
    IP_HASH_SALT: "test-salt",
    ENVIRONMENT: "development"
  };
}

test("OPTIONS /api/v1/roast allows Authorization and X-Api-Key", async () => {
  const response = await worker.fetch(
    new Request("https://roastmypage.site/api/v1/roast", { method: "OPTIONS" }),
    envFor(keyAwareDb()),
    { waitUntil() {} }
  );
  const allow = response.headers.get("Access-Control-Allow-Headers") || "";
  assert.ok(response.status === 200 || response.status === 204);
  assert.match(allow, /Authorization/i);
  assert.match(allow, /X-Api-Key/i);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
});

test("POST /api/v1/keys mints a hashed rmph_ key", async () => {
  const db = keyAwareDb();
  const response = await worker.fetch(
    new Request("https://roastmypage.site/api/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
      body: JSON.stringify({ email: "dev@example.com", label: "CI" })
    }),
    envFor(db),
    { waitUntil() {} }
  );
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.match(body.key, /^rmph_[A-Za-z0-9_-]{32,128}$/);
  assert.equal(body.tier, "free");
  assert.equal(body.dailyLimit, 50);
  assert.equal(body.label, "CI");
  assert.match(body.warning, /shown only once/i);
  const insert = db.queries.find((sql) => sql.includes("INSERT INTO api_keys"));
  assert.ok(insert);
  assert.match(insert, /key_hash/);
});

test("POST /api/v1/keys requires a valid email", async () => {
  const response = await worker.fetch(
    new Request("https://roastmypage.site/api/v1/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
      body: JSON.stringify({ email: "nope" })
    }),
    envFor(keyAwareDb()),
    { waitUntil() {} }
  );
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, "invalid_email");
});

test("GET /api/v1/usage with a bearer key returns daily key quota", async () => {
  const plaintext = "rmph_dddddddddddddddddddddddddddddddd";
  const db = keyAwareDb({
    keyRow: {
      id: "key-1",
      key_prefix: "rmph_dddddd",
      email: "dev@example.com",
      tier: "free",
      label: "CI",
      daily_limit: 50,
      created_at: "2026-09-10 00:00:00",
      last_used_at: null,
      is_active: 1
    },
    usageCount: 12
  });
  const response = await worker.fetch(
    new Request("https://roastmypage.site/api/v1/usage", {
      headers: {
        Authorization: `Bearer ${plaintext}`,
        "CF-Connecting-IP": "203.0.113.10"
      }
    }),
    envFor(db),
    { waitUntil() {} }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.limits.daily.limit, 50);
  assert.equal(body.limits.daily.used, 12);
  assert.equal(body.limits.daily.remaining, 38);
  assert.equal(body.limits.perIp, undefined);
  assert.equal(body.key.tier, "free");
  assert.equal(response.headers.get("X-RateLimit-Limit"), "50");
  assert.equal(response.headers.get("X-RateLimit-Remaining"), "38");
  assert.equal(response.headers.get("X-RateLimit-Tier"), "free");
  assert.equal(response.headers.get("X-RateLimit-Global-Limit"), null);
});

test("POST /api/v1/roast rejects an invalid API key without roasting", async () => {
  const response = await worker.fetch(
    new Request("https://roastmypage.site/api/v1/roast", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer rmph_thiskeydoesnotexist00000000000000",
        "CF-Connecting-IP": "203.0.113.10"
      },
      body: JSON.stringify({ url: "https://example.com" })
    }),
    envFor(keyAwareDb()),
    { waitUntil() {} }
  );
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.error, "invalid_api_key");
  assert.equal(body.success, false);
});

test("anonymous GET /api/v1/usage still reports IP and global pools", async () => {
  const response = await worker.fetch(
    new Request("https://roastmypage.site/api/v1/usage", {
      headers: { "CF-Connecting-IP": "203.0.113.10" }
    }),
    envFor(keyAwareDb()),
    { waitUntil() {} }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.limits.perIp.limit, 5);
  assert.equal(body.limits.global.limit, 50);
  assert.equal(body.limits.daily, undefined);
});

test("hashed lookup is used when authenticating a well-formed key", async () => {
  const plaintext = "rmph_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const expectedHash = await hashApiKey(plaintext);
  let seenHash;
  const db = keyAwareDb();
  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = originalPrepare(sql);
    if (sql.includes("FROM api_keys") && sql.includes("key_hash")) {
      const originalBind = statement.bind.bind(statement);
      statement.bind = (...values) => {
        seenHash = values[0];
        return originalBind(...values);
      };
    }
    return statement;
  };

  await worker.fetch(
    new Request("https://roastmypage.site/api/v1/usage", {
      headers: { Authorization: `Bearer ${plaintext}` }
    }),
    envFor(db),
    { waitUntil() {} }
  );

  assert.equal(seenHash, expectedHash);
});
