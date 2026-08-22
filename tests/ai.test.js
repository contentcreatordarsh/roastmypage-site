import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeWithVisionAndHeatmap, formatRoast } from "../src/ai.js";
import { CONFIG } from "../src/config.js";

test("AI partial JSON is normalized to a complete analysis", async () => {
  const env = {
    CONFIG: {
      get: async () => "true"
    },
    AI: {
      run: async () => ({
        response: JSON.stringify({
          overallScore: 7,
          quickWins: ["x"],
          industry: "saas",
          verdict: "ok"
        })
      })
    }
  };

  const { analysis } = await analyzeWithVisionAndHeatmap(env, "image", "https://example.com");

  assert.equal(analysis.overallScore, 7);
  assert.deepEqual(analysis.quickWins, ["x"]);
  assert.equal(analysis.industry, "saas");
  assert.equal(analysis.verdict, "ok");
  for (const category of ["hero", "cta", "trust", "copy", "design"]) {
    assert.equal(analysis.scores[category], 7);
    assert.equal(analysis.sections[category].score, 7);
    assert.equal(typeof analysis.sections[category].roast, "string");
    assert.equal(typeof analysis.sections[category].fix, "string");
    assert.ok(analysis.sections[category].scoreBreakdown.length > 0);
  }
  assert.doesNotThrow(() => formatRoast(analysis, "https://example.com"));
});

test("AI retries share one timeout budget", async () => {
  const originalTimeout = CONFIG.AI_TIMEOUT_MS;
  const originalRetryBase = CONFIG.AI_RETRY_BASE_MS;
  const originalAttempts = CONFIG.AI_MAX_ATTEMPTS;

  CONFIG.AI_TIMEOUT_MS = 100;
  CONFIG.AI_RETRY_BASE_MS = 10;
  CONFIG.AI_MAX_ATTEMPTS = 3;

  let calls = 0;
  const env = {
    CONFIG: {
      get: async () => "true"
    },
    AI: {
      run: async () => {
        calls++;
        if (calls < 3) {
          throw new Error("503 overloaded");
        }
        await new Promise((resolve) => setTimeout(resolve, 80));
        return {
          response: JSON.stringify({
            overallScore: 7,
            scores: { hero: 7, cta: 7, trust: 7, copy: 7, design: 7 },
            quickWins: ["Clarify the headline"],
            industry: "saas"
          })
        };
      }
    }
  };

  try {
    const startedAt = Date.now();
    const result = await analyzeWithVisionAndHeatmap(env, "image", "https://example.com");
    const elapsedMs = Date.now() - startedAt;

    assert.equal(calls, 3);
    assert.equal(result.analysis.aiUnavailable, true);
    assert.ok(elapsedMs < 140, `expected one 100ms budget, took ${elapsedMs}ms`);
  } finally {
    CONFIG.AI_TIMEOUT_MS = originalTimeout;
    CONFIG.AI_RETRY_BASE_MS = originalRetryBase;
    CONFIG.AI_MAX_ATTEMPTS = originalAttempts;
  }
});
