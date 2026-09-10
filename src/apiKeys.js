const API_KEY_PREFIX = "rmph_";
const API_KEY_RANDOM_BYTES = 32;
const API_KEY_PREFIX_LENGTH = 12;
const API_KEY_TIERS = new Set(["free", "pro", "agency"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ACTIVE_KEYS_PER_EMAIL = 3;

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === "function"
    ? btoa(binary)
    : Buffer.from(bytes).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function isValidApiKeyFormat(apiKey) {
  return typeof apiKey === "string" && /^rmph_[A-Za-z0-9_-]{32,128}$/.test(apiKey);
}

function getApiKeyPrefix(apiKey) {
  return String(apiKey || "").slice(0, API_KEY_PREFIX_LENGTH);
}

function normalizeApiKeyTier(tier) {
  const normalized = String(tier || "").trim().toLowerCase();
  return API_KEY_TIERS.has(normalized) ? normalized : "free";
}

function normalizeApiKeyLabel(label) {
  const normalized = String(label || "API key").replace(/\s+/g, " ").trim();
  return normalized.slice(0, 80) || "API key";
}

function normalizeEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || normalized.length > 254 || !EMAIL_RE.test(normalized)) return null;
  return normalized;
}

async function hashApiKey(apiKey) {
  const data = new TextEncoder().encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return toHex(hashBuffer);
}

async function generateApiKey() {
  const bytes = new Uint8Array(API_KEY_RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  return `${API_KEY_PREFIX}${base64UrlEncode(bytes)}`;
}

function extractApiKeyFromRequest(request) {
  const auth = request.headers.get("Authorization") || "";
  const bearerMatch = auth.match(/^\s*Bearer\s+(.+?)\s*$/i);
  if (bearerMatch) return bearerMatch[1];
  const headerKey = request.headers.get("X-Api-Key");
  return headerKey ? headerKey.trim() : null;
}

function mapApiKeyRow(row) {
  if (!row) return null;
  const tier = normalizeApiKeyTier(row.tier);
  return {
    id: row.id,
    prefix: row.key_prefix,
    email: row.email || "",
    tier,
    label: row.label || "",
    dailyLimit: Number(row.daily_limit) || 50,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
    isActive: row.is_active !== 0 && row.is_active !== false
  };
}

async function countActiveKeysForEmail(env, email) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM api_keys WHERE email = ? AND is_active = 1"
  ).bind(email).first();
  return Number(row?.count || 0);
}

async function createApiKey(env, { email, label } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    const error = new Error("invalid_email");
    error.code = "invalid_email";
    throw error;
  }
  const activeCount = await countActiveKeysForEmail(env, normalizedEmail);
  if (activeCount >= MAX_ACTIVE_KEYS_PER_EMAIL) {
    const error = new Error("key_limit_exceeded");
    error.code = "key_limit_exceeded";
    throw error;
  }
  const key = await generateApiKey();
  const keyHash = await hashApiKey(key);
  const keyPrefix = getApiKeyPrefix(key);
  const normalizedLabel = normalizeApiKeyLabel(label);
  const id = crypto.randomUUID();
  const row = await env.DB.prepare(`
    INSERT INTO api_keys (id, key_hash, key_prefix, email, tier, label, daily_limit, is_active)
    VALUES (?, ?, ?, ?, 'free', ?, 50, 1)
    RETURNING id, key_prefix, email, tier, label, daily_limit, created_at, last_used_at, is_active
  `).bind(id, keyHash, keyPrefix, normalizedEmail, normalizedLabel).first();
  return { key, apiKey: mapApiKeyRow(row) };
}

async function findApiKey(env, apiKey) {
  if (!isValidApiKeyFormat(apiKey)) return null;
  const keyHash = await hashApiKey(apiKey);
  const row = await env.DB.prepare(`
    SELECT id, key_prefix, email, tier, label, daily_limit, created_at, last_used_at, is_active
    FROM api_keys
    WHERE key_hash = ? AND is_active = 1
    LIMIT 1
  `).bind(keyHash).first();
  return mapApiKeyRow(row);
}

async function authenticateApiKeyRequest(env, request) {
  const apiKey = extractApiKeyFromRequest(request);
  if (!apiKey) return { present: false, apiKey: null };
  return { present: true, apiKey: await findApiKey(env, apiKey) };
}

async function touchApiKeyLastUsed(env, apiKeyId) {
  await env.DB.prepare(`
    UPDATE api_keys
    SET last_used_at = datetime('now')
    WHERE id = ? AND is_active = 1
  `).bind(apiKeyId).run();
}

function getApiV1CounterKeyForApiKey(apiKey) {
  return `key:${apiKey.id}`;
}

export {
  API_KEY_PREFIX,
  API_KEY_TIERS,
  MAX_ACTIVE_KEYS_PER_EMAIL,
  authenticateApiKeyRequest,
  createApiKey,
  extractApiKeyFromRequest,
  findApiKey,
  getApiKeyPrefix,
  getApiV1CounterKeyForApiKey,
  hashApiKey,
  isValidApiKeyFormat,
  normalizeEmail,
  normalizeApiKeyTier,
  touchApiKeyLastUsed
};
