import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidUrl,
  normalizeUrl,
  isUrlSafeForFetching,
  isValidRoastId,
  sanitizeUrl
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

test("sanitizeUrl blocks dangerous schemes", () => {
  assert.equal(sanitizeUrl("javascript:alert(1)"), "");
  assert.equal(sanitizeUrl("https://safe.com"), "https://safe.com");
});

test("isValidRoastId accepts 8-char hex ids", () => {
  assert.equal(isValidRoastId("a1b2c3d4"), true);
  assert.equal(isValidRoastId("short"), false);
  assert.equal(isValidRoastId("zzzzzzzz"), false);
});
