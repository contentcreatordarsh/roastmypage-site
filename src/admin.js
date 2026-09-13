import { escapeHtml, generateId, isValidRoastIdLoose } from "./utils.js";

const ADMIN_TOKEN_HEADER = "X-Admin-Token";
const MODERATION_KV_KEY = "admin:moderation";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_HIDDEN = 500;
const MAX_FEATURED = 100;

function getAdminToken(env) {
  const secret = typeof env?.ADMIN_SECRET === "string" ? env.ADMIN_SECRET.trim() : "";
  if (secret) return secret;
  const token = typeof env?.ADMIN_TOKEN === "string" ? env.ADMIN_TOKEN.trim() : "";
  return token || null;
}

function extractAdminToken(request) {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) {
    return { token: queryToken, source: "query" };
  }
  const headerToken = request.headers.get(ADMIN_TOKEN_HEADER);
  if (headerToken) {
    return { token: headerToken, source: "header" };
  }
  const authorization = request.headers.get("Authorization") || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return { token: authorization.slice(7).trim(), source: "header" };
  }
  return { token: null, source: null };
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index++) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function verifyAdminToken(providedToken, expectedToken) {
  if (!providedToken || !expectedToken) return false;
  const [providedHash, expectedHash] = await Promise.all([
    sha256Hex(providedToken),
    sha256Hex(expectedToken)
  ]);
  return constantTimeEqual(providedHash, expectedHash);
}

async function authorizeAdminRequest(request, env) {
  const expectedToken = getAdminToken(env);
  if (!expectedToken) {
    return { configured: false, authorized: false, source: null };
  }
  const { token, source } = extractAdminToken(request);
  const authorized = await verifyAdminToken(token, expectedToken);
  return { configured: true, authorized, source: authorized ? source : null };
}

function adminJson(data, init = {}, baseHeaders = {}) {
  return Response.json(data, {
    ...init,
    headers: {
      ...baseHeaders,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      ...(init.headers || {})
    }
  });
}

function adminHtml(html, init = {}, baseHeaders = {}) {
  return new Response(html, {
    ...init,
    headers: {
      ...baseHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      ...(init.headers || {})
    }
  });
}

function clampLimit(value, fallback, max) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return EMAIL_RE.test(email) && email.length <= 254 ? email : null;
}

function emptyModeration() {
  return { hidden: [], featured: [] };
}

function sanitizeIdList(ids, max) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(isValidRoastIdLoose))].slice(0, max);
}

async function getModerationState(env) {
  try {
    const raw = await env.CONFIG?.get(MODERATION_KV_KEY);
    if (!raw) return emptyModeration();
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      hidden: sanitizeIdList(parsed?.hidden, MAX_HIDDEN),
      featured: sanitizeIdList(parsed?.featured, MAX_FEATURED)
    };
  } catch {
    return emptyModeration();
  }
}

async function saveModerationState(env, state) {
  if (!env.CONFIG?.put) {
    throw new Error("KV CONFIG binding is required for gallery moderation");
  }
  const next = {
    hidden: sanitizeIdList(state.hidden, MAX_HIDDEN),
    featured: sanitizeIdList(state.featured, MAX_FEATURED)
  };
  await env.CONFIG.put(MODERATION_KV_KEY, JSON.stringify(next));
  return next;
}

async function getHiddenRoastIds(env) {
  return (await getModerationState(env)).hidden;
}

async function getFeaturedRoastIds(env) {
  return (await getModerationState(env)).featured;
}

function roastIdExclusion(ids, column = "id") {
  const safe = sanitizeIdList(ids, MAX_HIDDEN);
  if (!safe.length) return { sql: "1=1", params: [] };
  return {
    sql: `${column} NOT IN (${safe.map(() => "?").join(",")})`,
    params: safe
  };
}

function filterHiddenRoasts(rows = [], hiddenIds = []) {
  if (!hiddenIds.length) return rows;
  const hidden = new Set(hiddenIds);
  return rows.filter((row) => !hidden.has(row.id));
}

const OPT_OUT_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS email_opt_outs (
    email TEXT PRIMARY KEY,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`;

async function ensureOptOutTable(env) {
  await env.DB.prepare(OPT_OUT_TABLE_SQL).run();
}

async function isEmailOptedOut(env, email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  try {
    const row = await env.DB.prepare(
      "SELECT email FROM email_opt_outs WHERE email = ?"
    ).bind(normalized).first();
    return Boolean(row?.email);
  } catch {
    return false;
  }
}

async function getAdminStats(env) {
  const hiddenIds = await getHiddenRoastIds(env);
  const hidden = roastIdExclusion(hiddenIds);
  const [
    stats,
    industryRows,
    countryRows,
    monthlyRows,
    recentRows,
    subscriberCount,
    feedbackCount
  ] = await Promise.all([
    env.DB.prepare(`
      SELECT
        COUNT(*) AS total_roasts,
        SUM(CASE WHEN created_at > datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS roasts_24h,
        SUM(CASE WHEN created_at > datetime('now', '-7 days') THEN 1 ELSE 0 END) AS roasts_7d,
        SUM(CASE WHEN created_at > datetime('now', '-30 days') THEN 1 ELSE 0 END) AS roasts_30d,
        COUNT(DISTINCT CASE WHEN created_at > datetime('now', '-30 days') THEN url_hash END) AS unique_sites_30d,
        AVG(overall_score) AS avg_score,
        MIN(overall_score) AS min_score,
        MAX(overall_score) AS max_score,
        MAX(created_at) AS last_roast
      FROM roasts
    `).first(),
    env.DB.prepare(`
      SELECT industry, COUNT(*) AS count, AVG(overall_score) AS avg_score
      FROM roasts
      GROUP BY industry
      ORDER BY count DESC
      LIMIT 10
    `).all(),
    env.DB.prepare(`
      SELECT country, COUNT(*) AS count
      FROM roasts
      WHERE created_at > datetime('now', '-30 days')
        AND country IS NOT NULL AND country != '' AND country != 'XX'
      GROUP BY country
      ORDER BY count DESC
      LIMIT 10
    `).all(),
    env.DB.prepare(`
      SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
      FROM roasts
      WHERE created_at > datetime('now', '-12 months')
      GROUP BY month
      ORDER BY month ASC
    `).all(),
    env.DB.prepare(`
      SELECT id, url, overall_score, industry, country, created_at
      FROM roasts
      WHERE ${hidden.sql}
      ORDER BY created_at DESC
      LIMIT 12
    `).bind(...hidden.params).all(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM email_subscribers").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM feedback").first()
  ]);

  const monthly = (monthlyRows.results || []).map((row) => ({
    month: row.month,
    count: Number(row.count || 0)
  }));
  const maxMonth = monthly.reduce((max, row) => Math.max(max, row.count), 0);

  return {
    stats: {
      totalRoasts: Number(stats?.total_roasts || 0),
      roasts24h: Number(stats?.roasts_24h || 0),
      roasts7d: Number(stats?.roasts_7d || 0),
      mau: Number(stats?.roasts_30d || 0),
      uniqueSites30d: Number(stats?.unique_sites_30d || 0),
      avgScore: stats?.avg_score == null ? null : Number(Number(stats.avg_score).toFixed(2)),
      minScore: stats?.min_score == null ? null : Number(stats.min_score),
      maxScore: stats?.max_score == null ? null : Number(stats.max_score),
      lastRoast: stats?.last_roast || null,
      subscribers: Number(subscriberCount?.total || 0),
      feedback: Number(feedbackCount?.total || 0),
      hiddenCount: hiddenIds.length
    },
    industries: (industryRows.results || []).map((row) => ({
      industry: row.industry || "other",
      count: Number(row.count || 0),
      avgScore: row.avg_score == null ? null : Number(Number(row.avg_score).toFixed(2))
    })),
    topCountries: (countryRows.results || []).map((row) => ({
      country: row.country,
      count: Number(row.count || 0)
    })),
    monthlyTrend: monthly.map((row) => ({
      ...row,
      pct: maxMonth > 0 ? Math.round((row.count / maxMonth) * 100) : 0
    })),
    recentRoasts: (recentRows.results || []).map((row) => ({
      id: row.id,
      url: row.url,
      overallScore: row.overall_score,
      industry: row.industry || "other",
      country: row.country || null,
      createdAt: row.created_at
    }))
  };
}

async function getRecentFeedback(env, limit) {
  const rows = await env.DB.prepare(`
    SELECT id, vote, context, reasons, message, email, roast_id, url, country, created_at
    FROM feedback
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(limit).all();

  return {
    feedback: (rows.results || []).map((row) => ({
      id: row.id,
      vote: row.vote,
      context: row.context,
      reasons: row.reasons || "",
      message: row.message || "",
      email: row.email || "",
      roastId: row.roast_id || null,
      url: row.url || null,
      country: row.country || null,
      createdAt: row.created_at
    }))
  };
}

async function getSubscribers(env, limit) {
  const [countRow, rows] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM email_subscribers").first(),
    env.DB.prepare(`
      SELECT id, email, roast_id, created_at
      FROM email_subscribers
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(limit).all()
  ]);
  const total = Number(countRow?.total || 0);
  const subscribers = (rows.results || []).map((row) => ({
    id: row.id,
    email: row.email,
    roastId: row.roast_id || null,
    createdAt: row.created_at
  }));

  return {
    total,
    limit,
    truncated: total > subscribers.length,
    subscribers
  };
}

async function getGallery(env, limit) {
  const moderation = await getModerationState(env);
  const hidden = new Set(moderation.hidden);
  const featured = new Set(moderation.featured);
  const rows = await env.DB.prepare(`
    SELECT id, url, overall_score, industry, country, created_at
    FROM roasts
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(limit).all();

  return {
    hidden: moderation.hidden,
    featured: moderation.featured,
    roasts: (rows.results || []).map((row) => ({
      id: row.id,
      url: row.url,
      overallScore: row.overall_score,
      industry: row.industry || "other",
      country: row.country || null,
      createdAt: row.created_at,
      hidden: hidden.has(row.id),
      featured: featured.has(row.id)
    }))
  };
}

async function getRateLimits(env, limit) {
  const [limits, counters] = await Promise.all([
    env.DB.prepare(`
      SELECT ip_hash, request_count, window_start, last_request
      FROM rate_limits
      ORDER BY last_request DESC
      LIMIT ?
    `).bind(limit).all(),
    env.DB.prepare(`
      SELECT day_key, ip_hash, request_count, updated_at
      FROM api_v1_counters
      ORDER BY updated_at DESC
      LIMIT ?
    `).bind(limit).all()
  ]);

  return {
    rateLimits: (limits.results || []).map((row) => ({
      ipHash: row.ip_hash,
      requestCount: Number(row.request_count || 0),
      windowStart: row.window_start || null,
      lastRequest: row.last_request || null
    })),
    apiV1Counters: (counters.results || []).map((row) => ({
      dayKey: row.day_key,
      ipHash: row.ip_hash,
      requestCount: Number(row.request_count || 0),
      updatedAt: row.updated_at || null
    }))
  };
}

async function getOptOuts(env, limit) {
  await ensureOptOutTable(env);
  const [countRow, rows] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM email_opt_outs").first(),
    env.DB.prepare(`
      SELECT email, reason, created_at
      FROM email_opt_outs
      ORDER BY created_at DESC
      LIMIT ?
    `).bind(limit).all()
  ]);
  const total = Number(countRow?.total || 0);
  const optOuts = (rows.results || []).map((row) => ({
    email: row.email,
    reason: row.reason || "",
    createdAt: row.created_at || null
  }));

  return {
    exists: true,
    table: "email_opt_outs",
    total,
    limit,
    truncated: total > optOuts.length,
    optOuts
  };
}

async function moderateGallery(env, body) {
  const id = isValidRoastIdLoose(body?.id) ? body.id : null;
  const action = String(body?.action || "").toLowerCase();
  if (!id) {
    return { error: "Valid roast id required", status: 400 };
  }
  if (!["hide", "show", "feature", "unfeature"].includes(action)) {
    return { error: "Action must be hide, show, feature, or unfeature", status: 400 };
  }

  const roast = await env.DB.prepare("SELECT id FROM roasts WHERE id = ?").bind(id).first();
  if (!roast?.id) {
    return { error: "Roast not found", status: 404 };
  }

  const state = await getModerationState(env);
  if (action === "hide") {
    state.hidden = [...state.hidden, id];
  } else if (action === "show") {
    state.hidden = state.hidden.filter((value) => value !== id);
  } else if (action === "feature") {
    state.featured = [...state.featured, id];
    state.hidden = state.hidden.filter((value) => value !== id);
  } else if (action === "unfeature") {
    state.featured = state.featured.filter((value) => value !== id);
  }

  const next = await saveModerationState(env, state);
  return { ok: true, id, action, hidden: next.hidden, featured: next.featured };
}

async function handleOptOutMutation(env, body) {
  const email = normalizeEmail(body?.email);
  const action = String(body?.action || "add").toLowerCase();
  const reason = String(body?.reason || "admin").slice(0, 120);
  if (!email) {
    return { error: "Valid email required", status: 400 };
  }

  await ensureOptOutTable(env);

  if (action === "remove") {
    await env.DB.prepare("DELETE FROM email_opt_outs WHERE email = ?").bind(email).run();
    return { ok: true, email, action: "remove" };
  }

  await env.DB.prepare(`
    INSERT OR REPLACE INTO email_opt_outs (email, reason, created_at)
    VALUES (?, ?, datetime('now'))
  `).bind(email, reason).run();
  await env.DB.prepare("DELETE FROM email_subscribers WHERE email = ?").bind(email).run();
  return { ok: true, email, action: "add", id: generateId() };
}

async function handleRateLimitMutation(env, body) {
  const action = String(body?.action || "reset").toLowerCase();
  const ipHash = String(body?.ipHash || "").trim();
  if (action !== "reset") {
    return { error: "Action must be reset", status: 400 };
  }
  if (!/^[a-f0-9]{8,64}$/i.test(ipHash)) {
    return { error: "Valid ipHash required", status: 400 };
  }
  await Promise.all([
    env.DB.prepare("DELETE FROM rate_limits WHERE ip_hash = ?").bind(ipHash).run(),
    env.DB.prepare("DELETE FROM api_v1_counters WHERE ip_hash = ?").bind(ipHash).run()
  ]);
  return { ok: true, ipHash, action: "reset" };
}

async function handleAdminApiRequest(request, env, baseHeaders = {}) {
  const auth = await authorizeAdminRequest(request, env);
  if (!auth.configured) {
    return adminJson({ error: "Admin dashboard not configured" }, { status: 503 }, baseHeaders);
  }
  if (!auth.authorized) {
    return adminJson({ error: "Unauthorized" }, { status: 401 }, baseHeaders);
  }

  const url = new URL(request.url);
  const limit = clampLimit(url.searchParams.get("limit"), 50, 100);

  try {
    if (request.method === "GET") {
      if (url.pathname === "/api/admin/stats") {
        return adminJson(await getAdminStats(env), {}, baseHeaders);
      }
      if (url.pathname === "/api/admin/feedback") {
        return adminJson(await getRecentFeedback(env, limit), {}, baseHeaders);
      }
      if (url.pathname === "/api/admin/subscribers") {
        return adminJson(await getSubscribers(env, limit), {}, baseHeaders);
      }
      if (url.pathname === "/api/admin/gallery") {
        return adminJson(await getGallery(env, limit), {}, baseHeaders);
      }
      if (url.pathname === "/api/admin/rate-limits") {
        return adminJson(await getRateLimits(env, limit), {}, baseHeaders);
      }
      if (url.pathname === "/api/admin/opt-outs") {
        return adminJson(await getOptOuts(env, limit), {}, baseHeaders);
      }
      return adminJson({ error: "Not found" }, { status: 404 }, baseHeaders);
    }

    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      let result;
      if (url.pathname === "/api/admin/gallery") {
        result = await moderateGallery(env, body);
      } else if (url.pathname === "/api/admin/opt-outs") {
        result = await handleOptOutMutation(env, body);
      } else if (url.pathname === "/api/admin/rate-limits") {
        result = await handleRateLimitMutation(env, body);
      } else {
        return adminJson({ error: "Not found" }, { status: 404 }, baseHeaders);
      }
      if (result.error) {
        return adminJson({ error: result.error }, { status: result.status || 400 }, baseHeaders);
      }
      return adminJson(result, {}, baseHeaders);
    }

    return adminJson({ error: "Method not allowed" }, {
      status: 405,
      headers: { Allow: "GET, POST" }
    }, baseHeaders);
  } catch (error) {
    console.error("Admin API error:", error?.message || error);
    return adminJson({ error: "Admin request failed" }, { status: 500 }, baseHeaders);
  }
}

function renderAdminNotConfigured(baseHeaders) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Admin — not configured</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"><\/script>
<style>
  body { background:#0A0908; color:#F5F0E8; font-family:'DM Sans',system-ui,sans-serif; }
  h1 { font-family:'Syne',system-ui,sans-serif; }
</style>
</head>
<body class="min-h-screen flex items-center justify-center p-6">
  <div class="max-w-lg text-center">
    <div class="text-4xl mb-4">🔒</div>
    <h1 class="text-2xl font-bold mb-2">Admin dashboard not configured</h1>
    <p class="text-sm text-[#a1a1a6] mb-6">Set the <code class="text-[#FF6B35]">ADMIN_SECRET</code> worker secret, then reload this page.</p>
    <pre class="text-left text-xs bg-white/[0.04] border border-white/[0.08] rounded-xl p-4 overflow-x-auto text-[#d1d1d6]">npx wrangler secret put ADMIN_SECRET
npx wrangler secret put ADMIN_SECRET --env production</pre>
    <a href="/" class="inline-block mt-6 text-sm text-[#6e6e73] hover:text-[#FF6B35]">Back to site</a>
  </div>
</body>
</html>`;
  return adminHtml(html, { status: 503 }, baseHeaders);
}

function renderAdminDashboard({ queryTokenPresent }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Admin — Roast My Landing Page</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230A0908'/%3E%3Cpath d='M16 6c2 4 7 6 7 12a7 7 0 1 1-14 0c0-3 2-5 3-7 1 2 2 3 4 3 0-3 0-5 0-8z' fill='%23E85D04'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">
<script src="https://cdn.tailwindcss.com"><\/script>
<style>
  :root { --ink:#0A0908; --cream:#F5F0E8; --ember:#E85D04; }
  body { background:var(--ink); color:var(--cream); font-family:'DM Sans',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }
  body::before { content:''; position:fixed; inset:0; z-index:0; pointer-events:none;
    background: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(232,93,4,0.12) 0%, transparent 55%),
      linear-gradient(180deg,#0A0908 0%,#12100E 55%,#0A0908 100%); }
  body > * { position:relative; z-index:1; }
  h1,h2,h3,.font-display { font-family:'Syne',system-ui,sans-serif; letter-spacing:-0.02em; }
  .card { background:rgba(245,240,232,0.035); border:1px solid rgba(245,240,232,0.08); border-radius:16px; }
  .tab-btn { padding:8px 14px; border-radius:8px; font-size:13px; color:rgba(245,240,232,0.5); cursor:pointer; background:rgba(245,240,232,0.03); border:1px solid transparent; }
  .tab-btn:hover { color:var(--cream); background:rgba(245,240,232,0.06); }
  .tab-btn.active { color:var(--ink); background:var(--ember); font-weight:600; }
  .tab-panel { display:none; }
  .tab-panel.active { display:block; }
  .hidden { display:none !important; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:#6e6e73; font-weight:600; padding:8px 10px; border-bottom:1px solid rgba(245,240,232,0.08); }
  td { padding:8px 10px; border-bottom:1px solid rgba(245,240,232,0.04); vertical-align:top; word-break:break-word; }
  .btn { font-size:12px; padding:6px 10px; border-radius:8px; border:1px solid rgba(245,240,232,0.12); background:rgba(245,240,232,0.04); color:var(--cream); cursor:pointer; }
  .btn:hover { border-color:rgba(232,93,4,0.5); color:#FF6B35; }
  .btn-primary { background:var(--ember); color:var(--ink); border-color:transparent; font-weight:600; }
  .chip { display:inline-block; font-size:11px; padding:2px 8px; border-radius:999px; background:rgba(245,240,232,0.06); }
  .chip-hot { background:rgba(232,93,4,0.18); color:#FF6B35; }
  .chip-mute { background:rgba(239,68,68,0.12); color:#f87171; }
  .bar { height:8px; border-radius:999px; background:rgba(245,240,232,0.08); overflow:hidden; }
  .bar > span { display:block; height:100%; background:var(--ember); }
  a { color:#FF6B35; }
</style>
</head>
<body class="min-h-screen">
<nav class="px-4 py-4">
  <div class="max-w-6xl mx-auto flex justify-between items-center bg-black/60 backdrop-blur-xl border border-white/[0.06] rounded-2xl px-5 py-3">
    <div class="flex items-center gap-2">
      <span class="text-xl">🔥</span>
      <span class="font-semibold text-sm">Admin</span>
    </div>
    <div class="flex items-center gap-2">
      <button id="refresh" class="btn hidden" type="button">Refresh</button>
      <button id="logout" class="btn hidden" type="button">Log out</button>
      <a href="/" class="text-sm text-white/50 hover:text-white/90 px-3 py-1.5">Site</a>
    </div>
  </div>
</nav>

<main class="max-w-6xl mx-auto px-4 pb-16">
  <section id="login" class="card p-8 max-w-md mx-auto mt-10">
    <h1 class="text-2xl font-bold mb-2">Sign in</h1>
    <p class="text-sm text-[#a1a1a6] mb-6">Enter the admin token. It is checked server-side and stored only in this browser's session.</p>
    <form id="login-form" class="space-y-4">
      <input id="token-input" type="password" autocomplete="current-password" placeholder="ADMIN_SECRET" class="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] outline-none focus:border-[#E85D04]">
      <button class="btn btn-primary w-full py-3" type="submit">Open dashboard</button>
      <p id="login-error" class="text-sm text-red-400"></p>
    </form>
  </section>

  <section id="dashboard" class="hidden space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-3xl font-bold">Dashboard</h1>
        <p id="last-roast" class="text-sm text-[#6e6e73] mt-1"></p>
      </div>
      <div id="tabs" class="flex flex-wrap gap-2">
        <button class="tab-btn active" data-tab="overview" type="button">Overview</button>
        <button class="tab-btn" data-tab="feedback" type="button">Feedback</button>
        <button class="tab-btn" data-tab="subscribers" type="button">Subscribers</button>
        <button class="tab-btn" data-tab="gallery" type="button">Gallery</button>
        <button class="tab-btn" data-tab="limits" type="button">Rate limits</button>
        <button class="tab-btn" data-tab="optouts" type="button">Opt-outs</button>
      </div>
    </div>

    <div id="tab-overview" class="tab-panel active space-y-6">
      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="card p-4"><div class="text-xs text-[#6e6e73]">Total roasts</div><div id="total-roasts" class="text-2xl font-bold">—</div></div>
        <div class="card p-4"><div class="text-xs text-[#6e6e73]">MAU (30d roasts)</div><div id="mau" class="text-2xl font-bold">—</div></div>
        <div class="card p-4"><div class="text-xs text-[#6e6e73]">Unique sites (30d)</div><div id="unique-sites" class="text-2xl font-bold">—</div></div>
        <div class="card p-4"><div class="text-xs text-[#6e6e73]">Avg score</div><div id="avg-score" class="text-2xl font-bold">—</div></div>
        <div class="card p-4"><div class="text-xs text-[#6e6e73]">Last 24h</div><div id="roasts-24h" class="text-2xl font-bold">—</div></div>
        <div class="card p-4"><div class="text-xs text-[#6e6e73]">Last 7d</div><div id="roasts-7d" class="text-2xl font-bold">—</div></div>
        <div class="card p-4"><div class="text-xs text-[#6e6e73]">Subscribers</div><div id="stat-subs" class="text-2xl font-bold">—</div></div>
        <div class="card p-4"><div class="text-xs text-[#6e6e73]">Feedback</div><div id="stat-feedback" class="text-2xl font-bold">—</div></div>
      </div>
      <div class="grid md:grid-cols-2 gap-4">
        <div class="card p-5">
          <h2 class="font-semibold mb-4">Monthly trend</h2>
          <div id="monthly-trend" class="space-y-2 text-sm"></div>
        </div>
        <div class="card p-5">
          <h2 class="font-semibold mb-4">Top countries (30d)</h2>
          <div id="top-countries" class="space-y-2 text-sm"></div>
        </div>
      </div>
      <div class="card p-5 overflow-x-auto">
        <h2 class="font-semibold mb-3">Recent roasts</h2>
        <table><thead><tr><th>ID</th><th>URL</th><th>Score</th><th>Industry</th><th>Country</th><th>When</th></tr></thead><tbody id="recent-roasts"></tbody></table>
      </div>
    </div>

    <div id="tab-feedback" class="tab-panel card p-5 overflow-x-auto">
      <table><thead><tr><th>Vote</th><th>Context</th><th>Message</th><th>Email</th><th>Roast</th><th>When</th></tr></thead><tbody id="feedback"></tbody></table>
    </div>

    <div id="tab-subscribers" class="tab-panel card p-5 overflow-x-auto">
      <div class="flex justify-between mb-3 text-sm text-[#a1a1a6]"><span id="subscriber-count"></span></div>
      <table><thead><tr><th>Email</th><th>Roast</th><th>When</th><th></th></tr></thead><tbody id="subscribers"></tbody></table>
    </div>

    <div id="tab-gallery" class="tab-panel card p-5 overflow-x-auto">
      <p class="text-sm text-[#a1a1a6] mb-3">Hide entries from the public gallery, or pin them to <code>/api/featured</code>.</p>
      <table><thead><tr><th>ID</th><th>URL</th><th>Score</th><th>Flags</th><th>When</th><th></th></tr></thead><tbody id="gallery"></tbody></table>
    </div>

    <div id="tab-limits" class="tab-panel space-y-4">
      <div class="card p-5 overflow-x-auto">
        <h2 class="font-semibold mb-3">Per-IP roast windows</h2>
        <table><thead><tr><th>IP hash</th><th>Count</th><th>Window</th><th>Last</th><th></th></tr></thead><tbody id="rate-limits"></tbody></table>
      </div>
      <div class="card p-5 overflow-x-auto">
        <h2 class="font-semibold mb-3">API v1 daily counters</h2>
        <table><thead><tr><th>Day</th><th>IP hash</th><th>Count</th><th>Updated</th></tr></thead><tbody id="api-counters"></tbody></table>
      </div>
    </div>

    <div id="tab-optouts" class="tab-panel card p-5">
      <form id="optout-form" class="flex flex-wrap gap-2 mb-4">
        <input id="optout-email" type="email" placeholder="email@example.com" class="flex-1 min-w-[200px] px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08]">
        <input id="optout-reason" type="text" placeholder="Reason" class="w-40 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08]">
        <button class="btn btn-primary" type="submit">Add opt-out</button>
      </form>
      <p id="opt-out-count" class="text-sm text-[#a1a1a6] mb-3"></p>
      <div class="overflow-x-auto">
        <table><thead><tr><th>Email</th><th>Reason</th><th>When</th><th></th></tr></thead><tbody id="opt-outs"></tbody></table>
      </div>
    </div>
  </section>
</main>

<script>
const TOKEN_KEY = "admin_token";
const login = document.getElementById("login");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("login-form");
const tokenInput = document.getElementById("token-input");
const loginError = document.getElementById("login-error");
const queryTokenPresent = ${queryTokenPresent ? "true" : "false"};

function text(value) {
  return value == null || value === "" ? "—" : String(value);
}
function dateText(value) {
  if (!value) return "—";
  const iso = /Z$|[+-]\\d\\d:\\d\\d$/.test(value) ? value : value + "Z";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function hostname(url) {
  try { return new URL(url).hostname.replace(/^www\\./, ""); } catch { return url || "—"; }
}
function tokenHeaders() {
  return { "X-Admin-Token": sessionStorage.getItem(TOKEN_KEY) || "", "Content-Type": "application/json" };
}
async function fetchAdmin(path, options) {
  const response = await fetch(path, { ...options, headers: { ...tokenHeaders(), ...(options && options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}
function setRows(id, rows, columns) {
  const tbody = document.getElementById(id);
  tbody.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length;
    td.className = "text-[#6e6e73]";
    td.textContent = "No rows";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of columns) {
      const td = document.createElement("td");
      if (column.node) {
        td.appendChild(column.node(row));
      } else {
        const value = column.format ? column.format(row[column.key], row) : row[column.key];
        if (column.link && value && row[column.link]) {
          const a = document.createElement("a");
          a.href = row[column.link];
          a.target = "_blank";
          a.rel = "noopener";
          a.textContent = text(value);
          td.appendChild(a);
        } else {
          td.textContent = text(value);
        }
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}
function actionButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}
function actionGroup(buttons) {
  const wrap = document.createElement("div");
  wrap.className = "flex flex-wrap gap-1";
  for (const button of buttons) wrap.appendChild(button);
  return wrap;
}
function showBars(id, items, labelKey, countKey) {
  const root = document.getElementById(id);
  root.replaceChildren();
  if (!items.length) {
    root.textContent = "No data yet";
    root.className = "text-sm text-[#6e6e73]";
    return;
  }
  const max = items.reduce((n, item) => Math.max(n, Number(item[countKey] || 0)), 0);
  for (const item of items) {
    const row = document.createElement("div");
    const head = document.createElement("div");
    head.className = "flex justify-between mb-1";
    const label = document.createElement("span");
    label.textContent = item[labelKey] || "unknown";
    const count = document.createElement("span");
    count.className = "text-[#6e6e73]";
    count.textContent = String(item[countKey] || 0);
    head.append(label, count);
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("span");
    fill.style.width = (max ? Math.round((Number(item[countKey] || 0) / max) * 100) : 0) + "%";
    bar.appendChild(fill);
    row.append(head, bar);
    root.appendChild(row);
  }
}

async function mutate(path, payload) {
  await fetchAdmin(path, { method: "POST", body: JSON.stringify(payload) });
  await loadDashboard();
}

async function loadDashboard() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) {
    dashboard.classList.add("hidden");
    login.classList.remove("hidden");
    document.getElementById("refresh").classList.add("hidden");
    document.getElementById("logout").classList.add("hidden");
    return;
  }
  login.classList.add("hidden");
  dashboard.classList.remove("hidden");
  document.getElementById("refresh").classList.remove("hidden");
  document.getElementById("logout").classList.remove("hidden");
  loginError.textContent = "";

  try {
    const [stats, feedback, subscribers, gallery, limits, optOuts] = await Promise.all([
      fetchAdmin("/api/admin/stats"),
      fetchAdmin("/api/admin/feedback?limit=50"),
      fetchAdmin("/api/admin/subscribers?limit=50"),
      fetchAdmin("/api/admin/gallery?limit=50"),
      fetchAdmin("/api/admin/rate-limits?limit=50"),
      fetchAdmin("/api/admin/opt-outs?limit=50")
    ]);

    document.getElementById("total-roasts").textContent = stats.stats.totalRoasts;
    document.getElementById("mau").textContent = stats.stats.mau;
    document.getElementById("unique-sites").textContent = stats.stats.uniqueSites30d;
    document.getElementById("avg-score").textContent = stats.stats.avgScore ?? "—";
    document.getElementById("roasts-24h").textContent = stats.stats.roasts24h;
    document.getElementById("roasts-7d").textContent = stats.stats.roasts7d;
    document.getElementById("stat-subs").textContent = stats.stats.subscribers;
    document.getElementById("stat-feedback").textContent = stats.stats.feedback;
    document.getElementById("last-roast").textContent = stats.stats.lastRoast ? "Last roast " + dateText(stats.stats.lastRoast) : "";

    showBars("monthly-trend", stats.monthlyTrend || [], "month", "count");
    showBars("top-countries", stats.topCountries || [], "country", "count");

    setRows("recent-roasts", stats.recentRoasts || [], [
      { key: "id" },
      { key: "url", format: hostname, link: "url" },
      { key: "overallScore" },
      { key: "industry" },
      { key: "country" },
      { key: "createdAt", format: dateText }
    ]);
    setRows("feedback", feedback.feedback || [], [
      { key: "vote" },
      { key: "context" },
      { key: "message" },
      { key: "email" },
      { key: "roastId" },
      { key: "createdAt", format: dateText }
    ]);

    document.getElementById("subscriber-count").textContent = subscribers.total + " total" + (subscribers.truncated ? " (showing latest " + subscribers.subscribers.length + ")" : "");
    setRows("subscribers", subscribers.subscribers || [], [
      { key: "email" },
      { key: "roastId" },
      { key: "createdAt", format: dateText },
      { node: (row) => actionButton("Opt out", () => mutate("/api/admin/opt-outs", { email: row.email, reason: "admin-subscriber" })) }
    ]);

    setRows("gallery", gallery.roasts || [], [
      { node: (row) => { const a = document.createElement("a"); a.href = "/roast/" + row.id; a.textContent = row.id; return a; } },
      { key: "url", format: hostname, link: "url" },
      { key: "overallScore" },
      { node: (row) => {
        const wrap = document.createElement("div");
        wrap.className = "flex gap-1";
        if (row.featured) { const chip = document.createElement("span"); chip.className = "chip chip-hot"; chip.textContent = "featured"; wrap.appendChild(chip); }
        if (row.hidden) { const chip = document.createElement("span"); chip.className = "chip chip-mute"; chip.textContent = "hidden"; wrap.appendChild(chip); }
        if (!row.featured && !row.hidden) wrap.textContent = "—";
        return wrap;
      } },
      { key: "createdAt", format: dateText },
      { node: (row) => actionGroup([
        actionButton(row.hidden ? "Show" : "Hide", () => mutate("/api/admin/gallery", { id: row.id, action: row.hidden ? "show" : "hide" })),
        actionButton(row.featured ? "Unfeature" : "Feature", () => mutate("/api/admin/gallery", { id: row.id, action: row.featured ? "unfeature" : "feature" }))
      ]) }
    ]);

    setRows("rate-limits", limits.rateLimits || [], [
      { key: "ipHash" },
      { key: "requestCount" },
      { key: "windowStart", format: dateText },
      { key: "lastRequest", format: dateText },
      { node: (row) => actionButton("Reset", () => mutate("/api/admin/rate-limits", { ipHash: row.ipHash, action: "reset" })) }
    ]);
    setRows("api-counters", limits.apiV1Counters || [], [
      { key: "dayKey" },
      { key: "ipHash" },
      { key: "requestCount" },
      { key: "updatedAt", format: dateText }
    ]);

    document.getElementById("opt-out-count").textContent = optOuts.total + " total";
    setRows("opt-outs", optOuts.optOuts || [], [
      { key: "email" },
      { key: "reason" },
      { key: "createdAt", format: dateText },
      { node: (row) => actionButton("Remove", () => mutate("/api/admin/opt-outs", { email: row.email, action: "remove" })) }
    ]);
  } catch (error) {
    sessionStorage.removeItem(TOKEN_KEY);
    dashboard.classList.add("hidden");
    login.classList.remove("hidden");
    document.getElementById("refresh").classList.add("hidden");
    document.getElementById("logout").classList.add("hidden");
    loginError.textContent = error.message === "Unauthorized" ? "Invalid admin token." : error.message;
  }
}

document.getElementById("tabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-tab]");
  if (!button) return;
  document.querySelectorAll(".tab-btn").forEach((el) => el.classList.toggle("active", el === button));
  document.querySelectorAll(".tab-panel").forEach((el) => el.classList.toggle("active", el.id === "tab-" + button.dataset.tab));
});

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();
  if (!token) {
    loginError.textContent = "Enter the admin token.";
    return;
  }
  sessionStorage.setItem(TOKEN_KEY, token);
  loadDashboard();
});

document.getElementById("optout-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.getElementById("optout-email").value.trim();
  const reason = document.getElementById("optout-reason").value.trim();
  if (!email) return;
  await mutate("/api/admin/opt-outs", { email, reason });
  document.getElementById("optout-email").value = "";
  document.getElementById("optout-reason").value = "";
});

document.getElementById("refresh").addEventListener("click", loadDashboard);
document.getElementById("logout").addEventListener("click", () => {
  sessionStorage.removeItem(TOKEN_KEY);
  loadDashboard();
});

if (queryTokenPresent) {
  const params = new URLSearchParams(location.search);
  const token = params.get("token");
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
    params.delete("token");
    const next = location.pathname + (params.toString() ? "?" + params.toString() : "") + location.hash;
    history.replaceState({}, "", next);
  }
}

loadDashboard();
<\/script>
</body>
</html>`;
}

async function renderAdminPage(request, env, baseHeaders = {}) {
  if (!getAdminToken(env)) {
    return renderAdminNotConfigured(baseHeaders);
  }
  const url = new URL(request.url);
  const html = renderAdminDashboard({
    queryTokenPresent: url.searchParams.has("token")
  });
  return adminHtml(html, {}, baseHeaders);
}

export {
  ADMIN_TOKEN_HEADER,
  MODERATION_KV_KEY,
  OPT_OUT_TABLE_SQL,
  getAdminToken,
  extractAdminToken,
  verifyAdminToken,
  authorizeAdminRequest,
  getModerationState,
  getHiddenRoastIds,
  getFeaturedRoastIds,
  roastIdExclusion,
  filterHiddenRoasts,
  isEmailOptedOut,
  ensureOptOutTable,
  handleAdminApiRequest,
  renderAdminPage
};
