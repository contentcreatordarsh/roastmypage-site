const API_KEY_PREFIX = "rmp_";
const API_KEY_RANDOM_BYTES = 32;
const API_KEY_PREFIX_LENGTH = 12;
const API_KEY_TIERS = new Set(["free", "pro", "agency"]);

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
  return typeof apiKey === "string" && /^rmp_[A-Za-z0-9_-]{32,128}$/.test(apiKey);
}

function getApiKeyPrefix(apiKey) {
  return String(apiKey || "").slice(0, API_KEY_PREFIX_LENGTH);
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

function normalizeApiKeyTier(tier) {
  const normalized = String(tier || "").trim().toLowerCase();
  return API_KEY_TIERS.has(normalized) ? normalized : "free";
}

function normalizeApiKeyLabel(label) {
  const normalized = String(label || "API key").replace(/\s+/g, " ").trim();
  return normalized.slice(0, 80) || "API key";
}

function mapApiKeyRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    prefix: row.key_prefix,
    tier: normalizeApiKeyTier(row.tier),
    label: row.label || "",
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || null,
    revoked: !!row.revoked
  };
}

async function createApiKey(env, { label } = {}) {
  const key = await generateApiKey();
  const keyHash = await hashApiKey(key);
  const keyPrefix = getApiKeyPrefix(key);
  const tier = "free";
  const normalizedLabel = normalizeApiKeyLabel(label);
  const id = crypto.randomUUID();
  const row = await env.DB.prepare(`
    INSERT INTO api_keys (id, key_hash, key_prefix, tier, label)
    VALUES (?, ?, ?, ?, ?)
    RETURNING id, key_prefix, tier, label, created_at, last_used_at, revoked
  `).bind(id, keyHash, keyPrefix, tier, normalizedLabel).first();
  return { key, apiKey: mapApiKeyRow(row) };
}

async function findApiKey(env, apiKey) {
  if (!isValidApiKeyFormat(apiKey)) return null;
  const keyHash = await hashApiKey(apiKey);
  const row = await env.DB.prepare(`
    SELECT id, key_prefix, tier, label, created_at, last_used_at, revoked
    FROM api_keys
    WHERE key_hash = ? AND revoked = 0
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
    WHERE id = ? AND revoked = 0
  `).bind(apiKeyId).run();
}

export {
  API_KEY_PREFIX,
  API_KEY_TIERS,
  createApiKey,
  extractApiKeyFromRequest,
  getApiKeyPrefix,
  hashApiKey,
  isValidApiKeyFormat,
  authenticateApiKeyRequest,
  normalizeApiKeyTier,
  touchApiKeyLastUsed
};
