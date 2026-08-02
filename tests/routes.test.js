import { test } from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";
import { handleAdminRoutes } from "../src/routes/admin.js";
import { handleApiV1Routes } from "../src/routes/apiV1.js";
import { handleExtrasRoutes } from "../src/routes/extras.js";
import { handlePublicDataRoutes } from "../src/routes/publicData.js";
import { handleRouteModules } from "../src/routes/router.js";

test("route modules export handler functions", () => {
  assert.equal(typeof handleAdminRoutes, "function");
  assert.equal(typeof handleApiV1Routes, "function");
  assert.equal(typeof handleExtrasRoutes, "function");
  assert.equal(typeof handlePublicDataRoutes, "function");
  assert.equal(typeof handleRouteModules, "function");
});

test("worker default export keeps fetch handler", () => {
  assert.equal(typeof worker.fetch, "function");
});
