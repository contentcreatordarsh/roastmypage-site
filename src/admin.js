const ADMIN_TOKEN_HEADER = "X-Admin-Token";
const OPT_OUT_TABLE_CANDIDATES = [
  "email_opt_outs",
  "opt_outs",
  "email_optouts",
  "unsubscribes",
  "unsubscribe_events"
];

function getAdminToken(env) {
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
      ...(init.headers || {})
    }
  });
}

function clampLimit(value, fallback, max) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function isSafeSqlIdentifier(identifier) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier);
}

function quoteIdentifier(identifier) {
  if (!isSafeSqlIdentifier(identifier)) {
    throw new Error("Unsafe SQL identifier");
  }
  return `"${identifier}"`;
}

async function getAdminStats(env) {
  const [stats, industryRows, recentRows] = await Promise.all([
    env.DB.prepare(`
      SELECT
        COUNT(*) AS total_roasts,
        SUM(CASE WHEN created_at > datetime('now', '-24 hours') THEN 1 ELSE 0 END) AS roasts_24h,
        SUM(CASE WHEN created_at > datetime('now', '-7 days') THEN 1 ELSE 0 END) AS roasts_7d,
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
      SELECT id, url, overall_score, industry, country, created_at
      FROM roasts
      ORDER BY created_at DESC
      LIMIT 20
    `).all()
  ]);

  return {
    stats: {
      totalRoasts: Number(stats?.total_roasts || 0),
      roasts24h: Number(stats?.roasts_24h || 0),
      roasts7d: Number(stats?.roasts_7d || 0),
      avgScore: stats?.avg_score == null ? null : Number(Number(stats.avg_score).toFixed(2)),
      minScore: stats?.min_score == null ? null : Number(stats.min_score),
      maxScore: stats?.max_score == null ? null : Number(stats.max_score),
      lastRoast: stats?.last_roast || null
    },
    industries: (industryRows.results || []).map((row) => ({
      industry: row.industry || "other",
      count: Number(row.count || 0),
      avgScore: row.avg_score == null ? null : Number(Number(row.avg_score).toFixed(2))
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

async function findExistingOptOutTable(env) {
  for (const tableName of OPT_OUT_TABLE_CANDIDATES) {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).bind(tableName).first();
    if (row?.name === tableName) return tableName;
  }
  return null;
}

async function getOptOutColumns(env, tableName) {
  const pragma = await env.DB.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
  return (pragma.results || [])
    .map((row) => row.name)
    .filter((name) => typeof name === "string" && isSafeSqlIdentifier(name));
}

function firstAvailable(columns, candidates) {
  return candidates.find((candidate) => columns.includes(candidate)) || null;
}

async function getOptOuts(env, limit) {
  const tableName = await findExistingOptOutTable(env);
  if (!tableName) {
    return { exists: false, table: null, total: 0, limit, truncated: false, optOuts: [] };
  }

  const columns = await getOptOutColumns(env, tableName);
  const idColumn = firstAvailable(columns, ["id", "uuid"]);
  const emailColumn = firstAvailable(columns, ["email", "email_address", "email_hash"]);
  const reasonColumn = firstAvailable(columns, ["reason", "source", "context"]);
  const createdColumn = firstAvailable(columns, ["created_at", "opted_out_at", "unsubscribed_at", "updated_at"]);
  const selectColumns = [
    idColumn ? `${quoteIdentifier(idColumn)} AS id` : "NULL AS id",
    emailColumn ? `${quoteIdentifier(emailColumn)} AS email` : "NULL AS email",
    reasonColumn ? `${quoteIdentifier(reasonColumn)} AS reason` : "NULL AS reason",
    createdColumn ? `${quoteIdentifier(createdColumn)} AS created_at` : "NULL AS created_at"
  ];
  const orderClause = createdColumn ? ` ORDER BY ${quoteIdentifier(createdColumn)} DESC` : "";
  const [countRow, rows] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(tableName)}`).first(),
    env.DB.prepare(`
      SELECT ${selectColumns.join(", ")}
      FROM ${quoteIdentifier(tableName)}
      ${orderClause}
      LIMIT ?
    `).bind(limit).all()
  ]);
  const total = Number(countRow?.total || 0);
  const optOuts = (rows.results || []).map((row) => ({
    id: row.id || null,
    email: row.email || "",
    reason: row.reason || "",
    createdAt: row.created_at || null
  }));

  return {
    exists: true,
    table: tableName,
    total,
    limit,
    truncated: total > optOuts.length,
    optOuts
  };
}

async function handleAdminApiRequest(request, env, baseHeaders = {}) {
  const auth = await authorizeAdminRequest(request, env);
  if (!auth.configured) {
    return adminJson({ error: "Admin dashboard not configured" }, { status: 503 }, baseHeaders);
  }
  if (!auth.authorized) {
    return adminJson({ error: "Unauthorized" }, { status: 401 }, baseHeaders);
  }
  if (request.method !== "GET") {
    return adminJson({ error: "Method not allowed" }, { status: 405, headers: { Allow: "GET" } }, baseHeaders);
  }

  const url = new URL(request.url);
  const limit = clampLimit(url.searchParams.get("limit"), 50, 100);

  try {
    if (url.pathname === "/api/admin/stats") {
      return adminJson(await getAdminStats(env), {}, baseHeaders);
    }
    if (url.pathname === "/api/admin/feedback") {
      return adminJson(await getRecentFeedback(env, limit), {}, baseHeaders);
    }
    if (url.pathname === "/api/admin/subscribers") {
      return adminJson(await getSubscribers(env, limit), {}, baseHeaders);
    }
    if (url.pathname === "/api/admin/opt-outs") {
      return adminJson(await getOptOuts(env, limit), {}, baseHeaders);
    }
    return adminJson({ error: "Admin endpoint not found" }, { status: 404 }, baseHeaders);
  } catch (error) {
    console.error("Admin API error:", error);
    return adminJson({ error: "Failed to load admin data" }, { status: 500 }, baseHeaders);
  }
}

function renderAdminNotConfigured(baseHeaders = {}) {
  return adminHtml(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Not Configured</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0A0908; color: #F5F0E8; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 560px; padding: 32px; border: 1px solid rgba(245,240,232,0.12); border-radius: 20px; background: rgba(245,240,232,0.04); }
  h1 { margin: 0 0 12px; font-size: 28px; }
  p { margin: 0; color: #a1a1a6; line-height: 1.6; }
</style>
</head>
<body>
  <main>
    <h1>Admin dashboard not configured</h1>
    <p>Set ADMIN_TOKEN to enable the read-only admin dashboard.</p>
  </main>
</body>
</html>`, {}, baseHeaders);
}

function renderAdminDashboard(auth) {
  const queryTokenAccepted = auth.authorized && auth.source === "query";
  const queryTokenRejected = !auth.authorized && auth.queryTokenPresent;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Dashboard | Roast My Landing Page</title>
<style>
  :root { color-scheme: dark; --bg: #0A0908; --panel: rgba(245,240,232,0.045); --line: rgba(245,240,232,0.1); --text: #F5F0E8; --muted: #a1a1a6; --ember: #E85D04; }
  * { box-sizing: border-box; }
  body { margin: 0; background: radial-gradient(circle at 30% -10%, rgba(232,93,4,0.2), transparent 32%), var(--bg); color: var(--text); font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 56px; }
  header { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 24px; }
  h1, h2 { margin: 0; letter-spacing: -0.03em; }
  p { color: var(--muted); }
  a { color: inherit; }
  button, input { font: inherit; }
  .card { border: 1px solid var(--line); border-radius: 18px; background: var(--panel); box-shadow: 0 18px 70px rgba(0,0,0,0.24); }
  .login { max-width: 480px; margin: 12vh auto; padding: 28px; }
  .row { display: flex; gap: 10px; }
  input { width: 100%; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; background: rgba(0,0,0,0.22); color: var(--text); }
  button { border: 0; border-radius: 12px; padding: 12px 16px; background: var(--ember); color: #120904; font-weight: 700; cursor: pointer; }
  button.secondary { background: rgba(245,240,232,0.08); color: var(--text); border: 1px solid var(--line); }
  .hidden { display: none !important; }
  .error { color: #fca5a5; min-height: 20px; }
  .muted { color: var(--muted); }
  .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
  .metric { padding: 18px; }
  .metric strong { display: block; font-size: 30px; margin-top: 8px; }
  section { padding: 18px; margin-top: 16px; overflow: hidden; }
  .section-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 10px 8px; border-top: 1px solid rgba(245,240,232,0.08); text-align: left; vertical-align: top; }
  th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
  td { color: #d7d1c8; }
  .wrap { overflow-x: auto; }
  .pill { display: inline-block; padding: 3px 8px; border-radius: 999px; background: rgba(232,93,4,0.14); color: #ffb27d; font-size: 12px; }
  .empty { color: var(--muted); padding: 12px 0; }
  @media (max-width: 760px) { header, .row, .section-head { flex-direction: column; align-items: stretch; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
</head>
<body>
<main>
  <div id="login" class="card login">
    <h1>Admin dashboard</h1>
    <p>Enter the admin token to load read-only operational data.</p>
    <form id="login-form" class="row" autocomplete="off">
      <input id="token-input" type="password" placeholder="ADMIN_TOKEN" aria-label="Admin token">
      <button type="submit">Open</button>
    </form>
    <p id="login-error" class="error">${queryTokenRejected ? "Invalid admin token." : ""}</p>
  </div>

  <div id="dashboard" class="hidden">
    <header>
      <div>
        <h1>Admin dashboard</h1>
        <p class="muted">Read-only stats, feedback, subscribers, and opt-outs.</p>
      </div>
      <div class="row">
        <button id="refresh" class="secondary" type="button">Refresh</button>
        <button id="logout" class="secondary" type="button">Forget token</button>
      </div>
    </header>

    <div class="grid">
      <div class="card metric"><span class="muted">Total roasts</span><strong id="total-roasts">--</strong></div>
      <div class="card metric"><span class="muted">Last 24h</span><strong id="roasts-24h">--</strong></div>
      <div class="card metric"><span class="muted">Last 7d</span><strong id="roasts-7d">--</strong></div>
      <div class="card metric"><span class="muted">Avg score</span><strong id="avg-score">--</strong></div>
    </div>

    <section class="card">
      <div class="section-head"><h2>Recent roasts</h2><span class="muted" id="last-roast"></span></div>
      <div class="wrap"><table><thead><tr><th>ID</th><th>URL</th><th>Score</th><th>Industry</th><th>Country</th><th>Created</th></tr></thead><tbody id="recent-roasts"></tbody></table></div>
    </section>

    <section class="card">
      <div class="section-head"><h2>Recent feedback</h2><span class="muted">Latest 50</span></div>
      <div class="wrap"><table><thead><tr><th>Vote</th><th>Context</th><th>Reasons</th><th>Message</th><th>Email</th><th>Roast</th><th>Created</th></tr></thead><tbody id="feedback"></tbody></table></div>
    </section>

    <section class="card">
      <div class="section-head"><h2>Subscribers</h2><span class="muted" id="subscriber-count"></span></div>
      <div class="wrap"><table><thead><tr><th>Email</th><th>Roast</th><th>Created</th></tr></thead><tbody id="subscribers"></tbody></table></div>
    </section>

    <section class="card">
      <div class="section-head"><h2>Opt-outs</h2><span class="muted" id="opt-out-count"></span></div>
      <div class="wrap"><table><thead><tr><th>Email</th><th>Reason</th><th>Created</th></tr></thead><tbody id="opt-outs"></tbody></table></div>
    </section>
  </div>
</main>
<script>
const TOKEN_KEY = "roast-admin-token";
const queryTokenAccepted = ${queryTokenAccepted ? "true" : "false"};
const params = new URLSearchParams(window.location.search);
const queryToken = params.get("token");
if (queryToken) {
  if (queryTokenAccepted) sessionStorage.setItem(TOKEN_KEY, queryToken);
  params.delete("token");
  const nextSearch = params.toString();
  history.replaceState(null, "", window.location.pathname + (nextSearch ? "?" + nextSearch : "") + window.location.hash);
}

const login = document.getElementById("login");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const tokenInput = document.getElementById("token-input");

function text(value) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function dateText(value) {
  if (!value) return "-";
  const date = new Date(String(value).replace(" ", "T") + "Z");
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function setRows(tbodyId, rows, columns) {
  const tbody = document.getElementById(tbodyId);
  tbody.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "empty";
    td.colSpan = columns.length;
    td.textContent = "No rows";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of columns) {
      const td = document.createElement("td");
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
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

async function fetchAdmin(path) {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const response = await fetch(path, { headers: { "X-Admin-Token": token || "" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || "Request failed");
  }
  return body;
}

async function loadDashboard() {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (!token) {
    dashboard.classList.add("hidden");
    login.classList.remove("hidden");
    return;
  }
  login.classList.add("hidden");
  dashboard.classList.remove("hidden");
  loginError.textContent = "";

  try {
    const [stats, feedback, subscribers, optOuts] = await Promise.all([
      fetchAdmin("/api/admin/stats"),
      fetchAdmin("/api/admin/feedback?limit=50"),
      fetchAdmin("/api/admin/subscribers?limit=50"),
      fetchAdmin("/api/admin/opt-outs?limit=50")
    ]);

    document.getElementById("total-roasts").textContent = stats.stats.totalRoasts;
    document.getElementById("roasts-24h").textContent = stats.stats.roasts24h;
    document.getElementById("roasts-7d").textContent = stats.stats.roasts7d;
    document.getElementById("avg-score").textContent = stats.stats.avgScore ?? "-";
    document.getElementById("last-roast").textContent = stats.stats.lastRoast ? "Last roast: " + dateText(stats.stats.lastRoast) : "";

    setRows("recent-roasts", stats.recentRoasts || [], [
      { key: "id" },
      { key: "url", link: "url" },
      { key: "overallScore" },
      { key: "industry" },
      { key: "country" },
      { key: "createdAt", format: dateText }
    ]);
    setRows("feedback", feedback.feedback || [], [
      { key: "vote" },
      { key: "context" },
      { key: "reasons" },
      { key: "message" },
      { key: "email" },
      { key: "roastId" },
      { key: "createdAt", format: dateText }
    ]);

    document.getElementById("subscriber-count").textContent = subscribers.total + " total" + (subscribers.truncated ? " (showing latest " + subscribers.subscribers.length + ")" : "");
    setRows("subscribers", subscribers.subscribers || [], [
      { key: "email" },
      { key: "roastId" },
      { key: "createdAt", format: dateText }
    ]);

    document.getElementById("opt-out-count").textContent = optOuts.exists ? optOuts.total + " total in " + optOuts.table : "No opt-out table found";
    setRows("opt-outs", optOuts.optOuts || [], [
      { key: "email" },
      { key: "reason" },
      { key: "createdAt", format: dateText }
    ]);
  } catch (error) {
    sessionStorage.removeItem(TOKEN_KEY);
    dashboard.classList.add("hidden");
    login.classList.remove("hidden");
    loginError.textContent = error.message === "Unauthorized" ? "Invalid admin token." : error.message;
  }
}

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

document.getElementById("refresh").addEventListener("click", loadDashboard);
document.getElementById("logout").addEventListener("click", () => {
  sessionStorage.removeItem(TOKEN_KEY);
  dashboard.classList.add("hidden");
  login.classList.remove("hidden");
});

loadDashboard();
</script>
</body>
</html>`;
}

async function renderAdminPage(request, env, baseHeaders = {}) {
  const configured = Boolean(getAdminToken(env));
  if (!configured) {
    return renderAdminNotConfigured(baseHeaders);
  }
  const url = new URL(request.url);
  const auth = await authorizeAdminRequest(request, env);
  const html = renderAdminDashboard({
    ...auth,
    queryTokenPresent: url.searchParams.has("token")
  });
  return adminHtml(html, {}, baseHeaders);
}

export {
  ADMIN_TOKEN_HEADER,
  getAdminToken,
  extractAdminToken,
  verifyAdminToken,
  authorizeAdminRequest,
  handleAdminApiRequest,
  renderAdminPage
};
