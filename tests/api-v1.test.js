import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function cachedRoastDb(video) {
  const roast = {
    id: "video-roast",
    url: "https://example.com/",
    url_hash: "cached-hash",
    overall_score: 7.5,
    hero_score: 8,
    cta_score: 7,
    trust_score: 7,
    copy_score: 8,
    design_score: 7.5,
    roast_response: "Cached roast",
    quick_wins: '["Add captions"]',
    seo_data: JSON.stringify({ score: 80, video }),
    performance_data: JSON.stringify({ score: 75 }),
    heatmap_data: JSON.stringify({ foldLine: 42 }),
    industry: "saas"
  };

  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("INSERT INTO api_v1_counters")) return { request_count: 1 };
              if (sql.includes("SELECT id, url, url_hash")) return roast;
              if (sql.includes("SELECT COUNT(*)")) return { count: 1 };
              if (sql.includes("SELECT request_count FROM api_v1_counters")) return { request_count: 1 };
              if (sql.includes("SELECT COALESCE(SUM(request_count)")) return { request_count: 1 };
              throw new Error(`Unexpected query: ${sql}`);
            }
          };
        }
      };
    }
  };
}

test("API v1 cached responses preserve top-level video analysis", async () => {
  const video = {
    present: true,
    count: 1,
    hasHeroVideo: true,
    recommendations: ["Add captions"]
  };
  const env = {
    DB: cachedRoastDb(video),
    CONFIG: {
      get: async () => "0",
      put: async () => {}
    },
    IP_HASH_SALT: "test-salt",
    ENVIRONMENT: "development"
  };
  const request = new Request("https://roastmypage.site/api/v1/roast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.10"
    },
    body: JSON.stringify({ url: "https://example.com" })
  });

  const response = await worker.fetch(request, env, {
    waitUntil() {
      throw new Error("Cache hits must not schedule background work");
    }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Cache"), "HIT");
  assert.deepEqual(body.video, video);
  assert.deepEqual(body.video, body.seo.video);
});
