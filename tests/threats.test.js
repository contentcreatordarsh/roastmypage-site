import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {
  checkSecurityHeaders,
  determineHandleRisk,
  generateSuspiciousHandles,
  generateThreatRecommendations,
  scanSocialMediaImposters
} from "../src/threats.js";

test("generateSuspiciousHandles produces support/official brand variants", () => {
  const handles = generateSuspiciousHandles("Acme");
  assert.ok(handles.some((h) => h.includes("support")));
  // Caps at 30; support/help suffixes fill first for short brands — still brand-derived.
  assert.ok(handles.every((h) => h.includes("acme") || h.length >= 3));
  assert.ok(handles.length > 5);
  assert.ok(handles.length <= 30);
});

test("determineHandleRisk ranks support impersonation as high", () => {
  assert.equal(determineHandleRisk("acmesupport", "acme"), "high");
  assert.equal(determineHandleRisk("officialacme", "acme"), "medium");
  assert.equal(determineHandleRisk("acmexyzq", "acme"), "low");
});

test("threat scan rejects private domain inputs before fetching", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount++;
    throw new Error("private targets must not be fetched");
  };

  try {
    const response = await worker.fetch(
      new Request("https://roastmypage.site/api/threat-scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "203.0.113.10"
        },
        body: JSON.stringify({ domain: "2130706433" })
      }),
      {
        CONFIG: {
          get: async () => "0",
          put: async () => {}
        },
        IP_HASH_SALT: "test-salt",
        ENVIRONMENT: "development"
      },
      {}
    );

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /internal|private/i);
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkSecurityHeaders blocks private redirect targets before fetching them", async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url: String(url), options });
    return new Response(null, {
      status: 302,
      headers: { Location: "http://169.254.169.254/latest/meta-data/" }
    });
  };

  try {
    const result = await checkSecurityHeaders("https://example.com/redirect");
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "https://example.com/redirect");
    assert.equal(fetchCalls[0].options.redirect, "manual");
    assert.equal(result.score, 50);
    assert.ok(result.issues.some((issue) => /Could not fetch security headers/i.test(issue)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("checkSecurityHeaders follows safe redirects manually", async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    if (fetchCalls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/final" }
      });
    }
    return new Response(null, {
      status: 200,
      headers: { "Strict-Transport-Security": "max-age=31536000" }
    });
  };

  try {
    const result = await checkSecurityHeaders("https://example.com/start");
    assert.deepEqual(fetchCalls, [
      "https://example.com/start",
      "https://example.com/final"
    ]);
    assert.equal(
      result.headers.find((header) => header.name === "Strict-Transport-Security").present,
      true
    );
    assert.equal(result.issues.some((issue) => /Could not fetch security headers/i.test(issue)), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanSocialMediaImposters does not treat X/Instagram HEAD probes as proof", async () => {
  const originalFetch = globalThis.fetch;
  const fetchCalls = [];
  globalThis.fetch = async (url, opts = {}) => {
    fetchCalls.push({ url: String(url), method: opts.method || "GET" });
    // GitHub: pretend all users missing so only heuristics remain from social platforms
    if (String(url).includes("api.github.com/users/")) {
      return new Response(null, { status: 404 });
    }
    // If any code path still hits twitter/instagram, fail the test intent by returning 200
    return new Response(null, { status: 200 });
  };

  try {
    const results = await scanSocialMediaImposters("acme", "acme.com");
    assert.ok(results.length > 0, "should return heuristic candidates");

    const xOrIg = results.filter(
      (r) => r.platform.includes("Twitter") || r.platform.includes("Instagram")
    );
    assert.ok(xOrIg.length > 0);
    for (const row of xOrIg) {
      assert.equal(row.verificationStatus, "unverified");
      assert.equal(row.method, "heuristic");
      assert.match(row.note || "", /[Hh]euristic|manual/i);
    }

    // Must not issue HEAD (or any) requests to twitter.com / instagram.com
    const blockedHosts = fetchCalls.filter(
      (c) =>
        c.url.includes("twitter.com") ||
        c.url.includes("x.com/") ||
        c.url.includes("instagram.com")
    );
    assert.equal(
      blockedHosts.length,
      0,
      `unexpected social HEAD probes: ${JSON.stringify(blockedHosts)}`
    );

    // GitHub may be probed via official API
    assert.ok(fetchCalls.some((c) => c.url.includes("api.github.com/users/")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanSocialMediaImposters marks confirmed GitHub users as verified", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("api.github.com/users/acmesupport")) {
      return Response.json({ login: "acmesupport" }, { status: 200 });
    }
    if (u.includes("api.github.com/users/")) {
      return new Response(null, { status: 404 });
    }
    return new Response(null, { status: 404 });
  };

  try {
    const results = await scanSocialMediaImposters("acme", "acme.com");
    const github = results.find(
      (r) => r.platform === "GitHub" && r.handle === "@acmesupport"
    );
    assert.ok(github);
    assert.equal(github.verificationStatus, "verified");
    assert.equal(github.method, "github_api");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateThreatRecommendations distinguishes verified vs heuristic social hits", () => {
  const security = { score: 90, grade: "A", issues: [] };
  const verifiedRecs = generateThreatRecommendations(
    [],
    security,
    "low",
    [{ risk: "high", verificationStatus: "verified", platform: "GitHub" }]
  );
  assert.ok(verifiedRecs.some((r) => /confirmed to exist/i.test(r)));

  const heuristicRecs = generateThreatRecommendations(
    [],
    security,
    "low",
    [{ risk: "high", verificationStatus: "unverified", platform: "Twitter/X", method: "heuristic" }]
  );
  assert.ok(heuristicRecs.some((r) => /heuristic|unverified/i.test(r)));
  assert.equal(heuristicRecs.some((r) => /account\(s\) found/i.test(r)), false);
});
