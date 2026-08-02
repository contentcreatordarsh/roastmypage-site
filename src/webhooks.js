/**
 * #60 — Slack & Discord webhook notifications for roast results.
 */

const SLACK_HOST = /(^|\.)hooks\.slack\.com$/i;
const DISCORD_HOST = /(^|\.)discord(?:app)?\.com$/i;

export function detectWebhookPlatform(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    if (SLACK_HOST.test(u.hostname) && u.pathname.includes("/services/")) return "slack";
    if (DISCORD_HOST.test(u.hostname) && u.pathname.includes("/api/webhooks/")) return "discord";
    return null;
  } catch {
    return null;
  }
}

export function isAllowedWebhookUrl(url) {
  return detectWebhookPlatform(url) !== null;
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return String(url || "page").slice(0, 60);
  }
}

function scoreEmoji(score) {
  if (score >= 8) return "🔥";
  if (score >= 6) return "👍";
  if (score >= 4) return "😬";
  return "💀";
}

/**
 * Build a platform-native payload from a roast summary.
 */
export function buildNotifyPayload(platform, roast, { baseUrl = "https://roastmypage.site" } = {}) {
  const score = Number(roast.overallScore ?? roast.overall_score ?? 0);
  const url = roast.url || "";
  const host = hostFromUrl(url);
  const shareUrl = roast.shareUrl || `${baseUrl.replace(/\/$/, "")}/roast/${roast.id}`;
  const emoji = scoreEmoji(score);
  const scores = roast.scores || {
    hero: roast.hero_score,
    cta: roast.cta_score,
    trust: roast.trust_score,
    copy: roast.copy_score,
    design: roast.design_score
  };
  const breakdown = ["hero", "cta", "trust", "copy", "design"]
    .map((k) => `${k}: ${Number(scores?.[k] ?? 0).toFixed(1)}`)
    .join(" · ");
  const wins = Array.isArray(roast.quickWins)
    ? roast.quickWins.slice(0, 3)
    : (() => {
        try { return JSON.parse(roast.quick_wins || "[]").slice(0, 3); } catch { return []; }
      })();

  if (platform === "slack") {
    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: `${emoji} Roast result: ${score.toFixed(1)}/10`, emoji: true }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${host}*\n${breakdown}\n<${shareUrl}|View full report>`
        }
      }
    ];
    if (wins.length) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Quick wins*\n${wins.map((w) => `• ${w}`).join("\n")}`
        }
      });
    }
    return {
      text: `${emoji} ${host} scored ${score.toFixed(1)}/10 — ${shareUrl}`,
      blocks
    };
  }

  // Discord
  const embed = {
    title: `${emoji} ${host} — ${score.toFixed(1)}/10`,
    url: shareUrl,
    description: breakdown,
    color: score >= 8 ? 0x22c55e : score >= 6 ? 0xeab308 : score >= 4 ? 0xf97316 : 0xef4444,
    fields: wins.length
      ? [{ name: "Quick wins", value: wins.map((w) => `• ${w}`).join("\n").slice(0, 1000) }]
      : [],
    footer: { text: "Roast My Landing Page" }
  };
  return {
    content: `New roast ready for **${host}**`,
    embeds: [embed]
  };
}

export function buildTestPayload(platform) {
  return buildNotifyPayload(platform, {
    id: "test0001",
    url: "https://example.com",
    overallScore: 7.4,
    scores: { hero: 8, cta: 7, trust: 7, copy: 6, design: 7 },
    quickWins: ["Clarify the hero value prop", "Make the primary CTA more prominent", "Add a trust logo row"]
  }, { baseUrl: "https://roastmypage.site" });
}

export async function fireWebhook(url, payload, { timeoutMs = 8000 } = {}) {
  if (!isAllowedWebhookUrl(url)) {
    return { ok: false, error: "webhook_not_allowed" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "RoastMyPage-Notify/1.0"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `provider_${res.status}`, detail: body.slice(0, 200) };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    const msg = err?.name === "AbortError" ? "timeout" : "network_error";
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
