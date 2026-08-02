const DEFAULT_BASE_URL = "https://roastmypage.site";
const DEFAULT_RESEND_FROM = "Roast My Landing Page <digest@roastmypage.site>";
const DEFAULT_EMAIL_BINDING_FROM = "digest@roastmypage.site";
const DIGEST_BATCH_LIMIT = 50;
const DIGEST_SEND_DELAY_MS = 200;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getBaseUrl(env = {}) {
  return String(env.BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function toSqlDatetime(date) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function formatAvgScore(score) {
  if (score === null || score === undefined) return "Not enough scored roasts yet";
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return "Not enough scored roasts yet";
  return `${numeric.toFixed(1)}/10`;
}

function normalizeDigestStats(stats = {}) {
  const baseUrl = String(stats.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const roastCount = Number(stats.roastCount ?? stats.weeklyRoastCount ?? 0);
  const avgScore = stats.avgScore === null || stats.avgScore === undefined ? null : Number(stats.avgScore);
  const ctaUrl = stats.ctaUrl || `${baseUrl}/`;
  return {
    roastCount: Number.isFinite(roastCount) ? roastCount : 0,
    avgScore: Number.isFinite(avgScore) ? avgScore : null,
    baseUrl,
    ctaUrl,
    weekStart: stats.weekStart || stats.startDate,
    weekEnd: stats.weekEnd || stats.endDate
  };
}

function buildWeeklyDigestHtml(stats) {
  const normalized = normalizeDigestStats(stats);
  const weekRange = normalized.weekStart && normalized.weekEnd
    ? `${formatDate(normalized.weekStart)} - ${formatDate(normalized.weekEnd)}`
    : "The last 7 days";
  const roastLabel = normalized.roastCount === 1 ? "roast" : "roasts";
  const safeCtaUrl = escapeHtml(normalized.ctaUrl);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Your weekly landing page roast digest</title>
  </head>
  <body style="margin:0;background:#0b0b0f;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
      <div style="background:#15151c;border:1px solid #2a2a33;border-radius:24px;overflow:hidden;">
        <div style="padding:28px 28px 16px;">
          <p style="margin:0 0 10px;color:#ff6b35;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Weekly roast digest</p>
          <h1 style="margin:0;color:#ffffff;font-size:30px;line-height:1.15;">The internet brought ${escapeHtml(normalized.roastCount)} ${roastLabel} to the fire this week.</h1>
          <p style="margin:14px 0 0;color:#a1a1a6;font-size:15px;line-height:1.6;">${escapeHtml(weekRange)} on Roast My Landing Page.</p>
        </div>
        <div style="display:block;padding:8px 28px 8px;">
          <div style="display:inline-block;width:46%;min-width:220px;margin:0 12px 16px 0;padding:20px;background:#1f1f29;border-radius:18px;">
            <div style="color:#a1a1a6;font-size:13px;">Roasts this week</div>
            <div style="margin-top:8px;color:#ffffff;font-size:34px;font-weight:800;">${escapeHtml(normalized.roastCount)}</div>
          </div>
          <div style="display:inline-block;width:46%;min-width:220px;margin:0 0 16px 0;padding:20px;background:#1f1f29;border-radius:18px;">
            <div style="color:#a1a1a6;font-size:13px;">Average roast score</div>
            <div style="margin-top:8px;color:#ffffff;font-size:34px;font-weight:800;">${escapeHtml(formatAvgScore(normalized.avgScore))}</div>
          </div>
        </div>
        <div style="padding:8px 28px 30px;">
          <p style="margin:0 0 22px;color:#d1d1d6;font-size:16px;line-height:1.6;">Ready to see if your landing page is converting or quietly embarrassing itself? Run a fresh roast and get a prioritized teardown in minutes.</p>
          <a href="${safeCtaUrl}" style="display:inline-block;background:#ff6b35;color:#ffffff;text-decoration:none;font-weight:800;border-radius:999px;padding:14px 22px;">Roast my landing page</a>
        </div>
      </div>
      <p style="margin:18px 8px 0;color:#6e6e73;font-size:12px;line-height:1.5;">You are receiving this because you subscribed to Roast My Landing Page updates.</p>
    </div>
  </body>
</html>`;
}

function buildWeeklyDigestText(stats) {
  const normalized = normalizeDigestStats(stats);
  const roastLabel = normalized.roastCount === 1 ? "roast" : "roasts";
  return [
    "Your weekly landing page roast digest",
    "",
    `${normalized.roastCount} ${roastLabel} were run this week.`,
    `Average roast score: ${formatAvgScore(normalized.avgScore)}`,
    "",
    `Get a fresh teardown: ${normalized.ctaUrl}`,
    "",
    "You are receiving this because you subscribed to Roast My Landing Page updates."
  ].join("\n");
}

async function getWeeklyDigestStats(env, now = new Date()) {
  const weekEnd = new Date(now);
  const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS roast_count, AVG(overall_score) AS avg_score
    FROM roasts
    WHERE created_at >= ? AND created_at < ?
  `).bind(toSqlDatetime(weekStart), toSqlDatetime(weekEnd)).first();

  return {
    roastCount: Number(row?.roast_count || 0),
    avgScore: row?.avg_score === null || row?.avg_score === undefined ? null : Number(row.avg_score),
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    baseUrl: getBaseUrl(env),
    ctaUrl: `${getBaseUrl(env)}/`
  };
}

function getDigestProvider(env = {}) {
  if (env.RESEND_API_KEY) return "resend";
  if (env.EMAIL && typeof env.EMAIL.send === "function") return "email_binding";
  return null;
}

function getDigestFrom(env = {}, provider = "resend") {
  if (env.DIGEST_FROM_EMAIL) return String(env.DIGEST_FROM_EMAIL);
  if (provider === "email_binding") return DEFAULT_EMAIL_BINDING_FROM;
  return env.RESEND_FROM_EMAIL ? String(env.RESEND_FROM_EMAIL) : DEFAULT_RESEND_FROM;
}

function cleanHeader(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function buildRawEmail({ from, to, subject, html, text }) {
  const boundary = `digest-${Date.now().toString(36)}`;
  return [
    `From: ${cleanHeader(from)}`,
    `To: ${cleanHeader(to)}`,
    `Subject: ${cleanHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    html,
    "",
    `--${boundary}--`
  ].join("\r\n");
}

async function sendDigestEmail(env, provider, message) {
  const from = getDigestFrom(env, provider);
  if (provider === "resend") {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text
      })
    });
    if (!response.ok) {
      throw new Error(`Resend returned ${response.status}`);
    }
    return;
  }

  const raw = buildRawEmail({ from, ...message });
  try {
    const { EmailMessage } = await import("cloudflare:email");
    await env.EMAIL.send(new EmailMessage(from, message.to, raw));
  } catch (error) {
    if (error && error.code !== "ERR_MODULE_NOT_FOUND" && error.code !== "ERR_UNSUPPORTED_ESM_URL_SCHEME") {
      throw error;
    }
    await env.EMAIL.send({ from, to: message.to, subject: message.subject, html: message.html, text: message.text, raw });
  }
}

async function getDigestSubscribers(env, limit) {
  const rows = await env.DB.prepare(`
    SELECT email
    FROM email_subscribers
    WHERE email IS NOT NULL AND email != ''
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(limit).all();
  const seen = new Set();
  return (rows.results || [])
    .map((row) => String(row.email || "").toLowerCase().trim())
    .filter((email) => {
      if (!email || seen.has(email)) return false;
      seen.add(email);
      return true;
    });
}

async function sendWeeklyDigest(env, options = {}) {
  const provider = getDigestProvider(env);
  if (!provider) {
    return { skipped: true, reason: "missing_email_provider", sent: 0, failed: 0 };
  }
  if (!env.DB) {
    return { skipped: true, reason: "missing_db", sent: 0, failed: 0 };
  }

  const requestedLimit = Number(options.limit || env.DIGEST_BATCH_LIMIT || DIGEST_BATCH_LIMIT);
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, DIGEST_BATCH_LIMIT)
    : DIGEST_BATCH_LIMIT;
  const subscribers = await getDigestSubscribers(env, limit);
  if (subscribers.length === 0) {
    return { skipped: true, reason: "no_subscribers", sent: 0, failed: 0 };
  }

  const stats = await getWeeklyDigestStats(env, options.now || new Date());
  const html = buildWeeklyDigestHtml(stats);
  const text = buildWeeklyDigestText(stats);
  const subject = `This week on Roast My Landing Page: ${stats.roastCount} roasts`;
  let sent = 0;
  let failed = 0;

  for (const email of subscribers) {
    try {
      await sendDigestEmail(env, provider, { to: email, subject, html, text });
      sent += 1;
    } catch (error) {
      failed += 1;
      console.error("Weekly digest email failed:", error instanceof Error ? error.message : String(error));
    }
    if (sent + failed < subscribers.length) {
      await new Promise((resolve) => setTimeout(resolve, Number(options.sendDelayMs ?? DIGEST_SEND_DELAY_MS)));
    }
  }

  return { skipped: false, provider, attempted: subscribers.length, sent, failed };
}

export {
  DIGEST_BATCH_LIMIT,
  buildWeeklyDigestHtml,
  buildWeeklyDigestText,
  getWeeklyDigestStats,
  sendWeeklyDigest
};
