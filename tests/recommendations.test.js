import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAbTestIdeas } from "../src/recommendations.js";

const benchmarks = {
  label: "SaaS",
  scores: { hero: 6.8, cta: 6.2, trust: 5.5, copy: 6.5, design: 6.9 }
};

test("generateAbTestIdeas prioritizes categories furthest below benchmark", () => {
  const ideas = generateAbTestIdeas(
    { hero: 6.5, cta: 4.1, trust: 3.2, copy: 5.8, design: 7.1 },
    benchmarks
  );

  assert.equal(ideas.length, 4);
  assert.deepEqual(ideas.map((idea) => idea.category), ["trust", "cta", "copy", "hero"]);
  assert.equal(ideas[0].gap, -2.3);
  assert.equal(ideas[0].gapLabel, "2.3 pts below benchmark");
  assert.match(ideas[0].title, /proof/i);
  assert.equal(ideas[0].benchmark, 5.5);
});

test("generateAbTestIdeas limits results to the requested max", () => {
  const ideas = generateAbTestIdeas(
    { hero: 3, cta: 3, trust: 3, copy: 3, design: 3 },
    benchmarks,
    { maxIdeas: 2 }
  );

  assert.equal(ideas.length, 2);
  assert.deepEqual(ideas.map((idea) => idea.category), ["design", "hero"]);
});

test("generateAbTestIdeas fills minimum with weakest relative categories", () => {
  const ideas = generateAbTestIdeas(
    { hero: 7, cta: 6, trust: 6, copy: 7, design: 8 },
    benchmarks
  );

  assert.equal(ideas.length, 2);
  assert.deepEqual(ideas.map((idea) => idea.category), ["cta", "hero"]);
  assert.equal(ideas[0].gapLabel, "0.2 pts below benchmark");
  assert.equal(ideas[1].gapLabel, "0.2 pts above benchmark");
});

test("generateAbTestIdeas handles plain benchmark scores and invalid values", () => {
  const ideas = generateAbTestIdeas(
    { hero: "4", cta: "not-a-score", trust: 8 },
    { hero: 6, cta: 5, trust: 7 }
  );

  assert.equal(ideas.length, 2);
  assert.deepEqual(ideas.map((idea) => idea.category), ["hero", "trust"]);
  assert.equal(ideas[0].score, 4);
  assert.equal(ideas[0].benchmark, 6);
});
