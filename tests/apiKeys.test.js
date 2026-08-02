import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authenticateApiKeyRequest,
  createApiKey,
  extractApiKeyFromRequest,
  getApiKeyPrefix,
  hashApiKey,
  isValidApiKeyFormat
} from "../src/apiKeys.js";

test("createApiKey returns plaintext once and stores only a SHA-256 hash", async () => {
  let bindings;
  const env = {
    DB: {
      prepare: () => ({
        bind: (...values) => {
          bindings = values;
          return {
            first: async () => ({
              id: values[0],
              key_prefix: values[2],
              tier: values[3],
              label: values[4],
              created_at: "2026-08-02 00:00:00",
              last_used_at: null,
              revoked: 0
            })
          };
        }
      })
    }
  };

  const created = await createApiKey(env, { label: " Build worker " });

  assert.match(created.key, /^rmp_[A-Za-z0-9_-]{32,128}$/);
  assert.equal(isValidApiKeyFormat(created.key), true);
  assert.equal(created.apiKey.prefix, getApiKeyPrefix(created.key));
  assert.equal(created.apiKey.tier, "free");
  assert.equal(created.apiKey.label, "Build worker");
  assert.equal(bindings[1], await hashApiKey(created.key));
  assert.notEqual(bindings[1], created.key);
  assert.match(bindings[1], /^[a-f0-9]{64}$/);
});

test("extractApiKeyFromRequest accepts bearer and X-Api-Key headers", () => {
  const bearer = new Request("https://example.com", {
    headers: { Authorization: "Bearer rmp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
  });
  const xApiKey = new Request("https://example.com", {
    headers: { "X-Api-Key": " rmp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb " }
  });

  assert.equal(extractApiKeyFromRequest(bearer), "rmp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.equal(extractApiKeyFromRequest(xApiKey), "rmp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
});

test("authenticateApiKeyRequest hashes presented key and returns active row", async () => {
  const plaintext = "rmp_cccccccccccccccccccccccccccccccc";
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
              key_prefix: "rmp_cccccccc",
              tier: "pro",
              label: "CI",
              created_at: "2026-08-02 00:00:00",
              last_used_at: null,
              revoked: 0
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
