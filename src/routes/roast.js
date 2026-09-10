// POST /api/roast, POST /api/roast-stream, GET /api/screenshot/:id, GET /api/roast/:id
import { CONFIG, INDUSTRY_BENCHMARKS } from '../config.js';

import {
    generateId,
    isValidRoastId,
    isValidRoastIdLoose,
    isValidUrl,
    hashUrl,
    hashIp,
    uint8ArrayToBase64,
    safeLogError,
    withTimeout,
    sanitizeHtml,
    sanitizeUrl,
    isUrlSafeForFetching
} from '../utils.js';

import {
    checkGlobalRateLimit,
    trackBrowserUsage,
    deduplicatedRoast,
    checkOperationRateLimit,
    getCachedRoast
} from '../db.js';

import { capturePageWithMetrics } from '../puppeteer.js';

import { isBotChallengeError, isStoredChallengeRoast, BOT_CHALLENGE_MESSAGE } from '../botcheck.js';

import { analyzeWithVisionAndHeatmap, formatRoast, calculatePercentile } from '../ai.js';

import { redactVideoItemUrls } from '../video.js';

import { __name2, inFlightRequests } from './helpers.js';

export async function handle(request, env, ctx, url, corsHeaders) {
  const env22 = env;
    if (url.pathname === "/api/roast" && request.method === "POST") {
      const startTime = Date.now();
      try {
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const clientCountry = request.headers.get("CF-IPCountry") || "XX";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT, env22.ENVIRONMENT);
        const body = await request.json();
        const rawUrl = body.url;
        const device = ["desktop", "tablet", "mobile"].includes(body.device || "") ? body.device : "desktop";
        const brandName = body.brandName ? sanitizeHtml(body.brandName.slice(0, 100)) : void 0;
        const fullPage = body.fullPage === true;
        const targetUrl = sanitizeUrl(rawUrl);
        if (!targetUrl || !isValidUrl(targetUrl)) {
          return Response.json({ error: "Please provide a valid URL" }, { status: 400, headers: corsHeaders });
        }
        if (!isUrlSafeForFetching(targetUrl)) {
          return Response.json({ error: "Cannot scan internal/private URLs" }, { status: 400, headers: corsHeaders });
        }
        const rateLimit = await checkOperationRateLimit(env22, ipHash, "roast");
        if (!rateLimit.allowed) {
          return Response.json(
            { error: `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.`, retryAfter: rateLimit.resetIn },
            { status: 429, headers: { ...corsHeaders, "Retry-After": rateLimit.resetIn.toString() } }
          );
        }
        const globalLimit = await checkGlobalRateLimit(env22);
        if (!globalLimit.allowed) {
          return Response.json(
            { error: globalLimit.reason, retryAfter: 300 },
            { status: 503, headers: { ...corsHeaders, "Retry-After": "300" } }
          );
        }
        const urlHash = await hashUrl(targetUrl, device + (fullPage ? "-full" : ""));
        const cachedResult = await getCachedRoast(env22, urlHash, targetUrl);
        if (cachedResult) {
          return Response.json({ ...cachedResult, device, fullPage }, { headers: { ...corsHeaders, "X-Cache": "HIT" } });
        }
        const { result: roastResult, deduplicated } = await deduplicatedRoast(urlHash, () => withTimeout(
          (async () => {
            await trackBrowserUsage(env22, 1);
            const roastId = generateId();
            console.log(`[${Date.now() - startTime}ms] Capturing ${device}${fullPage ? " full-page" : ""} screenshot of ${targetUrl}`);
            const pageData = await capturePageWithMetrics(env22, targetUrl, { device, fullPage });
            console.log(`[${Date.now() - startTime}ms] Captured with SEO/Performance data`);
            if (pageData.screenshot.length > CONFIG.MAX_SCREENSHOT_BYTES) {
              throw new Error("Screenshot too large");
            }
            const screenshotKey = `screenshots/${roastId}.jpg`;
            const base64Screenshot = uint8ArrayToBase64(pageData.screenshot);
            const [_, analysisResult] = await Promise.all([
              env22.SCREENSHOTS.put(screenshotKey, pageData.screenshot, { httpMetadata: { contentType: "image/jpeg" } }),
              analyzeWithVisionAndHeatmap(env22, base64Screenshot, targetUrl, fullPage, 1, { video: pageData.video })
            ]);
            console.log(`[${Date.now() - startTime}ms] AI analysis complete`);
            const { analysis, heatmap } = analysisResult;
            const formattedRoast = formatRoast(analysis, targetUrl, brandName);
            const enhancedHeatmap = {
              ...heatmap,
              foldLine: pageData.foldLinePercent || heatmap.foldLine
            };
            const industry = analysis.industry || "other";
            const percentileData = CONFIG.ENABLE_PERCENTILE_RANKING ? await calculatePercentile(env22.DB, analysis.overallScore, industry, "overall") : null;
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
            return {
              id: roastId,
              url: targetUrl,
              urlHash,
              overallScore: analysis.overallScore,
              scores: analysis.scores,
              sections: analysis.sections || {},
              verdict: analysis.verdict || "",
              roast: formattedRoast,
              quickWins: analysis.quickWins,
              detailedRoast: analysis.detailedRoast,
              competitorInsight: analysis.competitorInsight,
              accessibilityIssues: analysis.accessibilityIssues || [],
              screenshotUrl: `/api/screenshot/${roastId}`,
              cached: false,
              device,
              fullPage,
              seo: pageData.seo,
              performance: pageData.performance,
              video: pageData.video || pageData.seo?.video || null,
              heatmap: enhancedHeatmap,
              pageDimensions: pageData.pageDimensions,
              industry,
              benchmarks: analysis.benchmarks || INDUSTRY_BENCHMARKS[industry] || INDUSTRY_BENCHMARKS.other,
              percentile: percentileData,
              // { percentile, betterThan, totalSamples }
              aiUnavailable: analysis.aiUnavailable || false
            };
          })(),
          CONFIG.ROAST_TOTAL_TIMEOUT_MS,
          "Roast operation"
        ));
        console.log(`[${Date.now() - startTime}ms] Total time${deduplicated ? " (deduplicated)" : ""}`);
        return Response.json(roastResult, { headers: { ...corsHeaders, "X-Cache": deduplicated ? "DEDUP" : "MISS" } });
      } catch (error32) {
        safeLogError("Roast failed:", error32);
        // Bot-challenge interstitial: never scored, never persisted — say so plainly.
        if (isBotChallengeError(error32)) {
          return Response.json(
            { error: "blocked_by_bot_protection", message: BOT_CHALLENGE_MESSAGE },
            { status: 422, headers: corsHeaders }
          );
        }
        let errorMessage = error32.message;
        let statusCode = 500;
        let retryAfter = 0;
        if (errorMessage.includes("timeout") || errorMessage.includes("Timeout")) {
          errorMessage = "The page took too long to load. Try again.";
          statusCode = 504;
        } else if (errorMessage.includes("net::ERR") || errorMessage.includes("Navigation")) {
          errorMessage = "Could not load the page. Please check the URL.";
          statusCode = 400;
        } else if (errorMessage.includes("Browser") || errorMessage.includes("busy")) {
          errorMessage = "High traffic! The roaster is warming up. Please try again in 30-60 seconds.";
          statusCode = 503;
          retryAfter = 30;
        } else {
          errorMessage = "Something went wrong. Please try again.";
        }
        const headers = { ...corsHeaders };
        if (retryAfter > 0) {
          headers["Retry-After"] = retryAfter.toString();
        }
        return Response.json({ error: errorMessage, retryAfter: retryAfter || void 0 }, { status: statusCode, headers });
      }
    }
    if (url.pathname === "/api/roast-stream" && request.method === "POST") {
      try {
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const clientCountry = request.headers.get("CF-IPCountry") || "XX";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT, env22.ENVIRONMENT);
        const body = await request.json();
        const device = ["desktop", "tablet", "mobile"].includes(body.device || "") ? body.device || "desktop" : "desktop";
        const brandName = body.brandName ? sanitizeHtml(body.brandName.slice(0, 100)) : void 0;
        const fullPage = body.fullPage === true;
        const targetUrl = sanitizeUrl(body.url);
        if (!targetUrl || !isValidUrl(targetUrl)) {
          return Response.json({ error: "Please provide a valid URL" }, { status: 400, headers: corsHeaders });
        }
        if (!isUrlSafeForFetching(targetUrl)) {
          return Response.json({ error: "Cannot scan internal/private URLs" }, { status: 400, headers: corsHeaders });
        }
        const rateLimit = await checkOperationRateLimit(env22, ipHash, "roast");
        if (!rateLimit.allowed) {
          return Response.json(
            { error: `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.`, retryAfter: rateLimit.resetIn },
            { status: 429, headers: { ...corsHeaders, "Retry-After": rateLimit.resetIn.toString() } }
          );
        }
        const globalLimit = await checkGlobalRateLimit(env22);
        if (!globalLimit.allowed) {
          return Response.json(
            { error: globalLimit.reason, retryAfter: 300 },
            { status: 503, headers: { ...corsHeaders, "Retry-After": "300" } }
          );
        }
        const urlHash = await hashUrl(targetUrl, device + (fullPage ? "-full" : ""));
        const cachedResult = await getCachedRoast(env22, urlHash, targetUrl);
        if (cachedResult) {
          return Response.json({ ...cachedResult, device, fullPage, cached: true }, { headers: { ...corsHeaders, "X-Cache": "HIT" } });
        }
        if (inFlightRequests.has(urlHash)) {
          return Response.json({ error: "This URL is already being analyzed. Please wait a moment." }, { status: 409, headers: corsHeaders });
        }
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const encoder = new TextEncoder();
        const sendEvent = /* @__PURE__ */ __name2(async (event, data) => {
          await writer.write(encoder.encode(`event: ${event}
data: ${JSON.stringify(data)}

`));
        }, "sendEvent");
        const roastCountry = clientCountry;
        await trackBrowserUsage(env22, 1);
        ctx.waitUntil(
          (async () => {
            try {
              await withTimeout((async () => {
                const roastId = generateId();
                await sendEvent("progress", { step: "screenshot", message: `Capturing ${device}${fullPage ? " full-page" : ""} screenshot...`, progress: 10 });
                const pageData = await capturePageWithMetrics(env22, targetUrl, { device, fullPage });
                await sendEvent("progress", { step: "screenshot", message: "Screenshot captured!", progress: 25 });
                await sendEvent("progress", { step: "seo", message: "Analyzing SEO...", progress: 30 });
                await sendEvent("seo", pageData.seo);
                await sendEvent("progress", { step: "performance", message: "Measuring performance...", progress: 35 });
                await sendEvent("performance", pageData.performance);
                if (pageData.screenshot.length > CONFIG.MAX_SCREENSHOT_BYTES) throw new Error("Screenshot too large");
                const screenshotKey = `screenshots/${roastId}.jpg`;
                const base64Screenshot = uint8ArrayToBase64(pageData.screenshot);
                await sendEvent("progress", { step: "upload", message: "Saving screenshot...", progress: 40 });
                await env22.SCREENSHOTS.put(screenshotKey, pageData.screenshot, { httpMetadata: { contentType: "image/jpeg" } });
                await sendEvent("progress", { step: "analyze", message: "AI analyzing your page...", progress: 50 });
                const { analysis, heatmap } = await analyzeWithVisionAndHeatmap(env22, base64Screenshot, targetUrl, fullPage, 1, { video: pageData.video });
                await sendEvent("progress", { step: "heatmap", message: "Generating attention heatmap...", progress: 75 });
                const enhancedHeatmap = {
                  ...heatmap,
                  foldLine: pageData.foldLinePercent || heatmap.foldLine
                };
                await sendEvent("heatmap", enhancedHeatmap);
                if (pageData.video?.present) await sendEvent("video", pageData.video);
                await sendEvent("progress", { step: "finalize", message: "Generating report...", progress: 90 });
                const formattedRoast = formatRoast(analysis, targetUrl, brandName);
                await env22.DB.prepare(`
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
                  roastCountry,
                  JSON.stringify(pageData.seo),
                  JSON.stringify(pageData.performance),
                  JSON.stringify(enhancedHeatmap),
                  analysis.industry || "other"
                ).run();
                const result = {
                  id: roastId,
                  url: targetUrl,
                  urlHash,
                  overallScore: analysis.overallScore,
                  scores: analysis.scores,
                  sections: analysis.sections || {},
                  verdict: analysis.verdict || "",
                  roast: formattedRoast,
                  quickWins: analysis.quickWins,
                  detailedRoast: analysis.detailedRoast,
                  competitorInsight: analysis.competitorInsight,
                  accessibilityIssues: analysis.accessibilityIssues || [],
                  screenshotUrl: `/api/screenshot/${roastId}`,
                  cached: false,
                  device,
                  fullPage,
                  seo: pageData.seo,
                  performance: pageData.performance,
                  video: pageData.video || pageData.seo?.video || null,
                  heatmap: enhancedHeatmap,
                  pageDimensions: pageData.pageDimensions,
                  industry: analysis.industry || "other",
                  benchmarks: analysis.benchmarks || INDUSTRY_BENCHMARKS.other,
                  aiUnavailable: analysis.aiUnavailable || false
                };
                await sendEvent("complete", result);
              })(), CONFIG.ROAST_TOTAL_TIMEOUT_MS, "Stream roast operation");
            } catch (error32) {
              if (isBotChallengeError(error32)) {
                await sendEvent("error", { error: "blocked_by_bot_protection", message: BOT_CHALLENGE_MESSAGE });
              } else {
                await sendEvent("error", { message: error32.message || "Analysis timed out. Please try again." });
              }
            } finally {
              await writer.close();
            }
          })()
        );
        return new Response(readable, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", ...corsHeaders }
        });
      } catch (error32) {
        safeLogError("Stream roast failed:", error32);
        return Response.json({ error: error32.message || "Analysis failed" }, { status: 500, headers: corsHeaders });
      }
    }
    if (url.pathname.startsWith("/api/screenshot/")) {
      const roastId = url.pathname.split("/").pop();
      if (!isValidRoastId(roastId)) {
        return new Response("Invalid screenshot ID", { status: 400, headers: corsHeaders });
      }
      const screenshot = await env22.SCREENSHOTS.get(`screenshots/${roastId}.jpg`);
      if (!screenshot) {
        const pngScreenshot = await env22.SCREENSHOTS.get(`screenshots/${roastId}.png`);
        if (!pngScreenshot) {
          return new Response("Screenshot not found", { status: 404, headers: corsHeaders });
        }
        return new Response(pngScreenshot.body, {
          headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", ...corsHeaders }
        });
      }
      return new Response(screenshot.body, {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400", ...corsHeaders }
      });
    }
    if (url.pathname.startsWith("/api/roast/") && request.method === "GET") {
      const roastId = url.pathname.split("/").pop();
      if (!isValidRoastIdLoose(roastId)) {
        return Response.json({ error: "Invalid roast ID" }, { status: 400, headers: corsHeaders });
      }
      const roast = await env22.DB.prepare("SELECT * FROM roasts WHERE id = ?").bind(roastId).first();
      if (!roast || isStoredChallengeRoast(roast.seo_data)) {
        return Response.json({ error: "Roast not found" }, { status: 404, headers: corsHeaders });
      }
      if (roast.seo_data) {
        try {
          const seo = JSON.parse(roast.seo_data);
          if (seo?.video) {
            seo.video = redactVideoItemUrls(seo.video);
            roast.seo_data = JSON.stringify(seo);
          }
        } catch {
        }
      }
      const roastIndustry = roast.industry || "other";
      return Response.json({ ...roast, benchmarks: INDUSTRY_BENCHMARKS[roastIndustry] || INDUSTRY_BENCHMARKS.other }, { headers: corsHeaders });
    }
  return null;
}
