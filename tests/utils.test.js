import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidUrl,
  normalizeUrl,
  isUrlSafeForFetching,
  isValidRoastId,
  sanitizeUrl,
  hashUrl,
  hashIp,
  calculateWeightedOverall
} from "../src/utils.js";

test("isValidUrl accepts http and https", () => {
  assert.equal(isValidUrl("https://example.com"), true);
  assert.equal(isValidUrl("http://example.com/path"), true);
  assert.equal(isValidUrl("ftp://example.com"), false);
  assert.equal(isValidUrl("not-a-url"), false);
});

test("normalizeUrl lowercases host and strips tracking params", () => {
  const normalized = normalizeUrl("https://Example.COM/page/?utm_source=x&ref=y");
  assert.equal(normalized, "https://example.com/page");
});

test("isUrlSafeForFetching blocks private and local addresses", () => {
  assert.equal(isUrlSafeForFetching("https://example.com"), true);
  assert.equal(isUrlSafeForFetching("http://localhost"), false);
  assert.equal(isUrlSafeForFetching("http://127.0.0.1"), false);
  assert.equal(isUrlSafeForFetching("http://192.168.1.1"), false);
  assert.equal(isUrlSafeForFetching("http://10.0.0.1"), false);
  assert.equal(isUrlSafeForFetching("javascript:alert(1)"), false);
});

test("isUrlSafeForFetching blocks encoded and IPv6 loopback addresses", () => {
  const blocked = [
    "http://2130706433",
    "http://0x7f.1",
    "http://0177.0.0.1",
    "http://127.1",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://169.254.169.254",
    "http://metadata.google.internal"
  ];
  for (const url of blocked) {
    assert.equal(isUrlSafeForFetching(url), false, `${url} should be blocked`);
  }
});

test("sanitizeUrl blocks dangerous schemes", () => {
  assert.equal(sanitizeUrl("javascript:alert(1)"), "");
  assert.equal(sanitizeUrl("https://safe.com"), "https://safe.com");
});

test("isValidRoastId accepts 8-char hex ids", () => {
  assert.equal(isValidRoastId("a1b2c3d4"), true);
  assert.equal(isValidRoastId("short"), false);
  assert.equal(isValidRoastId("zzzzzzzz"), false);
});

test("hashUrl includes device/full marker", async () => {
  const h1 = await hashUrl("https://example.com", "desktop");
  const h2 = await hashUrl("https://example.com", "desktop-full");
  const h3 = await hashUrl("https://example.com", "mobile");
  assert.notEqual(h1, h2);
  assert.notEqual(h1, h3);
  assert.notEqual(h2, h3);
});

test("hashIp requires a private salt in production", async () => {
  await assert.rejects(
    hashIp("203.0.113.10", undefined, "production"),
    /IP_HASH_SALT must be configured/
  );
  const hash = await hashIp("203.0.113.10", undefined, "development");
  assert.match(hash, /^[a-f0-9]{32}$/);
});

test("calculateWeightedOverall returns an equal-weight average by default", () => {
  const score = calculateWeightedOverall({
    hero: 8,
    cta: 6,
    trust: 7,
    copy: 9,
    design: 5
  });

  assert.equal(score, 7);
});

test("calculateWeightedOverall applies custom rubric weights", () => {
  const score = calculateWeightedOverall(
    { hero: 10, cta: 0, trust: 5, copy: 5, design: 5 },
    { hero: 3, cta: 1, trust: 1, copy: 1, design: 1 }
  );

  assert.equal(score, 6.4);
});

test("calculateWeightedOverall ignores invalid inputs and returns null without positive weights", () => {
  assert.equal(
    calculateWeightedOverall(
      { hero: 10, cta: "bad", trust: 4, copy: 6, design: 8 },
      { hero: -1, cta: 2, trust: "bad", copy: 0, design: 0 }
    ),
    null
  );
});
