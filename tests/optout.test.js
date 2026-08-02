import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OptOutValidationError,
  normalizeOptOutEmail,
  normalizeOptOutUrl,
  parseOptOutRequestBody,
  processOptOutRequest,
  screenshotKeysForRoasts
} from "../src/optout.js";
import { hashUrl } from "../src/utils.js";

function makeOptOutEnv(initialRows) {
  const state = {
    rows: [...initialRows],
    deletedKeys: [],
    logs: []
  };
  const env = {
    SCREENSHOTS: {
      delete: async (key) => {
        state.deletedKeys.push(key);
      }
    },
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              first: async () => {
                if (sql.includes("FROM roasts") && sql.includes("WHERE id = ?")) {
                  return state.rows.find((row) => row.id === values[0]) || null;
                }
                return null;
              },
              all: async () => {
                if (sql.includes("WHERE url_hash IN")) {
                  return { results: state.rows.filter((row) => values.includes(row.url_hash)) };
                }
                if (sql.includes("WHERE LOWER(url) LIKE ?")) {
                  const prefix = values[0].replace(/%$/, "");
                  return {
                    results: state.rows.filter((row) => String(row.url || "").toLowerCase().startsWith(prefix))
                  };
                }
                return { results: [] };
              },
              run: async () => {
                if (sql.includes("INSERT INTO opt_outs")) {
                  state.logs.push({ id: values[0], url: values[1], urlHash: values[2], email: values[3] });
                  return { meta: { changes: 1 } };
                }
                if (sql.includes("DELETE FROM roasts")) {
                  const ids = new Set(values);
                  const before = state.rows.length;
                  state.rows = state.rows.filter((row) => !ids.has(row.id));
                  return { meta: { changes: before - state.rows.length } };
                }
                return { meta: { changes: 0 } };
              }
            };
          }
        };
      }
    }
  };
  return { env, state };
}

test("normalizeOptOutUrl accepts bare domains and strips tracking params", () => {
  assert.equal(
    normalizeOptOutUrl("Example.com/page/?utm_source=newsletter&utm_medium=email&ref=footer"),
    "https://example.com/page"
  );
  assert.equal(normalizeOptOutUrl("javascript:alert(1)"), "");
  assert.equal(normalizeOptOutUrl("ftp://example.com"), "");
});

test("parseOptOutRequestBody validates URL, roast ID, and optional email", async () => {
  const parsedUrl = await parseOptOutRequestBody({ url: "https://Example.com/", email: "USER@Example.com" });
  assert.equal(parsedUrl.type, "url");
  assert.equal(parsedUrl.url, "https://example.com/");
  assert.equal(parsedUrl.email, "user@example.com");

  const parsedId = await parseOptOutRequestBody({ roastId: "self-roast-01" });
  assert.deepEqual(parsedId, { type: "roastId", roastId: "self-roast-01", email: "" });

  await assert.rejects(
    parseOptOutRequestBody({ roastId: "bad id" }),
    OptOutValidationError
  );
  assert.throws(
    () => normalizeOptOutEmail("not-an-email"),
    OptOutValidationError
  );
});

test("screenshotKeysForRoasts includes stored keys and legacy fallbacks once", () => {
  assert.deepEqual(
    screenshotKeysForRoasts([{ id: "aaaabbbb", screenshot_key: "screenshots/aaaabbbb.jpg" }]).sort(),
    ["screenshots/aaaabbbb.jpg", "screenshots/aaaabbbb.png"]
  );
});

test("processOptOutRequest deletes all roasts matching a normalized URL", async () => {
  const normalizedUrl = "https://example.com/page";
  const desktopHash = await hashUrl(normalizedUrl, "desktop");
  const { env, state } = makeOptOutEnv([
    {
      id: "aaaabbbb",
      url: "https://Example.com/page/?utm_source=newsletter&ref=footer",
      url_hash: "legacy-hash",
      screenshot_key: "screenshots/custom-aa.jpg"
    },
    {
      id: "ccccdddd",
      url: "https://example.com/page/",
      url_hash: desktopHash,
      screenshot_key: null
    },
    {
      id: "eeeeffff",
      url: "https://example.com/other",
      url_hash: "other-hash",
      screenshot_key: "screenshots/other.jpg"
    }
  ]);

  const result = await processOptOutRequest(env, {
    url: "example.com/page/?utm_source=newsletter",
    email: "Owner@Example.com"
  });

  assert.equal(result.success, true);
  assert.equal(result.matched, 2);
  assert.equal(result.deleted, 2);
  assert.deepEqual(state.rows.map((row) => row.id), ["eeeeffff"]);
  assert.deepEqual(
    state.deletedKeys.sort(),
    [
      "screenshots/aaaabbbb.jpg",
      "screenshots/aaaabbbb.png",
      "screenshots/ccccdddd.jpg",
      "screenshots/ccccdddd.png",
      "screenshots/custom-aa.jpg"
    ].sort()
  );
  assert.equal(state.logs.length, 1);
  assert.equal(state.logs[0].url, normalizedUrl);
  assert.equal(state.logs[0].email, "owner@example.com");
  assert.match(state.logs[0].urlHash, /^[a-f0-9]{32}$/);
});

test("processOptOutRequest deletes by valid roast ID", async () => {
  const { env, state } = makeOptOutEnv([
    {
      id: "self-roast-01",
      url: "https://roastmypage.site/",
      url_hash: "hash",
      screenshot_key: "screenshots/self-roast-01.jpg"
    }
  ]);

  const result = await processOptOutRequest(env, { roastId: "self-roast-01" });

  assert.equal(result.matched, 1);
  assert.equal(result.deleted, 1);
  assert.deepEqual(state.rows, []);
  assert.deepEqual(
    state.deletedKeys.sort(),
    [
      "screenshots/self-roast-01.jpg",
      "screenshots/self-roast-01.png"
    ].sort()
  );
  assert.equal(state.logs[0].url, "https://roastmypage.site/");
});
