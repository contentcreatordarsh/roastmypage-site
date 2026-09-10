import { fetchWithTimeout, isUrlSafeForFetching } from "./utils.js";

const WEBHOOK_TIMEOUT_MS = 4000;
const MAX_WEBHOOK_URL_LENGTH = 500;

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hostnameOf(urlString) {
  try {
    return new URL(urlString).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isPaidWebhookUrl(urlString) {
  if (!urlString || typeof urlString !== "string") return false;
  if (urlString.length > MAX_WEBHOOK_URL_LENGTH) return false;
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "https:") return false;
  } catch {
    return false;
  }
  if (!isUrlSafeForFetching(urlString)) return false;
  const host = hostnameOf(urlString);
  if (host === "roastmypage.site" || host.endsWith(".roastmypage.site")) return false;
  if (host.endsWith(".workers.dev")) return false;
  return true;
}

export function extractRoastWebhookUrl(body) {
  if (!body || typeof body !== "object") return "";
  const raw = body.webhookUrl || body.callbackUrl || body.callback_url || "";
  return typeof raw === "string" ? raw.trim() : "";
}

async function signWebhookBody(secret, timestamp, rawBody) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  return toHex(sig);
}

export async function deliverPaidRoastWebhook(env, { webhookUrl, apiKey, payload }) {
  if (!isPaidWebhookUrl(webhookUrl)) {
    return { ok: false, error: "webhook_not_allowed" };
  }
  const secret = env?.WEBHOOK_SIGNING_SECRET || env?.TIER_UPGRADE_SECRET || "";
  const body = {
    event: payload?.success === false ? "roast.failed" : "roast.completed",
    key: apiKey ? { prefix: apiKey.prefix, tier: apiKey.tier } : null,
    roast: payload
  };
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "RoastMyPage-API/1.0",
    "X-Roast-Timestamp": timestamp
  };
  if (secret) {
    headers["X-Roast-Signature"] = `sha256=${await signWebhookBody(secret, timestamp, rawBody)}`;
  }
  try {
    const res = await fetchWithTimeout(webhookUrl, {
      method: "POST",
      headers,
      body: rawBody,
      timeout: WEBHOOK_TIMEOUT_MS
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, error: "network_error" };
  }
}
