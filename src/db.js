import { CONFIG, POPULAR_DOMAINS, API_V1_LIMITS, INDUSTRY_BENCHMARKS } from './config.js';
import { getApiDayKey } from './utils.js';
import { calculatePercentile } from './ai.js';
import { redactVideoItemUrls } from './video.js';
import { isStoredChallengeRoast } from './botcheck.js';

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
    watchlist: CONFIG.RATE_LIMIT_WATCHLIST_MAX
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
async function getCachedRoast(env22, urlHash, url, { requireAuditData = true } = {}) {
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
    SELECT id, url, url_hash, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, roast_response, quick_wins, seo_data, performance_data, heatmap_data, industry
    FROM roasts WHERE url_hash = ? AND created_at > ? ORDER BY created_at DESC LIMIT 1
  `).bind(urlHash, cacheExpiry.toISOString()).first();
  if (!cached) return null;
  // By default, self-heal legacy rows that would render blank audit cards.
  // Callers that cannot persist a recapture may opt into the incomplete row.
  if (requireAuditData && (!cached.seo_data || !cached.performance_data)) return null;
  // Rows written before interstitial detection existed hold a score for a
  // challenge page, not the site. Never replay that — re-capture instead, which
  // now ends in an honest blocked_by_bot_protection error (or a real roast if
  // the site has since dropped the challenge). Applies to every caller: serving
  // a known-fabricated score is worse than a slower request.
  if (isStoredChallengeRoast(cached.seo_data)) return null;
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
    if (cached.seo_data) {
      seo = JSON.parse(cached.seo_data);
      if (seo?.video) seo.video = redactVideoItemUrls(seo.video);
    }
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
  // Video analysis is part of the current audit schema. Rows captured before it
  // shipped have otherwise-complete SEO/performance JSON, so they must be
  // recaptured once instead of hiding video findings until the cache TTL expires.
  if (requireAuditData && (!seo || !Object.prototype.hasOwnProperty.call(seo, "video"))) {
    return null;
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
    video: seo?.video || null,
    heatmap,
    industry,
    benchmarks: INDUSTRY_BENCHMARKS[industry] || INDUSTRY_BENCHMARKS.other,
    percentile: percentileData
    // { percentile, betterThan, totalSamples }
  };
}

function resolvePositiveDays(value, fallback) {
  const parsedDays = Number(value ?? fallback);
  if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
    throw new Error("Retention days must be a positive number");
  }
  return parsedDays;
}

function formatSqliteDateTime(date) {
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function screenshotKeysForRow(row) {
  const keys = new Set();
  if (row?.screenshot_key) keys.add(row.screenshot_key);
  if (row?.id) {
    keys.add(`screenshots/${row.id}.jpg`);
    keys.add(`screenshots/${row.id}.png`);
  }
  return [...keys];
}

/**
 * Delete expired R2 screenshots and clear screenshot_key.
 * Never deletes roast rows — indexed /roast/:id pages must stay alive (#40).
 */
async function purgeExpiredScreenshots(env22, { days, batchSize, maxBatches } = {}) {
  const retentionDays = resolvePositiveDays(
    days ?? env22?.SCREENSHOT_RETENTION_DAYS,
    CONFIG.SCREENSHOT_RETENTION_DAYS
  );
  const normalizedBatchSize = Math.max(
    1,
    Math.min(Number(batchSize) || CONFIG.SCREENSHOT_PURGE_BATCH_SIZE, CONFIG.SCREENSHOT_PURGE_BATCH_SIZE)
  );
  const normalizedMaxBatches = Math.max(
    1,
    Math.min(Number(maxBatches) || CONFIG.SCREENSHOT_PURGE_MAX_BATCHES, CONFIG.SCREENSHOT_PURGE_MAX_BATCHES)
  );
  const cutoff = formatSqliteDateTime(new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1e3));
  const summary = {
    cutoff,
    days: retentionDays,
    scanned: 0,
    deletedScreenshots: 0,
    clearedKeys: 0,
    failedScreenshots: 0,
    batches: 0
  };

  while (summary.batches < normalizedMaxBatches) {
    const result = await env22.DB.prepare(`
      SELECT id, screenshot_key
      FROM roasts
      WHERE created_at < ?
        AND screenshot_key IS NOT NULL
        AND screenshot_key != ''
      ORDER BY created_at ASC
      LIMIT ?
    `).bind(cutoff, normalizedBatchSize).all();
    const rows = result.results || [];
    if (rows.length === 0) break;

    summary.scanned += rows.length;
    summary.batches += 1;

    const clearedIds = [];
    for (const row of rows) {
      try {
        if (env22.SCREENSHOTS) {
          for (const key of screenshotKeysForRow(row)) {
            await env22.SCREENSHOTS.delete(key);
          }
        }
        summary.deletedScreenshots += 1;
        clearedIds.push(row.id);
      } catch (error32) {
        summary.failedScreenshots += 1;
        console.error(`Failed to delete expired screenshot for ${row.id}:`, error32);
      }
    }

    if (clearedIds.length > 0) {
      const placeholders = clearedIds.map(() => "?").join(", ");
      const updateResult = await env22.DB.prepare(
        `UPDATE roasts SET screenshot_key = NULL WHERE id IN (${placeholders})`
      ).bind(...clearedIds).run();
      summary.clearedKeys += Number(updateResult.meta?.changes || clearedIds.length);
    }

    if (rows.length < normalizedBatchSize) break;
  }

  return summary;
}

async function pruneExpiredRateLimitRows(env22, { rateLimitDays, apiCounterDays } = {}) {
  const rateLimitRetentionDays = resolvePositiveDays(
    rateLimitDays ?? env22?.RATE_LIMIT_ROW_RETENTION_DAYS,
    CONFIG.RATE_LIMIT_ROW_RETENTION_DAYS
  );
  const apiCounterRetentionDays = resolvePositiveDays(
    apiCounterDays ?? env22?.API_V1_COUNTER_RETENTION_DAYS,
    CONFIG.API_V1_COUNTER_RETENTION_DAYS
  );
  const rateLimitCutoff = new Date(
    Date.now() - rateLimitRetentionDays * 24 * 60 * 60 * 1e3
  ).toISOString();
  const counterCutoff = new Date(
    Date.now() - apiCounterRetentionDays * 24 * 60 * 60 * 1e3
  ).toISOString().slice(0, 10);

  const [rateLimits, apiCounters] = await Promise.all([
    env22.DB.prepare(
      "DELETE FROM rate_limits WHERE last_request < ?"
    ).bind(rateLimitCutoff).run(),
    env22.DB.prepare(
      "DELETE FROM api_v1_counters WHERE day_key < ?"
    ).bind(counterCutoff).run()
  ]);

  return {
    rateLimitCutoff,
    counterCutoff,
    deletedRateLimits: Number(rateLimits.meta?.changes || 0),
    deletedApiCounters: Number(apiCounters.meta?.changes || 0)
  };
}

async function runRetentionCleanup(env22, options = {}) {
  const screenshots = await purgeExpiredScreenshots(env22, options);
  const counters = await pruneExpiredRateLimitRows(env22, options);
  return { screenshots, counters };
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

async function releaseApiV1Quota(env, ipHash) {
  const dayKey = getApiDayKey();
  try {
    const result = await env.DB.prepare(`
      UPDATE api_v1_counters
      SET request_count = request_count - 1,
          updated_at = datetime('now')
      WHERE day_key = ?
        AND ip_hash = ?
        AND request_count > 0
    `).bind(dayKey, ipHash).run();
    return Number(result.meta?.changes || 0) > 0;
  } catch (error) {
    console.error("API v1 quota release failed:", error);
    return false;
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

export { checkGlobalRateLimit, trackBrowserUsage, deduplicatedRoast, checkOperationRateLimit, getCachedRoast, purgeExpiredScreenshots, pruneExpiredRateLimitRows, runRetentionCleanup, checkApiV1RateLimits, consumeApiV1Quota, releaseApiV1Quota, apiV1RateLimitHeaders };
