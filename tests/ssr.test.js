import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRoastPage, renderGalleryPage } from "../src/ssr.js";

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

test("renderRoastPage keeps the report and shows a placeholder when the screenshot was purged", () => {
  const html = renderRoastPage({
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
      roast_response: "### Hero\n**Problem:** Weak headline\n**Fix:** Make it specific"
    },
    hostname: "example.com",
    scoreColor: "#22C55E",
    score: 7,
    emoji: "🔥",
    dateStr: "Aug 10, 2026",
    categories: [],
    sections: {},
    quickWins: ["Add a CTA"],
    seo: null,
    performance22: null,
    BASE_URL: "https://roastmypage.site",
    screenshotUrl: null,
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

  assert.match(html, /Screenshot no longer stored/);
  assert.doesNotMatch(html, /\/api\/screenshot\/demo1234/);
  assert.match(html, /<h1 class="text-2xl md:text-3xl font-bold mb-2">example.com<\/h1>/);
});

test("renderRoastPage still embeds the screenshot when one is stored", () => {
  const html = renderWithVideo({ present: false, count: 0 });
  assert.match(html, /src="\/api\/screenshot\/demo1234"/);
  assert.doesNotMatch(html, /Screenshot no longer stored/);
});

test("renderGalleryPage placeholders cards whose screenshots were purged", () => {
  const html = renderGalleryPage({
    roasts: [
      {
        id: "keepshot",
        url: "https://kept.example",
        overall_score: 8,
        hero_score: 8,
        cta_score: 8,
        trust_score: 8,
        copy_score: 8,
        design_score: 8,
        country: "US",
        screenshot_key: "screenshots/keepshot.jpg",
        created_at: "2026-09-01 00:00:00"
      },
      {
        id: "purged01",
        url: "https://purged.example",
        overall_score: 6,
        hero_score: 6,
        cta_score: 6,
        trust_score: 6,
        copy_score: 6,
        design_score: 6,
        country: "US",
        screenshot_key: null,
        created_at: "2026-01-01 00:00:00"
      }
    ],
    total: 2,
    page: 1,
    totalPages: 1,
    prevPageUrl: null,
    nextPageUrl: null,
    validIndustry: null,
    BASE_URL: "https://roastmypage.site",
    industryMeta: null
  });

  assert.match(html, /\/api\/screenshot\/keepshot/);
  assert.doesNotMatch(html, /\/api\/screenshot\/purged01/);
  assert.match(html, /href="\/roast\/purged01"/);
  assert.match(html, /Screenshot no longer stored/);
});
