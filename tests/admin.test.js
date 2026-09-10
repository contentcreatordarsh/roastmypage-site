import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_TOKEN_HEADER,
  authorizeAdminRequest,
  extractAdminToken,
  filterHiddenRoasts,
  getAdminToken,
  roastIdExclusion,
  verifyAdminToken
} from "../src/admin.js";
import worker from "../src/index.js";

test("getAdminToken prefers ADMIN_SECRET and treats blanks as unset", () => {
  assert.equal(getAdminToken({}), null);
  assert.equal(getAdminToken({ ADMIN_TOKEN: "   " }), null);
  assert.equal(getAdminToken({ ADMIN_TOKEN: " token " }), "token");
  assert.equal(getAdminToken({ ADMIN_SECRET: " secret ", ADMIN_TOKEN: "token" }), "secret");
});

test("extractAdminToken reads query token before header token", () => {
  const request = new Request("https://example.com/admin?token=query-secret", {
    headers: { [ADMIN_TOKEN_HEADER]: "header-secret" }
  });

  assert.deepEqual(extractAdminToken(request), {
    token: "query-secret",
    source: "query"
  });
});

test("extractAdminToken reads X-Admin-Token and Bearer headers", () => {
  assert.deepEqual(
    extractAdminToken(new Request("https://example.com/api/admin/stats", {
      headers: { [ADMIN_TOKEN_HEADER]: "header-secret" }
    })),
    { token: "header-secret", source: "header" }
  );
  assert.deepEqual(
    extractAdminToken(new Request("https://example.com/api/admin/stats", {
      headers: { Authorization: "Bearer bearer-secret" }
    })),
    { token: "bearer-secret", source: "header" }
  );
});

test("authorizeAdminRequest reports unconfigured admin when no secret is set", async () => {
  const request = new Request("https://example.com/api/admin/stats?token=anything");

  assert.deepEqual(await authorizeAdminRequest(request, {}), {
    configured: false,
    authorized: false,
    source: null
  });
});

test("authorizeAdminRequest authorizes a matching query token", async () => {
  const request = new Request("https://example.com/admin?token=correct");

  assert.deepEqual(await authorizeAdminRequest(request, { ADMIN_SECRET: "correct" }), {
    configured: true,
    authorized: true,
    source: "query"
  });
});

test("authorizeAdminRequest rejects an invalid token without exposing its source", async () => {
  const request = new Request("https://example.com/api/admin/stats", {
    headers: { [ADMIN_TOKEN_HEADER]: "wrong" }
  });

  assert.deepEqual(await authorizeAdminRequest(request, { ADMIN_TOKEN: "correct" }), {
    configured: true,
    authorized: false,
    source: null
  });
});

test("verifyAdminToken rejects missing values and mismatches", async () => {
  assert.equal(await verifyAdminToken("", "correct"), false);
  assert.equal(await verifyAdminToken("wrong", "correct"), false);
  assert.equal(await verifyAdminToken("correct", "correct"), true);
});

test("roastIdExclusion parameterizes ids and ignores unsafe values", () => {
  assert.deepEqual(roastIdExclusion([]), { sql: "1=1", params: [] });
  assert.deepEqual(roastIdExclusion(["demo1234", "drop table", "demo1234"]), {
    sql: "id NOT IN (?)",
    params: ["demo1234"]
  });
});

test("filterHiddenRoasts removes moderated gallery ids", () => {
  const rows = [{ id: "keep1234" }, { id: "hide1234" }];
  assert.deepEqual(filterHiddenRoasts(rows, ["hide1234"]), [{ id: "keep1234" }]);
});

function memoryKv(initial = {}) {
  const store = { ...initial };
  return {
    async get(key) {
      return store[key] ?? null;
    },
    async put(key, value) {
      store[key] = value;
    }
  };
}

function adminDb({
  roasts = [],
  feedback = [],
  subscribers = [],
  optOuts = [],
  rateLimits = [],
  apiCounters = [],
  mutations = []
} = {}) {
  return {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      const statement = {
        binds: [],
        bind(...args) {
          statement.binds = args;
          return statement;
        },
        async first() {
          if (normalized.includes("SELECT id FROM roasts WHERE id = ?")) {
            return roasts.find((row) => row.id === statement.binds[0]) || null;
          }
          if (normalized.includes("FROM email_opt_outs WHERE email = ?")) {
            return optOuts.find((row) => row.email === statement.binds[0]) || null;
          }
          if (normalized.includes("COUNT(*) AS total FROM email_subscribers")) {
            return { total: subscribers.length };
          }
          if (normalized.includes("COUNT(*) AS total FROM feedback")) {
            return { total: feedback.length };
          }
          if (normalized.includes("COUNT(*) AS total FROM email_opt_outs")) {
            return { total: optOuts.length };
          }
          if (normalized.includes("FROM roasts") && normalized.includes("COUNT(*)")) {
            return {
              total_roasts: roasts.length,
              roasts_24h: 1,
              roasts_7d: 1,
              roasts_30d: 1,
              unique_sites_30d: 1,
              avg_score: 7.4,
              min_score: 6,
              max_score: 8,
              last_roast: "2026-09-10 00:00:00"
            };
          }
          return null;
        },
        async all() {
          if (normalized.includes("FROM feedback")) return { results: feedback };
          if (normalized.includes("FROM email_subscribers")) return { results: subscribers };
          if (normalized.includes("FROM email_opt_outs")) return { results: optOuts };
          if (normalized.includes("FROM rate_limits")) return { results: rateLimits };
          if (normalized.includes("FROM api_v1_counters")) return { results: apiCounters };
          if (normalized.includes("GROUP BY industry")) {
            return { results: [{ industry: "saas", count: roasts.length, avg_score: 7.4 }] };
          }
          if (normalized.includes("GROUP BY country")) {
            return { results: [{ country: "US", count: roasts.length }] };
          }
          if (normalized.includes("strftime('%Y-%m'")) {
            return { results: [{ month: "2026-09", count: roasts.length }] };
          }
          if (normalized.includes("FROM roasts")) return { results: roasts };
          return { results: [] };
        },
        async run() {
          mutations.push({ sql: normalized, binds: statement.binds });
          if (normalized.startsWith("INSERT OR REPLACE INTO email_opt_outs")) {
            const [email, reason] = statement.binds;
            const existing = optOuts.find((row) => row.email === email);
            if (existing) existing.reason = reason;
            else optOuts.push({ email, reason, created_at: "2026-09-10 00:00:00" });
          }
          if (normalized.startsWith("DELETE FROM email_subscribers")) {
            const email = statement.binds[0];
            const index = subscribers.findIndex((row) => row.email === email);
            if (index >= 0) subscribers.splice(index, 1);
          }
          if (normalized.startsWith("DELETE FROM email_opt_outs")) {
            const email = statement.binds[0];
            const index = optOuts.findIndex((row) => row.email === email);
            if (index >= 0) optOuts.splice(index, 1);
          }
          if (normalized.startsWith("DELETE FROM rate_limits") || normalized.startsWith("DELETE FROM api_v1_counters")) {
            const hash = statement.binds[0];
            const list = normalized.includes("rate_limits") ? rateLimits : apiCounters;
            const index = list.findIndex((row) => row.ip_hash === hash);
            if (index >= 0) list.splice(index, 1);
          }
          return { success: true };
        }
      };
      return statement;
    }
  };
}

const sampleRoast = {
  id: "demo1234",
  url: "https://example.com/",
  overall_score: 7.4,
  industry: "saas",
  country: "US",
  created_at: "2026-09-10 00:00:00"
};

function adminEnv(overrides = {}) {
  return {
    ENVIRONMENT: "development",
    BASE_URL: "https://roastmypage.site",
    ADMIN_SECRET: "correct",
    DB: adminDb({
      roasts: [sampleRoast],
      feedback: [{
        id: "fb1",
        vote: "up",
        context: "roast",
        reasons: "",
        message: "nice",
        email: "user@example.com",
        roast_id: "demo1234",
        url: "https://example.com/",
        country: "US",
        created_at: "2026-09-10 00:00:00"
      }],
      subscribers: [{
        id: "sub1",
        email: "user@example.com",
        roast_id: "demo1234",
        created_at: "2026-09-10 00:00:00"
      }],
      rateLimits: [{
        ip_hash: "abc123def456",
        request_count: 9,
        window_start: "2026-09-10 00:00:00",
        last_request: "2026-09-10 00:10:00"
      }]
    }),
    CONFIG: memoryKv(),
    ...overrides
  };
}

test("/admin returns not-configured when the secret is missing", async () => {
  const response = await worker.fetch(
    new Request("https://roastmypage.site/admin"),
    adminEnv({ ADMIN_SECRET: undefined, ADMIN_TOKEN: undefined }),
    {}
  );
  const html = await response.text();
  assert.equal(response.status, 503);
  assert.match(html, /not configured/i);
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

test("/admin renders the login dashboard when configured", async () => {
  const response = await worker.fetch(
    new Request("https://roastmypage.site/admin"),
    adminEnv(),
    {}
  );
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Open dashboard/);
  assert.match(html, /data-tab="overview"/);
  assert.match(html, /data-tab="feedback"/);
  assert.match(html, /data-tab="subscribers"/);
  assert.match(html, /data-tab="gallery"/);
  assert.doesNotMatch(html, /<meta name="robots" content="index/);
});

test("admin APIs require a valid token", async () => {
  const missing = await worker.fetch(
    new Request("https://roastmypage.site/api/admin/stats"),
    adminEnv(),
    {}
  );
  assert.equal(missing.status, 401);

  const ok = await worker.fetch(
    new Request("https://roastmypage.site/api/admin/stats?token=correct"),
    adminEnv(),
    {}
  );
  const body = await ok.json();
  assert.equal(ok.status, 200);
  assert.equal(body.stats.totalRoasts, 1);
  assert.equal(body.stats.mau, 1);
  assert.equal(body.topCountries[0].country, "US");
  assert.equal(body.monthlyTrend[0].month, "2026-09");
});

test("admin can hide a roast and the public gallery omits it", async () => {
  const env = adminEnv();
  const hide = await worker.fetch(
    new Request("https://roastmypage.site/api/admin/gallery", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:8787",
        [ADMIN_TOKEN_HEADER]: "correct"
      },
      body: JSON.stringify({ id: "demo1234", action: "hide" })
    }),
    env,
    {}
  );
  const hideBody = await hide.json();
  assert.equal(hide.status, 200);
  assert.deepEqual(hideBody.hidden, ["demo1234"]);

  const gallery = await worker.fetch(
    new Request("https://roastmypage.site/api/gallery"),
    env,
    {}
  );
  assert.deepEqual(await gallery.json(), []);
});

test("admin opt-out removes the subscriber and blocks resubscribe", async () => {
  const mutations = [];
  const subscribers = [{
    id: "sub1",
    email: "user@example.com",
    roast_id: "demo1234",
    created_at: "2026-09-10 00:00:00"
  }];
  const optOuts = [];
  const env = adminEnv({
    DB: adminDb({ roasts: [sampleRoast], subscribers, optOuts, mutations })
  });

  const optOut = await worker.fetch(
    new Request("https://roastmypage.site/api/admin/opt-outs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:8787",
        [ADMIN_TOKEN_HEADER]: "correct"
      },
      body: JSON.stringify({ email: "user@example.com", reason: "request" })
    }),
    env,
    {}
  );
  assert.equal(optOut.status, 200);
  assert.equal(subscribers.length, 0);
  assert.equal(optOuts[0].email, "user@example.com");

  const subscribe = await worker.fetch(
    new Request("https://roastmypage.site/api/subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:8787",
        "CF-Connecting-IP": "203.0.113.10"
      },
      body: JSON.stringify({ email: "user@example.com", roastId: "demo1234" })
    }),
    env,
    {}
  );
  assert.equal(subscribe.status, 200);
  assert.equal(subscribers.length, 0);
});

test("admin can reset a hashed rate-limit window", async () => {
  const rateLimits = [{
    ip_hash: "abc123def456",
    request_count: 9,
    window_start: "2026-09-10 00:00:00",
    last_request: "2026-09-10 00:10:00"
  }];
  const env = adminEnv({
    DB: adminDb({ roasts: [sampleRoast], rateLimits })
  });
  const response = await worker.fetch(
    new Request("https://roastmypage.site/api/admin/rate-limits", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:8787",
        [ADMIN_TOKEN_HEADER]: "correct"
      },
      body: JSON.stringify({ ipHash: "abc123def456", action: "reset" })
    }),
    env,
    {}
  );
  assert.equal(response.status, 200);
  assert.equal(rateLimits.length, 0);
});
