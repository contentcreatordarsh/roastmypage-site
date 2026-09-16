import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getCategoryWinners,
  pickShareHighlight,
  buildCompareCardSvg
} from "../src/compareCard.js";

test("getCategoryWinners picks per-category winners and ties", () => {
  const winners = getCategoryWinners(
    { hero: 8, cta: 5, trust: 7, copy: 6, design: 4 },
    { hero: 6, cta: 9, trust: 7, copy: 5, design: 8 }
  );
  assert.equal(winners.hero, "page1");
  assert.equal(winners.cta, "page2");
  assert.equal(winners.trust, "tie");
  assert.equal(winners.copy, "page1");
  assert.equal(winners.design, "page2");
});

test("pickShareHighlight chooses the largest category gap", () => {
  const highlight = pickShareHighlight(
    { hero: 8, cta: 5, trust: 7, copy: 6, design: 4 },
    { hero: 6, cta: 9, trust: 7, copy: 5, design: 8 },
    "mine.com",
    "rival.com"
  );
  assert.equal(highlight.key, "cta");
  assert.equal(highlight.winnerHost, "rival.com");
  assert.equal(highlight.diff, 4);
});

test("buildCompareCardSvg includes both hosts and VS marker", () => {
  const svg = buildCompareCardSvg({
    url1: "https://www.alpha.com",
    url2: "https://beta.dev",
    score1: 7.2,
    score2: 6.1,
    scores1: { hero: 8, cta: 7, trust: 7, copy: 6, design: 7 },
    scores2: { hero: 6, cta: 5, trust: 6, copy: 6, design: 7 },
    winner: "page1"
  });
  assert.match(svg, /alpha\.com/);
  assert.match(svg, /beta\.dev/);
  assert.match(svg, />VS</);
  assert.match(svg, /alpha\.com wins/);
});
