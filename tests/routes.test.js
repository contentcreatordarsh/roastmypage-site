import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { dispatch } from "../src/routes/router.js";
import { handle as handleRoast } from "../src/routes/roast.js";
import { handle as handleCompare } from "../src/routes/compare.js";
import { handle as handleBatch } from "../src/routes/batch.js";
import { handle as handleGallery } from "../src/routes/gallery.js";
import { handle as handleSocial } from "../src/routes/social.js";
import { handle as handleWatchlist } from "../src/routes/watchlist.js";
import { handle as handlePlatform } from "../src/routes/platform.js";
import { handle as handleBadges } from "../src/routes/badges.js";
import { handle as handleThreats } from "../src/routes/threats.js";
import { handle as handleApiV1 } from "../src/routes/apiV1.js";
import { handle as handleSsr } from "../src/routes/ssr-routes.js";
import { visibleStoredRoasts, visibleStoredRoastSql, OWNER_KEY_RE } from "../src/routes/helpers.js";

const routeHandles = [
  handleRoast,
  handleCompare,
  handleBatch,
  handleGallery,
  handleSocial,
  handleWatchlist,
  handlePlatform,
  handleBadges,
  handleThreats,
  handleApiV1,
  handleSsr
];

function mockRequest(path, method = "GET") {
  return new Request(`https://roastmypage.site${path}`, { method });
}

test("each route module exports a handle function", () => {
  for (const handle of routeHandles) {
    assert.equal(typeof handle, "function");
  }
});

test("route handles return null for paths they do not own", async () => {
  const url = new URL("https://roastmypage.site/definitely-not-a-route");
  const env = { ENVIRONMENT: "development" };
  const missed = await Promise.all(
    routeHandles.map((handle) => handle(mockRequest("/definitely-not-a-route"), env, {}, url, {}))
  );
  assert.deepEqual(missed, Array(routeHandles.length).fill(null));
});

test("dispatch returns null when no handler matches", async () => {
  const url = new URL("https://roastmypage.site/nope");
  const response = await dispatch(
    routeHandles,
    mockRequest("/nope"),
    { ENVIRONMENT: "development" },
    {},
    url,
    {}
  );
  assert.equal(response, null);
});

test("worker falls through unmatched paths to 404 without ASSETS", async () => {
  const response = await worker.fetch(
    mockRequest("/no-such-page"),
    { ENVIRONMENT: "development" },
    {}
  );
  assert.equal(response.status, 404);
});

test("OPTIONS short-circuits before route modules", async () => {
  const response = await worker.fetch(
    mockRequest("/api/gallery", "OPTIONS"),
    { ENVIRONMENT: "development" },
    {}
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

test("visibleStoredRoasts strips challenge rows and seo_data", () => {
  const rows = [
    { id: "ok", url: "https://example.com/", seo_data: JSON.stringify({ title: { text: "Hello" } }) },
    { id: "bot", url: "https://blocked.example/", seo_data: JSON.stringify({ title: { text: "Just a moment..." } }) }
  ];
  const visible = visibleStoredRoasts(rows);
  assert.deepEqual(visible.map((row) => row.id), ["ok"]);
  assert.equal("seo_data" in visible[0], false);
});

test("visibleStoredRoastSql embeds challenge title prefixes as SQL", () => {
  const sql = visibleStoredRoastSql();
  assert.match(sql, /json_extract\(seo_data, '\$\.title\.text'\)/);
  assert.match(sql, /just a moment/);
});

test("OWNER_KEY_RE accepts watchlist keys of 8–64 url-safe characters", () => {
  assert.equal(OWNER_KEY_RE.test("abcd1234"), true);
  assert.equal(OWNER_KEY_RE.test("short"), false);
  assert.equal(OWNER_KEY_RE.test("bad key!!"), false);
});
