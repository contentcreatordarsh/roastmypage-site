import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkGlobalRateLimit,
  getCachedRoast,
  getScoreHistory,
  normalizeScoreHistoryTarget,
  buildScoreHistoryQuery,
  releaseApiV1Quota
} from "../src/db.js";
import { hashUrl } from "../src/utils.js";

test("checkGlobalRateLimit fails closed when KV is unavailable", async () => {
  const env = {
    CONFIG: {
      get: async () => {
        throw new Error("KV unavailable");
      }
    }
  };

  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await checkGlobalRateLimit(env);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /temporarily unavailable/i);
  } finally {
    console.error = originalError;
  }
});

test("checkGlobalRateLimit increments an available hourly bucket", async () => {
  const writes = [];
  const env = {
    CONFIG: {
      get: async () => "0",
      put: async (...args) => writes.push(args)
    }
  };

  const result = await checkGlobalRateLimit(env);
  assert.deepEqual(result, { allowed: true });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][1], "1");
  assert.deepEqual(writes[0][2], { expirationTtl: 7200 });
});

test("getCachedRoast can return legacy audit data for non-persisting callers", async () => {
  const legacyRoast = {
    id: "legacy-1",
    url: "https://example.com/",
    url_hash: "hash",
    overall_score: 7,
    hero_score: 7,
    cta_score: 7,
    trust_score: 7,
    copy_score: 7,
    design_score: 7,
    roast_response: "Legacy roast",
    quick_wins: "[]",
    seo_data: null,
    performance_data: null,
    heatmap_data: null,
    industry: "other"
  };
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind() {
            return {
              first: async () => sql.includes("SELECT id, url") ? legacyRoast : { count: 1 }
            };
          }
        };
      }
    }
  };

  assert.equal(await getCachedRoast(env, "hash", legacyRoast.url), null);

  const cached = await getCachedRoast(
    env,
    "hash",
    legacyRoast.url,
    { requireAuditData: false }
  );
  assert.equal(cached.id, "legacy-1");
  assert.equal(cached.seo, null);
  assert.equal(cached.performance, null);
});

test("normalizeScoreHistoryTarget treats bare input as hostname and URL input as normalized URL", () => {
  assert.deepEqual(normalizeScoreHistoryTarget({ url: "WWW.Example.COM" }), {
    input: "WWW.Example.COM",
    mode: "hostname",
    hostname: "example.com",
    normalizedUrl: "https://www.example.com/"
  });

  assert.deepEqual(normalizeScoreHistoryTarget({ url: "https://Example.com/page/?utm_source=x&ref=y" }), {
    input: "https://Example.com/page/?utm_source=x&ref=y",
    mode: "url",
    hostname: "example.com",
    normalizedUrl: "https://example.com/page"
  });
});

test("buildScoreHistoryQuery shapes exact URL and hostname lookups safely", async () => {
  const urlTarget = normalizeScoreHistoryTarget({ url: "https://example.com/pricing" });
  const urlQuery = await buildScoreHistoryQuery(urlTarget, 20);

  assert.match(urlQuery.sql, /url_hash IN \(\?, \?, \?, \?, \?, \?\)/);
  assert.match(urlQuery.sql, /LOWER\(url\) = \?/);
  assert.doesNotMatch(urlQuery.sql, /LOWER\(url\) LIKE \?/);
  assert.equal(urlQuery.bindings.at(-1), 20);

  const hostTarget = normalizeScoreHistoryTarget({ hostname: "www.Example.com" });
  const hostQuery = await buildScoreHistoryQuery(hostTarget, 7);

  assert.doesNotMatch(hostQuery.sql, /url_hash IN/);
  assert.match(hostQuery.sql, /LOWER\(url\) LIKE \?/);
  assert.equal(hostQuery.bindings.at(-1), 7);
  assert(hostQuery.bindings.includes("https://example.com/%"));
  assert(hostQuery.bindings.includes("https://www.example.com/%"));
});

test("getScoreHistory filters normalized URLs, infers device, and returns chronological rows", async () => {
  const newestHash = await hashUrl("https://example.com/page?utm_source=ad", "mobile");
  const oldestHash = await hashUrl("https://example.com/page", "desktop");
  let sql;
  let bindings;
  const env = {
    DB: {
      prepare(statement) {
        sql = statement;
        return {
          bind(...values) {
            bindings = values;
            return {
              all: async () => ({
                results: [
                  {
                    id: "newer",
                    url: "https://example.com/page?utm_source=ad",
                    url_hash: newestHash,
                    overall_score: 7.2,
                    hero_score: 7,
                    cta_score: 7,
                    trust_score: 7,
                    copy_score: 7,
                    design_score: 8,
                    created_at: "2026-02-03T00:00:00Z"
                  },
                  {
                    id: "other-path",
                    url: "https://example.com/blog",
                    url_hash: "different",
                    overall_score: 9,
                    hero_score: 9,
                    cta_score: 9,
                    trust_score: 9,
                    copy_score: 9,
                    design_score: 9,
                    created_at: "2026-02-02T00:00:00Z"
                  },
                  {
                    id: "older",
                    url: "https://example.com/page",
                    url_hash: oldestHash,
                    overall_score: 5.5,
                    hero_score: 5,
                    cta_score: 6,
                    trust_score: 5,
                    copy_score: 6,
                    design_score: 5,
                    created_at: "2026-02-01T00:00:00Z"
                  }
                ]
              })
            };
          }
        };
      }
    }
  };

  const result = await getScoreHistory(env, { url: "https://Example.com/page/?ref=twitter" }, { limit: 20 });

  assert.match(sql, /ORDER BY created_at DESC/);
  assert.equal(bindings.at(-1), 20);
  assert.equal(result.target.mode, "url");
  assert.deepEqual(result.history.map((item) => item.id), ["older", "newer"]);
  assert.deepEqual(result.history.map((item) => item.device), ["desktop", "mobile"]);
  assert.deepEqual(result.history[0].scores, { hero: 5, cta: 6, trust: 5, copy: 6, design: 5 });
});

test("releaseApiV1Quota atomically restores a reserved daily quota", async () => {
  let sql;
  let bindings;
  const env = {
    DB: {
      prepare: (statement) => {
        sql = statement;
        return {
          bind: (...values) => {
            bindings = values;
            return {
              run: async () => ({ meta: { changes: 1 } })
            };
          }
        };
      }
    }
  };

  const released = await releaseApiV1Quota(env, "ip-hash");

  assert.equal(released, true);
  assert.match(sql, /request_count = request_count - 1/);
  assert.match(sql, /request_count > 0/);
  assert.match(bindings[0], /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(bindings[1], "ip-hash");
});

test("releaseApiV1Quota does not mask the original request failure", async () => {
  const env = {
    DB: {
      prepare: () => {
        throw new Error("D1 unavailable");
      }
    }
  };

  const originalError = console.error;
  console.error = () => {};
  try {
    assert.equal(await releaseApiV1Quota(env, "ip-hash"), false);
  } finally {
    console.error = originalError;
  }
});
