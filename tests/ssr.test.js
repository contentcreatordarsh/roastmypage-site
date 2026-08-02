import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRoastPage } from "../src/ssr.js";

function makeRoastPage(overrides = {}) {
  const categories = [
    { key: "hero", label: "Hero Section", score: 10, color: "#8B5CF6", emoji: "H", question: "Hero?", description: "Hero description" },
    { key: "cta", label: "Call to Action", score: 0, color: "#F97316", emoji: "C", question: "CTA?", description: "CTA description" },
    { key: "trust", label: "Trust Signals", score: 5, color: "#22C55E", emoji: "T", question: "Trust?", description: "Trust description" },
    { key: "copy", label: "Copywriting", score: 5, color: "#3B82F6", emoji: "W", question: "Copy?", description: "Copy description" },
    { key: "design", label: "Visual Design", score: 5, color: "#EC4899", emoji: "D", question: "Design?", description: "Design description" }
  ];

  return renderRoastPage({
    roast: {
      id: "abc12345",
      url: "https://example.com",
      hero_score: 10,
      cta_score: 0,
      trust_score: 5,
      copy_score: 5,
      design_score: 5,
      country: "XX",
      roast_response: "",
      industry: "other",
      created_at: "2026-08-02T00:00:00Z"
    },
    hostname: "example.com",
    scoreColor: "#FBBF24",
    score: 7,
    emoji: "",
    dateStr: "Aug 2, 2026",
    categories,
    sections: {},
    quickWins: [],
    seo: null,
    performance22: null,
    BASE_URL: "https://roastmypage.site",
    screenshotUrl: "/api/screenshot/abc12345",
    heatmapDotsHtml: "",
    heatmapSidebarHtml: "",
    a11y: null,
    a11yDetailsHtml: "",
    verdictText: "",
    scoreLabel: "Room to Improve",
    heatmap: null,
    seoDetailsHtml: "",
    perfDetailsHtml: "",
    ...overrides
  });
}

test("renderRoastPage includes local personalized weighting controls", () => {
  const html = makeRoastPage();

  assert.match(html, /Personalized weighting \(local\)/);
  assert.match(html, /This does not change the AI analysis, saved score, benchmark, or shared result\./);
  assert.match(html, /id="reset-rubric-weights"/);
  assert.match(html, /roastmypage:rubricWeights:v1/);
  for (const key of ["hero", "cta", "trust", "copy", "design"]) {
    assert.match(html, new RegExp(`data-rubric-weight="${key}"`));
  }
});

test("renderRoastPage starts local score from equal category weights", () => {
  const html = makeRoastPage();

  assert.match(html, /id="personalized-overall-score"[^>]*>5\.0<\/div>/);
  assert.match(html, /AI overall remains 7\/10/);
});
