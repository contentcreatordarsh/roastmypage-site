const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function readSecret(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getTurnstileSiteKey(env = {}) {
  const siteKey = readSecret(env.TURNSTILE_SITE_KEY);
  const secretKey = readSecret(env.TURNSTILE_SECRET_KEY);
  return siteKey && secretKey ? siteKey : null;
}

function isTurnstileConfigured(env = {}) {
  return getTurnstileSiteKey(env) !== null;
}

async function verifyTurnstileToken(env = {}, token, remoteIp, fetchImpl = globalThis.fetch) {
  if (!isTurnstileConfigured(env)) {
    return { success: true, skipped: true };
  }

  const responseToken = readSecret(token);
  if (!responseToken) {
    return { success: false, error: "missing-token" };
  }

  if (typeof fetchImpl !== "function") {
    return { success: false, error: "verification-unavailable" };
  }

  const params = new URLSearchParams();
  params.set("secret", readSecret(env.TURNSTILE_SECRET_KEY));
  params.set("response", responseToken);
  if (remoteIp && remoteIp !== "unknown") {
    params.set("remoteip", remoteIp);
  }

  try {
    const response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });

    if (!response.ok) {
      return { success: false, error: "verification-failed" };
    }

    const result = await response.json();
    if (result?.success === true) {
      return { success: true };
    }

    return {
      success: false,
      error: Array.isArray(result?.["error-codes"]) ? result["error-codes"][0] : "invalid-token"
    };
  } catch {
    return { success: false, error: "verification-failed" };
  }
}

export { TURNSTILE_SITEVERIFY_URL, getTurnstileSiteKey, isTurnstileConfigured, verifyTurnstileToken };
