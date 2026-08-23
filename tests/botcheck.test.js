import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectBotChallenge,
  botChallengeError,
  isBotChallengeError,
  isStoredChallengeRoast,
  BOT_CHALLENGE_MESSAGE
} from "../src/botcheck.js";

// A page that looks like a real, healthy landing page.
function realPage(overrides = {}) {
  return {
    title: "Acme — Ship faster with automated deploys",
    status: 200,
    bodyTextLength: 4200,
    markers: {},
    ...overrides
  };
}

test("detects the Cloudflare 'Just a moment...' interstitial", () => {
  // The exact shape that produced the bogus 4.2/10 roast of roastmypage.site.
  const result = detectBotChallenge({
    title: "Just a moment...",
    status: 403,
    bodyTextLength: 42,
    markers: { cfChallengeRunning: true, challengePlatformScript: true }
  });
  assert.equal(result.blocked, true);
  assert.ok(result.reasons.length >= 1);
});

test("detects each challenge title on its own", () => {
  const titles = [
    "Just a moment...",
    "Attention Required! | Cloudflare",
    "Checking your browser before accessing example.com",
    "Please wait...",
    "Access denied",
    "Verifying you are human"
  ];
  for (const title of titles) {
    const result = detectBotChallenge(realPage({ title }));
    assert.equal(result.blocked, true, `expected "${title}" to be flagged`);
  }
});

test("detects each hard DOM marker on its own", () => {
  const markers = ["cfChallengeRunning", "challengeForm", "cfBrowserVerification", "cfChlOptScript"];
  for (const marker of markers) {
    const result = detectBotChallenge(realPage({ markers: { [marker]: true } }));
    assert.equal(result.blocked, true, `expected ${marker} to be flagged`);
  }
});

test("detects blocking HTTP statuses on the main document", () => {
  for (const status of [403, 429, 503]) {
    const result = detectBotChallenge(realPage({ status }));
    assert.equal(result.blocked, true, `expected HTTP ${status} to be flagged`);
    assert.match(result.reasons.join(" "), new RegExp(String(status)));
  }
});

test("detects a near-empty body paired with a soft challenge marker", () => {
  const result = detectBotChallenge({
    title: "",
    status: 200,
    bodyTextLength: 12,
    markers: { challengePlatformScript: true }
  });
  assert.equal(result.blocked, true);
  assert.match(result.reasons.join(" "), /near-empty body/);
});

test("does not flag a normal page", () => {
  assert.equal(detectBotChallenge(realPage()).blocked, false);
});

test("does not flag a legitimate page with a very short title", () => {
  // Guards the original bug's tempting shortcut: "short title" is not a challenge.
  for (const title of ["Home", "Acme", "Blog", "Pricing"]) {
    const result = detectBotChallenge(realPage({ title }));
    assert.equal(result.blocked, false, `"${title}" should not be flagged`);
    assert.deepEqual(result.reasons, []);
  }
});

test("does not flag titles that merely contain a challenge phrase mid-string", () => {
  const result = detectBotChallenge(realPage({ title: "Wait — access denied? Fix your login flow" }));
  assert.equal(result.blocked, false);
});

test("does not flag a live Turnstile widget on a fully rendered page", () => {
  // Real sites embed Turnstile on login/contact forms; that must still be roastable.
  const result = detectBotChallenge(realPage({ markers: { turnstile: true } }));
  assert.equal(result.blocked, false);
});

test("does not flag a slow-rendering SPA with no challenge markers", () => {
  const result = detectBotChallenge(realPage({ title: "Dashboard", bodyTextLength: 3 }));
  assert.equal(result.blocked, false);
});

test("does not flag on missing or malformed signals", () => {
  assert.equal(detectBotChallenge().blocked, false);
  assert.equal(detectBotChallenge({}).blocked, false);
  assert.equal(detectBotChallenge({ title: null, status: "200", markers: null }).blocked, false);
});

test("botChallengeError round-trips through isBotChallengeError", () => {
  const err = botChallengeError(["#challenge-form present"]);
  assert.equal(isBotChallengeError(err), true);
  assert.ok(err.message.includes(BOT_CHALLENGE_MESSAGE));
  assert.ok(err.message.includes("#challenge-form present"));
});

test("isStoredChallengeRoast spots a cached interstitial roast", () => {
  // The exact stored shape behind the reported bug.
  const seoData = JSON.stringify({
    score: 75,
    title: { text: "Just a moment...", length: 16, status: "short" },
    metaDescription: { text: "", length: 0, status: "missing" }
  });
  assert.equal(isStoredChallengeRoast(seoData), true);
  assert.equal(isStoredChallengeRoast(JSON.parse(seoData)), true);
});

test("isStoredChallengeRoast leaves legitimate cached roasts alone", () => {
  const legit = JSON.stringify({ title: { text: "Home", length: 4, status: "short" } });
  assert.equal(isStoredChallengeRoast(legit), false);
  assert.equal(isStoredChallengeRoast(null), false);
  assert.equal(isStoredChallengeRoast(""), false);
  assert.equal(isStoredChallengeRoast("not json"), false);
  assert.equal(isStoredChallengeRoast("{}"), false);
});

test("isBotChallengeError ignores unrelated failures", () => {
  assert.equal(isBotChallengeError(new Error("Failed to capture page: Page took too long to load")), false);
  assert.equal(isBotChallengeError(new Error("Blocked: page redirected to an internal or private address")), false);
  assert.equal(isBotChallengeError(undefined), false);
  assert.equal(isBotChallengeError(""), false);
});
