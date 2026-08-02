import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_TOKEN_HEADER,
  authorizeAdminRequest,
  extractAdminToken,
  getAdminToken,
  verifyAdminToken
} from "../src/admin.js";

test("getAdminToken treats missing and blank ADMIN_TOKEN as not configured", () => {
  assert.equal(getAdminToken({}), null);
  assert.equal(getAdminToken({ ADMIN_TOKEN: "   " }), null);
  assert.equal(getAdminToken({ ADMIN_TOKEN: " secret " }), "secret");
});

test("extractAdminToken reads query token before header token", () => {
  const request = new Request("https://example.com/admin?token=query-secret", {
    headers: { [ADMIN_TOKEN_HEADER]: "header-secret" }
  });

  assert.deepEqual(extractAdminToken(request), {
    token: "query-secret",
    source: "query"
  });
});

test("extractAdminToken reads X-Admin-Token header when query token is absent", () => {
  const request = new Request("https://example.com/api/admin/stats", {
    headers: { [ADMIN_TOKEN_HEADER]: "header-secret" }
  });

  assert.deepEqual(extractAdminToken(request), {
    token: "header-secret",
    source: "header"
  });
});

test("authorizeAdminRequest reports unconfigured admin when ADMIN_TOKEN is unset", async () => {
  const request = new Request("https://example.com/api/admin/stats?token=anything");

  assert.deepEqual(await authorizeAdminRequest(request, {}), {
    configured: false,
    authorized: false,
    source: null
  });
});

test("authorizeAdminRequest authorizes a matching query token", async () => {
  const request = new Request("https://example.com/admin?token=correct");

  assert.deepEqual(await authorizeAdminRequest(request, { ADMIN_TOKEN: "correct" }), {
    configured: true,
    authorized: true,
    source: "query"
  });
});

test("authorizeAdminRequest rejects an invalid token without exposing its source", async () => {
  const request = new Request("https://example.com/api/admin/stats", {
    headers: { [ADMIN_TOKEN_HEADER]: "wrong" }
  });

  assert.deepEqual(await authorizeAdminRequest(request, { ADMIN_TOKEN: "correct" }), {
    configured: true,
    authorized: false,
    source: null
  });
});

test("verifyAdminToken rejects missing values and mismatches", async () => {
  assert.equal(await verifyAdminToken("", "correct"), false);
  assert.equal(await verifyAdminToken("wrong", "correct"), false);
  assert.equal(await verifyAdminToken("correct", "correct"), true);
});
