/**
 * #49 — Competitor watchlists with score-change alerts.
 */

import { isStoredChallengeRoast } from "./botcheck.js";

export function isWatchlistWebhookUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "hooks.slack.com" && u.pathname.includes("/services/")) return true;
    if ((host === "discord.com" || host === "discordapp.com") && u.pathname.includes("/api/webhooks/")) return true;
    return false;
  } catch {
    return false;
  }
}

export function scoreChanged(prev, next, threshold = 0.05) {
  if (prev == null || next == null) return prev == null && next != null;
  return Math.abs(Number(prev) - Number(next)) >= threshold;
}

export function buildWatchlistAlertMessage({ url, previousScore, newScore, shareUrl, baseUrl }) {
  const host = (() => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
  })();
  const prev = previousScore == null ? "—" : Number(previousScore).toFixed(1);
  const next = Number(newScore).toFixed(1);
  const delta = previousScore == null ? null : Number(newScore) - Number(previousScore);
  const deltaText = delta == null ? "first score recorded" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`;
  const link = shareUrl || `${baseUrl}/`;
  return {
    subject: `Watchlist alert: ${host} is now ${next}/10`,
    text: `${host} moved from ${prev} to ${next} (${deltaText}). ${link}`,
    html: `<div style="font-family:system-ui,sans-serif;line-height:1.5">
      <h2 style="margin:0 0 8px">Competitor score change</h2>
      <p style="margin:0 0 12px"><strong>${host}</strong> moved from <strong>${prev}</strong> to <strong>${next}</strong> (${deltaText}).</p>
      <p style="margin:0"><a href="${link}">View roast</a></p>
    </div>`,
    slack: {
      text: `👀 Watchlist: *${host}* ${prev} → *${next}* (${deltaText})\n${link}`
    },
    discord: {
      content: `👀 **Watchlist:** ${host} moved ${prev} → **${next}** (${deltaText})\n${link}`
    }
  };
}

export async function fireWatchlistWebhook(webhookUrl, message) {
  if (!isWatchlistWebhookUrl(webhookUrl)) {
    return { ok: false, error: "webhook_not_allowed" };
  }
  const lower = webhookUrl.toLowerCase();
  const isSlack = lower.includes("hooks.slack.com");
  const body = isSlack ? message.slack : message.discord;
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "RoastMyPage-Watchlist/1.0" },
      body: JSON.stringify(body)
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, error: "network_error" };
  }
}

/** Best-effort email via Cloudflare Email Workers binding when present. */
export async function sendWatchlistEmail(env, { to, subject, html, text }) {
  if (!env?.EMAIL || typeof env.EMAIL.send !== "function") {
    return { sent: false, reason: "EMAIL_BINDING_MISSING" };
  }
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { sent: false, reason: "invalid_email" };
  }
  const fromRaw = env.EMAIL_FROM || "Roast My Landing Page <noreply@roastmypage.site>";
  const m = String(fromRaw).match(/^(.*?)\s*<([^>]+)>$/);
  const from = m
    ? { name: m[1].trim() || "Roast My Landing Page", email: m[2].trim() }
    : { name: "Roast My Landing Page", email: String(fromRaw) };
  try {
    const result = await env.EMAIL.send({ to, from, subject, html, text });
    return { sent: true, messageId: result?.messageId || null };
  } catch (err) {
    console.error("Watchlist email failed", err?.message || err);
    return { sent: false, reason: "send_failed" };
  }
}

/**
 * Find the newest roast score for a URL (hash match, then hostname fallback).
 */
export async function lookupLatestRoastScore(env, { url, urlHash }) {
  if (urlHash) {
    const byHash = await env.DB.prepare(
      `SELECT id, url, overall_score, created_at, seo_data FROM roasts
       WHERE url_hash = ? ORDER BY created_at DESC LIMIT 1`
    ).bind(urlHash).first();
    if (byHash) return isStoredChallengeRoast(byHash.seo_data) ? null : byHash;
  }
  let hostname = "";
  try { hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
  if (!hostname) return null;
  const byHostname = await env.DB.prepare(
    `SELECT id, url, overall_score, created_at, seo_data FROM roasts
     WHERE lower(url) LIKE ? OR lower(url) LIKE ?
     ORDER BY created_at DESC LIMIT 1`
  ).bind(`https://${hostname}%`, `http://${hostname}%`).first();
  return byHostname && !isStoredChallengeRoast(byHostname.seo_data) ? byHostname : null;
}

/**
 * Scan active watchlist rows and emit alerts when scores changed.
 * Pass ownerKey to scope a manual check to one browser identity.
 */
export async function processWatchlistAlerts(env, { limit = 40, baseUrl = "https://roastmypage.site", ownerKey = null } = {}) {
  const rows = ownerKey
    ? await env.DB.prepare(
        `SELECT id, owner_key, url, url_hash, email, webhook_url, last_score, last_roast_id
         FROM watchlist WHERE owner_key = ? AND active = 1 AND notify_on_change = 1
         ORDER BY updated_at IS NULL DESC, updated_at ASC LIMIT ?`
      ).bind(ownerKey, limit).all()
    : await env.DB.prepare(
        `SELECT id, owner_key, url, url_hash, email, webhook_url, last_score, last_roast_id
         FROM watchlist WHERE active = 1 AND notify_on_change = 1
         ORDER BY updated_at IS NULL DESC, updated_at ASC LIMIT ?`
      ).bind(limit).all();

  const alerts = [];
  for (const row of rows.results || []) {
    const latest = await lookupLatestRoastScore(env, { url: row.url, urlHash: row.url_hash });
    if (!latest) continue;
    const nextScore = Number(latest.overall_score);
    if (!scoreChanged(row.last_score, nextScore)) {
      // Touch updated_at so we rotate through the list
      await env.DB.prepare(
        `UPDATE watchlist SET updated_at = datetime('now') WHERE id = ?`
      ).bind(row.id).run();
      continue;
    }

    const shareUrl = `${baseUrl.replace(/\/$/, "")}/roast/${latest.id}`;
    const message = buildWatchlistAlertMessage({
      url: row.url,
      previousScore: row.last_score,
      newScore: nextScore,
      shareUrl,
      baseUrl
    });

    if (row.webhook_url) {
      await fireWatchlistWebhook(row.webhook_url, message);
    }
    if (row.email) {
      await sendWatchlistEmail(env, {
        to: row.email,
        subject: message.subject,
        html: message.html,
        text: message.text
      });
    }

    const alertId = crypto.randomUUID().slice(0, 8);
    await env.DB.prepare(
      `INSERT INTO watchlist_alerts (id, watchlist_id, owner_key, url, previous_score, new_score, roast_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(alertId, row.id, row.owner_key, row.url, row.last_score, nextScore, latest.id).run();

    await env.DB.prepare(
      `UPDATE watchlist
       SET last_score = ?, last_roast_id = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(nextScore, latest.id, row.id).run();

    alerts.push({
      id: alertId,
      watchlistId: row.id,
      url: row.url,
      previousScore: row.last_score,
      newScore: nextScore,
      roastId: latest.id
    });
  }
  return { checked: (rows.results || []).length, alerted: alerts.length, alerts };
}
