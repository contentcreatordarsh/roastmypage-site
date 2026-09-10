#!/usr/bin/env node
/**
 * Post-deploy smoke suite. Read-only checks plus negative POSTs that are
 * rejected before Browser Rendering is touched, so running this never costs a
 * capture or pollutes the gallery.
 *
 *   node scripts/smoke.mjs https://roast-my-landing-page-test.falling-hall-ac41.workers.dev
 *
 * Always target a worker's *.workers.dev hostname, never roastmypage.site: the
 * zone sits behind Cloudflare bot protection that 403s non-browser agents, and
 * a challenge 403 is indistinguishable from a legitimate 4xx block — which
 * produces false failures and, worse, false passes.
 */

const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!BASE) {
  console.error("usage: node scripts/smoke.mjs <base-url>");
  process.exit(2);
}
if (/roastmypage\.site/.test(BASE)) {
  console.error("refusing to smoke-test the custom domain: bot protection makes the results meaningless. Use the worker's *.workers.dev hostname.");
  process.exit(2);
}

const results = [];
const ok = (name, pass, info = "") => {
  results.push({ name, pass: !!pass, info: String(info).slice(0, 160) });
};

const bust = (path) => `${BASE}${path}${path.includes("?") ? "&" : "?"}cb=${Date.now()}`;

async function get(path) {
  const res = await fetch(bust(path), { cache: "no-store" });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json, headers: res.headers };
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, text, json, headers: res.headers };
}

// --- pages ------------------------------------------------------------------
for (const [path, re] of [["/", /Roast/i], ["/gallery", /gallery/i], ["/pricing", /pricing/i], ["/sitemap.xml", /<urlset/]]) {
  const r = await get(path);
  ok(`GET ${path}`, r.status === 200 && re.test(r.text), `${r.status} len=${r.text.length}`);
}

// --- JSON endpoints ---------------------------------------------------------
const jsonRoutes = [
  "/api/gallery", "/api/leaderboard", "/api/leaderboard/alltime", "/api/leaderboard/weekly",
  "/api/leaderboard/shame", "/api/recent", "/api/featured", "/api/stats", "/api/platform-stats",
  "/api/live-activity", "/api/showcase", "/api/feed", "/api/v1/usage"
];
for (const path of jsonRoutes) {
  const r = await get(path);
  ok(`GET ${path} -> JSON 200`, r.status === 200 && r.json !== null, r.status);
}

const usage = await get("/api/v1/usage");
ok(
  "v1 usage exposes perIp + global limits",
  typeof usage.json?.limits?.perIp?.used === "number" && typeof usage.json?.limits?.global?.used === "number",
  JSON.stringify(usage.json?.limits || {}).slice(0, 110)
);

ok("unknown path -> 404", (await get("/definitely-not-a-real-path-xyz")).status === 404);

// --- sitemap ----------------------------------------------------------------
const sitemap = await get("/sitemap.xml");
ok(
  "sitemap is well-formed",
  sitemap.text.startsWith("<?xml") && sitemap.text.includes("</urlset>"),
  `${(sitemap.text.match(/<loc>/g) || []).length} urls`
);

// --- #146: internal audit JSON must never reach a public listing ------------
for (const path of ["/api/gallery?limit=100", "/api/leaderboard", "/api/recent", "/api/featured", "/api/showcase", "/api/feed"]) {
  const r = await get(path);
  ok(`${path} does not leak seo_data`, !/"seo_data"/.test(r.text), r.status);
}

// --- SSRF -------------------------------------------------------------------
const hostile = [
  "http://127.0.0.1", "http://localhost:8080", "http://169.254.169.254/latest/meta-data/",
  "http://[::1]/", "http://10.0.0.1", "http://192.168.1.1", "http://172.16.0.5",
  "file:///etc/passwd", "http://0177.0.0.1", "http://2130706433",
  "javascript:alert(1)", "http://metadata.google.internal/"
];
for (const url of hostile) {
  const r = await post("/api/roast", { url });
  ok(`SSRF /api/roast blocks ${url}`, r.status >= 400 && r.status < 500, `${r.status} ${(r.json?.error || "").slice(0, 40)}`);
}
for (const url of ["http://127.0.0.1", "http://169.254.169.254/", "file:///etc/passwd", "http://192.168.0.1"]) {
  const r = await post("/api/v1/roast", { url });
  ok(
    `SSRF /api/v1/roast blocks ${url}`,
    r.status === 400 && ["blocked_url", "invalid_url"].includes(r.json?.error),
    `${r.status} ${r.json?.error || ""}`
  );
}

// --- #147: the threat scanner must not be pointed at internal hosts ---------
// These probes are free: with #147 in place the internal-target check returns
// 400 before checkOperationRateLimit(..., "threat") is reached, so none of them
// consume the 10/hour budget. A 429 here therefore means the ordering regressed
// and the limiter now runs first — report it rather than asserting on a status
// the SSRF check never produced.
for (const domain of ["localhost", "127.0.0.1", "169.254.169.254", "10.0.0.1", "192.168.1.1", "172.16.0.5", "metadata.google.internal"]) {
  const r = await post("/api/threat-scan", { domain });
  if (r.status === 429) {
    ok(`#147 threat-scan domain ${domain} rate limited before the SSRF check`, false, "429 — validation is no longer short-circuiting");
    continue;
  }
  ok(`#147 threat-scan blocks domain ${domain}`, r.status === 400, `${r.status} ${(r.json?.error || "").slice(0, 40)}`);
}
for (const url of ["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://192.168.0.5/admin"]) {
  const r = await post("/api/threat-scan", { url });
  ok(`#147 threat-scan blocks url ${url}`, r.status >= 400 && r.status < 500 && r.status !== 429, `${r.status} ${(r.json?.error || "").slice(0, 40)}`);
}

// --- #148: the busy check must not mask a caller's own mistake --------------
for (const [body, expected] of [
  [{}, "invalid_request"],
  [{ url: 123 }, "invalid_request"],
  [{ url: "not a url at all" }, "invalid_url"],
  [{ url: "ftp://example.com" }, "invalid_url"]
]) {
  const r = await post("/api/v1/roast", body);
  ok(
    `#148 v1 ${JSON.stringify(body)} -> 400/${expected}, not 503`,
    r.status === 400 && r.json?.error === expected,
    `${r.status} ${r.json?.error || ""}`
  );
}
for (const body of [{}, { url: "not a url" }, { url: "http://127.0.0.1" }]) {
  const roast = await post("/api/roast", body);
  ok(`#148 /api/roast ${JSON.stringify(body)} -> 4xx, not 503`, roast.status >= 400 && roast.status < 500, roast.status);
  const compare = await post("/api/compare", { url1: body.url || "", url2: body.url || "" });
  ok(`#148 /api/compare ${JSON.stringify(body)} -> 4xx, not 503`, compare.status >= 400 && compare.status < 500, compare.status);
}
ok("#148 /api/batch-roast [] -> 4xx, not 503", (await post("/api/batch-roast", { urls: [] })).status < 500);
ok("#148 /api/roast-stream SSRF -> 4xx, not 503", (await post("/api/roast-stream", { url: "http://127.0.0.1" })).status < 500);

// --- security headers on worker-handled responses ---------------------------
const secured = await get("/api/stats");
const csp = secured.headers.get("content-security-policy") || "";
ok("CSP present", csp.length > 50, csp.slice(0, 60));
for (const [label, re] of [
  ["object-src 'none'", /object-src\s+'none'/],
  ["base-uri", /base-uri/],
  ["form-action", /form-action/],
  ["frame-ancestors", /frame-ancestors/],
  ["upgrade-insecure-requests", /upgrade-insecure-requests/],
  ["googlesyndication allowed", /googlesyndication/],
  ["cloudflareinsights allowed", /cloudflareinsights/]
]) {
  ok(`CSP ${label}`, re.test(csp));
}
ok("X-Content-Type-Options nosniff", (secured.headers.get("x-content-type-options") || "").toLowerCase() === "nosniff");
ok("X-Frame-Options DENY", secured.headers.get("x-frame-options") === "DENY");
ok("Referrer-Policy set", !!secured.headers.get("referrer-policy"));
ok("Permissions-Policy set", !!secured.headers.get("permissions-policy"));

// --- XSS --------------------------------------------------------------------
const payload = "%3Cscript%3Ealert(1)%3C/script%3E";
for (const path of [`/roast/${payload}`, `/gallery?industry=${payload}`, `/api/gallery?industry=${payload}`, `/api/badge/${payload}`]) {
  const r = await get(path);
  ok(`XSS-safe ${path.slice(0, 34)}`, !/<script>alert\(1\)<\/script>/.test(r.text), r.status);
}

// --- id routes --------------------------------------------------------------
ok("/api/screenshot/<malformed> -> 400", (await get("/api/screenshot/zzzzzzzz")).status === 400);
ok("/api/screenshot/<unknown> -> 404", (await get("/api/screenshot/deadbeef")).status === 404);
ok("/api/roast/<unknown> -> 404", (await get("/api/roast/deadbeef")).status === 404);
ok("/roast/<unknown> -> 404", (await get("/roast/deadbeef")).status === 404);
ok("/api/badge/<unknown> -> 404", (await get("/api/badge/deadbeef")).status === 404);

// --- watchlist auth ---------------------------------------------------------
ok("watchlist GET without ownerKey rejected", (await get("/api/watchlist")).status >= 400);
ok("watchlist GET with malformed ownerKey rejected", (await get("/api/watchlist?ownerKey=%3Cbad%3E")).status >= 400);
const emptyList = await get(`/api/watchlist?ownerKey=${"q".repeat(32)}`);
ok(
  "watchlist list never returns raw email/webhook",
  emptyList.status === 200 && !/"webhook_url"/.test(emptyList.text) && !/"email"\s*:\s*"[^"]/.test(emptyList.text),
  emptyList.text.slice(0, 80)
);

// --- #149: report pages must reference screenshots on the current origin -----
const firstPage = await get("/api/gallery?limit=1");
const sampleId = firstPage.json?.[0]?.id;
if (sampleId) {
  const page = await get(`/roast/${sampleId}`);
  ok(`#149 /roast/${sampleId} renders`, page.status === 200 && page.text.includes(sampleId), page.status);
  ok(
    "#149 screenshot src is origin-relative",
    page.text.includes(`src="/api/screenshot/${sampleId}"`),
    (page.text.match(/src="[^"]*api\/screenshot[^"]*"/) || ["none"])[0]
  );
  const shot = await fetch(bust(`/api/screenshot/${sampleId}`), { cache: "no-store" });
  ok(
    "#149 screenshot loads on this hostname",
    shot.status === 200 && (shot.headers.get("content-type") || "").startsWith("image/"),
    `${shot.status} ${shot.headers.get("content-type")}`
  );
} else {
  ok("#149 skipped: gallery is empty", true, "no roast available to sample");
}

// --- report -----------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
for (const r of failed) console.error(`FAIL  ${r.name}  [${r.info}]`);
console.log(`\n${BASE}`);
console.log(`${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error(`\n${failed.length} check(s) failed`);
  process.exit(1);
}
