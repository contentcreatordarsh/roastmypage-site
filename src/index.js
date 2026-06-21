import { 
    CONFIG, VIEWPORTS, POPULAR_DOMAINS, RUBRIC_CRITERIA, 
    INDUSTRY_BENCHMARKS, INDUSTRY_KEYS, PRODUCTION_ORIGINS, DEV_ORIGINS 
} from './config.js';

import {
    generateId, isValidRoastId, isValidRoastIdLoose, isValidUrl, normalizeUrl, 
    hashUrl, hashIp, uint8ArrayToBase64, safeLogError, sleep, withTimeout, 
    fetchWithTimeout, getTimeAgo, getTimeAgoSSR, getCountryFlag, escapeHtml, 
    sanitizeHtml, sanitizeUrl, isUrlSafeForFetching, getAllowedOrigins, getSecurityHeaders
} from './utils.js';

import {
    getRadarDomainRanking, getRadarGeoDistribution, getRadarInsights, queryCloudflareGraphQL
} from './radar.js';

import {
    checkGlobalRateLimit, trackBrowserUsage, deduplicatedRoast, 
    checkOperationRateLimit, getCachedRoast, checkApiV1RateLimits, 
    incrementApiV1Counters, apiV1RateLimitHeaders
} from './db.js';

import { capturePageWithMetrics } from './puppeteer.js';

import {
    parseMarkdownResponse, ensureLlamaLicenseAgreed, analyzeWithVisionAndHeatmap, 
    formatRoast, generateBreakdownFromScore, ensureScoreBreakdowns, 
    resolveIndustry, calculatePercentile, createFallbackAnalysis
} from './ai.js';

import { renderSvgToPng } from './render.js';

import {
    generateTyposquats, checkDomainRegistrations, checkSecurityHeaders, 
    scanSocialMediaImposters, generateSuspiciousHandles, determineHandleRisk, 
    getImposterReason, generateThreatRecommendations
} from './threats.js';

import {
    generateNotFoundPage, renderRoastPage, renderGalleryPage
} from './ssr.js';

// Bundler shim: __name2 was injected by esbuild to name arrow functions.
// In the modular source it's a safe no-op passthrough.
const __name2 = (fn, _name) => fn;

// Module-level dedup set — prevents duplicate concurrent roast requests for the same URL.
const inFlightRequests = new Set();

export default {
    async fetch(request, env22, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const securityHeaders = getSecurityHeaders(origin, env22.ENVIRONMENT);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: securityHeaders });
    }
    const corsHeaders = securityHeaders;
    if (request.method === "POST" && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/v1/")) {
      const reqOrigin = request.headers.get("Origin");
      const allowedOrigins = getAllowedOrigins(env22.ENVIRONMENT);
      if (reqOrigin && !allowedOrigins.includes(reqOrigin)) {
        return Response.json({ error: "Forbidden: origin not allowed" }, { status: 403, headers: corsHeaders });
      }
    }
    if (url.pathname === "/api/roast" && request.method === "POST") {
      const startTime = Date.now();
      try {
        const globalLimit = await checkGlobalRateLimit(env22);
        if (!globalLimit.allowed) {
          return Response.json(
            { error: globalLimit.reason, retryAfter: 300 },
            { status: 503, headers: { ...corsHeaders, "Retry-After": "300" } }
          );
        }
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const clientCountry = request.headers.get("CF-IPCountry") || "XX";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT);
        const rateLimit = await checkOperationRateLimit(env22, ipHash, "roast");
        if (!rateLimit.allowed) {
          return Response.json(
            { error: `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.`, retryAfter: rateLimit.resetIn },
            { status: 429, headers: { ...corsHeaders, "Retry-After": rateLimit.resetIn.toString() } }
          );
        }
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
              analyzeWithVisionAndHeatmap(env22, base64Screenshot, targetUrl, fullPage)
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
    if (url.pathname === "/api/compare" && request.method === "POST") {
      try {
        const globalLimit = await checkGlobalRateLimit(env22);
        if (!globalLimit.allowed) {
          return Response.json(
            { error: globalLimit.reason, retryAfter: 300 },
            { status: 503, headers: { ...corsHeaders, "Retry-After": "300" } }
          );
        }
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT);
        const rateLimit = await checkOperationRateLimit(env22, ipHash, "compare");
        if (!rateLimit.allowed) {
          return Response.json(
            { error: `Compare rate limit exceeded (${CONFIG.RATE_LIMIT_COMPARE_MAX}/hour). Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.`, retryAfter: rateLimit.resetIn },
            { status: 429, headers: corsHeaders }
          );
        }
        const body = await request.json();
        const device = ["desktop", "tablet", "mobile"].includes(body.device || "") ? body.device : "desktop";
        const url1 = sanitizeUrl(body.url1);
        const url2 = sanitizeUrl(body.url2);
        if (!url1 || !url2 || !isValidUrl(url1) || !isValidUrl(url2)) {
          return Response.json({ error: "Please provide two valid URLs" }, { status: 400, headers: corsHeaders });
        }
        for (const checkUrl of [url1, url2]) {
          if (!isUrlSafeForFetching(checkUrl)) {
            return Response.json({ error: "Cannot scan internal/private URLs" }, { status: 400, headers: corsHeaders });
          }
        }
        const [hash1, hash2] = await Promise.all([
          hashUrl(url1, device),
          hashUrl(url2, device)
        ]);
        const [cached1, cached2] = await Promise.all([
          getCachedRoast(env22, hash1, url1),
          getCachedRoast(env22, hash2, url2)
        ]);
        const needCapture1 = !cached1;
        const needCapture2 = !cached2;
        const sessionsNeeded = (needCapture1 ? 1 : 0) + (needCapture2 ? 1 : 0);
        if (sessionsNeeded > 0) await trackBrowserUsage(env22, sessionsNeeded);
        const compareResult = await withTimeout((async () => {
          const [page1, page2] = await Promise.all([
            needCapture1 ? capturePageWithMetrics(env22, url1, { device }) : null,
            needCapture2 ? capturePageWithMetrics(env22, url2, { device }) : null
          ]);
          let analysis1, analysis2, id1, id2;
          if (cached1) {
            id1 = cached1.id;
            analysis1 = { analysis: { overallScore: cached1.overallScore, scores: cached1.scores, sections: cached1.sections || {}, quickWins: cached1.quickWins, industry: cached1.industry, benchmarks: cached1.benchmarks, aiUnavailable: cached1.aiUnavailable }, heatmap: cached1.heatmap || {} };
          } else {
            id1 = generateId();
            if (page1.screenshot.length > CONFIG.MAX_SCREENSHOT_BYTES) throw new Error("Screenshot too large");
            const base64_1 = uint8ArrayToBase64(page1.screenshot);
            analysis1 = await analyzeWithVisionAndHeatmap(env22, base64_1, url1);
            await env22.SCREENSHOTS.put(`screenshots/${id1}.jpg`, page1.screenshot, { httpMetadata: { contentType: "image/jpeg" } });
          }
          if (cached2) {
            id2 = cached2.id;
            analysis2 = { analysis: { overallScore: cached2.overallScore, scores: cached2.scores, sections: cached2.sections || {}, quickWins: cached2.quickWins, industry: cached2.industry, benchmarks: cached2.benchmarks, aiUnavailable: cached2.aiUnavailable }, heatmap: cached2.heatmap || {} };
          } else {
            id2 = generateId();
            if (page2.screenshot.length > CONFIG.MAX_SCREENSHOT_BYTES) throw new Error("Screenshot too large");
            const base64_2 = uint8ArrayToBase64(page2.screenshot);
            analysis2 = await analyzeWithVisionAndHeatmap(env22, base64_2, url2);
            await env22.SCREENSHOTS.put(`screenshots/${id2}.jpg`, page2.screenshot, { httpMetadata: { contentType: "image/jpeg" } });
          }
          const pageData1 = page1 || { seo: cached1?.seo, performance: cached1?.performance, screenshot: null };
          const pageData2 = page2 || { seo: cached2?.seo, performance: cached2?.performance, screenshot: null };
          const score1 = analysis1.analysis.overallScore;
          const score2 = analysis2.analysis.overallScore;
          const winner = score1 > score2 ? "page1" : score2 > score1 ? "page2" : "tie";
          const insights = [];
          const url1Host = new URL(url1).hostname.replace("www.", "");
          const url2Host = new URL(url2).hostname.replace("www.", "");
          if (winner === "page1") {
            insights.push(`\u{1F3C6} ${url1Host} wins with a ${(score1 - score2).toFixed(1)} point advantage in overall conversion potential`);
          } else if (winner === "page2") {
            insights.push(`\u{1F3C6} ${url2Host} wins with a ${(score2 - score1).toFixed(1)} point advantage in overall conversion potential`);
          } else {
            insights.push(`\u{1F91D} Both pages are evenly matched in conversion potential`);
          }
          const categoryNames = {
            hero: "Hero Section",
            cta: "Call-to-Action",
            trust: "Trust Signals",
            copy: "Copywriting",
            design: "Visual Design"
          };
          const cats = ["hero", "cta", "trust", "copy", "design"];
          let page1Strengths = [];
          let page2Strengths = [];
          for (const cat of cats) {
            const s1 = analysis1.analysis.scores[cat];
            const s2 = analysis2.analysis.scores[cat];
            const catName = categoryNames[cat];
            if (s1 > s2 + 1) {
              page1Strengths.push(`${catName} (${s1} vs ${s2})`);
            } else if (s2 > s1 + 1) {
              page2Strengths.push(`${catName} (${s2} vs ${s1})`);
            }
            if (s1 < 5 && s2 >= 7) {
              insights.push(`\u26A0\uFE0F ${url1Host} should study ${url2Host}'s ${catName.toLowerCase()} - there's a ${s2 - s1} point gap`);
            } else if (s2 < 5 && s1 >= 7) {
              insights.push(`\u26A0\uFE0F ${url2Host} should study ${url1Host}'s ${catName.toLowerCase()} - there's a ${s1 - s2} point gap`);
            }
          }
          if (page1Strengths.length > 0) {
            insights.push(`\u{1F4AA} ${url1Host} excels in: ${page1Strengths.join(", ")}`);
          }
          if (page2Strengths.length > 0) {
            insights.push(`\u{1F4AA} ${url2Host} excels in: ${page2Strengths.join(", ")}`);
          }
          const seo1 = pageData1.seo.score;
          const seo2 = pageData2.seo.score;
          if (Math.abs(seo1 - seo2) >= 5) {
            const betterSeo = seo1 > seo2 ? url1Host : url2Host;
            const worseSeo = seo1 > seo2 ? url2Host : url1Host;
            insights.push(`\u{1F50D} ${betterSeo} has stronger SEO (${Math.max(seo1, seo2)}/100 vs ${Math.min(seo1, seo2)}/100)`);
          }
          if (pageData1.seo.metaDescription?.status === "missing" && pageData2.seo.metaDescription?.status !== "missing") {
            insights.push(`\u{1F4DD} ${url1Host} is missing meta description - ${url2Host} has this covered`);
          } else if (pageData2.seo.metaDescription?.status === "missing" && pageData1.seo.metaDescription?.status !== "missing") {
            insights.push(`\u{1F4DD} ${url2Host} is missing meta description - ${url1Host} has this covered`);
          }
          const noAlt1 = pageData1.seo.imgWithoutAlt || 0;
          const noAlt2 = pageData2.seo.imgWithoutAlt || 0;
          if (noAlt1 > noAlt2 + 5) {
            insights.push(`\u{1F5BC}\uFE0F ${url1Host} has ${noAlt1} images without alt text vs ${url2Host}'s ${noAlt2} - accessibility issue`);
          } else if (noAlt2 > noAlt1 + 5) {
            insights.push(`\u{1F5BC}\uFE0F ${url2Host} has ${noAlt2} images without alt text vs ${url1Host}'s ${noAlt1} - accessibility issue`);
          }
          const load1 = pageData1.performance.loadTime;
          const load2 = pageData2.performance.loadTime;
          const loadDiff = Math.abs(load1 - load2);
          if (loadDiff >= 500) {
            const faster = load1 < load2 ? url1Host : url2Host;
            const slower = load1 < load2 ? url2Host : url1Host;
            const fasterTime = Math.min(load1, load2) / 1e3;
            const slowerTime = Math.max(load1, load2) / 1e3;
            insights.push(`\u26A1 ${faster} loads ${(loadDiff / 1e3).toFixed(1)}s faster (${fasterTime.toFixed(1)}s vs ${slowerTime.toFixed(1)}s)`);
            if (slowerTime > 3) {
              insights.push(`\u{1F40C} ${slower}'s ${slowerTime.toFixed(1)}s load time may hurt conversions - aim for under 3s`);
            }
          }
          const res1 = pageData1.performance.resourceCount || 0;
          const res2 = pageData2.performance.resourceCount || 0;
          if (Math.abs(res1 - res2) >= 20) {
            const lighter = res1 < res2 ? url1Host : url2Host;
            insights.push(`\u{1F4E6} ${lighter} is lighter with ${Math.min(res1, res2)} resources vs ${Math.max(res1, res2)}`);
          }
          const ttfb1 = pageData1.performance.ttfb || 0;
          const ttfb2 = pageData2.performance.ttfb || 0;
          if (Math.abs(ttfb1 - ttfb2) >= 200) {
            const fasterServer = ttfb1 < ttfb2 ? url1Host : url2Host;
            insights.push(`\u{1F5A5}\uFE0F ${fasterServer} has faster server response (TTFB: ${Math.min(ttfb1, ttfb2)}ms vs ${Math.max(ttfb1, ttfb2)}ms)`);
          }
          const qw1 = analysis1.analysis.quickWins?.length || 0;
          const qw2 = analysis2.analysis.quickWins?.length || 0;
          if (qw1 > qw2 + 2) {
            insights.push(`\u{1F4CB} ${url1Host} has more areas to improve (${qw1} quick wins identified vs ${qw2})`);
          } else if (qw2 > qw1 + 2) {
            insights.push(`\u{1F4CB} ${url2Host} has more areas to improve (${qw2} quick wins identified vs ${qw1})`);
          }
          if (winner !== "tie") {
            const winnerHost = winner === "page1" ? url1Host : url2Host;
            const loserHost = winner === "page1" ? url2Host : url1Host;
            const loserStrengths = winner === "page1" ? page2Strengths : page1Strengths;
            if (loserStrengths.length > 0) {
              insights.push(`\u{1F4A1} Recommendation: ${loserHost} could learn from ${winnerHost}, but has strengths in ${loserStrengths[0].split(" (")[0].toLowerCase()}`);
            }
          }
          const stealThis = [];
          const stealThisTemplates = {
            hero: {
              high: "Study their headline structure - it communicates value in under 5 words. Try: '[Benefit] + [Timeframe]' format",
              medium: "Their hero section has better visual hierarchy. Increase headline size by 20% and add more whitespace"
            },
            cta: {
              high: "Their CTA button uses action-oriented text and high-contrast colors. Replace generic 'Submit' with specific action verbs",
              medium: "Their CTA placement is more prominent. Move yours above the fold and increase button size by 15%"
            },
            trust: {
              high: "They leverage social proof effectively with logos and testimonials. Add 3+ recognizable brand logos or customer quotes",
              medium: "Their trust signals are more visible. Add a 'Featured in' section or customer count near your CTA"
            },
            copy: {
              high: "Their copy focuses on benefits over features. Rewrite headlines to answer 'What's in it for me?'",
              medium: "Their copy is more scannable. Add bullet points and break up long paragraphs into 2-3 sentences max"
            },
            design: {
              high: "Their visual design creates clear focus points. Reduce clutter and use whitespace to guide the eye to key elements",
              medium: "Their color contrast is better optimized. Ensure primary CTA has 4.5:1 contrast ratio against background"
            }
          };
          for (const cat of cats) {
            const s1 = analysis1.analysis.scores[cat];
            const s2 = analysis2.analysis.scores[cat];
            const catName = categoryNames[cat];
            if (Math.abs(s1 - s2) >= 1) {
              const catWinner = s1 > s2 ? "page1" : "page2";
              const winnerHost = catWinner === "page1" ? url1Host : url2Host;
              const loserHost = catWinner === "page1" ? url2Host : url1Host;
              const diff = Math.abs(s1 - s2);
              const template = diff >= 3 ? stealThisTemplates[cat].high : stealThisTemplates[cat].medium;
              stealThis.push({
                category: catName,
                winner: winnerHost,
                loser: loserHost,
                winnerScore: catWinner === "page1" ? s1 : s2,
                loserScore: catWinner === "page1" ? s2 : s1,
                recommendation: template
              });
            }
          }
          const weights = { hero: 0.2, cta: 0.25, trust: 0.2, copy: 0.15, design: 0.1 };
          let weightedScore1 = 0;
          let weightedScore2 = 0;
          for (const cat of cats) {
            const w = weights[cat] || 0;
            weightedScore1 += (analysis1.analysis.scores[cat] || 5) * w;
            weightedScore2 += (analysis2.analysis.scores[cat] || 5) * w;
          }
          weightedScore1 += pageData1.seo.score / 10 * 0.05;
          weightedScore2 += pageData2.seo.score / 10 * 0.05;
          const speedScore1 = Math.max(0, 10 - pageData1.performance.loadTime / 1e3);
          const speedScore2 = Math.max(0, 10 - pageData2.performance.loadTime / 1e3);
          weightedScore1 += speedScore1 * 0.05;
          weightedScore2 += speedScore2 * 0.05;
          const total = weightedScore1 + weightedScore2;
          const prob1 = total > 0 ? weightedScore1 / total * 100 : 50;
          const prob2 = total > 0 ? weightedScore2 / total * 100 : 50;
          const conversionLift = total > 0 ? Math.abs((weightedScore1 - weightedScore2) / Math.min(weightedScore1, weightedScore2) * 100) : 0;
          const abTestPrediction = {
            predictedWinner: prob1 > prob2 ? "page1" : prob2 > prob1 ? "page2" : "tie",
            page1Probability: Math.round(prob1),
            page2Probability: Math.round(prob2),
            conversionLift: Math.round(conversionLift),
            confidence: Math.abs(prob1 - prob2) > 20 ? "high" : Math.abs(prob1 - prob2) > 10 ? "medium" : "low"
          };
          return {
            page1: {
              id: id1,
              url: url1,
              screenshotUrl: `/api/screenshot/${id1}`,
              overallScore: score1,
              scores: analysis1.analysis.scores,
              sections: analysis1.analysis.sections,
              seo: pageData1.seo,
              performance: pageData1.performance,
              heatmap: analysis1.heatmap,
              quickWins: analysis1.analysis.quickWins
            },
            page2: {
              id: id2,
              url: url2,
              screenshotUrl: `/api/screenshot/${id2}`,
              overallScore: score2,
              scores: analysis2.analysis.scores,
              sections: analysis2.analysis.sections,
              seo: pageData2.seo,
              performance: pageData2.performance,
              heatmap: analysis2.heatmap,
              quickWins: analysis2.analysis.quickWins
            },
            winner,
            scoreDiff: Math.abs(score1 - score2),
            insights,
            stealThis,
            abTestPrediction
          };
        })(), CONFIG.COMPARE_TOTAL_TIMEOUT_MS, "Compare operation");
        return Response.json(compareResult, { headers: corsHeaders });
      } catch (error32) {
        safeLogError("Compare failed:", error32);
        const errorMsg = error32.message || "";
        if (errorMsg.includes("timed out")) {
          return Response.json({
            error: "Comparison took too long. Try simpler pages or try again later.",
            retryAfter: 30
          }, { status: 504, headers: { ...corsHeaders, "Retry-After": "30" } });
        }
        if (errorMsg.includes("Browser service is busy") || errorMsg.includes("429")) {
          return Response.json({
            error: "Browser service is busy. Compare mode needs 2 screenshots - please wait 1 minute and try again.",
            retryAfter: 60
          }, { status: 429, headers: corsHeaders });
        }
        return Response.json({ error: errorMsg || "Comparison failed. Please try again." }, { status: 500, headers: corsHeaders });
      }
    }
    if (url.pathname === "/api/batch-roast" && request.method === "POST") {
      try {
        const globalLimit = await checkGlobalRateLimit(env22);
        if (!globalLimit.allowed) {
          return Response.json(
            { error: globalLimit.reason, retryAfter: 300 },
            { status: 503, headers: { ...corsHeaders, "Retry-After": "300" } }
          );
        }
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const clientCountry = request.headers.get("CF-IPCountry") || "XX";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT);
        const rateLimit = await checkOperationRateLimit(env22, ipHash, "batch");
        if (!rateLimit.allowed) {
          return Response.json(
            { error: `Batch rate limit exceeded (${CONFIG.RATE_LIMIT_BATCH_MAX}/hour). Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.`, retryAfter: rateLimit.resetIn },
            { status: 429, headers: corsHeaders }
          );
        }
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
        await trackBrowserUsage(env22, validUrls.length);
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
            const pageData = await capturePageWithMetrics(env22, targetUrl, { device });
            if (pageData.screenshot.length > CONFIG.MAX_SCREENSHOT_BYTES) throw new Error("Screenshot too large");
            const base64Screenshot = uint8ArrayToBase64(pageData.screenshot);
            const screenshotKey = `screenshots/${roastId}.jpg`;
            const [_, analysisResult] = await Promise.all([
              env22.SCREENSHOTS.put(screenshotKey, pageData.screenshot, { httpMetadata: { contentType: "image/jpeg" } }),
              analyzeWithVisionAndHeatmap(env22, base64Screenshot, targetUrl, false)
            ]);
            const { analysis, heatmap } = analysisResult;
            const formattedRoast = formatRoast(analysis, targetUrl);
            ctx.waitUntil(
              env22.DB.prepare(`
                INSERT INTO roasts (id, url, url_hash, screenshot_key, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, roast_response, quick_wins, country, industry)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            errors.push({ url: targetUrl, error: "Failed to analyze this page. Please try again." });
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
    if (url.pathname === "/api/roast-stream" && request.method === "POST") {
      try {
        const globalLimit = await checkGlobalRateLimit(env22);
        if (!globalLimit.allowed) {
          return Response.json(
            { error: globalLimit.reason, retryAfter: 300 },
            { status: 503, headers: { ...corsHeaders, "Retry-After": "300" } }
          );
        }
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const clientCountry = request.headers.get("CF-IPCountry") || "XX";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT);
        const rateLimit = await checkOperationRateLimit(env22, ipHash, "roast");
        if (!rateLimit.allowed) {
          return Response.json(
            { error: `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.`, retryAfter: rateLimit.resetIn },
            { status: 429, headers: { ...corsHeaders, "Retry-After": rateLimit.resetIn.toString() } }
          );
        }
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
                const { analysis, heatmap } = await analyzeWithVisionAndHeatmap(env22, base64Screenshot, targetUrl, fullPage);
                await sendEvent("progress", { step: "heatmap", message: "Generating attention heatmap...", progress: 75 });
                const enhancedHeatmap = {
                  ...heatmap,
                  foldLine: pageData.foldLinePercent || heatmap.foldLine
                };
                await sendEvent("heatmap", enhancedHeatmap);
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
                  heatmap: enhancedHeatmap,
                  pageDimensions: pageData.pageDimensions,
                  industry: analysis.industry || "other",
                  benchmarks: analysis.benchmarks || INDUSTRY_BENCHMARKS.other,
                  aiUnavailable: analysis.aiUnavailable || false
                };
                await sendEvent("complete", result);
              })(), CONFIG.ROAST_TOTAL_TIMEOUT_MS, "Stream roast operation");
            } catch (error32) {
              await sendEvent("error", { message: error32.message || "Analysis timed out. Please try again." });
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
      if (!roast) {
        return Response.json({ error: "Roast not found" }, { status: 404, headers: corsHeaders });
      }
      const roastIndustry = roast.industry || "other";
      return Response.json({ ...roast, benchmarks: INDUSTRY_BENCHMARKS[roastIndustry] || INDUSTRY_BENCHMARKS.other }, { headers: corsHeaders });
    }
    if (url.pathname === "/api/recent" && request.method === "GET") {
      const roasts = await env22.DB.prepare(
        "SELECT id, url, overall_score, created_at FROM roasts ORDER BY created_at DESC LIMIT 10"
      ).all();
      return Response.json(roasts.results, { headers: corsHeaders });
    }
    if (url.pathname === "/api/gallery" && request.method === "GET") {
      const roasts = await env22.DB.prepare(`
        SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, created_at
        FROM roasts ORDER BY created_at DESC LIMIT 12
      `).all();
      const results = roasts.results.map((roast) => ({
        ...roast,
        screenshotUrl: `/api/screenshot/${roast.id}`,
        hostname: new URL(roast.url).hostname
      }));
      return Response.json(results, { headers: corsHeaders });
    }
    if (url.pathname === "/api/stats" && request.method === "GET") {
      const stats = await env22.DB.prepare(`
        SELECT COUNT(*) as total_roasts, AVG(overall_score) as avg_score, MAX(created_at) as last_roast FROM roasts
      `).first();
      const visitorCountry = request.headers.get("CF-IPCountry") || "XX";
      let recentCountries = [];
      try {
        const visitors = await env22.DB.prepare(`
          SELECT DISTINCT country FROM visitors 
          WHERE visited_at > datetime('now', '-24 hours') 
          ORDER BY visited_at DESC LIMIT 20
        `).all();
        recentCountries = visitors.results?.map((v) => v.country) || [];
      } catch {
      }
      try {
        await env22.DB.prepare(`
          INSERT OR REPLACE INTO visitors (country, visited_at) VALUES (?, datetime('now'))
        `).bind(visitorCountry).run();
      } catch {
      }
      if (visitorCountry !== "XX" && !recentCountries.includes(visitorCountry)) {
        recentCountries.unshift(visitorCountry);
      }
      return Response.json({
        ...stats,
        visitorCountry,
        recentCountries: recentCountries.slice(0, 12)
      }, { headers: corsHeaders });
    }
    if (url.pathname === "/api/live-activity" && request.method === "GET") {
      try {
        const recentRoasts = await env22.DB.prepare(`
          SELECT id, url, overall_score, country, created_at
          FROM roasts 
          ORDER BY created_at DESC 
          LIMIT 20
        `).all();
        const activity = recentRoasts.results.map((roast) => {
          let hostname = "unknown";
          try {
            hostname = new URL(roast.url).hostname.replace(/^www\./, "");
          } catch {
          }
          const createdAt = /* @__PURE__ */ new Date(roast.created_at + "Z");
          const secondsAgo = Math.floor((Date.now() - createdAt.getTime()) / 1e3);
          let timeAgo = "just now";
          if (secondsAgo >= 60 && secondsAgo < 3600) {
            timeAgo = `${Math.floor(secondsAgo / 60)}m ago`;
          } else if (secondsAgo >= 3600 && secondsAgo < 86400) {
            timeAgo = `${Math.floor(secondsAgo / 3600)}h ago`;
          } else if (secondsAgo >= 86400) {
            timeAgo = `${Math.floor(secondsAgo / 86400)}d ago`;
          }
          return {
            id: roast.id,
            hostname,
            score: roast.overall_score,
            country: roast.country || "XX",
            timeAgo,
            timestamp: roast.created_at
          };
        });
        const stats = await env22.DB.prepare(`
          SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN created_at > datetime('now', '-24 hours') THEN 1 ELSE 0 END) as today
          FROM roasts
        `).first();
        return Response.json({
          activity,
          stats: {
            total: stats?.total || 0,
            today: stats?.today || 0
          }
        }, { headers: corsHeaders });
      } catch (error32) {
        console.error("Live activity error:", error32);
        return Response.json({ activity: [], stats: { total: 0, today: 0 } }, { headers: corsHeaders });
      }
    }
    if (url.pathname === "/api/feedback" && request.method === "POST") {
      try {
        const fbIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const fbIpHash = await hashIp(fbIp, env22.IP_HASH_SALT);
        const fbLimit = await checkOperationRateLimit(env22, fbIpHash, "roast");
        if (!fbLimit.allowed) {
          return Response.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: corsHeaders });
        }
        const body = await request.json();
        const vote = body.vote === "up" || body.vote === "down" ? body.vote : null;
        if (!vote) {
          return Response.json({ error: "Invalid vote" }, { status: 400, headers: corsHeaders });
        }
        const context3 = (body.context || "roast").substring(0, 20);
        const reasons = Array.isArray(body.reasons) ? body.reasons.slice(0, 10).map((r) => String(r).substring(0, 50)).join(",") : "";
        const message = body.message ? String(body.message).substring(0, 1e3).trim() : "";
        const email = body.email ? String(body.email).substring(0, 254).trim() : "";
        const roastId = isValidRoastIdLoose(body.roastId) ? body.roastId : null;
        const feedbackUrl = body.url ? String(body.url).substring(0, 500) : null;
        const country = request.cf?.country || null;
        await env22.DB.prepare(`CREATE TABLE IF NOT EXISTS feedback (
          id TEXT PRIMARY KEY,
          vote TEXT NOT NULL,
          context TEXT,
          reasons TEXT,
          message TEXT,
          email TEXT,
          roast_id TEXT,
          url TEXT,
          ip_hash TEXT,
          country TEXT,
          created_at TEXT DEFAULT (datetime('now'))
        )`).run();
        const id = generateId();
        await env22.DB.prepare(
          `INSERT INTO feedback (id, vote, context, reasons, message, email, roast_id, url, ip_hash, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, vote, context3, reasons, message, email, roastId, feedbackUrl, fbIpHash, country).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (error32) {
        console.error("Feedback error:", error32);
        return Response.json({ error: "Failed to save feedback" }, { status: 500, headers: corsHeaders });
      }
    }
    if (url.pathname === "/api/subscribe" && request.method === "POST") {
      try {
        const subIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const subIpHash = await hashIp(subIp, env22.IP_HASH_SALT);
        const subLimit = await checkOperationRateLimit(env22, subIpHash, "roast");
        if (!subLimit.allowed) {
          return Response.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: corsHeaders });
        }
        const body = await request.json();
        const rawEmail = body.email;
        const roastId = body.roastId;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!rawEmail || rawEmail.length > 254 || !emailRegex.test(rawEmail)) {
          return Response.json({ error: "Please provide a valid email address" }, { status: 400, headers: corsHeaders });
        }
        const email = rawEmail.toLowerCase().trim();
        const validRoastId = isValidRoastIdLoose(roastId) ? roastId : null;
        const id = generateId();
        await env22.DB.prepare(`INSERT OR IGNORE INTO email_subscribers (id, email, roast_id) VALUES (?, ?, ?)`).bind(id, email, validRoastId).run();
        return Response.json({ success: true, message: "Subscribed successfully!" }, { headers: corsHeaders });
      } catch (error32) {
        return Response.json({ error: "Failed to subscribe" }, { status: 500, headers: corsHeaders });
      }
    }
    if (url.pathname.startsWith("/api/badge/") && request.method === "GET" && !url.pathname.includes("/html")) {
      const roastId = url.pathname.split("/").pop();
      if (!isValidRoastIdLoose(roastId)) {
        return new Response("Invalid roast ID", { status: 400, headers: corsHeaders });
      }
      const roast = await env22.DB.prepare("SELECT overall_score, url FROM roasts WHERE id = ?").bind(roastId).first();
      if (!roast) {
        return new Response("Roast not found", { status: 404, headers: corsHeaders });
      }
      const score = roast.overall_score;
      const color = score >= 8 ? "#22C55E" : score >= 6 ? "#EAB308" : score >= 4 ? "#F97316" : "#EF4444";
      const bgColor = score >= 8 ? "#166534" : score >= 6 ? "#854D0E" : score >= 4 ? "#9A3412" : "#991B1B";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="28" viewBox="0 0 120 28">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#1f1f1f"/>
            <stop offset="70%" style="stop-color:#1f1f1f"/>
            <stop offset="70%" style="stop-color:${bgColor}"/>
            <stop offset="100%" style="stop-color:${bgColor}"/>
          </linearGradient>
        </defs>
        <rect width="120" height="28" rx="6" fill="url(#bg)"/>
        <text x="8" y="18" font-family="system-ui, sans-serif" font-size="11" fill="#fff">\u{1F525} Roast Score</text>
        <text x="95" y="18" font-family="system-ui, sans-serif" font-size="12" font-weight="bold" fill="${color}" text-anchor="middle">${score}/10</text>
      </svg>`;
      return new Response(svg, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=3600",
          ...corsHeaders
        }
      });
    }
    if (url.pathname.match(/^\/api\/badge\/[^/]+\/html$/) && request.method === "GET") {
      const roastId = url.pathname.split("/")[3];
      const baseUrl = url.origin;
      const embedCode = `<!-- Roast My Landing Page Badge -->
<a href="${baseUrl}?roast=${roastId}" target="_blank" rel="noopener">
  <img src="${baseUrl}/api/badge/${roastId}" alt="Landing Page Roast Score" />
</a>`;
      return Response.json({
        embedCode,
        badgeUrl: `${baseUrl}/api/badge/${roastId}`,
        linkUrl: `${baseUrl}?roast=${roastId}`
      }, { headers: corsHeaders });
    }
    if (url.pathname === "/api/leaderboard" && request.method === "GET") {
      const roasts = await env22.DB.prepare(`
        SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, created_at
        FROM roasts 
        WHERE overall_score >= 7
        ORDER BY overall_score DESC, created_at DESC 
        LIMIT 10
      `).all();
      const results = roasts.results.map((roast) => ({
        id: roast.id,
        hostname: new URL(roast.url).hostname,
        score: roast.overall_score,
        screenshotUrl: `/api/screenshot/${roast.id}`,
        scores: {
          hero: roast.hero_score,
          cta: roast.cta_score,
          trust: roast.trust_score,
          copy: roast.copy_score,
          design: roast.design_score
        },
        createdAt: roast.created_at
      }));
      return Response.json(results, { headers: corsHeaders });
    }
    if (url.pathname === "/api/leaderboard/shame" && request.method === "GET") {
      try {
        const roasts = await env22.DB.prepare(`
          SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, created_at
          FROM roasts 
          WHERE overall_score <= 4
          ORDER BY overall_score ASC, created_at DESC 
          LIMIT 20
        `).all();
        const results = roasts.results.map((roast) => {
          let hostname = "unknown";
          try {
            hostname = new URL(roast.url).hostname.replace(/^www\./, "");
          } catch {
          }
          return {
            id: roast.id,
            hostname,
            score: roast.overall_score,
            screenshotUrl: `/api/screenshot/${roast.id}`,
            scores: {
              hero: roast.hero_score,
              cta: roast.cta_score,
              trust: roast.trust_score,
              copy: roast.copy_score,
              design: roast.design_score
            },
            createdAt: roast.created_at
          };
        });
        return Response.json(results, { headers: corsHeaders });
      } catch (error32) {
        console.error("Wall of shame error:", error32);
        return Response.json([], { headers: corsHeaders });
      }
    }
    if (url.pathname === "/api/feed" && request.method === "GET") {
      try {
        const page = parseInt(url.searchParams.get("page") || "1");
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 50);
        const offset = (page - 1) * limit;
        const roasts = await env22.DB.prepare(`
          SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, country, created_at
          FROM roasts 
          ORDER BY created_at DESC 
          LIMIT ? OFFSET ?
        `).bind(limit, offset).all();
        const total = await env22.DB.prepare("SELECT COUNT(*) as count FROM roasts").first();
        const results = roasts.results.map((roast) => {
          let hostname = "unknown";
          try {
            hostname = new URL(roast.url).hostname.replace(/^www\./, "");
          } catch {
          }
          const createdAt = /* @__PURE__ */ new Date(roast.created_at + "Z");
          const secondsAgo = Math.floor((Date.now() - createdAt.getTime()) / 1e3);
          let timeAgo = "just now";
          if (secondsAgo >= 60 && secondsAgo < 3600) timeAgo = `${Math.floor(secondsAgo / 60)}m ago`;
          else if (secondsAgo >= 3600 && secondsAgo < 86400) timeAgo = `${Math.floor(secondsAgo / 3600)}h ago`;
          else if (secondsAgo >= 86400) timeAgo = `${Math.floor(secondsAgo / 86400)}d ago`;
          return {
            id: roast.id,
            hostname,
            score: roast.overall_score,
            screenshotUrl: `/api/screenshot/${roast.id}`,
            scores: {
              hero: roast.hero_score,
              cta: roast.cta_score,
              trust: roast.trust_score,
              copy: roast.copy_score,
              design: roast.design_score
            },
            country: roast.country || "XX",
            timeAgo,
            createdAt: roast.created_at
          };
        });
        return Response.json({
          roasts: results,
          pagination: { page, limit, total: total?.count || 0, pages: Math.ceil((total?.count || 0) / limit) }
        }, { headers: corsHeaders });
      } catch (error32) {
        console.error("Feed error:", error32);
        return Response.json({ roasts: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } }, { headers: corsHeaders });
      }
    }
    if ((url.pathname.startsWith("/api/og/") || url.pathname.startsWith("/og/")) && request.method === "GET") {
      const roastId = url.pathname.split("/").pop();
      if (!roastId || roastId !== "default" && !isValidRoastIdLoose(roastId)) {
        return new Response("Invalid ID", { status: 400, headers: corsHeaders });
      }
      if (roastId === "default") {
        const defaultSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
          <defs>
            <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#0f0f0f"/>
              <stop offset="100%" style="stop-color:#1a1a2e"/>
            </linearGradient>
            <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" style="stop-color:#FF6B35"/>
              <stop offset="100%" style="stop-color:#FF8C42"/>
            </linearGradient>
          </defs>
          <rect width="1200" height="630" fill="url(#bg)"/>
          <rect width="1200" height="8" fill="url(#accent)"/>
          <text x="600" y="200" font-family="system-ui, -apple-system, sans-serif" font-size="80" fill="#FF6B35" text-anchor="middle">\u{1F525}</text>
          <text x="600" y="300" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="bold" fill="#ffffff" text-anchor="middle">Roast My Landing Page</text>
          <text x="600" y="380" font-family="system-ui, -apple-system, sans-serif" font-size="28" fill="#6e6e73" text-anchor="middle">AI-Powered Landing Page Analysis</text>
          <text x="600" y="480" font-family="system-ui, -apple-system, sans-serif" font-size="24" fill="#FF6B35" text-anchor="middle">Get your free conversion score in seconds</text>
          <rect x="400" y="520" width="400" height="50" rx="25" fill="url(#accent)"/>
          <text x="600" y="555" font-family="system-ui, -apple-system, sans-serif" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle">Analyze Your Page Free</text>
        </svg>`;
        try {
          const { png } = await renderSvgToPng(env22, defaultSvg, "og-default");
          return new Response(png, {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "public, max-age=2592000",
              // 30 days
              ...corsHeaders
            }
          });
        } catch (err) {
          safeLogError("OG default PNG render failed, falling back to SVG", err);
          return new Response(defaultSvg, {
            headers: {
              "Content-Type": "image/svg+xml",
              "Cache-Control": "public, max-age=86400",
              ...corsHeaders
            }
          });
        }
      }
      const roast = await env22.DB.prepare("SELECT overall_score, url, hero_score, cta_score, trust_score, copy_score, design_score FROM roasts WHERE id = ?").bind(roastId).first();
      if (!roast) {
        return new Response("Roast not found", { status: 404, headers: corsHeaders });
      }
      const score = roast.overall_score;
      let hostname = "Unknown";
      try {
        hostname = new URL(roast.url).hostname.replace("www.", "");
      } catch {
      }
      const scoreColor = score >= 8 ? "#22C55E" : score >= 6 ? "#EAB308" : score >= 4 ? "#F97316" : "#EF4444";
      const verdict = score >= 8 ? "Excellent!" : score >= 6 ? "Good" : score >= 4 ? "Needs Work" : "Critical";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
        <defs>
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#0f0f0f"/>
            <stop offset="100%" style="stop-color:#1a1a2e"/>
          </linearGradient>
          <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#FF6B35"/>
            <stop offset="100%" style="stop-color:#FF8C42"/>
          </linearGradient>
        </defs>
        
        <!-- Background -->
        <rect width="1200" height="630" fill="url(#bg)"/>
        
        <!-- Top accent bar -->
        <rect width="1200" height="8" fill="url(#accent)"/>
        
        <!-- Fire emoji and title -->
        <text x="80" y="100" font-family="system-ui, -apple-system, sans-serif" font-size="48" fill="#FF6B35">\u{1F525}</text>
        <text x="140" y="100" font-family="system-ui, -apple-system, sans-serif" font-size="42" font-weight="bold" fill="#ffffff">Roast My Landing Page</text>
        
        <!-- URL being analyzed -->
        <text x="80" y="160" font-family="system-ui, -apple-system, sans-serif" font-size="28" fill="#9CA3AF">${escapeHtml(hostname.length > 40 ? hostname.substring(0, 40) + "..." : hostname)}</text>
        
        <!-- Big score circle -->
        <circle cx="600" cy="350" r="140" fill="#1f1f1f" stroke="${scoreColor}" stroke-width="12"/>
        <text x="600" y="330" font-family="system-ui, -apple-system, sans-serif" font-size="120" font-weight="bold" fill="${scoreColor}" text-anchor="middle">${score.toFixed(1)}</text>
        <text x="600" y="400" font-family="system-ui, -apple-system, sans-serif" font-size="32" fill="#9CA3AF" text-anchor="middle">/ 10</text>
        
        <!-- Verdict -->
        <text x="600" y="520" font-family="system-ui, -apple-system, sans-serif" font-size="36" font-weight="bold" fill="${scoreColor}" text-anchor="middle">${verdict}</text>
        
        <!-- Score bars on right side -->
        <text x="900" y="220" font-family="system-ui, -apple-system, sans-serif" font-size="18" fill="#9CA3AF">Hero</text>
        <rect x="900" y="230" width="200" height="12" rx="6" fill="#2a2a2a"/>
        <rect x="900" y="230" width="${roast.hero_score / 10 * 200}" height="12" rx="6" fill="#8B5CF6"/>
        
        <text x="900" y="280" font-family="system-ui, -apple-system, sans-serif" font-size="18" fill="#9CA3AF">CTA</text>
        <rect x="900" y="290" width="200" height="12" rx="6" fill="#2a2a2a"/>
        <rect x="900" y="290" width="${roast.cta_score / 10 * 200}" height="12" rx="6" fill="#F97316"/>
        
        <text x="900" y="340" font-family="system-ui, -apple-system, sans-serif" font-size="18" fill="#9CA3AF">Trust</text>
        <rect x="900" y="350" width="200" height="12" rx="6" fill="#2a2a2a"/>
        <rect x="900" y="350" width="${roast.trust_score / 10 * 200}" height="12" rx="6" fill="#22C55E"/>
        
        <text x="900" y="400" font-family="system-ui, -apple-system, sans-serif" font-size="18" fill="#9CA3AF">Copy</text>
        <rect x="900" y="410" width="200" height="12" rx="6" fill="#2a2a2a"/>
        <rect x="900" y="410" width="${roast.copy_score / 10 * 200}" height="12" rx="6" fill="#3B82F6"/>
        
        <text x="900" y="460" font-family="system-ui, -apple-system, sans-serif" font-size="18" fill="#9CA3AF">Design</text>
        <rect x="900" y="470" width="200" height="12" rx="6" fill="#2a2a2a"/>
        <rect x="900" y="470" width="${roast.design_score / 10 * 200}" height="12" rx="6" fill="#EC4899"/>
        
        <!-- Footer -->
        <text x="600" y="600" font-family="system-ui, -apple-system, sans-serif" font-size="20" fill="#6B7280" text-anchor="middle">Get your free AI landing page analysis at roastmypage.site</text>
      </svg>`;
      try {
        const { png } = await renderSvgToPng(env22, svg, `og-${roastId}`);
        return new Response(png, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=2592000",
            // 30 days
            ...corsHeaders
          }
        });
      } catch (err) {
        safeLogError("OG PNG render failed, falling back to SVG", err);
        return new Response(svg, {
          headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=86400",
            ...corsHeaders
          }
        });
      }
    }
    if (url.pathname.startsWith("/api/card/") && request.method === "GET") {
      const roastId = url.pathname.split("/").pop();
      if (!isValidRoastIdLoose(roastId)) {
        return new Response("Invalid roast ID", { status: 400, headers: corsHeaders });
      }
      const roast = await env22.DB.prepare(
        "SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, industry, created_at FROM roasts WHERE id = ?"
      ).bind(roastId).first();
      if (!roast) {
        return new Response("Roast not found", { status: 404, headers: corsHeaders });
      }
      const score = parseFloat(roast.overall_score) || 0;
      let hostname = "";
      try {
        hostname = new URL(roast.url).hostname.replace("www.", "");
      } catch {
        hostname = roast.url;
      }
      const cardIndustry = roast.industry || "other";
      const cardBenchmark = INDUSTRY_BENCHMARKS[cardIndustry] || INDUSTRY_BENCHMARKS.other;
      const scoreColor = score >= 8 ? "#34D399" : score >= 6 ? "#FBBF24" : score >= 4 ? "#FB923C" : "#F87171";
      const scoreBg = score >= 8 ? "rgba(52,211,153,0.08)" : score >= 6 ? "rgba(251,191,36,0.08)" : score >= 4 ? "rgba(251,146,60,0.08)" : "rgba(248,113,113,0.08)";
      const verdict = score >= 8 ? "Excellent" : score >= 6 ? "Decent" : score >= 4 ? "Needs Work" : "Ouch";
      const flameCount = Math.max(1, Math.min(5, Math.round(score / 2)));
      const flames = Array(flameCount).fill("\u{1F525}").join("");
      let screenshotDataUri = "";
      try {
        const screenshot = await env22.SCREENSHOTS.get(`screenshots/${roastId}.jpg`);
        if (screenshot) {
          const buf = await screenshot.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const b64 = btoa(binary);
          screenshotDataUri = `data:image/jpeg;base64,${b64}`;
        } else {
          const pngScreenshot = await env22.SCREENSHOTS.get(`screenshots/${roastId}.png`);
          if (pngScreenshot) {
            const buf = await pngScreenshot.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const b64 = btoa(binary);
            screenshotDataUri = `data:image/png;base64,${b64}`;
          }
        }
      } catch (e) {
      }
      const categories = [
        { label: "Hero", score: parseFloat(roast.hero_score) || 0, color: "#A78BFA" },
        { label: "CTA", score: parseFloat(roast.cta_score) || 0, color: "#FB923C" },
        { label: "Trust", score: parseFloat(roast.trust_score) || 0, color: "#34D399" },
        { label: "Copy", score: parseFloat(roast.copy_score) || 0, color: "#60A5FA" },
        { label: "Design", score: parseFloat(roast.design_score) || 0, color: "#F472B6" }
      ];
      const arcRadius = 72;
      const arcCx = 160;
      const arcCy = 300;
      const arcStartAngle = -225;
      const arcSweep = 270;
      const arcEndAngle = arcStartAngle + arcSweep;
      const scoreAngle = arcStartAngle + score / 10 * arcSweep;
      const toRad = /* @__PURE__ */ __name2((d) => d * Math.PI / 180, "toRad");
      const arcX = /* @__PURE__ */ __name2((angle, r) => arcCx + r * Math.cos(toRad(angle)), "arcX");
      const arcY = /* @__PURE__ */ __name2((angle, r) => arcCy + r * Math.sin(toRad(angle)), "arcY");
      const bgArcStart = { x: arcX(arcStartAngle, arcRadius), y: arcY(arcStartAngle, arcRadius) };
      const bgArcEnd = { x: arcX(arcEndAngle, arcRadius), y: arcY(arcEndAngle, arcRadius) };
      const bgArcPath = `M ${bgArcStart.x} ${bgArcStart.y} A ${arcRadius} ${arcRadius} 0 1 1 ${bgArcEnd.x} ${bgArcEnd.y}`;
      const scoreArcEnd = { x: arcX(scoreAngle, arcRadius), y: arcY(scoreAngle, arcRadius) };
      const largeArc = scoreAngle - arcStartAngle > 180 ? 1 : 0;
      const scoreArcPath = score > 0 ? `M ${bgArcStart.x} ${bgArcStart.y} A ${arcRadius} ${arcRadius} 0 ${largeArc} 1 ${scoreArcEnd.x} ${scoreArcEnd.y}` : "";
      const barX = 340;
      const barStartY = 218;
      const barGap = 42;
      const barWidth = 200;
      const barHeight = 8;
      const benchScoreKeys = ["hero", "cta", "trust", "copy", "design"];
      const categoryBarsSvg = categories.map((cat, i) => {
        const y = barStartY + i * barGap;
        const fillWidth = Math.max(2, cat.score / 10 * barWidth);
        const benchAvg = cardBenchmark.scores[benchScoreKeys[i]] || 5;
        const benchX = barX + benchAvg / 10 * barWidth;
        return `
          <text x="${barX}" y="${y - 8}" font-family="'SF Pro Display', 'Inter', system-ui, sans-serif" font-size="11" fill="#a1a1a6" letter-spacing="0.02em">${cat.label}</text>
          <text x="${barX + barWidth}" y="${y - 8}" font-family="'SF Pro Display', 'Inter', system-ui, sans-serif" font-size="11" fill="${cat.color}" text-anchor="end" font-weight="600">${cat.score.toFixed(1)}</text>
          <rect x="${barX}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="rgba(255,255,255,0.04)"/>
          <rect x="${barX}" y="${y}" width="${fillWidth}" height="${barHeight}" rx="4" fill="${cat.color}"/>
          <line x1="${benchX}" y1="${y - 2}" x2="${benchX}" y2="${y + barHeight + 2}" stroke="rgba(161,161,166,0.4)" stroke-width="1" stroke-dasharray="2,2"/>
        `;
      }).join("");
      const screenshotSvg = screenshotDataUri ? `
        <defs>
          <clipPath id="screenClip">
            <rect x="600" y="60" width="540" height="360" rx="12"/>
          </clipPath>
        </defs>
        <rect x="600" y="60" width="540" height="360" rx="12" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
        <image href="${screenshotDataUri}" x="600" y="60" width="540" height="360" clip-path="url(#screenClip)" preserveAspectRatio="xMidYMin slice"/>
        <rect x="600" y="60" width="540" height="360" rx="12" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>
      ` : `
        <rect x="600" y="60" width="540" height="360" rx="12" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
        <text x="870" y="240" font-family="'SF Pro Display', 'Inter', system-ui, sans-serif" font-size="14" fill="#424245" text-anchor="middle">${escapeHtml(hostname)}</text>
      `;
      const cardSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
        <defs>
          <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#0a0a0a"/>
            <stop offset="50%" style="stop-color:#111111"/>
            <stop offset="100%" style="stop-color:#0d0d0d"/>
          </linearGradient>
          <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#FF6B35"/>
            <stop offset="100%" style="stop-color:#FF8C42"/>
          </linearGradient>
          <linearGradient id="scoreGlow" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:${scoreColor};stop-opacity:0.3"/>
            <stop offset="100%" style="stop-color:${scoreColor};stop-opacity:0"/>
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        
        <!-- Background -->
        <rect width="1200" height="630" fill="url(#cardBg)"/>
        
        <!-- Subtle grid pattern -->
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.015)" stroke-width="0.5"/>
        </pattern>
        <rect width="1200" height="630" fill="url(#grid)"/>
        
        <!-- Top accent line -->
        <rect width="1200" height="3" fill="url(#accentGrad)"/>
        
        <!-- Score glow effect -->
        <circle cx="${arcCx}" cy="${arcCy}" r="110" fill="url(#scoreGlow)" opacity="0.4"/>

        <!-- Left panel: Score + Categories -->
        <!-- Brand mark -->
        <text x="60" y="100" font-family="'SF Pro Display', 'Inter', system-ui, sans-serif" font-size="15" fill="#FF6B35" font-weight="600" letter-spacing="0.04em">ROAST MY LANDING PAGE</text>
        
        <!-- URL being analyzed -->
        <text x="60" y="130" font-family="'SF Pro Display', 'Inter', system-ui, sans-serif" font-size="18" fill="#f5f5f7" font-weight="500">${escapeHtml(hostname.length > 28 ? hostname.substring(0, 28) + "..." : hostname)}</text>
        
        <!-- Industry badge -->
        <rect x="60" y="145" width="${Math.max(80, cardBenchmark.label.length * 8 + 40)}" height="22" rx="11" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.06)" stroke-width="0.5"/>
        <text x="76" y="160" font-family="'SF Pro Display', 'Inter', system-ui, sans-serif" font-size="11" fill="#a1a1a6">${cardBenchmark.emoji} ${cardBenchmark.label}</text>

        <!-- Score arc gauge -->
        <path d="${bgArcPath}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="10" stroke-linecap="round"/>
        ${score > 0 ? `<path d="${scoreArcPath}" fill="none" stroke="${scoreColor}" stroke-width="10" stroke-linecap="round" filter="url(#glow)"/>` : ""}
        
        <!-- Score number in center of arc -->
        <text x="${arcCx}" y="${arcCy - 8}" font-family="'SF Pro Display', 'Inter', system-ui, sans-serif" font-size="52" font-weight="700" fill="${scoreColor}" text-anchor="middle">${score.toFixed(1)}</text>
        <text x="${arcCx}" y="${arcCy + 20}" font-family="'SF Pro Display', 'Inter', system-ui, sans-serif" font-size="14" fill="#6e6e73" text-anchor="middle">/ 10</text>
        
        <!-- Verdict below arc -->
        <text x="${arcCx}" y="${arcCy + 58}" font-family="'SF Pro Display', 'Inter', system-ui, sans-serif" font-size="16" font-weight="600" fill="${scoreColor}" text-anchor="middle">${verdict} ${flames}</text>

        <!-- Category breakdown bars -->
        ${categoryBarsSvg}

        <!-- Right panel: Screenshot -->
        ${screenshotSvg}
        
        <!-- URL label under screenshot -->
        <text x="870" y="445" font-family="'SF Pro Display', 'Inter', system-ui, sans-serif" font-size="12" fill="#6e6e73" text-anchor="middle">${escapeHtml(hostname.length > 50 ? hostname.substring(0, 50) + "..." : hostname)}</text>

        <!-- Bottom bar -->
        <rect x="0" y="590" width="1200" height="40" fill="rgba(0,0,0,0.5)"/>
        <rect x="0" y="590" width="1200" height="1" fill="rgba(255,255,255,0.04)"/>
        <text x="60" y="616" font-family="'SF Pro Display', 'Inter', system-ui, sans-serif" font-size="13" fill="#6e6e73">roastmypage.site</text>
        <text x="1140" y="616" font-family="'SF Pro Display', 'Inter', system-ui, sans-serif" font-size="13" fill="#424245" text-anchor="end">Free AI Landing Page Analysis</text>
      </svg>`;
      try {
        const { png } = await renderSvgToPng(env22, cardSvg, `card-${roastId}`);
        return new Response(png, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "public, max-age=2592000",
            // 30 days
            ...corsHeaders
          }
        });
      } catch (err) {
        safeLogError("Card PNG render failed, falling back to SVG", err);
        return new Response(cardSvg, {
          headers: {
            "Content-Type": "image/svg+xml",
            "Cache-Control": "public, max-age=86400",
            ...corsHeaders
          }
        });
      }
    }
    if (url.pathname === "/api/leaderboard/weekly" && request.method === "GET") {
      const roasts = await env22.DB.prepare(`
        SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, created_at
        FROM roasts 
        WHERE created_at > datetime('now', '-7 days')
        ORDER BY overall_score DESC, created_at DESC 
        LIMIT 20
      `).all();
      const results = roasts.results.map((roast, index) => {
        let hostname = "unknown";
        try {
          hostname = new URL(roast.url).hostname.replace("www.", "");
        } catch {
        }
        return {
          rank: index + 1,
          id: roast.id,
          hostname,
          url: roast.url,
          score: roast.overall_score,
          screenshotUrl: `/api/screenshot/${roast.id}`,
          ogImageUrl: `/api/og/${roast.id}`,
          scores: {
            hero: roast.hero_score,
            cta: roast.cta_score,
            trust: roast.trust_score,
            copy: roast.copy_score,
            design: roast.design_score
          },
          createdAt: roast.created_at
        };
      });
      const weekStats = await env22.DB.prepare(`
        SELECT 
          COUNT(*) as total_roasts,
          ROUND(AVG(overall_score), 1) as avg_score,
          MAX(overall_score) as top_score
        FROM roasts 
        WHERE created_at > datetime('now', '-7 days')
      `).first();
      return Response.json({
        leaderboard: results,
        stats: weekStats,
        period: "Last 7 days"
      }, { headers: corsHeaders });
    }
    if (url.pathname === "/api/leaderboard/alltime" && request.method === "GET") {
      const roasts = await env22.DB.prepare(`
        SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, created_at
        FROM roasts 
        ORDER BY overall_score DESC, created_at DESC 
        LIMIT 20
      `).all();
      const results = roasts.results.map((roast, index) => {
        let hostname = "unknown";
        try {
          hostname = new URL(roast.url).hostname.replace("www.", "");
        } catch {
        }
        return {
          rank: index + 1,
          id: roast.id,
          hostname,
          url: roast.url,
          score: roast.overall_score,
          screenshotUrl: `/api/screenshot/${roast.id}`,
          ogImageUrl: `/api/og/${roast.id}`,
          scores: {
            hero: roast.hero_score,
            cta: roast.cta_score,
            trust: roast.trust_score,
            copy: roast.copy_score,
            design: roast.design_score
          },
          createdAt: roast.created_at
        };
      });
      return Response.json({
        leaderboard: results,
        period: "All time"
      }, { headers: corsHeaders });
    }
    if (url.pathname.startsWith("/api/improvement/") && request.method === "GET") {
      const urlHashParam = url.pathname.split("/").pop();
      const roasts = await env22.DB.prepare(`
        SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, created_at
        FROM roasts 
        WHERE url_hash = ?
        ORDER BY created_at ASC
      `).bind(urlHashParam).all();
      if (!roasts.results || roasts.results.length === 0) {
        return Response.json({ error: "No roasts found for this URL" }, { status: 404, headers: corsHeaders });
      }
      const first2 = roasts.results[0];
      const latest = roasts.results[roasts.results.length - 1];
      let hostname = "unknown";
      try {
        hostname = new URL(first2.url).hostname.replace("www.", "");
      } catch {
      }
      const improvement = {
        hostname,
        url: first2.url,
        totalRoasts: roasts.results.length,
        firstRoast: {
          id: first2.id,
          score: first2.overall_score,
          scores: { hero: first2.hero_score, cta: first2.cta_score, trust: first2.trust_score, copy: first2.copy_score, design: first2.design_score },
          date: first2.created_at,
          screenshotUrl: `/api/screenshot/${first2.id}`
        },
        latestRoast: {
          id: latest.id,
          score: latest.overall_score,
          scores: { hero: latest.hero_score, cta: latest.cta_score, trust: latest.trust_score, copy: latest.copy_score, design: latest.design_score },
          date: latest.created_at,
          screenshotUrl: `/api/screenshot/${latest.id}`
        },
        scoreChange: latest.overall_score - first2.overall_score,
        categoryChanges: {
          hero: latest.hero_score - first2.hero_score,
          cta: latest.cta_score - first2.cta_score,
          trust: latest.trust_score - first2.trust_score,
          copy: latest.copy_score - first2.copy_score,
          design: latest.design_score - first2.design_score
        },
        history: roasts.results.map((r) => ({
          id: r.id,
          score: r.overall_score,
          date: r.created_at
        }))
      };
      return Response.json(improvement, { headers: corsHeaders });
    }
    if (url.pathname === "/api/showcase" && request.method === "GET") {
      const improvements = await env22.DB.prepare(`
        WITH url_roasts AS (
          SELECT 
            url_hash,
            url,
            overall_score,
            created_at,
            id,
            ROW_NUMBER() OVER (PARTITION BY url_hash ORDER BY created_at ASC) as first_roast,
            ROW_NUMBER() OVER (PARTITION BY url_hash ORDER BY created_at DESC) as latest_roast
          FROM roasts
        ),
        first_scores AS (
          SELECT url_hash, url, overall_score as first_score, id as first_id, created_at as first_date
          FROM url_roasts WHERE first_roast = 1
        ),
        latest_scores AS (
          SELECT url_hash, overall_score as latest_score, id as latest_id, created_at as latest_date
          FROM url_roasts WHERE latest_roast = 1
        )
        SELECT 
          f.url_hash,
          f.url,
          f.first_score,
          f.first_id,
          f.first_date,
          l.latest_score,
          l.latest_id,
          l.latest_date,
          (l.latest_score - f.first_score) as improvement
        FROM first_scores f
        JOIN latest_scores l ON f.url_hash = l.url_hash
        WHERE f.first_id != l.latest_id
          AND l.latest_score > f.first_score
        ORDER BY improvement DESC
        LIMIT 10
      `).all();
      const showcase = improvements.results.map((item) => {
        let hostname = "unknown";
        try {
          hostname = new URL(item.url).hostname.replace("www.", "");
        } catch {
        }
        return {
          hostname,
          url: item.url,
          urlHash: item.url_hash,
          before: {
            id: item.first_id,
            score: item.first_score,
            date: item.first_date,
            screenshotUrl: `/api/screenshot/${item.first_id}`
          },
          after: {
            id: item.latest_id,
            score: item.latest_score,
            date: item.latest_date,
            screenshotUrl: `/api/screenshot/${item.latest_id}`
          },
          improvement: item.improvement,
          improvementPercent: item.first_score > 0 ? Math.round(item.improvement / item.first_score * 100) : 0
        };
      });
      return Response.json({
        showcase,
        totalImprovements: showcase.length
      }, { headers: corsHeaders });
    }
    if (url.pathname === "/api/featured" && request.method === "GET") {
      const featuredDomains = [
        "stripe.com",
        "notion.so",
        "linear.app",
        "vercel.com",
        "figma.com",
        "shopify.com",
        "github.com",
        "cloudflare.com",
        "netflix.com",
        "airbnb.com",
        "spotify.com",
        "slack.com",
        "dropbox.com",
        "twitch.tv",
        "discord.com",
        "tailwindcss.com",
        "nextjs.org",
        "webflow.com",
        "framer.com",
        "producthunt.com",
        "samsung.com",
        "nokia.com",
        "paypal.com",
        "revolut.com",
        "flipkart.com",
        "google.com",
        "facebook.com",
        "amazon.com",
        "apple.com",
        "microsoft.com"
      ];
      const likeClauses = featuredDomains.map(() => `(url LIKE ?)`).join(" OR ");
      const likeParams = featuredDomains.map((d) => `%${d}%`);
      const featured = await env22.DB.prepare(`
        SELECT r.id, r.url, r.overall_score, r.hero_score, r.cta_score, r.trust_score, r.copy_score, r.design_score, r.industry, r.created_at
        FROM roasts r
        INNER JOIN (
          SELECT url, MAX(created_at) as latest
          FROM roasts
          WHERE ${likeClauses}
          GROUP BY url
        ) latest ON r.url = latest.url AND r.created_at = latest.latest
        ORDER BY r.overall_score DESC
        LIMIT 12
      `).bind(...likeParams).all();
      let results = featured.results || [];
      if (results.length < 6) {
        const existingIds = results.map((r) => r.id);
        const excludeClause = existingIds.length > 0 ? `AND id NOT IN (${existingIds.map(() => "?").join(",")})` : "";
        const padding = await env22.DB.prepare(`
          SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, industry, created_at
          FROM roasts
          WHERE overall_score > 0 ${excludeClause}
          ORDER BY overall_score DESC, created_at DESC
          LIMIT ?
        `).bind(...existingIds, 12 - results.length).all();
        results = [...results, ...padding.results || []];
      }
      const formatted = results.map((r) => {
        let hostname = "";
        try {
          hostname = new URL(r.url).hostname.replace("www.", "");
        } catch {
          hostname = r.url;
        }
        return {
          id: r.id,
          url: r.url,
          hostname,
          overallScore: r.overall_score,
          scores: {
            hero: r.hero_score,
            cta: r.cta_score,
            trust: r.trust_score,
            copy: r.copy_score,
            design: r.design_score
          },
          industry: r.industry || "other",
          screenshotUrl: `/api/screenshot/${r.id}`,
          createdAt: r.created_at
        };
      });
      return Response.json(formatted, {
        headers: { ...corsHeaders, "Cache-Control": "public, max-age=3600" }
      });
    }
    if (url.pathname.match(/^\/api\/badge\/[^/]+\/large$/) && request.method === "GET") {
      const roastId = url.pathname.split("/")[3];
      const roast = await env22.DB.prepare("SELECT overall_score, url FROM roasts WHERE id = ?").bind(roastId).first();
      if (!roast) {
        return new Response("Roast not found", { status: 404, headers: corsHeaders });
      }
      const score = roast.overall_score;
      let hostname = "unknown";
      try {
        hostname = new URL(roast.url).hostname.replace("www.", "");
      } catch {
      }
      const scoreColor = score >= 8 ? "#22C55E" : score >= 6 ? "#EAB308" : score >= 4 ? "#F97316" : "#EF4444";
      const verdict = score >= 8 ? "Excellent" : score >= 6 ? "Good" : score >= 4 ? "Needs Work" : "Critical";
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80">
        <defs>
          <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#1f1f1f"/>
            <stop offset="100%" style="stop-color:#2a2a2a"/>
          </linearGradient>
        </defs>
        <rect width="200" height="80" rx="10" fill="url(#bgGrad)"/>
        <rect width="200" height="4" fill="#FF6B35"/>
        <text x="15" y="30" font-family="system-ui, sans-serif" font-size="12" fill="#9CA3AF">\u{1F525} Roast Score</text>
        <text x="15" y="55" font-family="system-ui, sans-serif" font-size="28" font-weight="bold" fill="${scoreColor}">${score}/10</text>
        <text x="95" y="55" font-family="system-ui, sans-serif" font-size="14" fill="${scoreColor}">${verdict}</text>
        <text x="15" y="72" font-family="system-ui, sans-serif" font-size="9" fill="#6B7280">${escapeHtml(hostname.length > 25 ? hostname.substring(0, 25) + "..." : hostname)}</text>
      </svg>`;
      return new Response(svg, {
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=3600",
          ...corsHeaders
        }
      });
    }
    if (url.pathname.startsWith("/api/industry/") && request.method === "GET") {
      const parts = url.pathname.split("/");
      const industry = parts[3];
      if (!industry) {
        return Response.json({ error: "Industry parameter required" }, { status: 400, headers: corsHeaders });
      }
      if (industry === "all") {
        try {
          const industryStats = await env22.DB.prepare(`
            SELECT 
              industry,
              COUNT(*) as count,
              ROUND(AVG(overall_score), 1) as avg_overall,
              ROUND(AVG(hero_score), 1) as avg_hero,
              ROUND(AVG(cta_score), 1) as avg_cta,
              ROUND(AVG(trust_score), 1) as avg_trust,
              ROUND(AVG(copy_score), 1) as avg_copy,
              ROUND(AVG(design_score), 1) as avg_design,
              MAX(overall_score) as best_score,
              MIN(overall_score) as worst_score
            FROM roasts
            WHERE industry IS NOT NULL
            GROUP BY industry
            ORDER BY count DESC
          `).all();
          const industryScores = {};
          for (const stat2 of industryStats.results) {
            const ind = stat2.industry;
            const detailScores = await env22.DB.prepare(`
              SELECT seo_data, performance_data
              FROM roasts
              WHERE industry = ?
              AND seo_data IS NOT NULL
              AND performance_data IS NOT NULL
            `).bind(ind).all();
            let seoSum = 0, perfSum = 0, a11ySum = 0, validCount = 0;
            for (const row of detailScores.results) {
              try {
                const seoData = JSON.parse(row.seo_data);
                const perfData = JSON.parse(row.performance_data);
                if (seoData?.score != null) seoSum += seoData.score;
                if (perfData?.score != null) perfSum += perfData.score;
                if (perfData?.accessibility != null) a11ySum += perfData.accessibility;
                validCount++;
              } catch (e) {
              }
            }
            const benchmark = INDUSTRY_BENCHMARKS[ind] || INDUSTRY_BENCHMARKS["other"];
            industryScores[ind] = {
              label: benchmark.label,
              emoji: benchmark.emoji,
              count: stat2.count,
              scores: {
                overall: stat2.avg_overall,
                hero: stat2.avg_hero,
                cta: stat2.avg_cta,
                trust: stat2.avg_trust,
                copy: stat2.avg_copy,
                design: stat2.avg_design
              },
              seo: validCount > 0 ? Math.round(seoSum / validCount) : benchmark.seo,
              performance: validCount > 0 ? Math.round(perfSum / validCount) : benchmark.performance,
              accessibility: validCount > 0 ? Math.round(a11ySum / validCount) : benchmark.accessibility,
              bestScore: stat2.best_score,
              worstScore: stat2.worst_score,
              // Include static benchmark for comparison (if feature flag is on)
              staticBenchmark: CONFIG.ENABLE_COMPUTED_INDUSTRY_BENCHMARKS ? benchmark.scores : null
            };
          }
          for (const [key, benchmark] of Object.entries(INDUSTRY_BENCHMARKS)) {
            if (!industryScores[key]) {
              industryScores[key] = {
                label: benchmark.label,
                emoji: benchmark.emoji,
                count: 0,
                scores: benchmark.scores,
                seo: benchmark.seo,
                performance: benchmark.performance,
                accessibility: benchmark.accessibility,
                bestScore: null,
                worstScore: null,
                staticBenchmark: benchmark.scores
              };
            }
          }
          return Response.json({
            industries: industryScores,
            total: industryStats.results.reduce((sum, s) => sum + s.count, 0),
            computedFrom: "real_data",
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          }, { headers: corsHeaders });
        } catch (error32) {
          console.error("Industry stats error:", error32);
          return Response.json({ error: "Failed to compute industry stats" }, { status: 500, headers: corsHeaders });
        }
      }
      try {
        const normalizedIndustry = resolveIndustry(industry);
        const staticBenchmark = INDUSTRY_BENCHMARKS[normalizedIndustry];
        if (!staticBenchmark) {
          return Response.json({ error: "Unknown industry" }, { status: 404, headers: corsHeaders });
        }
        const stats = await env22.DB.prepare(`
          SELECT 
            COUNT(*) as count,
            ROUND(AVG(overall_score), 1) as avg_overall,
            ROUND(AVG(hero_score), 1) as avg_hero,
            ROUND(AVG(cta_score), 1) as avg_cta,
            ROUND(AVG(trust_score), 1) as avg_trust,
            ROUND(AVG(copy_score), 1) as avg_copy,
            ROUND(AVG(design_score), 1) as avg_design,
            MAX(overall_score) as best_score,
            MIN(overall_score) as worst_score
          FROM roasts
          WHERE industry = ?
        `).bind(normalizedIndustry).first();
        const topPages = await env22.DB.prepare(`
          SELECT id, url, overall_score, created_at
          FROM roasts
          WHERE industry = ? AND overall_score IS NOT NULL
          ORDER BY overall_score DESC
          LIMIT 5
        `).bind(normalizedIndustry).all();
        const detailScores = await env22.DB.prepare(`
          SELECT seo_data, performance_data
          FROM roasts
          WHERE industry = ?
          AND seo_data IS NOT NULL
          AND performance_data IS NOT NULL
        `).bind(normalizedIndustry).all();
        let seoSum = 0, perfSum = 0, a11ySum = 0, validCount = 0;
        for (const row of detailScores.results) {
          try {
            const seoData = JSON.parse(row.seo_data);
            const perfData = JSON.parse(row.performance_data);
            if (seoData?.score != null) seoSum += seoData.score;
            if (perfData?.score != null) perfSum += perfData.score;
            if (perfData?.accessibility != null) a11ySum += perfData.accessibility;
            validCount++;
          } catch (e) {
          }
        }
        const count32 = stats?.count || 0;
        const useComputed = CONFIG.ENABLE_COMPUTED_INDUSTRY_BENCHMARKS && count32 >= 3;
        return Response.json({
          industry: normalizedIndustry,
          label: staticBenchmark.label,
          emoji: staticBenchmark.emoji,
          sampleSize: count32,
          scores: useComputed ? {
            overall: stats.avg_overall,
            hero: stats.avg_hero,
            cta: stats.avg_cta,
            trust: stats.avg_trust,
            copy: stats.avg_copy,
            design: stats.avg_design
          } : staticBenchmark.scores,
          seo: useComputed && validCount > 0 ? Math.round(seoSum / validCount) : staticBenchmark.seo,
          performance: useComputed && validCount > 0 ? Math.round(perfSum / validCount) : staticBenchmark.performance,
          accessibility: useComputed && validCount > 0 ? Math.round(a11ySum / validCount) : staticBenchmark.accessibility,
          bestScore: stats?.best_score,
          worstScore: stats?.worst_score,
          topPages: topPages.results.map((p) => ({
            id: p.id,
            hostname: new URL(p.url).hostname,
            score: p.overall_score,
            createdAt: p.created_at
          })),
          computedFrom: useComputed ? "real_data" : "static_baseline",
          staticBenchmark: staticBenchmark.scores,
          // Always include for comparison
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }, { headers: corsHeaders });
      } catch (error32) {
        console.error("Industry query error:", error32);
        return Response.json({ error: "Failed to fetch industry data" }, { status: 500, headers: corsHeaders });
      }
    }
    if (url.pathname === "/api/analytics" && request.method === "GET") {
      try {
        const scoreDistribution = await env22.DB.prepare(`
          SELECT 
            CASE 
              WHEN overall_score >= 9 THEN '9-10'
              WHEN overall_score >= 7 THEN '7-8'
              WHEN overall_score >= 5 THEN '5-6'
              WHEN overall_score >= 3 THEN '3-4'
              ELSE '1-2'
            END as range,
            COUNT(*) as count
          FROM roasts
          GROUP BY range
          ORDER BY range DESC
        `).all();
        const categoryAverages = await env22.DB.prepare(`
          SELECT 
            ROUND(AVG(hero_score), 1) as hero,
            ROUND(AVG(cta_score), 1) as cta,
            ROUND(AVG(trust_score), 1) as trust,
            ROUND(AVG(copy_score), 1) as copy,
            ROUND(AVG(design_score), 1) as design
          FROM roasts
        `).first();
        const topDomains = await env22.DB.prepare(`
          SELECT 
            url,
            COUNT(*) as roast_count,
            ROUND(AVG(overall_score), 1) as avg_score,
            MAX(overall_score) as best_score
          FROM roasts
          GROUP BY url
          ORDER BY roast_count DESC
          LIMIT 10
        `).all();
        const recentActivity = await env22.DB.prepare(`
          SELECT id, url, overall_score, created_at
          FROM roasts
          ORDER BY created_at DESC
          LIMIT 10
        `).all();
        const dailyRoasts = await env22.DB.prepare(`
          SELECT 
            DATE(created_at) as date,
            COUNT(*) as count,
            ROUND(AVG(overall_score), 1) as avg_score
          FROM roasts
          WHERE created_at > datetime('now', '-7 days')
          GROUP BY DATE(created_at)
          ORDER BY date ASC
        `).all();
        const overallStats = await env22.DB.prepare(`
          SELECT 
            COUNT(*) as total_roasts,
            ROUND(AVG(overall_score), 1) as avg_score,
            MAX(overall_score) as highest_score,
            MIN(overall_score) as lowest_score,
            COUNT(DISTINCT url) as unique_urls
          FROM roasts
        `).first();
        const bestPage = await env22.DB.prepare(`
          SELECT url, overall_score FROM roasts ORDER BY overall_score DESC LIMIT 1
        `).first();
        const worstPage = await env22.DB.prepare(`
          SELECT url, overall_score FROM roasts ORDER BY overall_score ASC LIMIT 1
        `).first();
        const formattedDomains = topDomains.results.map((d) => {
          try {
            return { ...d, hostname: new URL(d.url).hostname };
          } catch {
            return { ...d, hostname: d.url };
          }
        });
        const formattedActivity = recentActivity.results.map((r) => {
          try {
            const hostname = new URL(r.url).hostname;
            const timeAgo = getTimeAgo(/* @__PURE__ */ new Date(r.created_at + "Z"));
            return { ...r, hostname, timeAgo };
          } catch {
            return { ...r, hostname: r.url, timeAgo: "recently" };
          }
        });
        return Response.json({
          scoreDistribution: scoreDistribution.results,
          categoryAverages,
          topDomains: formattedDomains,
          recentActivity: formattedActivity,
          dailyRoasts: dailyRoasts.results,
          overallStats,
          highlights: {
            bestPage: bestPage ? { hostname: new URL(bestPage.url).hostname, score: bestPage.overall_score } : null,
            worstPage: worstPage ? { hostname: new URL(worstPage.url).hostname, score: worstPage.overall_score } : null
          }
        }, { headers: corsHeaders });
      } catch (error32) {
        console.error("Analytics error:", error32);
        return Response.json({ error: "Failed to load analytics" }, { status: 500, headers: corsHeaders });
      }
    }
    if (url.pathname === "/api/platform-stats" && request.method === "GET") {
      try {
        if (!env22.ANALYTICS_API_TOKEN) {
          return Response.json({
            error: "Analytics not configured",
            // Return mock data for development
            cdnRequests24h: 0,
            workerCalls24h: 0,
            screenshots24h: 0,
            growth: 0
          }, { headers: corsHeaders });
        }
        const cacheKey = "platform-stats";
        const cached = await env22.CONFIG.get(cacheKey);
        if (cached) {
          return Response.json(JSON.parse(cached), { headers: corsHeaders });
        }
        const now = /* @__PURE__ */ new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
        const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1e3);
        const endTime = now.toISOString();
        const startTime24h = yesterday.toISOString();
        const startTime48h = twoDaysAgo.toISOString();
        const cdnQuery = `
          query CDNRequests($zoneTag: string, $start: Time, $end: Time) {
            viewer {
              zones(filter: {zoneTag: $zoneTag}) {
                httpRequestsAdaptiveGroups(
                  filter: {
                    datetime_geq: $start,
                    datetime_lt: $end
                  }
                  limit: 1
                ) {
                  sum {
                    requests
                  }
                }
              }
            }
          }
        `;
        const workerQuery = `
          query WorkerInvocations($accountTag: string, $start: Time, $end: Time) {
            viewer {
              accounts(filter: {accountTag: $accountTag}) {
                workersInvocationsAdaptive(
                  filter: {
                    datetime_geq: $start,
                    datetime_lt: $end
                  }
                  limit: 1
                ) {
                  sum {
                    requests
                  }
                }
              }
            }
          }
        `;
        const [cdnCurrent, cdnPrevious, workerCurrent, workerPrevious] = await Promise.all([
          queryCloudflareGraphQL(cdnQuery, {
            zoneTag: env22.CF_ZONE_TAG || "",
            start: startTime24h,
            end: endTime
          }, env22.ANALYTICS_API_TOKEN),
          queryCloudflareGraphQL(cdnQuery, {
            zoneTag: env22.CF_ZONE_TAG || "",
            start: startTime48h,
            end: startTime24h
          }, env22.ANALYTICS_API_TOKEN),
          queryCloudflareGraphQL(workerQuery, {
            accountTag: env22.CF_ACCOUNT_TAG || "",
            start: startTime24h,
            end: endTime
          }, env22.ANALYTICS_API_TOKEN),
          queryCloudflareGraphQL(workerQuery, {
            accountTag: env22.CF_ACCOUNT_TAG || "",
            start: startTime48h,
            end: startTime24h
          }, env22.ANALYTICS_API_TOKEN)
        ]);
        const cdnRequests24h = cdnCurrent?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups?.[0]?.sum?.requests || 0;
        const cdnRequestsPrevious = cdnPrevious?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups?.[0]?.sum?.requests || 0;
        const workerCalls24h = workerCurrent?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0]?.sum?.requests || 0;
        const workerCallsPrevious = workerPrevious?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0]?.sum?.requests || 0;
        const cdnGrowth = cdnRequestsPrevious > 0 ? Math.round((cdnRequests24h - cdnRequestsPrevious) / cdnRequestsPrevious * 100) : 0;
        const workerGrowth = workerCallsPrevious > 0 ? Math.round((workerCalls24h - workerCallsPrevious) / workerCallsPrevious * 100) : 0;
        const roastStats = await env22.DB.prepare(`
          SELECT 
            COUNT(*) as total_roasts,
            COUNT(*) FILTER (WHERE created_at > datetime('now', '-1 day')) as roasts_24h,
            COUNT(*) FILTER (WHERE created_at > datetime('now', '-2 days') AND created_at <= datetime('now', '-1 day')) as roasts_previous_24h
          FROM roasts
        `).first();
        const roastsGrowth = roastStats && roastStats.roasts_previous_24h > 0 ? Math.round((roastStats.roasts_24h - roastStats.roasts_previous_24h) / roastStats.roasts_previous_24h * 100) : 0;
        const screenshotsStored = roastStats?.total_roasts || 0;
        const countryStats = await env22.DB.prepare(`
          SELECT COUNT(DISTINCT country) as country_count
          FROM roasts
          WHERE country IS NOT NULL AND country != ''
        `).first();
        const hourlyDistribution = await env22.DB.prepare(`
          SELECT 
            CAST(strftime('%H', created_at) AS INTEGER) as hour,
            COUNT(*) as count
          FROM roasts
          WHERE created_at > datetime('now', '-7 days')
          GROUP BY hour
          ORDER BY hour
        `).all();
        const hourlyData = hourlyDistribution.results;
        const peakHour = hourlyData.reduce((max, curr) => curr.count > max.count ? curr : max, { hour: 0, count: 0 });
        const topCountries = await env22.DB.prepare(`
          SELECT 
            country,
            COUNT(*) as count
          FROM roasts
          WHERE created_at > datetime('now', '-30 days')
            AND country IS NOT NULL 
            AND country != ''
          GROUP BY country
          ORDER BY count DESC
          LIMIT 10
        `).all();
        const industryDistribution = await env22.DB.prepare(`
          SELECT 
            industry,
            COUNT(*) as count
          FROM roasts
          WHERE industry IS NOT NULL AND industry != ''
          GROUP BY industry
          ORDER BY count DESC
          LIMIT 5
        `).all();
        const avgResponseTime = await env22.DB.prepare(`
          SELECT 
            AVG(JULIANDAY(created_at) - JULIANDAY(created_at)) * 24 * 60 * 60 as avg_seconds
          FROM roasts
          WHERE created_at > datetime('now', '-7 days')
        `).first();
        const result = {
          cdnRequests24h,
          workerCalls24h,
          roastsCompleted: roastStats?.roasts_24h || 0,
          screenshotsStored,
          countriesReached: countryStats?.country_count || 0,
          growth: {
            cdn: cdnGrowth,
            workers: workerGrowth,
            roasts: roastsGrowth
          },
          peakUsage: {
            peakHour: peakHour.hour,
            peakHourLabel: `${peakHour.hour}:00 - ${peakHour.hour + 1}:00 UTC`,
            peakHourCount: peakHour.count,
            hourlyDistribution: hourlyData
          },
          topCountries: topCountries.results.map((c) => ({
            country: c.country,
            count: c.count,
            percentage: roastStats?.total_roasts ? Math.round(c.count / roastStats.total_roasts * 100) : 0
          })),
          topIndustries: industryDistribution.results.map((i) => ({
            industry: i.industry,
            count: i.count,
            percentage: roastStats?.total_roasts ? Math.round(i.count / roastStats.total_roasts * 100) : 0
          })),
          performance: {
            avgResponseTimeSeconds: Math.round(avgResponseTime?.avg_seconds || 0)
          },
          timestamp: now.toISOString()
        };
        await env22.CONFIG.put(cacheKey, JSON.stringify(result), { expirationTtl: 300 });
        return Response.json(result, { headers: corsHeaders });
      } catch (error32) {
        console.error("Platform stats error:", error32);
        return Response.json({
          error: "Failed to load platform stats",
          cdnRequests24h: 0,
          workerCalls24h: 0,
          roastsCompleted: 0,
          screenshotsStored: 0,
          countriesReached: 0,
          growth: { cdn: 0, workers: 0, roasts: 0 }
        }, { status: 500, headers: corsHeaders });
      }
    }
    if (url.pathname === "/api/threat-scan" && request.method === "POST") {
      try {
        const globalLimit = await checkGlobalRateLimit(env22);
        if (!globalLimit.allowed) {
          return Response.json({ error: globalLimit.reason, retryAfter: 300 }, { status: 503, headers: { ...corsHeaders, "Retry-After": "300" } });
        }
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT);
        const rateLimit = await checkOperationRateLimit(env22, ipHash, "roast");
        if (!rateLimit.allowed) {
          return Response.json({ error: `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.`, retryAfter: rateLimit.resetIn }, { status: 429, headers: corsHeaders });
        }
        const body = await request.json();
        let targetDomain;
        let brandName;
        if (body.url) {
          const sanitizedUrl = sanitizeUrl(body.url);
          if (!sanitizedUrl) {
            return Response.json({ error: "Invalid URL" }, { status: 400, headers: corsHeaders });
          }
          if (!isUrlSafeForFetching(sanitizedUrl)) {
            return Response.json({ error: "Cannot scan internal/private URLs" }, { status: 400, headers: corsHeaders });
          }
          try {
            const parsedUrl = new URL(sanitizedUrl);
            targetDomain = parsedUrl.hostname.replace("www.", "").toLowerCase();
            brandName = sanitizeHtml(targetDomain.split(".")[0]).slice(0, 50);
          } catch {
            return Response.json({ error: "Invalid URL" }, { status: 400, headers: corsHeaders });
          }
        } else if (body.domain) {
          const cleanDomain = body.domain.replace(/[^a-zA-Z0-9.-]/g, "").toLowerCase();
          if (!cleanDomain || cleanDomain.length > 253) {
            return Response.json({ error: "Invalid domain" }, { status: 400, headers: corsHeaders });
          }
          targetDomain = cleanDomain.replace("www.", "");
          brandName = sanitizeHtml(targetDomain.split(".")[0]).slice(0, 50);
        } else {
          return Response.json({ error: "URL or domain required" }, { status: 400, headers: corsHeaders });
        }
        const [typosquats, securityGrade, socialImposters] = await Promise.all([
          // 1. Generate and check typosquats
          (async () => {
            const variations = generateTyposquats(targetDomain);
            return checkDomainRegistrations(variations);
          })(),
          // 2. Security headers check
          checkSecurityHeaders(body.url || `https://${targetDomain}`),
          // 3. Social media imposter scan
          scanSocialMediaImposters(brandName, targetDomain)
        ]);
        const registeredLookalikes = typosquats.filter((d) => d.registered);
        const suspiciousCount = registeredLookalikes.filter((d) => d.risk === "high" || d.risk === "medium").length;
        const imposterCount = socialImposters.filter((i) => i.risk === "high" || i.risk === "medium").length;
        let threatScore = 100;
        threatScore -= registeredLookalikes.length * 2;
        threatScore -= suspiciousCount * 5;
        threatScore -= imposterCount * 8;
        threatScore -= (100 - securityGrade.score) * 0.2;
        threatScore = Math.max(0, Math.min(100, Math.round(threatScore)));
        let riskLevel = "low";
        if (threatScore < 40) riskLevel = "critical";
        else if (threatScore < 60) riskLevel = "high";
        else if (threatScore < 80) riskLevel = "medium";
        return Response.json({
          domain: targetDomain,
          brandName,
          threatScore,
          riskLevel,
          lookalikes: {
            total: typosquats.length,
            registered: registeredLookalikes.length,
            suspicious: suspiciousCount,
            domains: typosquats.slice(0, 50)
          },
          security: securityGrade,
          socialMedia: {
            totalChecked: socialImposters.length,
            impostersFound: socialImposters.filter((i) => i.risk !== "low").length,
            accounts: socialImposters
          },
          recommendations: generateThreatRecommendations(typosquats, securityGrade, riskLevel, socialImposters),
          scannedAt: (/* @__PURE__ */ new Date()).toISOString()
        }, { headers: corsHeaders });
      } catch (error32) {
        safeLogError("Threat scan error:", error32);
        return Response.json({ error: "Threat scan failed" }, { status: 500, headers: corsHeaders });
      }
    }
    if (url.pathname === "/api/tech-scan" && request.method === "POST") {
      try {
        const globalLimit = await checkGlobalRateLimit(env22);
        if (!globalLimit.allowed) {
          return Response.json({ error: globalLimit.reason, retryAfter: 300 }, { status: 503, headers: { ...corsHeaders, "Retry-After": "300" } });
        }
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT);
        const rateLimit = await checkOperationRateLimit(env22, ipHash, "roast");
        if (!rateLimit.allowed) {
          return Response.json({ error: `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.`, retryAfter: rateLimit.resetIn }, { status: 429, headers: corsHeaders });
        }
        const body = await request.json();
        if (!body.url) {
          return Response.json({ error: "URL required" }, { status: 400, headers: corsHeaders });
        }
        const sanitizedUrl = sanitizeUrl(body.url);
        if (!sanitizedUrl || !isUrlSafeForFetching(sanitizedUrl)) {
          return Response.json({ error: "Invalid or unsafe URL" }, { status: 400, headers: corsHeaders });
        }
        const cacheKey = `tech-scan:${await hashUrl(sanitizedUrl)}`;
        const cached = await env22.CONFIG.get(cacheKey);
        if (cached) {
          return Response.json({
            success: true,
            cached: true,
            ...JSON.parse(cached)
          }, { headers: corsHeaders });
        }
        if (!env22.URL_SCANNER_TOKEN) {
          return Response.json({ error: "URL Scanner not configured" }, { status: 503, headers: corsHeaders });
        }
        const accountId = env22.CF_ACCOUNT_TAG || "";
        const scanResponse = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/urlscanner/v2/scan`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env22.URL_SCANNER_TOKEN}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              url: sanitizedUrl,
              visibility: "Unlisted",
              screenshotsResolutions: ["desktop"]
            })
          }
        );
        if (!scanResponse.ok) {
          const errorData = await scanResponse.json();
          console.error("URL Scanner submission failed:", errorData);
          return Response.json({ error: "Failed to submit scan" }, { status: 500, headers: corsHeaders });
        }
        const scanData = await scanResponse.json();
        const scanId = scanData.result?.uuid;
        if (!scanId) {
          return Response.json({ error: "Failed to get scan ID" }, { status: 500, headers: corsHeaders });
        }
        return Response.json({
          success: true,
          scanId,
          url: sanitizedUrl,
          status: "pending",
          message: "Scan submitted. Results ready in 15-30 seconds."
        }, { headers: corsHeaders });
      } catch (error32) {
        safeLogError("Tech scan submit error:", error32);
        return Response.json({ error: "Tech scan failed" }, { status: 500, headers: corsHeaders });
      }
    }
    if (url.pathname.match(/^\/api\/tech-scan\/[\w-]+$/) && request.method === "GET") {
      try {
        const scanId = url.pathname.split("/").pop();
        if (!scanId || scanId.length < 10) {
          return Response.json({ error: "Invalid scan ID" }, { status: 400, headers: corsHeaders });
        }
        if (!env22.URL_SCANNER_TOKEN) {
          return Response.json({ error: "URL Scanner not configured" }, { status: 503, headers: corsHeaders });
        }
        const accountId = env22.CF_ACCOUNT_TAG || "";
        const resultResponse = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/urlscanner/v2/result/${scanId}`,
          {
            headers: {
              "Authorization": `Bearer ${env22.URL_SCANNER_TOKEN}`
            }
          }
        );
        if (!resultResponse.ok) {
          return Response.json({
            success: false,
            status: "processing",
            message: "Still processing. Try again in 10 seconds."
          }, { headers: corsHeaders });
        }
        const scanResult = await resultResponse.json();
        const technologies = scanResult?.meta?.processors?.wappa?.data || [];
        const byCategory = {};
        technologies.forEach((tech) => {
          tech.categories?.forEach((cat) => {
            if (!byCategory[cat.name]) {
              byCategory[cat.name] = [];
            }
            byCategory[cat.name].push({
              name: tech.app,
              confidence: tech.confidenceTotal || 0,
              icon: tech.icon,
              website: tech.website
            });
          });
        });
        const hosting = {
          server: scanResult?.page?.server || "Unknown",
          asn: scanResult?.page?.asn || "Unknown",
          ip: scanResult?.page?.ip || "Unknown",
          country: scanResult?.page?.country || "Unknown"
        };
        const radarRank = scanResult?.meta?.processors?.radarRank?.data?.[0] || null;
        const result = {
          success: true,
          url: scanResult?.task?.url || "",
          scanId,
          technologies: {
            total: technologies.length,
            byCategory,
            all: technologies.map((tech) => ({
              name: tech.app,
              category: tech.categories?.[0]?.name || "Other",
              confidence: tech.confidenceTotal || 0,
              icon: tech.icon,
              website: tech.website
            }))
          },
          hosting,
          rank: radarRank ? {
            bucket: radarRank.bucket,
            rank: radarRank.rank
          } : null,
          scannedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        if (result.url) {
          const cacheKey = `tech-scan:${await hashUrl(result.url)}`;
          await env22.CONFIG.put(cacheKey, JSON.stringify(result), { expirationTtl: 86400 });
        }
        return Response.json(result, { headers: corsHeaders });
      } catch (error32) {
        safeLogError("Tech scan result error:", error32);
        return Response.json({ error: "Failed to fetch results" }, { status: 500, headers: corsHeaders });
      }
    }
    const API_V1_LIMITS = {
      PER_IP_DAILY: 5,
      GLOBAL_DAILY: 50
    };
    function getApiDayKey() {
      const now = /* @__PURE__ */ new Date();
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    }
    function secondsUntilMidnightUTC() {
      const now = /* @__PURE__ */ new Date();
      const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
      return Math.ceil((midnight.getTime() - now.getTime()) / 1e3);
    }
    async function checkApiV1RateLimits(env3, ipHash) {
      const dayKey = getApiDayKey();
      const ipKey = `apiv1:ip:${ipHash}:${dayKey}`;
      const globalKey = `apiv1:global:${dayKey}`;
      try {
        const [ipCountStr, globalCountStr] = await Promise.all([
          env3.CONFIG.get(ipKey),
          env3.CONFIG.get(globalKey)
        ]);
        const ipCount = parseInt(ipCountStr || "0");
        const globalCount = parseInt(globalCountStr || "0");
        if (globalCount >= API_V1_LIMITS.GLOBAL_DAILY) {
          return {
            allowed: false,
            ipCount,
            globalCount,
            error: "The API has reached its daily capacity of 50 roasts. Please try again tomorrow.",
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
      } catch (error32) {
        console.error("API v1 rate limit check failed:", error32);
        return { allowed: false, ipCount: 0, globalCount: 0, error: "Rate limiting unavailable. Please try again later.", errorType: "global_limit" };
      }
    }
    async function incrementApiV1Counters(env3, ipHash) {
      const dayKey = getApiDayKey();
      const ipKey = `apiv1:ip:${ipHash}:${dayKey}`;
      const globalKey = `apiv1:global:${dayKey}`;
      const ttl = secondsUntilMidnightUTC() + 3600;
      try {
        const [ipCountStr, globalCountStr] = await Promise.all([
          env3.CONFIG.get(ipKey),
          env3.CONFIG.get(globalKey)
        ]);
        await Promise.all([
          env3.CONFIG.put(ipKey, String(parseInt(ipCountStr || "0") + 1), { expirationTtl: ttl }),
          env3.CONFIG.put(globalKey, String(parseInt(globalCountStr || "0") + 1), { expirationTtl: ttl })
        ]);
      } catch (error32) {
        console.error("API v1 counter increment failed:", error32);
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
      const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT);
      const dayKey = getApiDayKey();
      const [ipCountStr, globalCountStr] = await Promise.all([
        env22.CONFIG.get(`apiv1:ip:${ipHash}:${dayKey}`),
        env22.CONFIG.get(`apiv1:global:${dayKey}`)
      ]);
      const ipCount = parseInt(ipCountStr || "0");
      const globalCount = parseInt(globalCountStr || "0");
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
      try {
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const clientCountry = request.headers.get("CF-IPCountry") || "XX";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT);
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
        const urlHash = await hashUrl(targetUrl, device);
        const cachedResult = await getCachedRoast(env22, urlHash, targetUrl);
        if (cachedResult) {
          await incrementApiV1Counters(env22, ipHash);
          const updatedIp2 = rateLimits.ipCount + 1;
          const updatedGlobal2 = rateLimits.globalCount + 1;
          return Response.json({
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
              ...apiV1RateLimitHeaders(updatedIp2, updatedGlobal2),
              "X-Cache": "HIT"
            }
          });
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
          analyzeWithVisionAndHeatmap(env22, base64Screenshot, targetUrl, false)
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
        await incrementApiV1Counters(env22, ipHash);
        const updatedIp = rateLimits.ipCount + 1;
        const updatedGlobal = rateLimits.globalCount + 1;
        return Response.json({
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
          heatmap: enhancedHeatmap,
          screenshotUrl: `${PRODUCTION_ORIGINS[0]}/api/screenshot/${roastId}`,
          shareUrl: `${PRODUCTION_ORIGINS[0]}/roast/${roastId}`,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          processingTime: Date.now() - startTime
        }, {
          headers: {
            ...apiV1CorsHeaders,
            ...apiV1RateLimitHeaders(updatedIp, updatedGlobal),
            "X-Cache": "MISS"
          }
        });
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
      }
    }
    if (url.pathname === "/sitemap.xml" && request.method === "GET") {
      try {
        const BASE_URL_SM = PRODUCTION_ORIGINS[0];
        const totalResult = await env22.DB.prepare("SELECT COUNT(*) as count FROM roasts").first();
        const totalRoasts = totalResult?.count || 0;
        const galleryPages = Math.ceil(totalRoasts / 24);
        const roasts = await env22.DB.prepare(
          "SELECT id, created_at FROM roasts ORDER BY created_at DESC LIMIT 50000"
        ).all();
        const now = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE_URL_SM}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
    <lastmod>${now}</lastmod>
  </url>
  <url>
    <loc>${BASE_URL_SM}/gallery</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
    <lastmod>${now}</lastmod>
  </url>`;
        for (let p = 2; p <= galleryPages; p++) {
          xml += `
  <url>
    <loc>${BASE_URL_SM}/gallery?page=${p}</loc>
    <changefreq>daily</changefreq>
    <priority>0.5</priority>
    <lastmod>${now}</lastmod>
  </url>`;
        }
        if (roasts.results) {
          for (const roast of roasts.results) {
            const lastmod = roast.created_at ? (/* @__PURE__ */ new Date(roast.created_at + "Z")).toISOString().split("T")[0] : now;
            xml += `
  <url>
    <loc>${BASE_URL_SM}/roast/${roast.id}</loc>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
    <lastmod>${lastmod}</lastmod>
  </url>`;
          }
        }
        xml += `
</urlset>`;
        return new Response(xml, {
          status: 200,
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, s-maxage=3600",
            // 1 hour cache
            ...corsHeaders
          }
        });
      } catch (err) {
        safeLogError("Sitemap generation error", err);
        return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>', {
          status: 200,
          headers: { "Content-Type": "application/xml; charset=utf-8" }
        });
      }
    }
    const BASE_URL = env22.BASE_URL || PRODUCTION_ORIGINS[0];
    if (url.pathname.match(/^\/roast\/[a-z0-9][\w-]{2,30}$/i) && request.method === "GET") {
      const roastId = url.pathname.split("/").pop();
      const roast = await env22.DB.prepare(`
        SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score,
               roast_response, quick_wins, seo_data, performance_data, heatmap_data, country, industry, created_at
        FROM roasts WHERE id = ?
      `).bind(roastId).first();
      if (!roast) {
        return new Response(generateNotFoundPage(BASE_URL), {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8", ...getSecurityHeaders(origin, env22.ENVIRONMENT) }
        });
      }
      let hostname = "unknown";
      try {
        hostname = new URL(roast.url).hostname.replace(/^www\./, "");
      } catch {
      }
      const score = roast.overall_score;
      const scoreColor = score >= 8 ? "#22C55E" : score >= 6 ? "#EAB308" : score >= 4 ? "#F97316" : "#EF4444";
      const verdict = score >= 8 ? "Excellent" : score >= 6 ? "Needs Work" : score >= 4 ? "Concerning" : "Needs Help";
      const emoji = score >= 8 ? "\u{1F525}" : score >= 6 ? "\u{1F610}" : score >= 4 ? "\u{1F62C}" : "\u{1F480}";
      let quickWins = [];
      try {
        quickWins = roast.quick_wins ? JSON.parse(roast.quick_wins) : [];
      } catch {
      }
      let seo = null;
      try {
        if (roast.seo_data) seo = JSON.parse(roast.seo_data);
      } catch {
      }
      let performance22 = null;
      try {
        if (roast.performance_data) performance22 = JSON.parse(roast.performance_data);
      } catch {
      }
      let heatmap = null;
      try {
        if (roast.heatmap_data) heatmap = JSON.parse(roast.heatmap_data);
      } catch {
      }
      const roastIndustryKey = resolveIndustry(roast.industry);
      const industryBench = INDUSTRY_BENCHMARKS[roastIndustryKey] || INDUSTRY_BENCHMARKS.other;
      const industryAvgScore = Number(((industryBench.scores.hero + industryBench.scores.cta + industryBench.scores.trust + industryBench.scores.copy + industryBench.scores.design) / 5).toFixed(1));
      const scoreDiff = (score - industryAvgScore).toFixed(1);
      const scoreDiffNum = parseFloat(scoreDiff);
      const isAboveAvg = scoreDiffNum > 0;
      const isAtAvg = Math.abs(scoreDiffNum) < 0.3;
      const industryCountRow = await env22.DB.prepare(`SELECT COUNT(*) as cnt FROM roasts WHERE industry = ?`).bind(roastIndustryKey).first();
      const industrySampleSize = industryCountRow?.cnt || 0;
      const sections = {};
      if (roast.roast_response) {
        const md = roast.roast_response;
        const sectionBlocks = md.split(/(?=^### )/m);
        const sectionKeywords = {
          "Hero": "hero",
          "Call-to-Action": "cta",
          "Trust": "trust",
          "Copy": "copy",
          "Design": "design"
        };
        const positiveWords = /\b(good|great|clear|strong|well|effective|appealing|clean|excellent|impressive|professional|solid|compelling|engaging|intuitive)\b/i;
        const negativeWords = /\b(but|however|could|lack|missing|no visible|not |weak|poor|confusing|unclear|too |slow|hard to|difficult)\b/i;
        for (const block of sectionBlocks) {
          for (const [keyword, key] of Object.entries(sectionKeywords)) {
            if (block.includes(keyword)) {
              const problemMatch = block.match(/\*\*Problem:\*\*\s*(.+)/);
              const fixMatch = block.match(/\*\*Fix:\*\*\s*(.+)/);
              let problem = problemMatch ? problemMatch[1].trim() : "";
              let fix = fixMatch ? fixMatch[1].trim() : "";
              if (fix === "---" || fix === "##" || fix.startsWith("###")) fix = "";
              if (/^(N\/A|Nothing|None|n\/a|-|—)$/i.test(fix)) fix = "";
              if (/^(N\/A|None|n\/a|-|—)$/i.test(problem)) problem = "";
              const isStrength = problem !== "" && positiveWords.test(problem) && !negativeWords.test(problem);
              if (problem || fix) {
                sections[key] = { roast: problem, fix, isStrength };
              }
              break;
            }
          }
        }
      }
      const createdAt = /* @__PURE__ */ new Date(roast.created_at + "Z");
      const dateStr = createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const ogTitle = `${hostname} scored ${score}/10 ${emoji} - Roast My Landing Page`;
      const ogDesc = `AI analysis: Hero ${roast.hero_score}/10, CTA ${roast.cta_score}/10, Trust ${roast.trust_score}/10, Copy ${roast.copy_score}/10, Design ${roast.design_score}/10. Get your free roast!`;
      const ogImage = `${BASE_URL}/api/card/${roastId}`;
      const pageUrl = `${BASE_URL}/roast/${roastId}`;
      const screenshotUrl = `${BASE_URL}/api/screenshot/${roastId}`;
      const categories = [
        { key: "hero", label: "Hero Section", score: roast.hero_score, color: "#8B5CF6", gradFrom: "from-purple-500/10", gradTo: "to-purple-600/5", borderColor: "border-purple-500/20", emoji: "\u{1F9B8}", question: "Is your headline clear, benefit-driven, and immediately compelling?", description: "The first thing visitors see \u2014 your headline, subheadline, and hero image. It must communicate your value in under 5 seconds or visitors bounce." },
        { key: "cta", label: "Call to Action", score: roast.cta_score, color: "#F97316", gradFrom: "from-orange-500/10", gradTo: "to-red-600/5", borderColor: "border-orange-500/20", emoji: "\u{1F3AF}", question: "Are your buttons visible, urgent, and impossible to miss?", description: "Your conversion buttons and links. Great CTAs are visually distinct, use action-oriented copy, and create urgency. This is where visitors become customers." },
        { key: "trust", label: "Trust Signals", score: roast.trust_score, color: "#22C55E", gradFrom: "from-green-500/10", gradTo: "to-emerald-600/5", borderColor: "border-green-500/20", emoji: "\u{1F6E1}\uFE0F", question: "Do visitors have enough proof to believe your claims?", description: "Testimonials, logos, reviews, security badges, and social proof. These reduce buying anxiety and convince visitors you can deliver on your promises." },
        { key: "copy", label: "Copywriting", score: roast.copy_score, color: "#3B82F6", gradFrom: "from-blue-500/10", gradTo: "to-cyan-600/5", borderColor: "border-blue-500/20", emoji: "\u270D\uFE0F", question: "Does your text persuade, or just fill space?", description: "The quality of your written content \u2014 clarity, persuasion, benefit focus, and scannability. Good copy speaks to the reader's pain points and desires." },
        { key: "design", label: "Visual Design", score: roast.design_score, color: "#EC4899", gradFrom: "from-pink-500/10", gradTo: "to-rose-600/5", borderColor: "border-pink-500/20", emoji: "\u{1F3A8}", question: "Does the layout guide the eye and support your message?", description: "Layout, visual hierarchy, whitespace, color, and typography. Good design directs attention to what matters and makes the page feel professional and trustworthy." }
      ];
      const a11y = seo?.accessibility || null;
      const a11yScore = a11y?.score ?? null;
      let heatmapDotsHtml = "";
      let heatmapSidebarHtml = "";
      if (heatmap) {
        const attentionPoints = heatmap.attention || [];
        heatmapDotsHtml = attentionPoints.map((p) => {
          const size = Math.max(40, p.intensity * 1.2);
          const color = p.intensity >= 80 ? "rgba(239,68,68,0.5)" : p.intensity >= 50 ? "rgba(249,115,22,0.4)" : "rgba(234,179,8,0.3)";
          const glow = p.intensity >= 80 ? "rgba(239,68,68,0.3)" : p.intensity >= 50 ? "rgba(249,115,22,0.2)" : "rgba(234,179,8,0.15)";
          return `<div style="position:absolute;left:${p.x}%;top:${p.y}%;width:${size}px;height:${size}px;border-radius:50%;background:radial-gradient(circle,${color} 0%,transparent 70%);box-shadow:0 0 ${size / 2}px ${glow};transform:translate(-50%,-50%);pointer-events:none;"${p.element ? ` title="${escapeHtml(p.element)}"` : ""}></div>`;
        }).join("");
        if (heatmap.foldLine) {
          heatmapDotsHtml += `<div style="position:absolute;left:0;right:0;top:${heatmap.foldLine}%;border-top:2px dashed #EAB308;pointer-events:none;"><span style="position:absolute;right:8px;top:-24px;font-size:11px;color:#EAB308;background:rgba(0,0,0,0.9);padding:2px 8px;border-radius:4px;">\u{1F4F1} Fold Line</span></div>`;
        }
        const aboveFold = heatmap.foldLine ? attentionPoints.filter((p) => p.y < heatmap.foldLine).length : attentionPoints.length;
        const aboveFoldPct = attentionPoints.length > 0 ? Math.round(aboveFold / attentionPoints.length * 100) : 0;
        heatmapSidebarHtml = `
        <div class="space-y-4">
          <div class="card p-5">
            <div class="flex items-center gap-2 mb-3"><span class="text-lg">\u{1F441}\uFE0F</span><h4 class="font-semibold text-sm">Attention Summary</h4></div>
            <div class="space-y-2">
              <div class="p-2.5 bg-white/[0.03] rounded-lg flex justify-between items-center">
                <span class="text-xs text-[#a1a1a6]">Hotspots Detected</span>
                <span class="text-sm font-bold text-orange-400">${attentionPoints.length}</span>
              </div>
              <div class="p-2.5 bg-white/[0.03] rounded-lg flex justify-between items-center">
                <span class="text-xs text-[#a1a1a6]">Above Fold</span>
                <span class="text-sm font-bold text-green-400">${aboveFoldPct}%</span>
              </div>
              ${heatmap.pattern ? `<div class="p-2.5 bg-white/[0.03] rounded-lg flex justify-between items-center">
                <span class="text-xs text-[#a1a1a6]">Reading Pattern</span>
                <span class="text-sm font-bold text-blue-400">${escapeHtml(heatmap.pattern)}-Pattern</span>
              </div>` : ""}
            </div>
          </div>
          ${heatmap.clickPredictions && heatmap.clickPredictions.length > 0 ? `<div class="card p-5">
            <div class="flex items-center gap-2 mb-3"><span class="text-lg">\u{1F3AF}</span><h4 class="font-semibold text-sm">Click Predictions</h4></div>
            <div class="space-y-2">
              ${heatmap.clickPredictions.map((cp2) => `<div class="flex items-center justify-between text-sm">
                <span class="text-[#a1a1a6]">${escapeHtml(cp2.element)}</span>
                <div class="flex items-center gap-2">
                  <div class="w-16 h-1.5 bg-white/[0.06] rounded-full overflow-hidden"><div class="h-full rounded-full" style="width:${cp2.probability}%;background:${cp2.probability >= 60 ? "#22C55E" : cp2.probability >= 30 ? "#EAB308" : "#EF4444"}"></div></div>
                  <span class="text-xs font-medium" style="color:${cp2.probability >= 60 ? "#22C55E" : cp2.probability >= 30 ? "#EAB308" : "#EF4444"}">${cp2.probability}%</span>
                </div>
              </div>`).join("")}
            </div>
          </div>` : ""}
        </div>`;
      }
      let perfDetailsHtml = "";
      if (performance22) {
        const perfColor = performance22.score >= 80 ? "#22C55E" : performance22.score >= 50 ? "#EAB308" : "#EF4444";
        const perfNormDisp = (performance22.score / 10).toFixed(1);
        const loadTimeS = (performance22.loadTime / 1e3).toFixed(1);
        const ttfbMs = performance22.ttfb || 0;
        const fcpMs = performance22.fcp || 0;
        const totalSizeKB = performance22.totalSize ? Math.round(performance22.totalSize / 1024) : null;
        const rb = performance22.resourceBreakdown || {};
        const vitals = [];
        if (ttfbMs) {
          const c = ttfbMs < 200 ? "#22C55E" : ttfbMs < 600 ? "#EAB308" : "#EF4444";
          vitals.push({
            label: "Time to First Byte (TTFB)",
            value: `${Math.round(ttfbMs)}ms`,
            pct: Math.min(100, ttfbMs / 600 * 100),
            color: c,
            advice: ttfbMs < 200 ? "Excellent server response time. Your server is responding quickly to requests." : ttfbMs < 600 ? "Your server takes a bit long to respond. Consider using a CDN, optimizing server-side code, or upgrading your hosting." : "Slow server response. This delays everything else. Look into server caching, CDN distribution, database query optimization, or better hosting."
          });
        }
        if (fcpMs) {
          const c = fcpMs < 1800 ? "#22C55E" : fcpMs < 3e3 ? "#EAB308" : "#EF4444";
          vitals.push({
            label: "First Contentful Paint (FCP)",
            value: `${(fcpMs / 1e3).toFixed(1)}s`,
            pct: Math.min(100, fcpMs / 3e3 * 100),
            color: c,
            advice: fcpMs < 1800 ? "Users see content quickly. This keeps them engaged rather than bouncing." : fcpMs < 3e3 ? "Content takes a moment to appear. Try inlining critical CSS, deferring non-essential scripts, and optimizing web fonts." : "Users wait too long to see any content. Reduce render-blocking resources, inline critical CSS, and lazy-load below-fold assets."
          });
        }
        {
          const lt = parseFloat(loadTimeS);
          const c = lt < 2 ? "#22C55E" : lt < 4 ? "#EAB308" : "#EF4444";
          vitals.push({
            label: "Page Load Time",
            value: `${loadTimeS}s`,
            pct: Math.min(100, lt / 4 * 100),
            color: c,
            advice: lt < 2 ? "Fast page load. Users can interact with your page almost immediately." : lt < 4 ? "Page load is acceptable but could be faster. Compress images, minify JS/CSS, and remove unused code." : "Slow page load hurts conversions. Every extra second costs ~7% in conversions. Audit your assets \u2014 compress images, lazy-load, use code splitting."
          });
        }
        const perfIssueAdvice = {
          "render-blocking": "Move non-critical CSS/JS to load asynchronously. Use defer/async on script tags.",
          "large": "Compress and resize assets. Use WebP for images, minify CSS/JS, enable gzip/brotli.",
          "image": "Compress images with tools like squoosh.app. Use modern formats (WebP, AVIF). Set explicit width/height.",
          "font": "Self-host fonts, use font-display: swap, and subset fonts to only the characters you need.",
          "script": "Defer non-critical JavaScript. Consider code splitting and loading scripts only when needed.",
          "cache": "Set proper Cache-Control headers. Static assets should have long cache durations.",
          "redirect": "Each redirect adds latency. Remove unnecessary redirects from your request chain."
        };
        perfDetailsHtml = `
        <div class="space-y-4">
          <!-- Performance Score Header -->
          <div class="card p-5">
            <div class="flex items-center gap-4">
              <div class="score-ring" style="width:80px;height:80px;border-width:5px;border-color:${perfColor};flex-shrink:0;">
                <span class="text-xl font-bold" style="color:${perfColor}">${perfNormDisp}</span>
                <span class="text-xs text-[#a1a1a6]">/10</span>
              </div>
              <div>
                <h3 class="text-sm font-semibold text-white">Performance</h3>
                <p class="text-xs text-[#6e6e73] mt-1">How fast your page loads and becomes interactive. Slow pages lose visitors \u2014 53% of mobile users leave if a page takes over 3 seconds to load.</p>
              </div>
            </div>
          </div>

          <div class="grid md:grid-cols-2 gap-4">
            <!-- Core Web Vitals -->
            <div class="card p-5">
              <h3 class="text-sm font-semibold mb-4">Core Web Vitals</h3>
              <div class="space-y-2">
                ${vitals.map((v) => `<div class="expandable p-3 bg-white/[0.03] rounded-xl" onclick="this.classList.toggle('open')">
                  <div class="flex justify-between items-center mb-1">
                    <div class="flex items-center gap-2">
                      <span class="expand-icon">&#9654;</span>
                      <span class="text-xs text-[#a1a1a6]">${v.label}</span>
                    </div>
                    <span class="text-xs font-bold" style="color:${v.color}">${v.value}</span>
                  </div>
                  <div class="h-1 bg-white/[0.06] rounded-full overflow-hidden ml-5"><div class="h-full rounded-full" style="width:${v.pct}%;background:${v.color}"></div></div>
                  <div class="expand-detail mt-2 ml-5">
                    <div class="p-2.5 ${v.color === "#22C55E" ? "bg-green-500/5 border border-green-500/10" : "bg-yellow-500/5 border border-yellow-500/10"} rounded-lg">
                      <p class="text-xs text-[#d1d1d6] leading-relaxed">${v.advice}</p>
                    </div>
                  </div>
                </div>`).join("\n                ")}
              </div>
            </div>

            <!-- Page Weight -->
            <div class="card p-5">
              <h3 class="text-sm font-semibold mb-4">Page Weight</h3>
              <div class="grid grid-cols-2 gap-3 mb-4">
                ${totalSizeKB !== null ? `<div class="p-3 bg-white/[0.03] rounded-xl text-center expandable" onclick="this.classList.toggle('open')">
                  <div class="text-xl font-bold text-blue-400">${totalSizeKB > 1024 ? (totalSizeKB / 1024).toFixed(1) + "MB" : totalSizeKB + "KB"}</div>
                  <div class="text-xs text-[#6e6e73]">Total Size</div>
                  <div class="expand-detail mt-2">
                    <p class="text-xs text-[#a1a1a6] leading-relaxed">${totalSizeKB > 3e3 ? "Your page is very heavy. Aim for under 1.5MB total. Compress images, minify code, and remove unused assets." : totalSizeKB > 1500 ? "Page size is above average. Consider compressing images and lazy-loading below-fold content." : "Good page size \u2014 lightweight pages load faster on all connections."}</p>
                  </div>
                </div>` : ""}
                <div class="p-3 bg-white/[0.03] rounded-xl text-center expandable" onclick="this.classList.toggle('open')">
                  <div class="text-xl font-bold text-purple-400">${performance22.resourceCount}</div>
                  <div class="text-xs text-[#6e6e73]">Requests</div>
                  <div class="expand-detail mt-2">
                    <p class="text-xs text-[#a1a1a6] leading-relaxed">${performance22.resourceCount > 50 ? "Too many HTTP requests slow down your page. Combine files, use sprites, and lazy-load non-critical resources." : performance22.resourceCount > 30 ? "Moderate number of requests. Consider bundling scripts and stylesheets to reduce round trips." : "Good request count \u2014 fewer requests mean faster page loads."}</p>
                  </div>
                </div>
              </div>
              ${Object.keys(rb).length > 0 ? `<div class="space-y-2">
                ${rb.scripts ? `<div class="flex justify-between items-center text-xs p-2 bg-white/[0.02] rounded-lg"><span class="text-[#a1a1a6]">\u{1F4DC} Scripts</span><span class="text-[#d1d1d6]">${rb.scripts.count} files (${Math.round(rb.scripts.size / 1024)}KB)</span></div>` : ""}
                ${rb.stylesheets ? `<div class="flex justify-between items-center text-xs p-2 bg-white/[0.02] rounded-lg"><span class="text-[#a1a1a6]">\u{1F3A8} Stylesheets</span><span class="text-[#d1d1d6]">${rb.stylesheets.count} files (${Math.round(rb.stylesheets.size / 1024)}KB)</span></div>` : ""}
                ${rb.images ? `<div class="flex justify-between items-center text-xs p-2 bg-white/[0.02] rounded-lg"><span class="text-[#a1a1a6]">\u{1F5BC} Images</span><span class="text-[#d1d1d6]">${rb.images.count} files (${Math.round(rb.images.size / 1024)}KB)</span></div>` : ""}
                ${rb.fonts ? `<div class="flex justify-between items-center text-xs p-2 bg-white/[0.02] rounded-lg"><span class="text-[#a1a1a6]">\u{1F524} Fonts</span><span class="text-[#d1d1d6]">${rb.fonts.count} files (${Math.round(rb.fonts.size / 1024)}KB)</span></div>` : ""}
              </div>` : ""}
              ${performance22.issues && performance22.issues.length > 0 ? `<div class="mt-4 pt-3 border-t border-white/[0.06] space-y-2">
                ${performance22.issues.slice(0, 4).map((issue) => {
          const adviceKey = Object.keys(perfIssueAdvice).find((k) => issue.toLowerCase().includes(k));
          const advice = adviceKey ? perfIssueAdvice[adviceKey] : "Address this issue to improve page load speed and user experience.";
          return `<div class="expandable text-xs p-2.5 bg-red-500/5 rounded-lg" onclick="this.classList.toggle('open')">
                    <div class="flex items-center gap-2">
                      <span class="expand-icon">&#9654;</span>
                      <span class="text-red-400/80">\u26A0 ${escapeHtml(issue)}</span>
                    </div>
                    <div class="expand-detail mt-2 ml-5">
                      <div class="p-2 bg-yellow-500/5 border border-yellow-500/10 rounded-lg">
                        <div class="text-xs text-[#a1a1a6] mb-1">\u{1F4A1} How to fix</div>
                        <p class="text-xs text-[#d1d1d6]">${advice}</p>
                      </div>
                    </div>
                  </div>`;
        }).join("")}
              </div>` : ""}
            </div>
          </div>
        </div>`;
      }
      let seoDetailsHtml = "";
      if (seo) {
        const seoColor = seo.score >= 80 ? "#22C55E" : seo.score >= 50 ? "#EAB308" : "#EF4444";
        const seoNormDisp = (seo.score / 10).toFixed(1);
        const seoItems = [];
        if (seo.title) {
          const ideal = seo.title.length >= 50 && seo.title.length <= 60;
          seoItems.push({
            label: "Page Title",
            status: seo.title.status,
            value: escapeHtml(seo.title.text || "None"),
            detail: `${seo.title.length} characters`,
            advice: seo.title.status === "good" ? "Your title is well-optimized. It's within the ideal 50-60 character range and will display properly in search results." : seo.title.length > 60 ? `Your title is ${seo.title.length} chars \u2014 search engines will truncate it after ~60. Shorten it while keeping your main keyword near the front.` : seo.title.length < 30 ? `Your title is only ${seo.title.length} chars \u2014 you're leaving SEO value on the table. Aim for 50-60 chars with your target keyword.` : "Consider refining your title. Place your primary keyword near the beginning and keep it between 50-60 characters for optimal search display."
          });
        }
        if (seo.metaDescription) {
          seoItems.push({
            label: "Meta Description",
            status: seo.metaDescription.status,
            value: escapeHtml(seo.metaDescription.text || "None"),
            detail: `${seo.metaDescription.length} characters`,
            advice: seo.metaDescription.status === "good" ? "Your meta description is well-written and within the ideal 120-160 character range. It will show fully in search results." : !seo.metaDescription.text ? "You have no meta description! Search engines will auto-generate one from your page content, which usually looks bad. Write a compelling 120-160 char summary with your target keyword." : seo.metaDescription.length > 160 ? `At ${seo.metaDescription.length} chars, your description will be cut off in search results. Trim it to 120-160 chars and front-load the most compelling info.` : `At ${seo.metaDescription.length} chars, your description is short. Expand it to 120-160 chars \u2014 include your value prop and a call to action.`
          });
        }
        if (seo.h1) {
          seoItems.push({
            label: "H1 Heading",
            status: seo.h1.status,
            value: escapeHtml(seo.h1.text || "None"),
            detail: seo.h1.status === "good" ? "Found" : "Missing or duplicate",
            advice: seo.h1.status === "good" ? "Your page has a proper H1 tag. Make sure it contains your primary keyword and clearly describes the page topic." : "Every page needs exactly one H1 tag. It tells search engines (and users) what the page is about. Add a clear, keyword-rich H1 heading."
          });
        }
        seoDetailsHtml = `
        <div class="space-y-4">
          <!-- SEO Score Header -->
          <div class="card p-5">
            <div class="flex items-center gap-4">
              <div class="score-ring" style="width:80px;height:80px;border-width:5px;border-color:${seoColor};flex-shrink:0;">
                <span class="text-xl font-bold" style="color:${seoColor}">${seoNormDisp}</span>
                <span class="text-xs text-[#a1a1a6]">/10</span>
              </div>
              <div>
                <h3 class="text-sm font-semibold text-white">SEO Health</h3>
                <p class="text-xs text-[#6e6e73] mt-1">How well your page is optimized for search engines. This score measures title tags, meta descriptions, heading structure, image alt text, and more.</p>
              </div>
            </div>
          </div>

          <div class="grid md:grid-cols-2 gap-4">
            <!-- SEO Checks -->
            <div class="card p-5">
              <h3 class="text-sm font-semibold mb-4">SEO Checks</h3>
              <div class="space-y-2">
                ${seoItems.map((item, idx) => `<div>
                  <div class="expandable p-3 bg-white/[0.03] rounded-xl" onclick="this.classList.toggle('open')">
                    <div class="flex justify-between items-start mb-1">
                      <div class="flex items-center gap-2">
                        <span class="expand-icon">&#9654;</span>
                        <span class="text-xs font-medium text-[#d1d1d6]">${item.label}</span>
                      </div>
                      <span class="text-xs px-1.5 py-0.5 rounded-full ${item.status === "good" ? "bg-green-500/20 text-green-400" : item.status === "warning" ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400"}">${item.status}</span>
                    </div>
                    <p class="text-xs text-[#a1a1a6] truncate ml-5">${item.value}</p>
                    <p class="text-xs text-[#6e6e73] mt-0.5 ml-5">${item.detail}</p>
                    <div class="expand-detail mt-2 ml-5">
                      <div class="p-2.5 ${item.status === "good" ? "bg-green-500/5 border border-green-500/10" : "bg-yellow-500/5 border border-yellow-500/10"} rounded-lg">
                        <div class="text-xs text-[#a1a1a6] mb-1">${item.status === "good" ? "\u2713 Looking good" : "\u{1F4A1} Recommendation"}</div>
                        <p class="text-xs text-[#d1d1d6] leading-relaxed">${item.advice}</p>
                      </div>
                    </div>
                  </div>
                </div>`).join("\n                ")}
                <!-- H2 & Images row -->
                <div class="grid grid-cols-2 gap-3 mt-2">
                  <div class="p-3 bg-white/[0.03] rounded-xl text-center expandable" onclick="this.classList.toggle('open')">
                    <div class="text-lg font-bold">${seo.h2Count ?? "-"}</div>
                    <div class="text-xs text-[#6e6e73]">H2 Headings</div>
                    <div class="expand-detail mt-2 text-left">
                      <p class="text-xs text-[#a1a1a6] leading-relaxed">${(seo.h2Count ?? 0) === 0 ? "Add H2 subheadings to break up content and help search engines understand your page structure." : (seo.h2Count ?? 0) < 3 ? "Consider adding more subheadings. They help both readers and search engines navigate your content." : "Good heading structure helps SEO and readability."}</p>
                    </div>
                  </div>
                  <div class="p-3 bg-white/[0.03] rounded-xl text-center expandable" onclick="this.classList.toggle('open')">
                    <div class="text-lg font-bold ${(seo.imgWithoutAlt ?? 0) > 0 ? "text-red-400" : ""}">${seo.imgWithoutAlt ?? "-"}</div>
                    <div class="text-xs text-[#6e6e73]">Imgs w/o Alt</div>
                    <div class="expand-detail mt-2 text-left">
                      <p class="text-xs text-[#a1a1a6] leading-relaxed">${(seo.imgWithoutAlt ?? 0) > 0 ? `${seo.imgWithoutAlt} images are missing alt text. Alt text helps search engines understand images and is essential for accessibility. Add descriptive alt attributes to every image.` : "All images have alt text \u2014 great for SEO and accessibility."}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Radar / Issues -->
            ${seo.radar ? `<div class="card p-5 border-orange-500/20">
              <div class="flex items-center gap-2 mb-4">
                <span class="text-lg">\u{1F4E1}</span>
                <div>
                  <h3 class="text-sm font-semibold">Cloudflare Radar</h3>
                  <p class="text-xs text-[#6e6e73]">Global DNS traffic data</p>
                </div>
              </div>
              ${seo.radar.ranking ? `<div class="p-3 bg-white/[0.03] border border-white/[0.04] rounded-xl mb-3 expandable" onclick="this.classList.toggle('open')">
                <div class="flex justify-between items-start">
                  <div>
                    <div class="text-xs text-[#a1a1a6] mb-1">Domain Popularity</div>
                    <div class="text-sm font-semibold text-orange-400">${seo.radar.ranking.bucket || "Unknown"}</div>
                    ${seo.radar.ranking.rank ? `<div class="text-xs text-[#6e6e73]">Rank #${seo.radar.ranking.rank}</div>` : ""}
                  </div>
                  <span class="expand-icon mt-1">&#9654;</span>
                </div>
                <div class="expand-detail mt-2">
                  <p class="text-xs text-[#a1a1a6] leading-relaxed">Domain popularity is based on Cloudflare's global DNS resolver data. Higher popularity means more organic visitors are finding your site through direct navigation or bookmarks.</p>
                </div>
              </div>` : ""}
              ${seo.radar.geoDistribution && seo.radar.geoDistribution.length > 0 ? `<div class="p-3 bg-white/[0.03] rounded-xl">
                <div class="text-xs font-medium text-[#d1d1d6] mb-2">Traffic by Country</div>
                <div class="space-y-1.5">
                  ${seo.radar.geoDistribution.slice(0, 5).map((g) => `<div class="flex items-center justify-between text-xs">
                    <span class="text-[#a1a1a6]">${escapeHtml(g.country || g.code)}</span>
                    <div class="flex items-center gap-2">
                      <div class="w-12 h-1 bg-white/[0.06] rounded-full overflow-hidden"><div class="h-full bg-orange-400 rounded-full" style="width:${g.percentage || g.pct || 0}%"></div></div>
                      <span class="text-[#d1d1d6] w-8 text-right">${(g.percentage || g.pct || 0).toFixed(0)}%</span>
                    </div>
                  </div>`).join("")}
                </div>
              </div>` : ""}
            </div>` : `<div class="card p-5">
              <h3 class="text-sm font-semibold mb-4">Issues Found</h3>
              ${seo.issues && seo.issues.length > 0 ? `<div class="space-y-2">${seo.issues.map((issue, idx) => {
          const issueAdvice = {
            "title": "Write a unique, descriptive title between 50-60 characters that includes your primary keyword.",
            "description": "Add a compelling meta description of 120-160 characters with your main keyword and a clear value proposition.",
            "h1": "Add exactly one H1 heading that clearly describes the page content and includes your target keyword.",
            "alt": "Add descriptive alt text to all images. Describe what the image shows in context of your content.",
            "heading": "Use a logical heading hierarchy (H1 > H2 > H3). Don't skip levels."
          };
          const adviceKey = Object.keys(issueAdvice).find((k) => issue.toLowerCase().includes(k));
          const advice = adviceKey ? issueAdvice[adviceKey] : "Review this issue and implement the fix to improve your SEO score.";
          return `<div class="expandable text-xs p-3 bg-red-500/5 rounded-lg" onclick="this.classList.toggle('open')">
                  <div class="flex items-center gap-2">
                    <span class="expand-icon">&#9654;</span>
                    <span class="text-red-400/80">\u26A0 ${escapeHtml(issue)}</span>
                  </div>
                  <div class="expand-detail mt-2 ml-5">
                    <div class="p-2 bg-yellow-500/5 border border-yellow-500/10 rounded-lg">
                      <div class="text-xs text-[#a1a1a6] mb-1">\u{1F4A1} How to fix</div>
                      <p class="text-xs text-[#d1d1d6]">${advice}</p>
                    </div>
                  </div>
                </div>`;
        }).join("")}</div>` : '<div class="text-xs text-green-400 p-3 bg-green-500/10 rounded-lg">\u2713 No SEO issues found</div>'}
            </div>`}
          </div>
        </div>`;
      }
      let a11yDetailsHtml = "";
      if (a11y) {
        const a11yColor = a11yScore >= 80 ? "#22C55E" : a11yScore >= 50 ? "#EAB308" : "#EF4444";
        const a11yNormDisp = (a11yScore / 10).toFixed(1);
        const checks = [
          { label: "Images without alt text", value: a11y.imagesWithoutAlt ?? 0, bad: (a11y.imagesWithoutAlt ?? 0) > 0, what: "Alt text describes images for screen readers and search engines.", advice: (a11y.imagesWithoutAlt ?? 0) > 0 ? `${a11y.imagesWithoutAlt} images are missing alt text. Add descriptive alt attributes \u2014 describe what the image shows and why it matters in context.` : "All images have alt text. Screen readers can describe every image to visually impaired users." },
          { label: "Links without text", value: a11y.linksWithoutText ?? 0, bad: (a11y.linksWithoutText ?? 0) > 0, what: "Links need descriptive text so users know where they lead.", advice: (a11y.linksWithoutText ?? 0) > 0 ? `${a11y.linksWithoutText} links have no accessible text. Add aria-label or visible text to each link \u2014 avoid "click here" or icon-only links.` : "All links have descriptive text. Users can understand each link's purpose." },
          { label: "Missing form labels", value: a11y.formsMissingLabels ?? 0, bad: (a11y.formsMissingLabels ?? 0) > 0, what: "Form inputs need labels so users know what to enter.", advice: (a11y.formsMissingLabels ?? 0) > 0 ? `${a11y.formsMissingLabels} form inputs are missing labels. Add <label> elements associated with each input via the "for" attribute.` : "All form inputs have proper labels." },
          { label: "Has skip link", value: a11y.hasSkipLink ? "Yes" : "No", bad: !a11y.hasSkipLink, what: "Skip links let keyboard users jump past navigation to main content.", advice: !a11y.hasSkipLink ? 'Add a "Skip to content" link as the first focusable element. It helps keyboard-only users navigate efficiently.' : "Your page has a skip link \u2014 keyboard users can jump directly to content." },
          { label: "Has lang attribute", value: a11y.hasLangAttr ? "Yes" : "No", bad: !a11y.hasLangAttr, what: "The lang attribute tells browsers and screen readers what language your content is in.", advice: !a11y.hasLangAttr ? 'Add lang="en" (or your language) to the <html> tag. This helps screen readers pronounce content correctly.' : "Language is properly declared. Screen readers will use the correct pronunciation." },
          { label: "ARIA roles", value: a11y.ariaRoles ?? 0, bad: false, what: "ARIA roles define the purpose of page sections for assistive technology.", advice: (a11y.ariaRoles ?? 0) > 0 ? `${a11y.ariaRoles} ARIA roles found. These help screen readers understand your page structure.` : "No ARIA roles detected. Consider adding landmark roles (navigation, main, banner) to help screen readers." }
        ];
        a11yDetailsHtml = `
        <div class="space-y-4">
          <!-- A11y Score Header -->
          <div class="card p-5">
            <div class="flex items-center gap-4">
              <div class="score-ring" style="width:80px;height:80px;border-width:5px;border-color:${a11yColor};flex-shrink:0;">
                <span class="text-xl font-bold" style="color:${a11yColor}">${a11yNormDisp}</span>
                <span class="text-xs text-[#a1a1a6]">/10</span>
              </div>
              <div>
                <h3 class="text-sm font-semibold text-white">Accessibility</h3>
                <p class="text-xs text-[#6e6e73] mt-1">How usable your page is for people with disabilities. Good accessibility also improves SEO and helps all users navigate your site more easily.</p>
                <div class="text-xs mt-2" style="color:${a11yColor}">${a11yScore >= 90 ? "Excellent \u2014 your page is well accessible" : a11yScore >= 70 ? "Good \u2014 minor improvements possible" : a11yScore >= 50 ? "Needs work \u2014 several accessibility gaps" : "Poor \u2014 significant accessibility barriers exist"}</div>
              </div>
            </div>
          </div>

          <!-- A11y Checks -->
          <div class="card p-5">
            <h3 class="text-sm font-semibold mb-3">Accessibility Checks</h3>
            <div class="space-y-2">
              ${checks.map((c) => `<div class="expandable p-3 bg-white/[0.03] rounded-xl" onclick="this.classList.toggle('open')">
                <div class="flex justify-between items-center">
                  <div class="flex items-center gap-2">
                    <span class="expand-icon">&#9654;</span>
                    <span class="text-xs text-[#d1d1d6]">${c.label}</span>
                  </div>
                  <span class="text-xs font-medium ${c.bad ? "text-red-400" : "text-green-400"}">${c.value}</span>
                </div>
                <div class="expand-detail mt-2 ml-5">
                  <div class="text-xs text-[#6e6e73] mb-2">${c.what}</div>
                  <div class="p-2.5 ${c.bad ? "bg-yellow-500/5 border border-yellow-500/10" : "bg-green-500/5 border border-green-500/10"} rounded-lg">
                    <div class="text-xs text-[#a1a1a6] mb-1">${c.bad ? "\u{1F4A1} Recommendation" : "\u2713 Looking good"}</div>
                    <p class="text-xs text-[#d1d1d6] leading-relaxed">${c.advice}</p>
                  </div>
                </div>
              </div>`).join("\n              ")}
            </div>
          </div>
        </div>`;
      }
      const verdictText = roast.roast_response || verdict;
      const scoreLabel = score >= 8 ? 'High Performer' : score >= 6 ? 'Room to Improve' : score >= 4 ? 'Needs Work' : 'Critical Issues';
      const html = renderRoastPage({
          roast, hostname, scoreColor, score, emoji, dateStr, categories, sections,
          quickWins, seo, performance22, BASE_URL, screenshotUrl, heatmapDotsHtml,
          heatmapSidebarHtml, a11y, a11yDetailsHtml, verdictText, scoreLabel,
          ogTitle, ogDesc, ogImage, pageUrl, createdAt, industrySampleSize, heatmap,
          seoDetailsHtml, perfDetailsHtml
        });
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=3600, s-maxage=86400",
          ...getSecurityHeaders(origin, env22.ENVIRONMENT)
        }
      });
    }
    if (url.pathname === "/gallery" && request.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
      const perPage = 24;
      const offset = (page - 1) * perPage;
      const industryFilter = url.searchParams.get("industry");
      const validIndustry = industryFilter && INDUSTRY_KEYS.includes(industryFilter) ? industryFilter : null;
      let roastsResult;
      let totalResult;
      if (validIndustry) {
        [roastsResult, totalResult] = await Promise.all([
          env22.DB.prepare(`
            SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, country, industry, created_at
            FROM roasts WHERE industry = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
          `).bind(validIndustry, perPage, offset).all(),
          env22.DB.prepare("SELECT COUNT(*) as count FROM roasts WHERE industry = ?").bind(validIndustry).first()
        ]);
      } else {
        [roastsResult, totalResult] = await Promise.all([
          env22.DB.prepare(`
            SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, country, created_at
            FROM roasts ORDER BY created_at DESC LIMIT ? OFFSET ?
          `).bind(perPage, offset).all(),
          env22.DB.prepare("SELECT COUNT(*) as count FROM roasts").first()
        ]);
      }
      const total = totalResult?.count || 0;
      const totalPages = Math.ceil(total / perPage);
      const roasts = roastsResult.results || [];
      const industryMeta = validIndustry ? INDUSTRY_BENCHMARKS[validIndustry] : null;
      const galleryHtml = renderGalleryPage({
          roasts, total, page, totalPages,
          prevPageUrl: page > 1 ? `/gallery${validIndustry ? `?industry=${validIndustry}&page=${page - 1}` : `?page=${page - 1}`}` : null,
          nextPageUrl: page < totalPages ? `/gallery${validIndustry ? `?industry=${validIndustry}&page=${page + 1}` : `?page=${page + 1}`}` : null,
          validIndustry, BASE_URL, industryMeta
        });
      return new Response(galleryHtml, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "public, max-age=300, s-maxage=600",
          ...getSecurityHeaders(origin, env22.ENVIRONMENT)
        }
      });
    }
    // Alias /api/og-image/:id → /api/og/:id for backward compatibility
    if (url.pathname.startsWith("/api/og-image/") && request.method === "GET") {
      const roastId = url.pathname.split("/").pop();
      const base = env22.BASE_URL || PRODUCTION_ORIGINS[0];
      return Response.redirect(`${base}/api/og/${roastId}`, 301);
    }
    // Pricing page — served as SPA route from index.html
    if (url.pathname === "/pricing" && request.method === "GET") {
      if (env22.ASSETS) {
        const indexUrl = new URL(request.url);
        indexUrl.pathname = "/";
        return env22.ASSETS.fetch(new Request(indexUrl.toString(), request));
      }
    }
    if (env22.ASSETS) {
      return env22.ASSETS.fetch(request);
    }
    return new Response("Not Found", { status: 404 });
  }

};
