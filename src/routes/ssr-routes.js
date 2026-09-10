// GET /sitemap.xml, /roast/:id, /gallery, /pricing
import { INDUSTRY_BENCHMARKS, INDUSTRY_KEYS, PRODUCTION_ORIGINS } from '../config.js';

import { safeLogError, escapeHtml, getSecurityHeaders } from '../utils.js';

import { isStoredChallengeRoast } from '../botcheck.js';

import { resolveIndustry } from '../ai.js';

import { generateNotFoundPage, renderRoastPage, renderGalleryPage } from '../ssr.js';

import { visibleStoredRoasts, visibleStoredRoastSql } from './helpers.js';

export async function handle(request, env, ctx, url, corsHeaders) {
  const env22 = env;
  const origin = request.headers.get("Origin");
    if (url.pathname === "/sitemap.xml" && request.method === "GET") {
      try {
        const BASE_URL_SM = PRODUCTION_ORIGINS[0];
        const totalResult = await env22.DB.prepare(
          `SELECT COUNT(*) as count FROM roasts WHERE ${visibleStoredRoastSql()}`
        ).first();
        const totalRoasts = totalResult?.count || 0;
        const galleryPages = Math.ceil(totalRoasts / 24);
        const roasts = await env22.DB.prepare(
          `SELECT id, created_at, seo_data FROM roasts
           WHERE ${visibleStoredRoastSql()} ORDER BY created_at DESC LIMIT 50000`
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
          for (const roast of visibleStoredRoasts(roasts.results)) {
            const created = roast.created_at || now;
            const hasZ = /Z$/.test(created);
            const lastmod = (/* @__PURE__ */ new Date(hasZ ? created : (created + "Z"))).toISOString().split("T")[0];
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
      if (!roast || isStoredChallengeRoast(roast.seo_data)) {
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
      const industryCountRow = await env22.DB.prepare(
        `SELECT COUNT(*) as cnt FROM roasts WHERE industry = ? AND ${visibleStoredRoastSql()}`
      ).bind(roastIndustryKey).first();
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
      // Keep page images on the request origin. Production is reachable from
      // both the custom domain and workers.dev, while CSP img-src is 'self'.
      const screenshotUrl = `/api/screenshot/${roastId}`;
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
            SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, country, industry, created_at, seo_data
            FROM roasts WHERE industry = ? AND ${visibleStoredRoastSql()} ORDER BY created_at DESC LIMIT ? OFFSET ?
          `).bind(validIndustry, perPage, offset).all(),
          env22.DB.prepare(
            `SELECT COUNT(*) as count FROM roasts WHERE industry = ? AND ${visibleStoredRoastSql()}`
          ).bind(validIndustry).first()
        ]);
      } else {
        [roastsResult, totalResult] = await Promise.all([
          env22.DB.prepare(`
            SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, country, created_at, seo_data
            FROM roasts WHERE ${visibleStoredRoastSql()} ORDER BY created_at DESC LIMIT ? OFFSET ?
          `).bind(perPage, offset).all(),
          env22.DB.prepare(
            `SELECT COUNT(*) as count FROM roasts WHERE ${visibleStoredRoastSql()}`
          ).first()
        ]);
      }
      const total = totalResult?.count || 0;
      const totalPages = Math.ceil(total / perPage);
      const roasts = visibleStoredRoasts(roastsResult.results);
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
    if (url.pathname === "/pricing" && request.method === "GET") {
      if (env22.ASSETS) {
        const indexUrl = new URL(request.url);
        indexUrl.pathname = "/";
        return env22.ASSETS.fetch(new Request(indexUrl.toString(), request));
      }
    }
  return null;
}
