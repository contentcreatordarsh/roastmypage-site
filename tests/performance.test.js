import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCoreWebVitals,
  finiteTiming,
  gradeCoreWebVital
} from "../src/performance.js";

test("gradeCoreWebVital grades LCP thresholds", () => {
  assert.equal(gradeCoreWebVital("lcp", 2500), "good");
  assert.equal(gradeCoreWebVital("lcp", 2501), "needs-improvement");
  assert.equal(gradeCoreWebVital("lcp", 4000), "needs-improvement");
  assert.equal(gradeCoreWebVital("lcp", 4001), "poor");
});

test("gradeCoreWebVital grades FCP thresholds", () => {
  assert.equal(gradeCoreWebVital("fcp", 1800), "good");
  assert.equal(gradeCoreWebVital("fcp", 1801), "needs-improvement");
  assert.equal(gradeCoreWebVital("fcp", 3000), "needs-improvement");
  assert.equal(gradeCoreWebVital("fcp", 3001), "poor");
});

test("gradeCoreWebVital grades TTFB thresholds", () => {
  assert.equal(gradeCoreWebVital("ttfb", 800), "good");
  assert.equal(gradeCoreWebVital("ttfb", 801), "needs-improvement");
  assert.equal(gradeCoreWebVital("ttfb", 1800), "needs-improvement");
  assert.equal(gradeCoreWebVital("ttfb", 1801), "poor");
});

test("gradeCoreWebVital handles unavailable values", () => {
  assert.equal(gradeCoreWebVital("lcp", null), "not-available");
  assert.equal(gradeCoreWebVital("fcp", Number.NaN), "not-available");
  assert.equal(gradeCoreWebVital("ttfb", -1), "not-available");
  assert.equal(gradeCoreWebVital("cls", 0.1), "not-available");
});

test("buildCoreWebVitals returns labeled graded metrics", () => {
  const vitals = buildCoreWebVitals({ lcp: 2100, fcp: 2200, ttfb: 1900 });

  assert.equal(vitals.lcp.label, "Largest Contentful Paint (LCP)");
  assert.equal(vitals.lcp.rating, "good");
  assert.equal(vitals.fcp.rating, "needs-improvement");
  assert.equal(vitals.ttfb.rating, "poor");
  assert.equal(vitals.lcp.thresholds.good, 2500);
});

test("finiteTiming only accepts non-negative finite numbers", () => {
  assert.equal(finiteTiming(0), 0);
  assert.equal(finiteTiming(12.5), 12.5);
  assert.equal(finiteTiming(-0.1), null);
  assert.equal(finiteTiming(Infinity), null);
  assert.equal(finiteTiming("12"), null);
});
