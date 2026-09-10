// POST /api/batch-roast
import { CONFIG } from '../config.js';

import {
    generateId,
    isValidUrl,
    hashUrl,
    hashIp,
    uint8ArrayToBase64,
    safeLogError,
    sleep,
    isUrlSafeForFetching
} from '../utils.js';

import {
    checkGlobalRateLimit,
    trackBrowserUsage,
    checkOperationRateLimit,
    getCachedRoast
} from '../db.js';

import { capturePageWithMetrics } from '../puppeteer.js';

import { isBotChallengeError, BOT_CHALLENGE_MESSAGE } from '../botcheck.js';

import { analyzeWithVisionAndHeatmap, formatRoast } from '../ai.js';

export async function handle(request, env, ctx, url, corsHeaders) {
  const env22 = env;
    if (url.pathname === "/api/batch-roast" && request.method === "POST") {
      try {
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const clientCountry = request.headers.get("CF-IPCountry") || "XX";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT, env22.ENVIRONMENT);
        const body = await request.json();
        const { urls, device = "desktop" } = body;
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
          return Response.json({ error: "Please provide an array of URLs" }, { status: 400, headers: corsHeaders });
        }
        if (urls.length > CONFIG.MAX_BATCH_URLS) {
          return Response.json({ error: `Maximum ${CONFIG.MAX_BATCH_URLS} URLs per batch` }, { status: 400, headers: corsHeaders });
        }
        const validUrls = urls.filter((u) => isValidUrl(u) && isUrlSafeForFetching(u));
        if (validUrls.length === 0) {
          return Response.json({ error: "No valid URLs provided" }, { status: 400, headers: corsHeaders });
        }
        const rateLimit = await checkOperationRateLimit(env22, ipHash, "batch");
        if (!rateLimit.allowed) {
          return Response.json(
            { error: `Batch rate limit exceeded (${CONFIG.RATE_LIMIT_BATCH_MAX}/hour). Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.`, retryAfter: rateLimit.resetIn },
            { status: 429, headers: corsHeaders }
          );
        }
        const globalLimit = await checkGlobalRateLimit(env22);
        if (!globalLimit.allowed) {
          return Response.json(
            { error: globalLimit.reason, retryAfter: 300 },
            { status: 503, headers: { ...corsHeaders, "Retry-After": "300" } }
          );
        }
        const results = [];
        const errors = [];
        for (const targetUrl of validUrls) {
          try {
            const urlHash = await hashUrl(targetUrl, device);
            const cachedResult = await getCachedRoast(env22, urlHash, targetUrl);
            if (cachedResult) {
              results.push({ ...cachedResult, device, cached: true });
              continue;
            }
            const roastId = generateId();
            await trackBrowserUsage(env22, 1);
            const pageData = await capturePageWithMetrics(env22, targetUrl, { device });
            if (pageData.screenshot.length > CONFIG.MAX_SCREENSHOT_BYTES) throw new Error("Screenshot too large");
            const base64Screenshot = uint8ArrayToBase64(pageData.screenshot);
            const screenshotKey = `screenshots/${roastId}.jpg`;
            const [_, analysisResult] = await Promise.all([
              env22.SCREENSHOTS.put(screenshotKey, pageData.screenshot, { httpMetadata: { contentType: "image/jpeg" } }),
              analyzeWithVisionAndHeatmap(env22, base64Screenshot, targetUrl, false, 1, { video: pageData.video })
            ]);
            const { analysis, heatmap } = analysisResult;
            const formattedRoast = formatRoast(analysis, targetUrl);
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
                JSON.stringify(heatmap),
                analysis.industry || "other"
              ).run()
            );
            results.push({
              id: roastId,
              url: targetUrl,
              overallScore: analysis.overallScore,
              scores: analysis.scores,
              quickWins: analysis.quickWins,
              screenshotUrl: `/api/screenshot/${roastId}`,
              cached: false,
              device,
              seo: { score: pageData.seo.score, issues: pageData.seo.issues },
              performance: { score: pageData.performance.score, loadTime: pageData.performance.loadTime }
            });
            await sleep(1e3);
          } catch (err) {
            safeLogError(`Batch roast failed for URL:`, err);
            errors.push(isBotChallengeError(err) ? { url: targetUrl, error: "blocked_by_bot_protection", message: BOT_CHALLENGE_MESSAGE } : { url: targetUrl, error: "Failed to analyze this page. Please try again." });
          }
        }
        return Response.json({
          results,
          errors,
          summary: {
            total: validUrls.length,
            successful: results.length,
            failed: errors.length,
            avgScore: results.length > 0 ? (results.reduce((sum, r) => sum + r.overallScore, 0) / results.length).toFixed(1) : null
          }
        }, { headers: corsHeaders });
      } catch (error32) {
        safeLogError("Batch roast failed:", error32);
        return Response.json({ error: error32.message || "Batch processing failed" }, { status: 500, headers: corsHeaders });
      }
    }
  return null;
}
