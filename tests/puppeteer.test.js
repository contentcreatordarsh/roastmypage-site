import { test } from "node:test";
import assert from "node:assert/strict";
import { capturePageWithRetry, isTransientCaptureError } from "../src/puppeteer.js";
import { CONFIG } from "../src/config.js";

// Compare's capture path had no retry: one transient Browser Rendering failure
// ("Execution context was destroyed…") on an uncached URL 500'd the whole comparison.
// These cover the retry and — just as importantly — the cases it must NOT retry, since
// compare only has COMPARE_TOTAL_TIMEOUT_MS (90s) for two captures plus two AI passes.

const PAGE = { screenshot: new Uint8Array([1, 2, 3]), seo: { score: 80 }, performance: { loadTime: 900 } };

// Env stub: CONFIG KV is only touched by trackBrowserUsage when a retry actually happens.
function makeEnv() {
  const store = new Map();
  return {
    sessionsTracked: () => Number(store.get([...store.keys()].find((k) => k.startsWith("global_daily_browser_")) ?? "") ?? 0),
    CONFIG: {
      get: async (key) => store.get(key) ?? null,
      put: async (key, value) => void store.set(key, value)
    }
  };
}

// Capture stub: replays `outcomes` (an Error to throw, anything else to return) in order
// and records the options it was handed.
function makeCapture(outcomes) {
  const seenOptions = [];
  const capture = async (_env, _url, options) => {
    seenOptions.push(options);
    const outcome = outcomes[seenOptions.length - 1];
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  capture.calls = () => seenOptions.length;
  capture.optionsAt = (i) => seenOptions[i];
  return capture;
}

// Runs fn with fast retry settings so the suite doesn't sleep for the real 1s backoff,
// and with console.warn muted (the retry logs on every path under test).
async function withFastRetries(fn) {
  const originalDelay = CONFIG.COMPARE_CAPTURE_RETRY_DELAY_MS;
  const originalReserve = CONFIG.COMPARE_CAPTURE_RETRY_RESERVE_MS;
  const originalWarn = console.warn;
  CONFIG.COMPARE_CAPTURE_RETRY_DELAY_MS = 10;
  CONFIG.COMPARE_CAPTURE_RETRY_RESERVE_MS = 100;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    CONFIG.COMPARE_CAPTURE_RETRY_DELAY_MS = originalDelay;
    CONFIG.COMPARE_CAPTURE_RETRY_RESERVE_MS = originalReserve;
    console.warn = originalWarn;
  }
}

// The exact error compare returned on the dev worker when meesho.com aged out of cache.
const DESTROYED_CONTEXT = "Failed to capture page: Please try again in a moment (Execution context was destroyed, most likely because of a navigation.)";

test("a transient browser failure is retried once and the compare succeeds", async () => {
  await withFastRetries(async () => {
    const capture = makeCapture([new Error(DESTROYED_CONTEXT), PAGE]);
    const env = makeEnv();

    const result = await capturePageWithRetry(
      env,
      "https://example.com",
      { device: "mobile", fullPage: true, deadline: Date.now() + 5e3 },
      capture
    );

    assert.equal(result, PAGE);
    assert.equal(capture.calls(), 2);
    // The extra browser session must show up in the daily usage counter.
    assert.equal(env.sessionsTracked(), 1);
    // deadline is retry bookkeeping — capturePageWithMetrics must not see it.
    assert.deepEqual(capture.optionsAt(1), { device: "mobile", fullPage: true });
  });
});

test("the retry is skipped when the compare budget can no longer fit a capture", async () => {
  await withFastRetries(async () => {
    const capture = makeCapture([new Error(DESTROYED_CONTEXT), PAGE]);
    const env = makeEnv();

    // 50ms left against a 100ms reserve: a second capture cannot fit, so compare must
    // fail with the original error rather than blow COMPARE_TOTAL_TIMEOUT_MS.
    await assert.rejects(
      capturePageWithRetry(env, "https://example.com", { deadline: Date.now() + 50 }, capture),
      { message: DESTROYED_CONTEXT }
    );

    assert.equal(capture.calls(), 1);
    assert.equal(env.sessionsTracked(), 0);
  });
});

test("a second transient failure surfaces instead of retrying forever", async () => {
  await withFastRetries(async () => {
    const capture = makeCapture([new Error(DESTROYED_CONTEXT), new Error("Protocol error (Runtime.callFunctionOn): Target closed")]);

    await assert.rejects(
      capturePageWithRetry(makeEnv(), "https://example.com", { deadline: Date.now() + 5e3 }, capture),
      /Target closed/
    );

    assert.equal(capture.calls(), 2);
  });
});

test("SSRF redirect blocks are never retried", async () => {
  await withFastRetries(async () => {
    const capture = makeCapture([new Error("Blocked: page redirected to an internal or private address"), PAGE]);

    await assert.rejects(
      capturePageWithRetry(makeEnv(), "https://example.com", { deadline: Date.now() + 5e3 }, capture),
      /^Error: Blocked:/
    );

    assert.equal(capture.calls(), 1);
  });
});

test("timeouts and dead hosts are not retried", async () => {
  await withFastRetries(async () => {
    // A retried 30s navigation cannot fit in the compare budget (same reasoning as the
    // AI retry in ai.js), and a host that does not resolve will not resolve on attempt 2.
    for (const message of [
      "Failed to capture page: Page took too long to load (Navigation timeout of 30000 ms exceeded)",
      "Failed to capture page: Could not load the page. Check the URL. (net::ERR_NAME_NOT_RESOLVED)",
      "Browser service is busy. Please try again in a minute."
    ]) {
      const capture = makeCapture([new Error(message), PAGE]);
      await assert.rejects(
        capturePageWithRetry(makeEnv(), "https://example.com", { deadline: Date.now() + 5e3 }, capture),
        { message }
      );
      assert.equal(capture.calls(), 1, `should not retry: ${message}`);
    }
  });
});

test("isTransientCaptureError separates browser-session flakes from real failures", () => {
  for (const message of [
    "Execution context was destroyed, most likely because of a navigation.",
    "Protocol error (Page.captureScreenshot): Target closed",
    "Session closed. Most likely the page has been closed.",
    "Navigation failed because browser has disconnected!"
  ]) {
    assert.equal(isTransientCaptureError(new Error(message)), true, message);
  }

  for (const message of [
    "Blocked: page redirected to an internal or private address",
    "Failed to capture page: Page took too long to load (Navigation timeout of 30000 ms exceeded)",
    "Failed to capture page: Could not load the page. Check the URL. (net::ERR_CONNECTION_REFUSED)",
    "Browser service is busy. Please try again in a minute.",
    "Screenshot too large",
    "Compare operation timed out after 90000ms"
  ]) {
    assert.equal(isTransientCaptureError(new Error(message)), false, message);
  }
});
