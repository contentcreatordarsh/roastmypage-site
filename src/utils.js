import { CONFIG, POPULAR_DOMAINS, VIEWPORTS, PRODUCTION_ORIGINS, DEV_ORIGINS } from './config.js';

function generateId() {
  return crypto.randomUUID().slice(0, 8);
}
function isValidRoastId(id) {
  return !!id && /^[a-f0-9]{8}$/i.test(id);
}
function isValidRoastIdLoose(id) {
  return !!id && /^[a-z0-9][\w-]{1,30}$/i.test(id);
}
function isValidUrl(urlString) {
  try {
    const url = new URL(urlString);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
function normalizeUrl(urlString) {
  try {
    const url = new URL(urlString);
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    url.searchParams.delete("utm_source");
    url.searchParams.delete("utm_medium");
    url.searchParams.delete("utm_campaign");
    url.searchParams.delete("ref");
    return url.toString();
  } catch {
    return urlString;
  }
}
async function hashUrl(url, device = "desktop") {
  const normalized = normalizeUrl(url) + "-" + device;
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
let _ipSaltWarned = false;
async function hashIp(ip, salt) {
  if (!salt && !_ipSaltWarned) {
    _ipSaltWarned = true;
    console.warn("[security] IP_HASH_SALT is not set — IP hashes fall back to a public constant and are reversible. Set it with: wrangler secret put IP_HASH_SALT");
  }
  const encoder = new TextEncoder();
  const data = encoder.encode(ip + "-" + (salt || "roast-salt"));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function uint8ArrayToBase64(bytes) {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}
function safeLogError(message, error32) {
  const redacted = message.replace(/https?:\/\/[^\s)]+/g, "[URL]");
  if (error32) {
    const errorMsg = error32 instanceof Error ? error32.message : String(error32);
    console.error(redacted, errorMsg.replace(/https?:\/\/[^\s)]+/g, "[URL]"));
  } else {
    console.error(redacted);
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function withTimeout(promise, ms, label = "Operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
  ]);
}
function fetchWithTimeout(url, options = {}) {
  const { timeout: timeout2 = 5e3, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout2);
  return fetch(url, { ...fetchOptions, signal: controller.signal }).finally(() => clearTimeout(id));
}
function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1e3);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function getTimeAgoSSR(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1e3);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function getCountryFlag(code) {
  if (!code || code.length !== 2 || code === "XX") return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127462 + c.charCodeAt(0) - 65));
}

function getAllowedOrigins(environment) {
  if (environment !== "production") {
    return [...PRODUCTION_ORIGINS, ...DEV_ORIGINS];
  }
  return PRODUCTION_ORIGINS;
}
function getSecurityHeaders(origin, environment) {
  const allowedOrigins = getAllowedOrigins(environment);
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : PRODUCTION_ORIGINS[0];
  return {
    // CORS
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    // Security headers
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "0",
    // Disabled — legacy filter can introduce vulnerabilities; CSP is the modern replacement
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    // Content Security Policy
    "Content-Security-Policy": [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.googleadservices.com https://adservice.google.com https://*.google.com",
      // TODO: migrate inline scripts to nonces to remove unsafe-inline
      "style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https: http:",
      "connect-src 'self' https://cloudflare-dns.com https://twitter.com https://www.instagram.com https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.google.com https://*.doubleclick.net https://*.googleadservices.com",
      "frame-src 'self' https://googleads.g.doubleclick.net https://*.doubleclick.net https://*.googlesyndication.com https://tpc.googlesyndication.com https://www.google.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'"
    ].join("; ")
  };
}

function sanitizeHtml(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;").replace(/\//g, "&#x2F;");
}
function sanitizeUrl(url) {
  if (!url) return "";
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith("javascript:") || trimmed.startsWith("data:") || trimmed.startsWith("vbscript:")) {
    return "";
  }
  return url;
}
function isUrlSafeForFetching(urlString) {
  try {
    const parsed = new URL(urlString);
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "0.0.0.0") {
      return false;
    }
    if (hostname.startsWith("[") && (hostname.includes("::1") || hostname.includes("::ffff:") || hostname.includes("0:0:0:0"))) {
      return false;
    }
    if (hostname.startsWith("10.")) {
      return false;
    }
    if (hostname.startsWith("192.168.")) {
      return false;
    }
    const match172 = hostname.match(/^172\.(\d+)\./);
    if (match172) {
      const second = parseInt(match172[1], 10);
      if (second >= 16 && second <= 31) {
        return false;
      }
    }
    if (hostname.startsWith("169.254.")) {
      return false;
    }
    if (hostname === "169.254.169.254" || // AWS/GCP/Azure metadata
    hostname === "metadata.google.internal" || hostname === "metadata.google" || hostname.endsWith(".metadata.google.internal")) {
      return false;
    }
    if (/^\d{1,10}$/.test(hostname)) {
      return false;
    }
    if (/^0x[0-9a-f]+$/i.test(hostname)) {
      return false;
    }
    if (/^0\d/.test(hostname) || hostname.split(".").some((p) => /^0\d+$/.test(p))) {
      return false;
    }
    if (hostname === "0" || hostname === "0.0.0.0") {
      return false;
    }
    if (hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".localhost") || hostname.endsWith(".localdomain") || hostname.endsWith(".corp") || hostname.endsWith(".home") || hostname.endsWith(".lan")) {
      return false;
    }
    if (hostname.endsWith(".cluster.local") || hostname.endsWith(".svc.local") || hostname.endsWith(".pod.local")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

    function getApiDayKey() {
      const now = /* @__PURE__ */ new Date();
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    }
    function secondsUntilMidnightUTC() {
      const now = /* @__PURE__ */ new Date();
      const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
      return Math.ceil((midnight.getTime() - now.getTime()) / 1e3);
    }
    
export { generateId, isValidRoastId, isValidRoastIdLoose, isValidUrl, normalizeUrl, hashUrl, hashIp, uint8ArrayToBase64, safeLogError, sleep, withTimeout, fetchWithTimeout, getTimeAgo, getTimeAgoSSR, getCountryFlag, escapeHtml, sanitizeHtml, sanitizeUrl, isUrlSafeForFetching, getApiDayKey, secondsUntilMidnightUTC, getAllowedOrigins, getSecurityHeaders };
