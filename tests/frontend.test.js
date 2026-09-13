import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("single roast progress resume banner is available near the hero", () => {
  assert.match(html, /id="roast-resume-banner"/);
  assert.match(html, /Roast in progress for <span id="roast-resume-url"/);
  assert.match(html, /onclick="resumeRoastProgress\(\)"/);
  assert.match(html, /onclick="dismissRoastProgress\(\)"/);
});

test("single roast progress persistence uses the expected localStorage contract", () => {
  assert.match(html, /const ROAST_PROGRESS_KEY = 'rmlp_roast_progress';/);
  assert.match(html, /const ROAST_PROGRESS_MAX_AGE_MS = 10 \* 60 \* 1000;/);
  assert.match(html, /status: 'in_progress'/);
  assert.match(html, /localStorage\.setItem\(ROAST_PROGRESS_KEY, JSON\.stringify\(safeProgress\)\)/);
  assert.match(html, /localStorage\.removeItem\(ROAST_PROGRESS_KEY\)/);
});

test("single roast progress lifecycle starts, updates, resumes, and clears", () => {
  assert.match(html, /beginRoastProgress\(url\);[\s\S]*showLoadingModal\(\);/);
  assert.match(html, /persistRoastProgressUpdate\(step, message, percent\);/);
  assert.match(html, /clearRoastProgress\(\);[\s\S]*hideLoadingModal\(\);[\s\S]*displayResults\(data, data\.cached\);/);
  assert.match(html, /clearRoastProgress\(\);[\s\S]*hideLoadingModal\(\);[\s\S]*displayResults\(data, false\);/);
  assert.match(html, /document\.getElementById\('url-input'\)\.value = progress\.url;/);
  assert.match(html, /setDevice\(progress\.device\);/);
  assert.match(html, /setFullPage\(progress\.fullPage\);/);
});
