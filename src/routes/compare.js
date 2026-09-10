// POST /api/compare
import { CONFIG } from '../config.js';

import {
    generateId,
    isValidUrl,
    hashUrl,
    hashIp,
    uint8ArrayToBase64,
    safeLogError,
    withTimeout,
    sanitizeUrl,
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

import { getComparisonMetrics, hasMetricPair } from '../compare.js';

import { analyzeWithVisionAndHeatmap } from '../ai.js';

export async function handle(request, env, ctx, url, corsHeaders) {
  const env22 = env;
    if (url.pathname === "/api/compare" && request.method === "POST") {
      try {
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT, env22.ENVIRONMENT);
        const body = await request.json();
        const device = ["desktop", "tablet", "mobile"].includes(body.device || "") ? body.device : "desktop";
        const fullPage = body.fullPage === true;
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
        const rateLimit = await checkOperationRateLimit(env22, ipHash, "compare");
        if (!rateLimit.allowed) {
          return Response.json(
            { error: `Compare rate limit exceeded (${CONFIG.RATE_LIMIT_COMPARE_MAX}/hour). Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.`, retryAfter: rateLimit.resetIn },
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
        const [hash1, hash2] = await Promise.all([
          hashUrl(url1, device + (fullPage ? "-full" : "")),
          hashUrl(url2, device + (fullPage ? "-full" : ""))
        ]);
        const [cached1, cached2] = await Promise.all([
          // Compare does not persist fresh captures, so repeatedly rejecting a
          // legacy row would force a full Browser + AI recapture on every request.
          // Its metric helpers safely handle missing legacy audit data.
          getCachedRoast(env22, hash1, url1, { requireAuditData: false }),
          getCachedRoast(env22, hash2, url2, { requireAuditData: false })
        ]);
        const needCapture1 = !cached1;
        const needCapture2 = !cached2;
        const sessionsNeeded = (needCapture1 ? 1 : 0) + (needCapture2 ? 1 : 0);
        if (sessionsNeeded > 0) await trackBrowserUsage(env22, sessionsNeeded);
        const compareResult = await withTimeout((async () => {
          const [page1, page2] = await Promise.all([
            needCapture1 ? capturePageWithMetrics(env22, url1, { device, fullPage }) : null,
            needCapture2 ? capturePageWithMetrics(env22, url2, { device, fullPage }) : null
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
          const metrics1 = getComparisonMetrics(pageData1);
          const metrics2 = getComparisonMetrics(pageData2);
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
          const seo1 = metrics1.seoScore;
          const seo2 = metrics2.seoScore;
          if (hasMetricPair(metrics1, metrics2, "seoScore") && Math.abs(seo1 - seo2) >= 5) {
            const betterSeo = seo1 > seo2 ? url1Host : url2Host;
            const worseSeo = seo1 > seo2 ? url2Host : url1Host;
            insights.push(`\u{1F50D} ${betterSeo} has stronger SEO (${Math.max(seo1, seo2)}/100 vs ${Math.min(seo1, seo2)}/100)`);
          }
          if (metrics1.hasSeo && metrics2.hasSeo && metrics1.metaDescriptionStatus === "missing" && metrics2.metaDescriptionStatus !== "missing") {
            insights.push(`\u{1F4DD} ${url1Host} is missing meta description - ${url2Host} has this covered`);
          } else if (metrics1.hasSeo && metrics2.hasSeo && metrics2.metaDescriptionStatus === "missing" && metrics1.metaDescriptionStatus !== "missing") {
            insights.push(`\u{1F4DD} ${url2Host} is missing meta description - ${url1Host} has this covered`);
          }
          const noAlt1 = metrics1.imgWithoutAlt;
          const noAlt2 = metrics2.imgWithoutAlt;
          if (hasMetricPair(metrics1, metrics2, "imgWithoutAlt") && noAlt1 > noAlt2 + 5) {
            insights.push(`\u{1F5BC}\uFE0F ${url1Host} has ${noAlt1} images without alt text vs ${url2Host}'s ${noAlt2} - accessibility issue`);
          } else if (hasMetricPair(metrics1, metrics2, "imgWithoutAlt") && noAlt2 > noAlt1 + 5) {
            insights.push(`\u{1F5BC}\uFE0F ${url2Host} has ${noAlt2} images without alt text vs ${url1Host}'s ${noAlt1} - accessibility issue`);
          }
          const load1 = metrics1.loadTime;
          const load2 = metrics2.loadTime;
          const loadDiff = hasMetricPair(metrics1, metrics2, "loadTime") ? Math.abs(load1 - load2) : null;
          if (loadDiff !== null && loadDiff >= 500) {
            const faster = load1 < load2 ? url1Host : url2Host;
            const slower = load1 < load2 ? url2Host : url1Host;
            const fasterTime = Math.min(load1, load2) / 1e3;
            const slowerTime = Math.max(load1, load2) / 1e3;
            insights.push(`\u26A1 ${faster} loads ${(loadDiff / 1e3).toFixed(1)}s faster (${fasterTime.toFixed(1)}s vs ${slowerTime.toFixed(1)}s)`);
            if (slowerTime > 3) {
              insights.push(`\u{1F40C} ${slower}'s ${slowerTime.toFixed(1)}s load time may hurt conversions - aim for under 3s`);
            }
          }
          const res1 = metrics1.resourceCount;
          const res2 = metrics2.resourceCount;
          if (hasMetricPair(metrics1, metrics2, "resourceCount") && Math.abs(res1 - res2) >= 20) {
            const lighter = res1 < res2 ? url1Host : url2Host;
            insights.push(`\u{1F4E6} ${lighter} is lighter with ${Math.min(res1, res2)} resources vs ${Math.max(res1, res2)}`);
          }
          const ttfb1 = metrics1.ttfb;
          const ttfb2 = metrics2.ttfb;
          if (hasMetricPair(metrics1, metrics2, "ttfb") && Math.abs(ttfb1 - ttfb2) >= 200) {
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
          if (hasMetricPair(metrics1, metrics2, "seoScore")) {
            weightedScore1 += seo1 / 10 * 0.05;
            weightedScore2 += seo2 / 10 * 0.05;
          }
          if (hasMetricPair(metrics1, metrics2, "loadTime")) {
            const speedScore1 = Math.max(0, 10 - load1 / 1e3);
            const speedScore2 = Math.max(0, 10 - load2 / 1e3);
            weightedScore1 += speedScore1 * 0.05;
            weightedScore2 += speedScore2 * 0.05;
          }
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
            abTestPrediction,
            device,
            fullPage
          };
        })(), CONFIG.COMPARE_TOTAL_TIMEOUT_MS, "Compare operation");
        return Response.json(compareResult, { headers: corsHeaders });
      } catch (error32) {
        safeLogError("Compare failed:", error32);
        const errorMsg = error32.message || "";
        if (isBotChallengeError(error32)) {
          return Response.json({
            error: "blocked_by_bot_protection",
            message: BOT_CHALLENGE_MESSAGE
          }, { status: 422, headers: corsHeaders });
        }
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
  return null;
}
