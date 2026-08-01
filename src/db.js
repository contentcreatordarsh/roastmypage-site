import { CONFIG, POPULAR_DOMAINS, API_V1_LIMITS, INDUSTRY_BENCHMARKS } from './config.js';
import { getApiDayKey } from './utils.js';
import { calculatePercentile } from './ai.js';

async function checkGlobalRateLimit(env22) {
  const now = /* @__PURE__ */ new Date();
  const hourKey = `global_hourly_${now.getUTCFullYear()}_${now.getUTCMonth()}_${now.getUTCDate()}_${now.getUTCHours()}`;
  const dayKey = `global_daily_browser_${now.getUTCFullYear()}_${now.getUTCMonth()}_${now.getUTCDate()}`;
  try {
    const hourlyCount = parseInt(await env22.CONFIG.get(hourKey) || "0");
    if (hourlyCount >= CONFIG.GLOBAL_HOURLY_LIMIT) {
      return { allowed: false, reason: "Service is at capacity. Please try again in a few minutes." };
    }
    const dailyBrowser = parseInt(await env22.CONFIG.get(dayKey) || "0");
    if (dailyBrowser >= CONFIG.GLOBAL_DAILY_BROWSER_LIMIT) {
      return { allowed: false, reason: "Daily capacity reached. Please try again tomorrow." };
    }
    await env22.CONFIG.put(hourKey, String(hourlyCount + 1), { expirationTtl: 7200 });
    return { allowed: true };
  } catch (error32) {
    console.error("Global rate limit check failed:", error32);
    return { allowed: false, reason: "Rate limiting is temporarily unavailable. Please try again shortly." };
  }
}
async function trackBrowserUsage(env22, sessions2 = 1) {
  const now = /* @__PURE__ */ new Date();
  const dayKey = `global_daily_browser_${now.getUTCFullYear()}_${now.getUTCMonth()}_${now.getUTCDate()}`;
  try {
    const current = parseInt(await env22.CONFIG.get(dayKey) || "0");
    await env22.CONFIG.put(dayKey, String(current + sessions2), { expirationTtl: 172800 });
  } catch (error32) {
    console.error("Failed to track browser usage:", error32);
  }
}
var inFlightRequests = /* @__PURE__ */ new Map();
async function deduplicatedRoast(urlHash, roastFn) {
  const existing = inFlightRequests.get(urlHash);
  if (existing) {
    console.log(`Deduplicating request for ${urlHash}`);
    return { result: await existing, deduplicated: true };
  }
  const promise = roastFn();
  inFlightRequests.set(urlHash, promise);
  try {
    const result = await promise;
    return { result, deduplicated: false };
  } finally {
    inFlightRequests.delete(urlHash);
  }
}
async function checkOperationRateLimit(env22, ipHash, operation) {
  const limits2 = {
    roast: CONFIG.RATE_LIMIT_MAX_REQUESTS,
    compare: CONFIG.RATE_LIMIT_COMPARE_MAX,
    batch: CONFIG.RATE_LIMIT_BATCH_MAX,
    feedback: CONFIG.RATE_LIMIT_FEEDBACK_MAX,
    subscribe: CONFIG.RATE_LIMIT_SUBSCRIBE_MAX,
    threat: CONFIG.RATE_LIMIT_THREAT_MAX,
    optout: CONFIG.RATE_LIMIT_OPTOUT_MAX
  };
  const maxRequests = limits2[operation];
  const now = /* @__PURE__ */ new Date();
  const windowStart = new Date(now.getTime() - CONFIG.RATE_LIMIT_WINDOW_MINUTES * 60 * 1e3);
  const rateLimitKey = `${ipHash}_${operation}`;
  await env22.DB.prepare(`
    INSERT INTO rate_limits (ip_hash, request_count, window_start, last_request)
    VALUES (?, 1, ?, ?)
    ON CONFLICT(ip_hash) DO UPDATE SET
      request_count = CASE
        WHEN window_start < ? THEN 1
        ELSE request_count + 1
      END,
      window_start = CASE
        WHEN window_start < ? THEN ?
        ELSE window_start
      END,
      last_request = ?
  `).bind(
    rateLimitKey,
    now.toISOString(),
    now.toISOString(),
    windowStart.toISOString(),
    windowStart.toISOString(),
    now.toISOString(),
    now.toISOString()
  ).run();
  const record = await env22.DB.prepare(
    "SELECT request_count, window_start FROM rate_limits WHERE ip_hash = ?"
  ).bind(rateLimitKey).first();
  if (!record) {
    return { allowed: true, remaining: maxRequests - 1, resetIn: CONFIG.RATE_LIMIT_WINDOW_MINUTES * 60 };
  }
  const recordWindowStart = new Date(record.window_start);
  const resetTime = new Date(recordWindowStart.getTime() + CONFIG.RATE_LIMIT_WINDOW_MINUTES * 60 * 1e3);
  const resetIn = Math.ceil((resetTime.getTime() - now.getTime()) / 1e3);
  if (record.request_count > maxRequests) {
    return { allowed: false, remaining: 0, resetIn };
  }
  return { allowed: true, remaining: maxRequests - record.request_count, resetIn };
}
async function getCachedRoast(env22, urlHash, url) {
  let cacheTTLHours = CONFIG.CACHE_TTL_HOURS;
  if (url) {
    try {
      const domain22 = new URL(url).hostname.replace(/^www\./, "");
      if (POPULAR_DOMAINS.has(domain22)) {
        cacheTTLHours = 720;
      }
    } catch {
    }
  }
  const cacheExpiry = new Date(Date.now() - cacheTTLHours * 60 * 60 * 1e3);
  const cached = await env22.DB.prepare(`
    SELECT id, url, url_hash, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, roast_response, quick_wins, seo_data, performance_data, heatmap_data, industry, device, full_page
    FROM roasts WHERE url_hash = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1
  `).bind(urlHash, cacheExpiry.toISOString()).first();
  if (!cached) return null;
  // Self-heal: a legacy cached roast missing SEO/performance data renders blank "-"
  // cards (and can break Compare). Treat it as a cache miss so it's re-captured with
  // complete data instead of serving an incomplete result.
  if (!cached.seo_data || !cached.performance_data) return null;
  let quickWins = [];
  try {
    quickWins = cached.quick_wins ? JSON.parse(cached.quick_wins) : [];
  } catch {
    quickWins = ["Review your headline clarity", "Add more social proof", "Make your CTA more prominent"];
  }
  let seo = null;
  let performance22 = null;
  let heatmap = null;
  try {
    if (cached.seo_data) seo = JSON.parse(cached.seo_data);
  } catch {
  }
  try {
    if (cached.performance_data) performance22 = JSON.parse(cached.performance_data);
  } catch {
  }
  try {
    if (cached.heatmap_data) heatmap = JSON.parse(cached.heatmap_data);
  } catch {
  }
  const industry = cached.industry || "other";
  const percentileData = CONFIG.ENABLE_PERCENTILE_RANKING ? await calculatePercentile(env22.DB, cached.overall_score, industry, "overall") : null;
  return {
    id: cached.id,
    url: cached.url,
    urlHash: cached.url_hash,
    overallScore: cached.overall_score,
    scores: { hero: cached.hero_score, cta: cached.cta_score, trust: cached.trust_score, copy: cached.copy_score, design: cached.design_score },
    roast: cached.roast_response,
    quickWins,
    screenshotUrl: `/api/screenshot/${cached.id}`,
    cached: true,
    seo,
    performance: performance22,
    heatmap,
    industry,
    device: cached.device || "desktop",
    fullPage: cached.full_page === 1 || cached.full_page === true,
    benchmarks: INDUSTRY_BENCHMARKS[industry] || INDUSTRY_BENCHMARKS.other,
    percentile: percentileData
    // { percentile, betterThan, totalSamples }
  };
}

async function purgeExpiredRoasts(env, retentionDays = CONFIG.RETENTION_DAYS) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1e3).toISOString();
  const expired = await env.DB.prepare(
    "SELECT id, screenshot_key FROM roasts WHERE created_at < ? ORDER BY created_at ASC LIMIT 200"
  ).bind(cutoff).all();
  const rows = expired.results || [];
  let deletedScreenshots = 0;
  for (const row of rows) {
    if (row.screenshot_key && env.SCREENSHOTS) {
      try {
        await env.SCREENSHOTS.delete(row.screenshot_key);
        deletedScreenshots++;
      } catch (err) {
        console.error("Failed to delete screenshot", row.screenshot_key, err);
      }
    }
  }
  if (rows.length) {
    const placeholders = rows.map(() => "?").join(",");
    await env.DB.prepare(
      `DELETE FROM roasts WHERE id IN (${placeholders})`
    ).bind(...rows.map((r) => r.id)).run();
  }
  // Opportunistic housekeeping for unbounded support tables
  await env.DB.prepare(
    "DELETE FROM rate_limits WHERE last_request < ?"
  ).bind(cutoff).run();
  const dayCutoff = cutoff.slice(0, 10);
  await env.DB.prepare(
    "DELETE FROM api_v1_counters WHERE day_key < ?"
  ).bind(dayCutoff).run();
  return { deletedRoasts: rows.length, deletedScreenshots, cutoff };
}

async function getApiV1Counts(env, ipHash) {
  const dayKey = getApiDayKey();
  const [ipRow, globalRow] = await Promise.all([
    env.DB.prepare(
      "SELECT request_count FROM api_v1_counters WHERE day_key = ? AND ip_hash = ?"
    ).bind(dayKey, ipHash).first(),
    env.DB.prepare(
      "SELECT COALESCE(SUM(request_count), 0) AS request_count FROM api_v1_counters WHERE day_key = ?"
    ).bind(dayKey).first()
  ]);
  return {
    ipCount: Number(ipRow?.request_count || 0),
    globalCount: Number(globalRow?.request_count || 0)
  };
}

function deniedApiV1Result(ipCount, globalCount) {
  if (globalCount >= API_V1_LIMITS.GLOBAL_DAILY) {
    return {
      allowed: false,
      ipCount,
      globalCount,
      error: `The API has reached its daily capacity of ${API_V1_LIMITS.GLOBAL_DAILY} roasts. Please try again tomorrow.`,
      errorType: "global_limit"
    };
  }
  if (ipCount >= API_V1_LIMITS.PER_IP_DAILY) {
    return {
      allowed: false,
      ipCount,
      globalCount,
      error: `You've reached the daily limit of ${API_V1_LIMITS.PER_IP_DAILY} roasts. Please try again tomorrow.`,
      errorType: "ip_limit"
    };
  }
  return { allowed: true, ipCount, globalCount };
}

async function checkApiV1RateLimits(env, ipHash) {
  try {
    const { ipCount, globalCount } = await getApiV1Counts(env, ipHash);
    return deniedApiV1Result(ipCount, globalCount);
  } catch (error) {
    console.error("API v1 rate limit check failed:", error);
    return {
      allowed: false,
      ipCount: 0,
      globalCount: 0,
      error: "Rate limiting unavailable. Please try again later.",
      errorType: "global_limit"
    };
  }
}

async function consumeApiV1Quota(env, ipHash) {
  const dayKey = getApiDayKey();
  try {
    // A single SQLite write serializes the per-IP increment and both limit checks.
    // This avoids the KV read-modify-write race and the check/increment TOCTOU gap.
    const reserved = await env.DB.prepare(`
      INSERT INTO api_v1_counters (day_key, ip_hash, request_count, updated_at)
      SELECT ?, ?, 1, datetime('now')
      WHERE (
        SELECT COALESCE(SUM(request_count), 0)
        FROM api_v1_counters
        WHERE day_key = ?
      ) < ?
      ON CONFLICT(day_key, ip_hash) DO UPDATE SET
        request_count = api_v1_counters.request_count + 1,
        updated_at = datetime('now')
      WHERE api_v1_counters.request_count < ?
        AND (
          SELECT COALESCE(SUM(request_count), 0)
          FROM api_v1_counters
          WHERE day_key = ?
        ) < ?
      RETURNING request_count
    `).bind(
      dayKey,
      ipHash,
      dayKey,
      API_V1_LIMITS.GLOBAL_DAILY,
      API_V1_LIMITS.PER_IP_DAILY,
      dayKey,
      API_V1_LIMITS.GLOBAL_DAILY
    ).first();

    const { ipCount, globalCount } = await getApiV1Counts(env, ipHash);
    if (!reserved) return deniedApiV1Result(ipCount, globalCount);
    return { allowed: true, ipCount, globalCount };
  } catch (error) {
    console.error("API v1 quota reservation failed:", error);
    return {
      allowed: false,
      ipCount: 0,
      globalCount: 0,
      error: "Rate limiting unavailable. Please try again later.",
      errorType: "global_limit"
    };
  }
}

function apiV1RateLimitHeaders(ipCount, globalCount) {
  const resetAt = /* @__PURE__ */ new Date();
  resetAt.setUTCHours(24, 0, 0, 0);
  return {
    "X-RateLimit-Limit": String(API_V1_LIMITS.PER_IP_DAILY),
    "X-RateLimit-Remaining": String(Math.max(0, API_V1_LIMITS.PER_IP_DAILY - ipCount)),
    "X-RateLimit-Reset": String(Math.floor(resetAt.getTime() / 1e3)),
    "X-RateLimit-Global-Limit": String(API_V1_LIMITS.GLOBAL_DAILY),
    "X-RateLimit-Global-Remaining": String(Math.max(0, API_V1_LIMITS.GLOBAL_DAILY - globalCount))
  };
}

export { checkGlobalRateLimit, trackBrowserUsage, deduplicatedRoast, checkOperationRateLimit, getCachedRoast, checkApiV1RateLimits, consumeApiV1Quota, apiV1RateLimitHeaders, purgeExpiredRoasts };
