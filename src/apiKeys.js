import { generateId, getApiDayKey } from './utils.js';

async function sha256Hex(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createApiKey(env, { label = "default", tier = "free", webhookUrl = null } = {}) {
  const raw = `rmp_${crypto.randomUUID().replace(/-/g, "")}`;
  const keyHash = await sha256Hex(raw);
  const id = generateId();
  const dailyLimit = tier === "pro" ? 200 : tier === "agency" ? 1000 : 20;
  await env.DB.prepare(`
    INSERT INTO api_keys (id, key_hash, key_prefix, label, tier, daily_limit, webhook_url, day_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, keyHash, raw.slice(0, 12), String(label).slice(0, 80), tier, dailyLimit, webhookUrl, getApiDayKey()).run();
  return { id, apiKey: raw, tier, dailyLimit, prefix: raw.slice(0, 12) };
}

export async function authenticateApiKey(env, request) {
  const header = request.headers.get("Authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const alt = request.headers.get("X-API-Key") || "";
  const raw = bearer || alt;
  if (!raw || !raw.startsWith("rmp_")) return null;
  const keyHash = await sha256Hex(raw);
  const row = await env.DB.prepare(
    "SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0"
  ).bind(keyHash).first();
  if (!row) return null;
  const dayKey = getApiDayKey();
  let requestsToday = row.requests_today || 0;
  if (row.day_key !== dayKey) {
    requestsToday = 0;
    await env.DB.prepare(
      "UPDATE api_keys SET day_key = ?, requests_today = 0 WHERE id = ?"
    ).bind(dayKey, row.id).run();
  }
  if (requestsToday >= (row.daily_limit || 20)) {
    return { ...row, requests_today: requestsToday, limited: true };
  }
  await env.DB.prepare(
    "UPDATE api_keys SET requests_today = ?, last_used_at = datetime('now'), day_key = ? WHERE id = ?"
  ).bind(requestsToday + 1, dayKey, row.id).run();
  return { ...row, requests_today: requestsToday + 1, limited: false };
}

/**
 * #31/#60 — deliver JSON webhooks; auto-format Slack/Discord payloads.
 */
export async function fireWebhook(url, payload) {
  if (!url || !/^https:\/\//i.test(url)) return;
  try {
    let body = payload;
    const lower = url.toLowerCase();
    const isSlack = lower.includes("hooks.slack.com");
    const isDiscord = lower.includes("discord.com/api/webhooks") || lower.includes("discordapp.com/api/webhooks");
    if (isSlack || isDiscord) {
      const data = payload?.data || payload;
      const score = data?.scores?.overall ?? data?.overallScore ?? "?";
      const target = data?.url || payload?.url || "a site";
      const share = data?.shareUrl || "";
      const text = `🔥 Roast ready: *${score}/10* for ${target}${share ? `\n${share}` : ""}`;
      body = isDiscord
        ? { content: text.replace(/\*/g, "**") }
        : { text };
    }
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "RoastMyPage-Webhook/1.0" },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error("Webhook delivery failed", err);
  }
}
