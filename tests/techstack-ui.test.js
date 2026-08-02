import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("results page exposes a Tech Stack tab wired to the scanner endpoint", () => {
  assert.ok(html.includes('id="rtab-techstack"'));
  assert.ok(html.includes('id="result-techstack"'));
  assert.ok(html.includes("function runTechStackScan()"));
  assert.ok(html.includes("fetch('/api/tech-scan'"));
  assert.ok(html.includes("fetch(`/api/tech-scan/${encodeURIComponent(scanId)}`)"));
});

test("tech stack UI includes explicit scanner failure and rate-limit states", () => {
  assert.ok(html.includes("Cloudflare URL Scanner is not configured"));
  assert.ok(html.includes("Tech scan rate limited"));
  assert.ok(html.includes("No technologies were detected"));
});
