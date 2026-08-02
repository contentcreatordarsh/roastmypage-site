/**
 * #47 — Outbound email via Cloudflare Email Workers (`send_email` binding).
 *
 * Requires Email Service / Email Routing configured for the domain and a
 * [[send_email]] binding named EMAIL in wrangler.toml.
 *
 * When EMAIL is unset, send helpers no-op with { sent: false }.
 */

const DEFAULT_FROM_NAME = "Roast My Landing Page";
const DEFAULT_FROM_EMAIL = "noreply@roastmypage.site";

function resolveFrom(env) {
  const raw = env.EMAIL_FROM || `${DEFAULT_FROM_NAME} <${DEFAULT_FROM_EMAIL}>`;
  const match = String(raw).match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim() || DEFAULT_FROM_NAME, email: match[2].trim() };
  }
  if (String(raw).includes("@")) {
    return { name: DEFAULT_FROM_NAME, email: String(raw).trim() };
  }
  return { name: DEFAULT_FROM_NAME, email: DEFAULT_FROM_EMAIL };
}

export function isValidEmail(email) {
  return typeof email === "string"
    && email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Send an email through the Cloudflare Email Workers binding.
 * Uses the structured Email Service API: env.EMAIL.send({ to, from, subject, html, text }).
 */
export async function sendEmail(env, { to, subject, html, text, replyTo } = {}) {
  if (!env?.EMAIL || typeof env.EMAIL.send !== "function") {
    return { sent: false, reason: "EMAIL_BINDING_MISSING" };
  }
  if (!isValidEmail(to)) {
    return { sent: false, reason: "invalid_recipient" };
  }
  if (!subject || (!html && !text)) {
    return { sent: false, reason: "missing_content" };
  }

  const from = resolveFrom(env);
  const payload = {
    to,
    from: { name: from.name, email: from.email },
    subject: String(subject).slice(0, 200),
    text: text || stripHtml(html || ""),
    html: html || undefined
  };
  if (replyTo && isValidEmail(replyTo)) {
    payload.replyTo = replyTo;
  }

  try {
    const result = await env.EMAIL.send(payload);
    return { sent: true, messageId: result?.messageId || null };
  } catch (err) {
    console.error("Cloudflare Email send failed:", err?.code || "", err?.message || err);
    return {
      sent: false,
      reason: err?.code || "send_failed",
      detail: String(err?.message || err).slice(0, 200)
    };
  }
}

function stripHtml(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return String(url || "your page").slice(0, 60);
  }
}

/** Welcome + tips email after subscribe. */
export function welcomeTipsHtml({ email, baseUrl }) {
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#1a1a1a;background:#f7f5f2;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #ece7e1">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#E85D04;font-weight:700">Roast My Landing Page</p>
    <h1 style="margin:0 0 12px;font-size:24px">You're on the list</h1>
    <p style="margin:0 0 16px;color:#444">Thanks for subscribing${email ? ` as <strong>${esc(email)}</strong>` : ""}. Here are three high-leverage tips while you wait for the next roast:</p>
    <ol style="margin:0 0 20px;padding-left:20px;color:#333">
      <li style="margin-bottom:8px"><strong>One job above the fold</strong> — headline, subcopy, and a single primary CTA.</li>
      <li style="margin-bottom:8px"><strong>Proof before pitch</strong> — logos, ratings, or a short quote near the CTA.</li>
      <li style="margin-bottom:8px"><strong>Speed is conversion</strong> — aim for under 2.5s LCP on mobile.</li>
    </ol>
    <p style="margin:0 0 20px"><a href="${esc(baseUrl)}" style="display:inline-block;background:#E85D04;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600">Roast another page</a></p>
    <p style="margin:0;font-size:12px;color:#888">You're receiving this because you subscribed on roastmypage.site.</p>
  </div>
</body></html>`;
}

/** Roast summary / report email. */
export function roastReportHtml({
  url,
  score,
  scores = {},
  quickWins = [],
  shareUrl,
  verdict = ""
}) {
  const host = hostFromUrl(url);
  const cats = ["hero", "cta", "trust", "copy", "design"]
    .map((k) => `<tr><td style="padding:6px 0;color:#666;text-transform:capitalize">${esc(k)}</td><td style="padding:6px 0;text-align:right;font-weight:600">${Number(scores[k] ?? 0).toFixed(1)}</td></tr>`)
    .join("");
  const wins = (quickWins || []).slice(0, 5)
    .map((w) => `<li style="margin-bottom:6px">${esc(w)}</li>`)
    .join("");

  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#1a1a1a;background:#f7f5f2;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #ece7e1">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#E85D04;font-weight:700">Your roast report</p>
    <h1 style="margin:0 0 4px;font-size:28px">${esc(Number(score).toFixed(1))}<span style="font-size:16px;color:#888"> / 10</span></h1>
    <p style="margin:0 0 16px;color:#444"><strong>${esc(host)}</strong>${verdict ? ` — ${esc(verdict)}` : ""}</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px">${cats}</table>
    ${wins ? `<h2 style="font-size:16px;margin:0 0 8px">Quick wins</h2><ul style="margin:0 0 20px;padding-left:20px">${wins}</ul>` : ""}
    <p style="margin:0 0 12px"><a href="${esc(shareUrl)}" style="display:inline-block;background:#E85D04;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600">Open full report</a></p>
    <p style="margin:0;font-size:12px;color:#888">Export a PDF anytime from the report page. Sent via Cloudflare Email Workers.</p>
  </div>
</body></html>`;
}

export function weeklyTipsHtml({ avgScore, roastCount, baseUrl }) {
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;line-height:1.5;color:#1a1a1a;background:#f7f5f2;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;border:1px solid #ece7e1">
    <p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#E85D04;font-weight:700">Weekly tips</p>
    <h1 style="margin:0 0 12px;font-size:22px">This week in landing pages</h1>
    <p style="margin:0 0 16px;color:#444">Community pulse: <strong>${esc(roastCount)}</strong> roasts, average score <strong>${esc(avgScore)}</strong>/10.</p>
    <p style="margin:0 0 12px;color:#333"><strong>Tip:</strong> Re-roast after each change — score history shows whether your CTA and trust fixes actually moved the needle.</p>
    <p style="margin:0 0 20px"><a href="${esc(baseUrl)}" style="display:inline-block;background:#E85D04;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600">Roast a page</a></p>
    <p style="margin:0;font-size:12px;color:#888">Unsubscribe by replying — or just ignore us forever. We get it.</p>
  </div>
</body></html>`;
}

/**
 * Load roast row + send report email.
 */
export async function sendRoastReportEmail(env, { to, roastId, baseUrl }) {
  if (!isValidEmail(to) || !roastId) {
    return { sent: false, reason: "invalid_request" };
  }
  const roast = await env.DB.prepare(
    `SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, quick_wins, roast_response
     FROM roasts WHERE id = ?`
  ).bind(roastId).first();
  if (!roast) return { sent: false, reason: "roast_not_found" };

  let quickWins = [];
  try { quickWins = roast.quick_wins ? JSON.parse(roast.quick_wins) : []; } catch { quickWins = []; }
  const shareUrl = `${String(baseUrl || "https://roastmypage.site").replace(/\/$/, "")}/roast/${roast.id}`;
  const scores = {
    hero: roast.hero_score,
    cta: roast.cta_score,
    trust: roast.trust_score,
    copy: roast.copy_score,
    design: roast.design_score
  };
  const html = roastReportHtml({
    url: roast.url,
    score: roast.overall_score,
    scores,
    quickWins,
    shareUrl,
    verdict: ""
  });
  const host = hostFromUrl(roast.url);
  return sendEmail(env, {
    to,
    subject: `Your roast: ${Number(roast.overall_score).toFixed(1)}/10 for ${host}`,
    html,
    text: `Score ${Number(roast.overall_score).toFixed(1)}/10 for ${roast.url}. Full report: ${shareUrl}`
  });
}
