import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildApiV1CallbackPayload,
  callbackStatusNotRequested,
  postApiV1Callback,
  validateCallbackUrl
} from "../src/webhooks.js";

test("validateCallbackUrl accepts empty values and public HTTPS URLs", () => {
  assert.deepEqual(validateCallbackUrl(undefined), { ok: true, url: null });
  assert.deepEqual(validateCallbackUrl(""), { ok: true, url: null });

  const result = validateCallbackUrl(" https://hooks.example.com/services/abc?token=123 ");
  assert.equal(result.ok, true);
  assert.equal(result.url, "https://hooks.example.com/services/abc?token=123");
});

test("validateCallbackUrl rejects non-HTTPS and private callback targets", () => {
  const blocked = [
    "http://hooks.example.com/webhook",
    "https://localhost/webhook",
    "https://127.0.0.1/webhook",
    "https://10.0.0.1/webhook",
    "https://192.168.1.10/webhook",
    "https://172.16.0.1/webhook",
    "https://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://user:pass@example.com/webhook"
  ];

  for (const url of blocked) {
    assert.equal(validateCallbackUrl(url).ok, false, `${url} should be blocked`);
  }
});

test("buildApiV1CallbackPayload returns plain JSON roast summary", () => {
  const payload = buildApiV1CallbackPayload({
    id: "a1b2c3d4",
    url: "https://example.com",
    scores: { overall: 8.2, hero: 9, cta: 7, trust: 8, copy: 8, design: 9 },
    shareUrl: "https://roastmylandingpage.com/roast/a1b2c3d4",
    cached: true,
    timestamp: "2026-08-02T12:00:00.000Z"
  });

  assert.deepEqual(payload, {
    event: "roast.completed",
    id: "a1b2c3d4",
    url: "https://example.com",
    scores: { overall: 8.2, hero: 9, cta: 7, trust: 8, copy: 8, design: 9 },
    shareUrl: "https://roastmylandingpage.com/roast/a1b2c3d4",
    cached: true,
    timestamp: "2026-08-02T12:00:00.000Z"
  });
});

test("postApiV1Callback posts JSON and reports delivery status", async () => {
  let captured;
  const status = await postApiV1Callback(
    "https://hooks.example.com/webhook",
    { event: "roast.completed", id: "a1b2c3d4" },
    {
      fetchImpl: async (url, options) => {
        captured = { url, options };
        return new Response(null, { status: 204 });
      }
    }
  );

  assert.deepEqual(status, {
    requested: true,
    delivered: true,
    status: "delivered",
    statusCode: 204
  });
  assert.equal(captured.url, "https://hooks.example.com/webhook");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers["Content-Type"], "application/json");
  assert.equal(captured.options.body, JSON.stringify({ event: "roast.completed", id: "a1b2c3d4" }));
});

test("postApiV1Callback reports failures without throwing", async () => {
  const httpStatus = await postApiV1Callback(
    "https://hooks.example.com/webhook",
    { event: "roast.completed" },
    { fetchImpl: async () => new Response(null, { status: 500 }) }
  );
  assert.deepEqual(httpStatus, {
    requested: true,
    delivered: false,
    status: "failed",
    statusCode: 500,
    error: "http_error"
  });

  const networkStatus = await postApiV1Callback(
    "https://hooks.example.com/webhook",
    { event: "roast.completed" },
    { fetchImpl: async () => { throw new Error("connection reset"); } }
  );
  assert.deepEqual(networkStatus, {
    requested: true,
    delivered: false,
    status: "failed",
    error: "network_error"
  });

  assert.deepEqual(await postApiV1Callback(null, {}), callbackStatusNotRequested());
});
