import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildContentSecurityPolicy,
  isValidUrl,
  normalizeUrl,
  isUrlSafeForFetching,
  isValidRoastId,
  sanitizeUrl,
  hashUrl,
  hashIp
} from "../src/utils.js";

function parseCsp(policy) {
  return Object.fromEntries(policy.split("; ").map((directive) => {
    const [name, ...sources] = directive.split(" ");
    return [name, sources];
  }));
}

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

test("buildContentSecurityPolicy includes hardening directives", () => {
  const directives = parseCsp(buildContentSecurityPolicy());

  assert.deepEqual(directives["default-src"], ["'self'"]);
  assert.deepEqual(directives["object-src"], ["'none'"]);
  assert.deepEqual(directives["frame-ancestors"], ["'none'"]);
  assert.deepEqual(directives["base-uri"], ["'self'"]);
  assert.deepEqual(directives["form-action"], ["'self'"]);
  assert.deepEqual(directives["upgrade-insecure-requests"], []);
});

test("buildContentSecurityPolicy preserves current SPA script and style requirements", () => {
  const directives = parseCsp(buildContentSecurityPolicy());

  assert.ok(directives["script-src"].includes("'unsafe-inline'"));
  assert.ok(directives["script-src"].includes("'report-sample'"));
  assert.ok(directives["script-src"].includes("https://cdn.tailwindcss.com"));
  assert.ok(directives["script-src"].includes("https://cdnjs.cloudflare.com"));
  assert.ok(directives["script-src"].includes("https://cdn.jsdelivr.net"));
  assert.ok(directives["script-src"].includes("https://pagead2.googlesyndication.com"));

  assert.ok(directives["style-src"].includes("'unsafe-inline'"));
  assert.ok(directives["style-src"].includes("'report-sample'"));
  assert.ok(directives["style-src"].includes("https://cdn.tailwindcss.com"));
  assert.ok(directives["style-src"].includes("https://fonts.googleapis.com"));
  assert.ok(directives["font-src"].includes("https://fonts.gstatic.com"));
});

test("buildContentSecurityPolicy keeps script-src explicit and wildcard-free", () => {
  const directives = parseCsp(buildContentSecurityPolicy());

  // Deliberate exception to #118's wildcard-free goal: Google rotates ad
  // subdomains, so a fixed host list silently blocks a share of ad requests
  // (revenue-affecting, and it fails silently). Every non-Google source must
  // still be an explicit host.
  const scriptNonGoogleWildcards = directives["script-src"].filter(
    (source) => source.includes("*") && !/googlesyndication|googleadservices|google\.com|doubleclick|adtrafficquality\.google/.test(source)
  );
  assert.deepEqual(scriptNonGoogleWildcards, []);
});

test("buildContentSecurityPolicy restricts browser image and connect sources", () => {
  const directives = parseCsp(buildContentSecurityPolicy());

  assert.ok(directives["img-src"].includes("'self'"));
  assert.ok(directives["img-src"].includes("data:"));
  assert.ok(directives["img-src"].includes("blob:"));
  assert.ok(directives["img-src"].includes("https://api.producthunt.com"));
  assert.ok(directives["img-src"].includes("https://placehold.co"));
  assert.ok(!directives["img-src"].includes("https:"));
  assert.ok(!directives["img-src"].includes("http:"));

  assert.deepEqual(directives["connect-src"][0], "'self'");
  assert.ok(directives["connect-src"].includes("https://pagead2.googlesyndication.com"));
  assert.ok(!directives["connect-src"].includes("https://cloudflare-dns.com"));
  // Deliberate exception to #118's wildcard-free goal: Google rotates ad
  // subdomains, so a fixed host list silently blocks a share of ad requests
  // (revenue-affecting, and it fails silently). Every non-Google source must
  // still be an explicit host.
  const connectNonGoogleWildcards = directives["connect-src"].filter(
    (source) => source.includes("*") && !/googlesyndication|googleadservices|google\.com|doubleclick|adtrafficquality\.google/.test(source)
  );
  assert.deepEqual(connectNonGoogleWildcards, []);
});
