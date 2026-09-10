import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authenticateApiKeyRequest,
  createApiKey,
  extractApiKeyFromRequest,
  getApiKeyPrefix,
  hashApiKey,
  isValidApiKeyFormat,
  normalizeEmail
} from "../src/apiKeys.js";

test("createApiKey returns plaintext once and stores only a SHA-256 hash", async () => {
  let bindings;
  const env = {
    DB: {
      prepare: (sql) => ({
        bind: (...values) => {
          if (sql.includes("COUNT(*)")) {
            return { first: async () => ({ count: 0 }) };
          }
          bindings = values;
          return {
            first: async () => ({
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
          };
        }
      })
    }
  };

  const created = await createApiKey(env, { email: " Dev@Example.COM ", label: " Build worker " });

  assert.match(created.key, /^rmph_[A-Za-z0-9_-]{32,128}$/);
  assert.equal(isValidApiKeyFormat(created.key), true);
  assert.equal(created.apiKey.prefix, getApiKeyPrefix(created.key));
  assert.equal(created.apiKey.tier, "free");
  assert.equal(created.apiKey.email, "dev@example.com");
  assert.equal(created.apiKey.label, "Build worker");
  assert.equal(created.apiKey.dailyLimit, 50);
  assert.equal(bindings[1], await hashApiKey(created.key));
  assert.notEqual(bindings[1], created.key);
  assert.match(bindings[1], /^[a-f0-9]{64}$/);
});

test("createApiKey rejects invalid email and caps active keys per email", async () => {
  const env = {
    DB: {
      prepare: () => ({
        bind: () => ({ first: async () => ({ count: 3 }) })
      })
    }
  };

  await assert.rejects(() => createApiKey(env, { email: "not-an-email" }), { code: "invalid_email" });
  await assert.rejects(() => createApiKey(env, { email: "dev@example.com" }), { code: "key_limit_exceeded" });
});

test("extractApiKeyFromRequest accepts bearer and X-Api-Key headers", () => {
  const bearer = new Request("https://example.com", {
    headers: { Authorization: "Bearer rmph_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  });
  const xApiKey = new Request("https://example.com", {
    headers: { "X-Api-Key": " rmph_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb " }
  });

  assert.equal(extractApiKeyFromRequest(bearer), "rmph_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(extractApiKeyFromRequest(xApiKey), "rmph_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
});

test("authenticateApiKeyRequest hashes presented key and returns active row", async () => {
  const plaintext = "rmph_cccccccccccccccccccccccccccccccc";
  const expectedHash = await hashApiKey(plaintext);
  let selectedHash;
  const env = {
    DB: {
      prepare: () => ({
        bind: (hash) => {
          selectedHash = hash;
          return {
            first: async () => hash === expectedHash ? {
              id: "key-1",
              key_prefix: "rmph_cccccc",
              email: "dev@example.com",
              tier: "pro",
              label: "CI",
              daily_limit: 250,
              created_at: "2026-09-10 00:00:00",
              last_used_at: null,
              is_active: 1
            } : null
          };
        }
      })
    }
  };

  const request = new Request("https://example.com", {
    headers: { Authorization: `Bearer ${plaintext}` }
  });
  const auth = await authenticateApiKeyRequest(env, request);

  assert.equal(selectedHash, expectedHash);
  assert.equal(auth.present, true);
  assert.equal(auth.apiKey.id, "key-1");
  assert.equal(auth.apiKey.tier, "pro");
  assert.equal(auth.apiKey.dailyLimit, 250);
});

test("authenticateApiKeyRequest reports no key without touching D1", async () => {
  const env = {
    DB: {
      prepare: () => {
        throw new Error("D1 should not be queried");
      }
    }
  };

  const auth = await authenticateApiKeyRequest(env, new Request("https://example.com"));

  assert.deepEqual(auth, { present: false, apiKey: null });
});

test("normalizeEmail lowercases and rejects junk", () => {
  assert.equal(normalizeEmail(" Dev@Example.COM "), "dev@example.com");
  assert.equal(normalizeEmail("nope"), null);
  assert.equal(normalizeEmail(""), null);
});
