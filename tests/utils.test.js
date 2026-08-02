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
  parsePaginationParams
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

test("parsePaginationParams defaults invalid page and limit values", () => {
  const params = new URLSearchParams("page=0&limit=nope");

  assert.deepEqual(parsePaginationParams(params, { defaultLimit: 24, maxLimit: 48 }), {
    page: 1,
    limit: 24,
    offset: 0
  });
});

test("parsePaginationParams clamps limit and calculates page offset", () => {
  const params = new URLSearchParams("page=3&limit=100");

  assert.deepEqual(parsePaginationParams(params, { defaultLimit: 24, maxLimit: 48 }), {
    page: 3,
    limit: 48,
    offset: 96
  });
});

test("parsePaginationParams supports explicit offset pagination", () => {
  const params = new URLSearchParams("offset=32&limit=8");

  assert.deepEqual(parsePaginationParams(params, { defaultLimit: 24, maxLimit: 48 }), {
    page: 5,
    limit: 8,
    offset: 32
  });
});
