import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRoastPage } from "../src/ssr.js";

function renderWithVideo(video) {
  return renderRoastPage({
    roast: {
      id: "demo1234",
      url: "https://example.com",
      industry: "saas",
      country: "US",
      hero_score: 7,
      cta_score: 7,
      trust_score: 7,
      copy_score: 7,
      design_score: 7,
      roast_response: ""
    },
    hostname: "example.com",
    scoreColor: "#22C55E",
    score: 7,
    emoji: "🔥",
    dateStr: "Aug 10, 2026",
    categories: [],
    sections: {},
    quickWins: [],
    seo: {
      score: 80,
      issues: [],
      video
    },
    performance22: null,
    BASE_URL: "https://roastmypage.site",
    screenshotUrl: "/api/screenshot/demo1234",
    heatmapDotsHtml: "",
    heatmapSidebarHtml: "",
    a11y: null,
    a11yDetailsHtml: "",
    verdictText: "Solid page",
    scoreLabel: "Room to Improve",
    heatmap: null,
    seoDetailsHtml: "",
    perfDetailsHtml: ""
  });
}

test("renderRoastPage includes persisted video analysis", () => {
  const html = renderWithVideo({
    present: true,
    count: 1,
    score: 82,
    hasHeroVideo: true,
    hasAutoplay: true,
    hasUnmutedAutoplay: false,
    conversion: {
      score: 95,
      issues: ["Keep the CTA visible over motion <script>alert(1)</script>"],
      notes: ["Muted autoplay hero detected"]
    },
    performance: {
      score: 88,
      issues: ["Autoplay can compete with LCP"]
    },
    accessibility: {
      score: 70,
      issues: ["Add captions"]
    },
    recommendations: ["Provide a pause control"]
  });

  assert.match(html, /data-tab="video"/);
  assert.match(html, /id="tab-video"/);
  assert.match(html, /Video Analysis/);
  assert.match(html, /Provide a pause control/);
  assert.match(html, /Keep the CTA visible over motion &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test("renderRoastPage omits video UI when no video was detected", () => {
  const html = renderWithVideo({
    present: false,
    count: 0
  });

  assert.doesNotMatch(html, /data-tab="video"/);
  assert.doesNotMatch(html, /id="tab-video"/);
});
