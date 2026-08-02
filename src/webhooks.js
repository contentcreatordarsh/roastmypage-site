import { isUrlSafeForFetching } from './utils.js';

const CALLBACK_TIMEOUT_MS = 2500;

function validateCallbackUrl(callbackUrl) {
  if (callbackUrl === undefined || callbackUrl === null || callbackUrl === "") {
    return { ok: true, url: null };
  }
  if (typeof callbackUrl !== "string") {
    return { ok: false, error: "callbackUrl must be a string." };
  }
  const trimmed = callbackUrl.trim();
  if (!trimmed) {
    return { ok: true, url: null };
  }
  if (trimmed.length > 2048) {
    return { ok: false, error: "callbackUrl must be 2048 characters or fewer." };
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "callbackUrl must be a valid HTTPS URL." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: "callbackUrl must use HTTPS." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "callbackUrl cannot include credentials." };
  }
  if (!isUrlSafeForFetching(parsed.toString())) {
    return { ok: false, error: "callbackUrl cannot point to internal, private, or localhost addresses." };
  }
  return { ok: true, url: parsed.toString() };
}

function callbackStatusNotRequested() {
  return {
    requested: false,
    delivered: false,
    status: "not_requested"
  };
}

function buildApiV1CallbackPayload({ id, url, scores, shareUrl, cached = false, timestamp }) {
  return {
    event: "roast.completed",
    id,
    url,
    scores: {
      overall: scores?.overall ?? null,
      hero: scores?.hero ?? null,
      cta: scores?.cta ?? null,
      trust: scores?.trust ?? null,
      copy: scores?.copy ?? null,
      design: scores?.design ?? null
    },
    shareUrl,
    cached: Boolean(cached),
    timestamp: timestamp || (/* @__PURE__ */ new Date()).toISOString()
  };
}

function isTimeoutError(error) {
  return error?.name === "AbortError" || /aborted|timeout/i.test(error?.message || "");
}

async function postApiV1Callback(callbackUrl, payload, { fetchImpl = fetch, timeoutMs = CALLBACK_TIMEOUT_MS } = {}) {
  if (!callbackUrl) {
    return callbackStatusNotRequested();
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "roast-my-landing-page-api/1.0"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (response.ok) {
      return {
        requested: true,
        delivered: true,
        status: "delivered",
        statusCode: response.status
      };
    }
    return {
      requested: true,
      delivered: false,
      status: "failed",
      statusCode: response.status,
      error: "http_error"
    };
  } catch (error) {
    return {
      requested: true,
      delivered: false,
      status: "failed",
      error: isTimeoutError(error) ? "timeout" : "network_error"
    };
  } finally {
    clearTimeout(timer);
  }
}

export {
  CALLBACK_TIMEOUT_MS,
  validateCallbackUrl,
  callbackStatusNotRequested,
  buildApiV1CallbackPayload,
  postApiV1Callback
};
