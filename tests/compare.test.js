import { test } from "node:test";
import assert from "node:assert/strict";
import { getComparisonMetrics, hasMetricPair } from "../src/compare.js";

test("comparison metrics preserve complete capture data", () => {
  const metrics = getComparisonMetrics({
    seo: {
      score: 82,
      metaDescription: { status: "good" },
      imgWithoutAlt: 3
    },
    performance: {
      loadTime: 1250,
      resourceCount: 42,
      ttfb: 180
    }
  });

  assert.deepEqual(metrics, {
    hasSeo: true,
    hasPerformance: true,
    seoScore: 82,
    metaDescriptionStatus: "good",
    imgWithoutAlt: 3,
    loadTime: 1250,
    resourceCount: 42,
    ttfb: 180
  });
});

test("comparison metrics tolerate legacy cache rows without audit data", () => {
  const incomplete = getComparisonMetrics({ seo: null, performance: null });
  const complete = getComparisonMetrics({
    seo: { score: 90 },
    performance: { loadTime: 500 }
  });

  assert.deepEqual(incomplete, {
    hasSeo: false,
    hasPerformance: false,
    seoScore: null,
    metaDescriptionStatus: null,
    imgWithoutAlt: null,
    loadTime: null,
    resourceCount: null,
    ttfb: null
  });
  assert.equal(hasMetricPair(incomplete, complete, "seoScore"), false);
  assert.equal(hasMetricPair(incomplete, complete, "loadTime"), false);
});
