import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractMetadataFromHtml,
  scoreMetadataSimilarity
} from "../src/threats.js";

test("extractMetadataFromHtml reads title, description, and Open Graph fields", () => {
  const metadata = extractMetadataFromHtml(`
    <html>
      <head>
        <title>Acme Bank Login</title>
        <meta name="description" content="Secure Acme account access">
        <meta property="og:title" content="Acme Bank - Official">
        <meta property="og:description" content="Manage your Acme Bank card">
      </head>
    </html>
  `);

  assert.equal(metadata.title, "Acme Bank Login");
  assert.equal(metadata.description, "Secure Acme account access");
  assert.equal(metadata.ogTitle, "Acme Bank - Official");
  assert.equal(metadata.ogDescription, "Manage your Acme Bank card");
});

test("scoreMetadataSimilarity flags strong brand token overlap as high heuristic risk", () => {
  const result = scoreMetadataSimilarity({
    title: "Acme Bank secure login",
    ogDescription: "Access your Acme Bank account"
  }, "acme-bank", "acme-bank.com");

  assert.equal(result.highSimilarity, true);
  assert.equal(result.risk, "high");
  assert.equal(result.score, 100);
  assert.match(result.label, /heuristic/i);
  assert.deepEqual(new Set(result.matchedTokens), new Set(["acme", "bank", "acmebank"]));
});

test("scoreMetadataSimilarity gives partial overlap a medium score", () => {
  const result = scoreMetadataSimilarity({
    title: "Acme customer portal",
    description: "Manage support requests"
  }, "acme-bank", "acme-bank.com");

  assert.equal(result.risk, "medium");
  assert.equal(result.highSimilarity, false);
  assert.equal(result.score, 33);
  assert.deepEqual(result.matchedTokens, ["acme"]);
});

test("scoreMetadataSimilarity keeps unrelated metadata low", () => {
  const result = scoreMetadataSimilarity({
    title: "Independent gardening supplies",
    description: "Tools and seeds for backyard growers"
  }, "stripe", "stripe.com");

  assert.equal(result.risk, "low");
  assert.equal(result.highSimilarity, false);
  assert.equal(result.score, 0);
  assert.deepEqual(result.matchedTokens, []);
});
