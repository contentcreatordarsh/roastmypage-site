import { test } from "node:test";
import assert from "node:assert/strict";
import { checkGlobalRateLimit, deduplicatedRoast, getCachedRoast, releaseApiV1Quota } from "../src/db.js";

function createMockKv(initialValues = {}) {
  const store = new Map(Object.entries(initialValues));
  const puts = [];
  const deletes = [];
  return {
    store,
    puts,
    deletes,
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value, options) {
      puts.push([key, value, options]);
      store.set(key, value);
    },
    async delete(key) {
      deletes.push(key);
      store.delete(key);
    }
  };
}

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

test("deduplicatedRoast acquires and releases a KV inflight lock", async () => {
  const kv = createMockKv();
  const env = { CONFIG: kv };
  let calls = 0;

  const response = await deduplicatedRoast(
    env,
    "hash-kv-lock",
    async () => {
      calls += 1;
      assert.equal(kv.store.has("inflight:hash-kv-lock"), true);
      return { ok: true };
    },
    { lockTtlSeconds: 90 }
  );

  assert.deepEqual(response, { result: { ok: true }, deduplicated: false });
  assert.equal(calls, 1);
  assert.equal(kv.puts.length, 1);
  assert.equal(kv.puts[0][0], "inflight:hash-kv-lock");
  assert.deepEqual(kv.puts[0][2], { expirationTtl: 90 });
  assert.equal(kv.deletes.length, 1);
  assert.equal(kv.deletes[0], "inflight:hash-kv-lock");
  assert.equal(kv.store.has("inflight:hash-kv-lock"), false);
});

test("deduplicatedRoast returns an already-analyzing signal when KV lock is held", async () => {
  const kv = createMockKv({
    "inflight:hash-held": JSON.stringify({ token: "other-isolate" })
  });
  const env = { CONFIG: kv };
  let calls = 0;

  const response = await deduplicatedRoast(
    env,
    "hash-held",
    async () => {
      calls += 1;
      return { ok: true };
    },
    { lockPollTimeoutMs: 1, lockPollIntervalMs: 1 }
  );

  assert.equal(calls, 0);
  assert.equal(response.result, null);
  assert.equal(response.deduplicated, true);
  assert.equal(response.alreadyAnalyzing, true);
  assert.equal(response.retryAfter, 1);
  assert.equal(response.lockReleased, false);
  assert.equal(kv.puts.length, 0);
  assert.equal(kv.deletes.length, 0);
});

test("deduplicatedRoast falls back to in-memory dedup when KV is unavailable", async () => {
  const env = {
    CONFIG: {
      get: async () => {
        throw new Error("KV unavailable");
      },
      put: async () => {
        throw new Error("KV unavailable");
      }
    }
  };
  let calls = 0;

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const response = await deduplicatedRoast(env, "hash-fallback", async () => {
      calls += 1;
      return { ok: true };
    });

    assert.deepEqual(response, { result: { ok: true }, deduplicated: false });
    assert.equal(calls, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test("deduplicatedRoast still deduplicates concurrent requests in the same isolate", async () => {
  const kv = createMockKv();
  const env = { CONFIG: kv };
  let calls = 0;
  let finishRoast;
  const roastFinished = new Promise((resolve) => {
    finishRoast = resolve;
  });

  const first = deduplicatedRoast(env, "hash-local", async () => {
    calls += 1;
    return roastFinished;
  });
  const second = deduplicatedRoast(env, "hash-local", async () => {
    calls += 1;
    return { ok: false };
  });

  finishRoast({ ok: true });
  const [firstResponse, secondResponse] = await Promise.all([first, second]);

  assert.deepEqual(firstResponse, { result: { ok: true }, deduplicated: false });
  assert.deepEqual(secondResponse, { result: { ok: true }, deduplicated: true });
  assert.equal(calls, 1);
  assert.equal(kv.puts.length, 1);
  assert.equal(kv.deletes.length, 1);
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
