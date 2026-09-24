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
    hasLoopingNoPause: true,
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
      issues: ["Provide a pause/stop control for looping autoplay video — WCAG 2.2.2."]
    },
    recommendations: ["Provide a pause control"]
  });

  assert.match(html, /data-tab="video"/);
  assert.match(html, /id="tab-video"/);
  assert.match(html, /Video Analysis/);
  assert.match(html, /looping without pause control/);
  assert.match(html, /WCAG 2\.2\.2/);
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

test("roast route cannot inject markup through stored heatmap values", async () => {
  const payload = '<svg/onload="globalThis.heatmapPwned=1">';
  const roast = {
    id: "badc0ffe",
    url: "https://example.com",
    overall_score: 5,
    hero_score: 5,
    cta_score: 5,
    trust_score: 5,
    copy_score: 5,
    design_score: 5,
    roast_response: "",
    quick_wins: "[]",
    seo_data: null,
    performance_data: null,
    heatmap_data: JSON.stringify({
      attention: [{
        x: `10%;">${payload}`,
        y: 25,
        intensity: 90,
        element: payload
      }],
      clickPredictions: [{
        element: payload,
        probability: '50" onmouseover="globalThis.heatmapPwned=1'
      }],
      foldLine: `60%;">${payload}`
    }),
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
    new Request("https://roastmypage.site/roast/badc0ffe"),
    env,
    {}
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.doesNotMatch(html, /<svg\/onload=/);
  assert.doesNotMatch(html, /onmouseover="globalThis\.heatmapPwned/);
  assert.match(html, /&lt;svg\/onload=&quot;globalThis\.heatmapPwned=1&quot;&gt;/);
  assert.match(html, /left:0%;top:25%/);
  assert.match(html, /style="width:0%;background:/);
});

// --- /robots.txt ---

test("robots.txt on production adds only what the managed block lacks", async () => {
  const env = { ENVIRONMENT: "production", BASE_URL: "https://example.test" };
  const res = await worker.fetch(new Request("https://example.test/robots.txt"), env, { waitUntil() {} });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/plain/);
  const body = await res.text();
  assert.match(body, /^Sitemap: https:\/\/example\.test\/sitemap\.xml$/m);
  assert.match(body, /^Disallow: \/api\/$/m);
  // Cloudflare splices its own content-signal block in front of this response.
  // Restating it here is what produced a doubled crawler list on production.
  assert.equal(/^Content-Signal:/m.test(body), false);
  assert.equal(/^User-agent: GPTBot$/m.test(body), false);
  assert.equal((body.match(/^User-agent: \*$/gm) || []).length, 1);
});

test("robots.txt falls back to the production origin without BASE_URL", async () => {
  const res = await worker.fetch(new Request("https://roastmypage.site/robots.txt"), { ENVIRONMENT: "production" }, { waitUntil() {} });
  assert.match(await res.text(), /^Sitemap: https:\/\/roastmypage\.site\/sitemap\.xml$/m);
});

test("robots.txt keeps the non-production worker out of the index", async () => {
  const env = { ENVIRONMENT: "development", BASE_URL: "https://dev.example" };
  const body = await (await worker.fetch(new Request("https://dev.example/robots.txt"), env, { waitUntil() {} })).text();
  assert.match(body, /^Disallow: \/$/m);
  // It serves the same content as production, so it must not advertise a
  // sitemap or invite crawling at all.
  assert.equal(/^Sitemap:/m.test(body), false);
});
