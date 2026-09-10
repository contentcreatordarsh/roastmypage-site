import { API_V1_LIMITS, DEV_ORIGINS, PRODUCTION_ORIGINS } from "./config.js";
import { findApiKeyById, findApiKeyByStripeSubscription, normalizeApiKeyTier, setApiKeyTier } from "./apiKeys.js";

const UPGRADEABLE_TIERS = new Set(["pro", "agency"]);

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(sig);
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function billingConfigured(env) {
  return Boolean(env?.STRIPE_SECRET_KEY && stripePriceId(env, "pro"));
}

function stripePriceId(env, tier) {
  const normalized = normalizeApiKeyTier(tier);
  if (normalized === "pro") return env?.STRIPE_PRICE_PRO || "";
  if (normalized === "agency") return env?.STRIPE_PRICE_AGENCY || env?.STRIPE_PRICE_PRO || "";
  return "";
}

function publicPlans(env) {
  return {
    checkoutEnabled: billingConfigured(env),
    plans: [
      {
        id: "free",
        name: "Free",
        priceUsd: 0,
        apiDaily: API_V1_LIMITS.PER_IP_DAILY,
        webHourly: API_V1_LIMITS.WEB_HOURLY_BY_TIER.free,
        priority: false,
        webhooks: false
      },
      {
        id: "pro",
        name: "Pro",
        priceUsd: 29,
        apiDaily: API_V1_LIMITS.API_KEY_DAILY_BY_TIER.pro,
        webHourly: API_V1_LIMITS.WEB_HOURLY_BY_TIER.pro,
        priority: true,
        webhooks: true
      },
      {
        id: "agency",
        name: "Agency",
        priceUsd: null,
        apiDaily: API_V1_LIMITS.API_KEY_DAILY_BY_TIER.agency,
        webHourly: API_V1_LIMITS.WEB_HOURLY_BY_TIER.agency,
        priority: true,
        webhooks: true
      }
    ]
  };
}

function upgradePayload(apiKeyId, tier, exp) {
  return `${apiKeyId}|${normalizeApiKeyTier(tier)}|${exp}`;
}

async function signUpgradeToken(secret, apiKeyId, tier, exp) {
  return hmacSha256Hex(secret, upgradePayload(apiKeyId, tier, exp));
}

async function verifyUpgradeToken(secret, apiKeyId, tier, exp, token) {
  if (!secret || !token || !exp) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum * 1000 < Date.now()) return false;
  const expected = await signUpgradeToken(secret, apiKeyId, tier, String(expNum));
  return timingSafeEqual(expected, String(token).toLowerCase());
}

function isAllowedCheckoutReturnUrl(urlString, env) {
  if (!urlString || typeof urlString !== "string") return false;
  try {
    const parsed = new URL(urlString);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const allowed = [env?.BASE_URL, ...PRODUCTION_ORIGINS, ...DEV_ORIGINS].filter(Boolean);
    return allowed.some((origin) => urlString.startsWith(origin));
  } catch {
    return false;
  }
}

function formEncode(fields) {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

async function createCheckoutSession(env, { apiKey, tier, successUrl, cancelUrl }) {
  const normalized = normalizeApiKeyTier(tier);
  if (!UPGRADEABLE_TIERS.has(normalized)) {
    return { error: "invalid_tier", message: "Choose the pro or agency plan." };
  }
  if (!billingConfigured(env)) {
    return { error: "billing_not_configured", message: "Paid checkout is not enabled yet. Set STRIPE_SECRET_KEY and STRIPE_PRICE_PRO." };
  }
  const price = stripePriceId(env, normalized);
  if (!price) {
    return { error: "billing_not_configured", message: `No Stripe price configured for ${normalized}.` };
  }
  const origin = env.BASE_URL || "https://roastmypage.site";
  const success = isAllowedCheckoutReturnUrl(successUrl, env) ? successUrl : `${origin}/pricing?upgraded=${normalized}`;
  const cancel = isAllowedCheckoutReturnUrl(cancelUrl, env) ? cancelUrl : `${origin}/pricing?canceled=1`;
  const body = formEncode({
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: success,
    cancel_url: cancel,
    client_reference_id: apiKey.id,
    "metadata[api_key_id]": apiKey.id,
    "metadata[tier]": normalized,
    "subscription_data[metadata][api_key_id]": apiKey.id,
    "subscription_data[metadata][tier]": normalized
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) {
    return { error: "checkout_failed", message: "Could not start checkout. Try again or email support." };
  }
  return { url: data.url, sessionId: data.id };
}

function parseStripeSignatureHeader(header) {
  const parts = String(header || "").split(",").map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const signatures = parts.filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  return { timestamp, signatures };
}

async function verifyStripeSignature(secret, payload, header, { toleranceSec = 300 } = {}) {
  const { timestamp, signatures } = parseStripeSignatureHeader(header);
  if (!secret || !timestamp || signatures.length === 0) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSec) return false;
  const expected = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  return signatures.some((sig) => timingSafeEqual(expected, sig.toLowerCase()));
}

async function applyStripeEvent(env, event) {
  const type = event?.type;
  const obj = event?.data?.object || {};
  if (type === "checkout.session.completed") {
    const apiKeyId = obj.client_reference_id || obj.metadata?.api_key_id;
    const tier = normalizeApiKeyTier(obj.metadata?.tier || "pro");
    if (!apiKeyId || !UPGRADEABLE_TIERS.has(tier)) return { applied: false };
    const updated = await setApiKeyTier(env, apiKeyId, tier, {
      stripeCustomerId: obj.customer || null,
      stripeSubscriptionId: obj.subscription || null
    });
    return { applied: !!updated, apiKey: updated };
  }
  if (type === "customer.subscription.deleted") {
    const apiKey = await findApiKeyByStripeSubscription(env, obj.id)
      || await findApiKeyById(env, obj.metadata?.api_key_id);
    if (!apiKey) return { applied: false };
    const updated = await setApiKeyTier(env, apiKey.id, "free");
    return { applied: !!updated, apiKey: updated };
  }
  return { applied: false };
}

export {
  applyStripeEvent,
  billingConfigured,
  createCheckoutSession,
  publicPlans,
  signUpgradeToken,
  UPGRADEABLE_TIERS,
  verifyStripeSignature,
  verifyUpgradeToken
};
