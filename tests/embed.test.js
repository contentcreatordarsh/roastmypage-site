import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const embedJs = readFileSync(new URL("../public/embed.js", import.meta.url), "utf8");
const embedHtml = readFileSync(new URL("../public/embed.html", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");

test("embed widget script parses and supports shadow or iframe rendering", () => {
  assert.doesNotThrow(() => new Function(embedJs));
  assert.match(embedJs, /attachShadow/);
  assert.match(embedJs, /data-mode/);
  assert.match(embedJs, /\/embed\?agency=/);
  assert.match(embedJs, /target\.searchParams\.set\("embed", "1"\)/);
});

test("embed widget sanitizes configured app origins", () => {
  assert.match(embedJs, /function cleanOrigin/);
  assert.match(embedJs, /ALLOWED_HOSTS/);
  assert.match(embedJs, /roastmypage\.site/);
  assert.match(embedJs, /parsed\.protocol === "https:"/);
});

test("minimal iframe page points submissions at embed-styled roast page", () => {
  const scripts = [...embedHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script));
  }
  assert.match(embedHtml, /APP_ORIGIN = "https:\/\/roastmypage\.site"/);
  assert.match(embedHtml, /target\.searchParams\.set\("embed", "1"\)/);
  assert.match(embedHtml, /parsed\.protocol !== "http:" && parsed\.protocol !== "https:"/);
});

test("API docs include a copy-paste agency widget snippet", () => {
  assert.ok(html.includes('id="widget-embed-code"'));
  assert.ok(html.includes('https://roastmypage.site/embed.js'));
  assert.ok(html.includes('data-agency="Your Agency"'));
  assert.ok(html.includes('data-mode="iframe"'));
  assert.ok(html.includes("function copyWidgetEmbedCode()"));
  assert.ok(html.includes("<\\/script>"));
});

test("main app supports compact embed arrival without changing default view", () => {
  assert.ok(html.includes("body.embed-mode .site-nav"));
  assert.ok(html.includes("params.get('embed') === '1'"));
  assert.ok(html.includes("const embedUrl = params.get('url')"));
  assert.ok(html.includes("urlInput.value = parsed.toString()"));
});

test("worker serves /embed with frame-safe headers only on the widget page", () => {
  assert.ok(worker.includes('url.pathname === "/embed"'));
  assert.ok(worker.includes('embedUrl.pathname = "/embed.html"'));
  assert.ok(worker.includes('delete headers["X-Frame-Options"]'));
  assert.ok(worker.includes('"frame-ancestors http: https:"'));
  assert.ok(worker.includes("getEmbedPageHeaders(origin, env22.ENVIRONMENT)"));
});
