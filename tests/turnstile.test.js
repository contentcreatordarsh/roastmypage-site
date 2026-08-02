import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TURNSTILE_SITEVERIFY_URL,
  getTurnstileSiteKey,
  isTurnstileConfigured,
  verifyTurnstileToken
} from "../src/turnstile.js";

test("Turnstile is disabled unless both keys are configured", async () => {
  assert.equal(getTurnstileSiteKey({}), null);
  assert.equal(getTurnstileSiteKey({ TURNSTILE_SITE_KEY: "site" }), null);
  assert.equal(isTurnstileConfigured({ TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET_KEY: "secret" }), true);

  let called = false;
  const result = await verifyTurnstileToken({}, "", "203.0.113.10", async () => {
    called = true;
  });

  assert.deepEqual(result, { success: true, skipped: true });
  assert.equal(called, false);
});

test("verifyTurnstileToken posts token details to siteverify", async () => {
  const env = { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET_KEY: "secret-key" };
  const result = await verifyTurnstileToken(env, "token-value", "203.0.113.10", async (url, options) => {
    assert.equal(url, TURNSTILE_SITEVERIFY_URL);
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.equal(options.body.get("secret"), "secret-key");
    assert.equal(options.body.get("response"), "token-value");
    assert.equal(options.body.get("remoteip"), "203.0.113.10");

    return {
      ok: true,
      json: async () => ({ success: true })
    };
  });

  assert.deepEqual(result, { success: true });
});

test("verifyTurnstileToken rejects missing tokens before calling fetch", async () => {
  const env = { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET_KEY: "secret-key" };
  let called = false;

  const result = await verifyTurnstileToken(env, " ", "203.0.113.10", async () => {
    called = true;
  });

  assert.deepEqual(result, { success: false, error: "missing-token" });
  assert.equal(called, false);
});

test("verifyTurnstileToken returns the first siteverify error code", async () => {
  const env = { TURNSTILE_SITE_KEY: "site-key", TURNSTILE_SECRET_KEY: "secret-key" };
  const result = await verifyTurnstileToken(env, "bad-token", "unknown", async (_url, options) => {
    assert.equal(options.body.has("remoteip"), false);

    return {
      ok: true,
      json: async () => ({ success: false, "error-codes": ["invalid-input-response"] })
    };
  });

  assert.deepEqual(result, { success: false, error: "invalid-input-response" });
});
