import { API_V1_LIMITS, CONFIG, INDUSTRY_BENCHMARKS, PRODUCTION_ORIGINS } from '../config.js';
import {
  checkApiV1RateLimits,
  checkGlobalRateLimit,
  consumeApiV1Quota,
  getCachedRoast,
  releaseApiV1Quota,
  apiV1RateLimitHeaders,
  trackBrowserUsage
} from '../db.js';
import { capturePageWithMetrics } from '../puppeteer.js';
import { analyzeWithVisionAndHeatmap, formatRoast } from '../ai.js';
import {
  generateId,
  hashIp,
  hashUrl,
  isUrlSafeForFetching,
  isValidUrl,
  safeLogError,
  sanitizeUrl,
  secondsUntilMidnightUTC,
  uint8ArrayToBase64
} from '../utils.js';

export async function handleApiV1Routes(request, env22, ctx, { url }) {
    const apiV1CorsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Expose-Headers": "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Global-Limit, X-RateLimit-Global-Remaining",
      "Access-Control-Max-Age": "86400"
    };
    if (url.pathname.startsWith("/api/v1/") && request.method === "OPTIONS") {
      return new Response(null, { headers: apiV1CorsHeaders });
    }
    if (url.pathname === "/api/v1/usage" && request.method === "GET") {
      const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
      const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT, env22.ENVIRONMENT);
      const usage = await checkApiV1RateLimits(env22, ipHash);
      const ipCount = usage.ipCount;
      const globalCount = usage.globalCount;
      const resetAt = /* @__PURE__ */ new Date();
      resetAt.setUTCHours(24, 0, 0, 0);
      return Response.json({
        limits: {
          perIp: { limit: API_V1_LIMITS.PER_IP_DAILY, used: ipCount, remaining: Math.max(0, API_V1_LIMITS.PER_IP_DAILY - ipCount) },
          global: { limit: API_V1_LIMITS.GLOBAL_DAILY, used: globalCount, remaining: Math.max(0, API_V1_LIMITS.GLOBAL_DAILY - globalCount) }
        },
        resetsAt: resetAt.toISOString(),
        resetsIn: secondsUntilMidnightUTC()
      }, {
        headers: {
          ...apiV1CorsHeaders,
          ...apiV1RateLimitHeaders(ipCount, globalCount)
        }
      });
    }
    if (url.pathname === "/api/v1/roast" && request.method === "POST") {
      const startTime = Date.now();
      let quotaReservationIpHash = null;
      try {
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const clientCountry = request.headers.get("CF-IPCountry") || "XX";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT, env22.ENVIRONMENT);
        const rateLimits = await checkApiV1RateLimits(env22, ipHash);
        if (!rateLimits.allowed) {
          const statusCode = rateLimits.errorType === "global_limit" ? 503 : 429;
          return Response.json({
            success: false,
            error: rateLimits.errorType === "global_limit" ? "global_limit_exceeded" : "rate_limit_exceeded",
            message: rateLimits.error,
            limits: {
              perIp: { limit: API_V1_LIMITS.PER_IP_DAILY, used: rateLimits.ipCount, remaining: Math.max(0, API_V1_LIMITS.PER_IP_DAILY - rateLimits.ipCount) },
              global: { limit: API_V1_LIMITS.GLOBAL_DAILY, used: rateLimits.globalCount, remaining: Math.max(0, API_V1_LIMITS.GLOBAL_DAILY - rateLimits.globalCount) }
            },
            resetsAt: (() => {
              const d = /* @__PURE__ */ new Date();
              d.setUTCHours(24, 0, 0, 0);
              return d.toISOString();
            })()
          }, {
            status: statusCode,
            headers: {
              ...apiV1CorsHeaders,
              ...apiV1RateLimitHeaders(rateLimits.ipCount, rateLimits.globalCount),
              "Retry-After": String(secondsUntilMidnightUTC())
            }
          });
        }
        const globalLimit = await checkGlobalRateLimit(env22);
        if (!globalLimit.allowed) {
          return Response.json({
            success: false,
            error: "service_busy",
            message: "The roasting service is at capacity. Please try again in a few minutes."
          }, {
            status: 503,
            headers: { ...apiV1CorsHeaders, "Retry-After": "300" }
          });
        }
        const body = await request.json();
        const rawUrl = body.url;
        const device = ["desktop", "tablet", "mobile"].includes(body.device || "") ? body.device : "desktop";
        if (!rawUrl || typeof rawUrl !== "string") {
          return Response.json({
            success: false,
            error: "invalid_request",
            message: 'The "url" field is required.'
          }, { status: 400, headers: apiV1CorsHeaders });
        }
        const targetUrl = sanitizeUrl(rawUrl);
        if (!targetUrl || !isValidUrl(targetUrl)) {
          return Response.json({
            success: false,
            error: "invalid_url",
            message: "Please provide a valid HTTP/HTTPS URL."
          }, { status: 400, headers: apiV1CorsHeaders });
        }
        if (!isUrlSafeForFetching(targetUrl)) {
          return Response.json({
            success: false,
            error: "blocked_url",
            message: "Cannot scan internal, private, or localhost URLs."
          }, { status: 400, headers: apiV1CorsHeaders });
        }
        const quota = await consumeApiV1Quota(env22, ipHash);
        if (!quota.allowed) {
          const statusCode = quota.errorType === "global_limit" ? 503 : 429;
          return Response.json({
            success: false,
            error: quota.errorType === "global_limit" ? "global_limit_exceeded" : "rate_limit_exceeded",
            message: quota.error,
            limits: {
              perIp: { limit: API_V1_LIMITS.PER_IP_DAILY, used: quota.ipCount, remaining: Math.max(0, API_V1_LIMITS.PER_IP_DAILY - quota.ipCount) },
              global: { limit: API_V1_LIMITS.GLOBAL_DAILY, used: quota.globalCount, remaining: Math.max(0, API_V1_LIMITS.GLOBAL_DAILY - quota.globalCount) }
            }
          }, {
            status: statusCode,
            headers: {
              ...apiV1CorsHeaders,
              ...apiV1RateLimitHeaders(quota.ipCount, quota.globalCount),
              "Retry-After": String(secondsUntilMidnightUTC())
            }
          });
        }
        quotaReservationIpHash = ipHash;
        const urlHash = await hashUrl(targetUrl, device);
        const cachedResult = await getCachedRoast(env22, urlHash, targetUrl);
        if (cachedResult) {
          const response = Response.json({
            success: true,
            cached: true,
            url: targetUrl,
            scores: {
              overall: cachedResult.overallScore,
              hero: cachedResult.scores.hero,
              cta: cachedResult.scores.cta,
              trust: cachedResult.scores.trust,
              copy: cachedResult.scores.copy,
              design: cachedResult.scores.design
            },
            verdict: cachedResult.verdict || "",
            roast: cachedResult.roast || "",
            quickWins: cachedResult.quickWins || [],
            industry: cachedResult.industry || "other",
            seo: cachedResult.seo || null,
            performance: cachedResult.performance || null,
            heatmap: cachedResult.heatmap || null,
            screenshotUrl: `${PRODUCTION_ORIGINS[0]}/api/screenshot/${cachedResult.id}`,
            shareUrl: `${PRODUCTION_ORIGINS[0]}/roast/${cachedResult.id}`,
            timestamp: cachedResult.createdAt || (/* @__PURE__ */ new Date()).toISOString()
          }, {
            headers: {
              ...apiV1CorsHeaders,
              ...apiV1RateLimitHeaders(quota.ipCount, quota.globalCount),
              "X-Cache": "HIT"
            }
          });
          quotaReservationIpHash = null;
          return response;
        }
        await trackBrowserUsage(env22, 1);
        const roastId = generateId();
        const pageData = await capturePageWithMetrics(env22, targetUrl, { device });
        if (pageData.screenshot.length > CONFIG.MAX_SCREENSHOT_BYTES) {
          return Response.json({
            success: false,
            error: "screenshot_too_large",
            message: "The page generated a screenshot exceeding the size limit."
          }, { status: 422, headers: apiV1CorsHeaders });
        }
        const screenshotKey = `screenshots/${roastId}.jpg`;
        const base64Screenshot = uint8ArrayToBase64(pageData.screenshot);
        const [_, analysisResult] = await Promise.all([
          env22.SCREENSHOTS.put(screenshotKey, pageData.screenshot, { httpMetadata: { contentType: "image/jpeg" } }),
          analyzeWithVisionAndHeatmap(env22, base64Screenshot, targetUrl, false, 1, { video: pageData.video })
        ]);
        const { analysis, heatmap } = analysisResult;
        const formattedRoast = formatRoast(analysis, targetUrl);
        const industry = analysis.industry || "other";
        const enhancedHeatmap = { ...heatmap, foldLine: pageData.foldLinePercent || heatmap.foldLine };
        ctx.waitUntil(
          env22.DB.prepare(`
            INSERT INTO roasts (id, url, url_hash, screenshot_key, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, roast_response, quick_wins, country, seo_data, performance_data, heatmap_data, industry)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            roastId,
            targetUrl,
            urlHash,
            screenshotKey,
            analysis.overallScore,
            analysis.scores.hero,
            analysis.scores.cta,
            analysis.scores.trust,
            analysis.scores.copy,
            analysis.scores.design,
            formattedRoast,
            JSON.stringify(analysis.quickWins),
            clientCountry,
            JSON.stringify(pageData.seo),
            JSON.stringify(pageData.performance),
            JSON.stringify(enhancedHeatmap),
            industry
          ).run()
        );
        const response = Response.json({
          success: true,
          cached: false,
          url: targetUrl,
          scores: {
            overall: analysis.overallScore,
            hero: analysis.scores.hero,
            cta: analysis.scores.cta,
            trust: analysis.scores.trust,
            copy: analysis.scores.copy,
            design: analysis.scores.design
          },
          sections: analysis.sections || {},
          verdict: analysis.verdict || "",
          roast: formattedRoast,
          quickWins: analysis.quickWins || [],
          industry,
          benchmarks: analysis.benchmarks || INDUSTRY_BENCHMARKS[industry] || INDUSTRY_BENCHMARKS.other,
          seo: pageData.seo || null,
          performance: pageData.performance || null,
          video: pageData.video || pageData.seo?.video || null,
          heatmap: enhancedHeatmap,
          screenshotUrl: `${PRODUCTION_ORIGINS[0]}/api/screenshot/${roastId}`,
          shareUrl: `${PRODUCTION_ORIGINS[0]}/roast/${roastId}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          processingTime: Date.now() - startTime
        }, {
          headers: {
            ...apiV1CorsHeaders,
            ...apiV1RateLimitHeaders(quota.ipCount, quota.globalCount),
            "X-Cache": "MISS"
          }
        });
        quotaReservationIpHash = null;
        return response;
      } catch (error32) {
        safeLogError("API v1 roast failed:", error32);
        let message = "Something went wrong. Please try again.";
        let statusCode = 500;
        if (error32.message?.includes("timeout") || error32.message?.includes("Timeout")) {
          message = "The page took too long to load. Try again or use a different URL.";
          statusCode = 504;
        } else if (error32.message?.includes("net::ERR") || error32.message?.includes("Navigation")) {
          message = "Could not load the page. Please check the URL and try again.";
          statusCode = 400;
        } else if (error32.message?.includes("Browser") || error32.message?.includes("busy")) {
          message = "The roasting service is temporarily busy. Please try again in 30-60 seconds.";
          statusCode = 503;
        }
        return Response.json({
          success: false,
          error: "roast_failed",
          message
        }, {
          status: statusCode,
          headers: apiV1CorsHeaders
        });
      } finally {
        if (quotaReservationIpHash) {
          await releaseApiV1Quota(env22, quotaReservationIpHash);
        }
      }
    }
  return null;
}
