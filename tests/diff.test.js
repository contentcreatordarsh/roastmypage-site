import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoastDiff, computeScoreDeltas, formatRoastForDiff, numericCategoryChanges } from "../src/diff.js";

test("computeScoreDeltas returns signed category and overall changes", () => {
  const deltas = computeScoreDeltas(
    {
      overall_score: 6.2,
      hero_score: 6,
      cta_score: 4.5,
      trust_score: 5,
      copy_score: 7,
      design_score: 8
    },
    {
      overallScore: 7.4,
      scores: { hero: 7, cta: 6, trust: 4, copy: 7, design: 8.5 }
    }
  );

  assert.equal(deltas.overall.change, 1.2);
  assert.equal(deltas.overall.direction, "up");
  assert.equal(deltas.cta.change, 1.5);
  assert.equal(deltas.trust.change, -1);
  assert.equal(deltas.trust.direction, "down");
  assert.equal(deltas.copy.change, 0);
  assert.equal(deltas.copy.direction, "flat");
});

test("computeScoreDeltas rounds scores and skips missing categories", () => {
  const deltas = computeScoreDeltas(
    { overallScore: 6.26, scores: { hero: 5.04, cta: null } },
    { overallScore: 6.94, scores: { hero: 5.95, cta: 7 } }
  );

  assert.equal(deltas.overall.previous, 6.3);
  assert.equal(deltas.overall.current, 6.9);
  assert.equal(deltas.overall.change, 0.6);
  assert.equal(deltas.hero.previous, 5);
  assert.equal(deltas.hero.current, 6);
  assert.equal(deltas.hero.change, 1);
  assert.equal(deltas.cta, undefined);
});

test("buildRoastDiff formats previous and current roast rows", () => {
  const diff = buildRoastDiff(
    {
      id: "prev1234",
      url: "https://example.com",
      url_hash: "hash",
      overall_score: 5,
      hero_score: 4,
      cta_score: 5,
      trust_score: 6,
      copy_score: 5,
      design_score: 5,
      created_at: "2026-08-01 12:00:00"
    },
    {
      id: "cur12345",
      url: "https://example.com",
      urlHash: "hash",
      overallScore: 6,
      scores: { hero: 5, cta: 5, trust: 7, copy: 6, design: 6 },
      createdAt: "2026-08-02 12:00:00"
    }
  );

  assert.equal(diff.previous.id, "prev1234");
  assert.equal(diff.previous.screenshotUrl, "/api/screenshot/prev1234");
  assert.equal(diff.current.urlHash, "hash");
  assert.equal(diff.deltas.overall.change, 1);
  assert.deepEqual(numericCategoryChanges(diff.deltas), {
    hero: 1,
    cta: 0,
    trust: 1,
    copy: 1,
    design: 1
  });
});

test("formatRoastForDiff handles first-roast current without previous data", () => {
  const formatted = formatRoastForDiff({
    id: "cur12345",
    url: "https://example.com",
    overallScore: 8,
    scores: { hero: 8, cta: 8, trust: 8, copy: 8, design: 8 }
  });

  assert.equal(formatted.score, 8);
  assert.equal(formatted.scores.hero, 8);
  assert.equal(buildRoastDiff(null, formatted).deltas, null);
});
