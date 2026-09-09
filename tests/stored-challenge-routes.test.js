import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { isStoredChallengeRoast } from "../src/botcheck.js";

const challengeRoast = {
  id: "challenge123",
  url: "https://blocked.example/",
  overall_score: 4.2,
  hero_score: 4,
  cta_score: 4,
  trust_score: 5,
  copy_score: 4,
  design_score: 4,
  industry: "other",
  created_at: "2026-08-20 12:00:00",
  seo_data: JSON.stringify({
    title: { text: "Just a moment...", length: 16, status: "short" }
  })
};

const legitimateRoast = {
  ...challengeRoast,
  id: "legitimate123",
  url: "https://example.com/",
  overall_score: 8,
  seo_data: JSON.stringify({
    title: { text: "Example — Build better pages", length: 28, status: "good" }
  })
};

function mockDb({ first = challengeRoast, rows = [challengeRoast, legitimateRoast] } = {}) {
  return {
    prepare(sql) {
      const statement = {
        bind() {
          return statement;
        },
        async first() {
          if (sql.includes("COUNT(*)")) {
            const count = sql.includes("json_extract")
              ? rows.filter((row) => !isStoredChallengeRoast(row.seo_data)).length
              : rows.length;
            return { count };
          }
          if (sql.includes("json_extract")) {
            return rows.find((row) => !isStoredChallengeRoast(row.seo_data)) || null;
          }
          return first;
        },
        async all() {
          return {
            results: sql.includes("json_extract")
              ? rows.filter((row) => !isStoredChallengeRoast(row.seo_data))
              : rows
          };
        }
      };
      return statement;
    }
  };
}

function envWithDb(DB) {
  return {
    DB,
    ENVIRONMENT: "development",
    BASE_URL: "https://roastmypage.site"
  };
}

test("stored challenge roasts are unavailable through ID-based report routes", async () => {
  const env = envWithDb(mockDb());

  const apiResponse = await worker.fetch(
    new Request("https://roastmypage.site/api/roast/challenge123"),
    env,
    {}
  );
  const pageResponse = await worker.fetch(
    new Request("https://roastmypage.site/roast/challenge123"),
    env,
    {}
  );
  const badgeResponse = await worker.fetch(
    new Request("https://roastmypage.site/api/badge/challenge123/large"),
    env,
    {}
  );

  assert.equal(apiResponse.status, 404);
  assert.equal(pageResponse.status, 404);
  assert.equal(badgeResponse.status, 404);
});

test("legitimate stored roasts remain available by ID", async () => {
  const response = await worker.fetch(
    new Request("https://roastmypage.site/api/roast/legitimate123"),
    envWithDb(mockDb({ first: legitimateRoast })),
    {}
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, "legitimate123");
});

test("public discovery routes omit stored challenge roasts and internal SEO data", async () => {
  const env = envWithDb(mockDb());

  const galleryResponse = await worker.fetch(
    new Request("https://roastmypage.site/api/gallery"),
    env,
    {}
  );
  const leaderboardResponse = await worker.fetch(
    new Request("https://roastmypage.site/api/leaderboard"),
    env,
    {}
  );
  const sitemapResponse = await worker.fetch(
    new Request("https://roastmypage.site/sitemap.xml"),
    env,
    {}
  );
  const galleryPageResponse = await worker.fetch(
    new Request("https://roastmypage.site/gallery"),
    env,
    {}
  );
  const activityResponse = await worker.fetch(
    new Request("https://roastmypage.site/api/live-activity"),
    env,
    {}
  );
  const feedResponse = await worker.fetch(
    new Request("https://roastmypage.site/api/feed"),
    env,
    {}
  );
  const improvementResponse = await worker.fetch(
    new Request("https://roastmypage.site/api/improvement/demo-hash"),
    env,
    {}
  );

  const gallery = await galleryResponse.json();
  const leaderboard = await leaderboardResponse.json();
  const sitemap = await sitemapResponse.text();
  const galleryPage = await galleryPageResponse.text();
  const activity = await activityResponse.json();
  const feed = await feedResponse.json();
  const improvement = await improvementResponse.json();

  assert.deepEqual(gallery.map(({ id }) => id), ["legitimate123"]);
  assert.equal("seo_data" in gallery[0], false);
  assert.deepEqual(leaderboard.map(({ id }) => id), ["legitimate123"]);
  assert.doesNotMatch(sitemap, /\/roast\/challenge123/);
  assert.match(sitemap, /\/roast\/legitimate123/);
  assert.doesNotMatch(galleryPage, /blocked\.example/);
  assert.match(galleryPage, /example\.com/);
  assert.match(galleryPage, /1 landing pages analyzed/);
  assert.deepEqual(activity.activity.map(({ id }) => id), ["legitimate123"]);
  assert.equal(feed.pagination.total, 1);
  assert.equal(improvement.totalRoasts, 1);
  assert.equal(improvement.firstRoast.id, "legitimate123");
});
