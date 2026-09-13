import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

test("share card route exposes PNG and download wiring", async () => {
  const workerSource = await readFile(new URL("../src/index.js", import.meta.url), "utf8");

  assert.match(workerSource, /url\.pathname\.startsWith\("\/api\/card\/"\)/);
  assert.match(workerSource, /renderSvgToPng\(env22, cardSvg, `card-\$\{roastId\}`\)/);
  assert.match(workerSource, /"Content-Type": "image\/png"/);
  assert.match(workerSource, /Content-Disposition/);
  assert.match(workerSource, /download"\) === "1"/);
});

test("results UI exposes download and open-card affordances", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /Download \/ Share card/);
  assert.match(html, /share-card-open-link/);
  assert.match(html, /share-card-image-link/);
  assert.match(html, /function getCardImageUrl/);
  assert.match(html, /async function shareOrDownloadCard/);
  assert.match(html, /navigator\.canShare/);
  assert.match(html, /getCardImageUrl\(true\)/);
});
