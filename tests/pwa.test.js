import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(rootDir, "public");

test("manifest exposes installable PWA metadata and icons", async () => {
  const manifest = JSON.parse(await readFile(join(publicDir, "manifest.webmanifest"), "utf8"));

  assert.equal(manifest.name, "Roast My Landing Page");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#0A0908");
  assert.equal(manifest.background_color, "#0A0908");
  assert.ok(manifest.icons.some((icon) => icon.src === "/icon.svg" && icon.type === "image/svg+xml"));
  assert.ok(manifest.icons.some((icon) => icon.src === "/apple-touch-icon.svg"));
});

test("index links PWA assets and guards service worker registration", async () => {
  const html = await readFile(join(publicDir, "index.html"), "utf8");

  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.svg">/);
  assert.match(html, /navigator\.serviceWorker\.register\('\/sw\.js', \{ scope: '\/', updateViaCache: 'none' \}\)/);
  assert.match(html, /window\.location\.protocol === 'https:' \|\| isLocalhost/);
  assert.match(html, /window\.addEventListener\('beforeinstallprompt'/);
});

test("service worker has versioned caches and expected caching strategies", async () => {
  const sw = await readFile(join(publicDir, "sw.js"), "utf8");

  assert.match(sw, /const CACHE_VERSION = 'v\d+'/);
  assert.match(sw, /const STATIC_CACHE = `rmlp-static-\$\{CACHE_VERSION\}`/);
  assert.match(sw, /const API_CACHE = `rmlp-api-\$\{CACHE_VERSION\}`/);
  assert.match(sw, /self\.skipWaiting\(\)/);
  assert.match(sw, /self\.clients\.claim\(\)/);
  assert.match(sw, /ROAST_POST_PATHS\.has\(url\.pathname\)/);
  assert.match(sw, /url\.pathname === '\/sw\.js'/);
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(sw, /networkFirst\(request, API_CACHE\)/);
  assert.match(sw, /cacheFirst\(request, STATIC_CACHE\)/);
});
