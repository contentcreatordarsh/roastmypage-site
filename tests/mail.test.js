import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWeeklyDigestHtml } from "../src/mail.js";

test("buildWeeklyDigestHtml renders weekly platform stats and CTA", () => {
  const html = buildWeeklyDigestHtml({
    roastCount: 42,
    avgScore: 6.73,
    baseUrl: "https://roastmypage.site",
    ctaUrl: "https://roastmypage.site/?utm_source=digest",
    weekStart: "2026-07-27T00:00:00.000Z",
    weekEnd: "2026-08-03T00:00:00.000Z"
  });

  assert.match(html, /Weekly roast digest/);
  assert.match(html, /42 roasts/);
  assert.match(html, /6\.7\/10/);
  assert.match(html, /Jul 27 - Aug 3/);
  assert.match(html, /href="https:\/\/roastmypage\.site\/\?utm_source=digest"/);
  assert.match(html, /Roast my landing page/);
});

test("buildWeeklyDigestHtml handles empty scored data", () => {
  const html = buildWeeklyDigestHtml({
    weeklyRoastCount: 0,
    avgScore: null,
    baseUrl: "https://roastmypage.site"
  });

  assert.match(html, /0 roasts/);
  assert.match(html, /Not enough scored roasts yet/);
});

test("buildWeeklyDigestHtml escapes dynamic values", () => {
  const html = buildWeeklyDigestHtml({
    roastCount: "<script>",
    avgScore: "bad",
    ctaUrl: "https://example.com/?q=\"<bad>",
    weekStart: "2026-07-27T00:00:00.000Z",
    weekEnd: "2026-08-03T00:00:00.000Z"
  });

  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /href="https:\/\/example\.com\/\?q=&quot;&lt;bad&gt;"/);
});
