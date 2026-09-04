import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRoastPage } from "../src/ssr.js";
import worker from "../src/index.js";

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

test("roast route keeps screenshots same-origin on the workers.dev hostname", async () => {
  const roast = {
    id: "deadbeef",
    url: "https://example.com",
    overall_score: 7,
    hero_score: 7,
    cta_score: 7,
    trust_score: 7,
    copy_score: 7,
    design_score: 7,
    roast_response: "",
    quick_wins: "[]",
    seo_data: null,
    performance_data: null,
    heatmap_data: null,
    country: "US",
    industry: "saas",
    created_at: "2026-09-04 11:00:00"
  };
  const env = {
    ENVIRONMENT: "production",
    BASE_URL: "https://roastmypage.site",
    DB: {
      prepare(sql) {
        const statement = {
          bind() {
            return statement;
          },
          async first() {
            return sql.includes("COUNT(*)") ? { cnt: 1 } : roast;
          }
        };
        return statement;
      }
    }
  };

  const response = await worker.fetch(
    new Request("https://roast-my-landing-page.falling-hall-ac41.workers.dev/roast/deadbeef"),
    env,
    {}
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Security-Policy") || "", /img-src 'self'/);
  assert.match(html, /src="\/api\/screenshot\/deadbeef"/);
  assert.doesNotMatch(html, /src="https:\/\/roastmypage\.site\/api\/screenshot\/deadbeef"/);
});
