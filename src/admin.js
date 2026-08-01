import { escapeHtml } from './utils.js';

export function isAdminAuthorized(request, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) return false;
  const url = new URL(request.url);
  const q = url.searchParams.get("token");
  const header = request.headers.get("X-Admin-Token");
  return q === token || header === token;
}

export function renderAdminPage({ stats, feedback, subscribers, optOuts, baseUrl }) {
  const rows = (feedback || []).map((f) => `
    <tr>
      <td>${escapeHtml(f.vote || "")}</td>
      <td>${escapeHtml(f.context || "")}</td>
      <td>${escapeHtml((f.message || "").slice(0, 120))}</td>
      <td>${escapeHtml(f.created_at || "")}</td>
    </tr>`).join("");
  const subs = (subscribers || []).map((s) => `
    <tr><td>${escapeHtml(s.email || "")}</td><td>${escapeHtml(s.roast_id || "")}</td><td>${escapeHtml(s.created_at || "")}</td></tr>
  `).join("");
  const outs = (optOuts || []).map((o) => `
    <tr><td>${escapeHtml(o.hostname || "")}</td><td>${o.roast_count || 0}</td><td>${escapeHtml(o.created_at || "")}</td></tr>
  `).join("");
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin · Roast My Page</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700&family=DM+Sans:wght@400;600&display=swap" rel="stylesheet">
<style>
body{margin:0;background:#0A0908;color:#F5F0E8;font-family:'DM Sans',system-ui,sans-serif;padding:2rem}
h1,h2{font-family:Syne,system-ui,sans-serif}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin:1.5rem 0}
.card{background:rgba(245,240,232,.04);border:1px solid rgba(245,240,232,.08);border-radius:12px;padding:1rem}
.stat{font-size:1.75rem;font-weight:700;color:#E85D04}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{border-bottom:1px solid rgba(255,255,255,.06);padding:.5rem;text-align:left;vertical-align:top}
a{color:#E85D04}
</style></head><body>
<a href="${escapeHtml(baseUrl)}">← Site</a>
<h1>Admin</h1>
<div class="grid">
  <div class="card"><div class="stat">${stats.totalRoasts || 0}</div><div>Total roasts</div></div>
  <div class="card"><div class="stat">${stats.todayRoasts || 0}</div><div>Today</div></div>
  <div class="card"><div class="stat">${stats.subscribers || 0}</div><div>Subscribers</div></div>
  <div class="card"><div class="stat">${Number(stats.avgScore || 0).toFixed(1)}</div><div>Avg score</div></div>
  <div class="card"><div class="stat">${stats.feedback || 0}</div><div>Feedback</div></div>
</div>
<h2>Recent feedback</h2>
<div class="card"><table><thead><tr><th>Vote</th><th>Context</th><th>Message</th><th>When</th></tr></thead><tbody>${rows || "<tr><td colspan=4>None</td></tr>"}</tbody></table></div>
<h2>Subscribers</h2>
<div class="card"><table><thead><tr><th>Email</th><th>Roast</th><th>When</th></tr></thead><tbody>${subs || "<tr><td colspan=3>None</td></tr>"}</tbody></table></div>
<h2>Opt-outs</h2>
<div class="card"><table><thead><tr><th>Host</th><th>Deleted</th><th>When</th></tr></thead><tbody>${outs || "<tr><td colspan=3>None</td></tr>"}</tbody></table></div>
</body></html>`;
}
