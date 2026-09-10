// GET /api/badge/*, /api/og/*, /og/*, /api/card/*, /api/og-image/:id
import { INDUSTRY_BENCHMARKS, PRODUCTION_ORIGINS } from '../config.js';

import { isValidRoastIdLoose, safeLogError, escapeHtml } from '../utils.js';

import { isStoredChallengeRoast } from '../botcheck.js';

import { renderSvgToPng } from '../render.js';

import { __name2 } from './helpers.js';

export async function handle(request, env, ctx, url, corsHeaders) {
  const env22 = env;
    if (url.pathname.startsWith("/api/badge/") && request.method === "GET" && !url.pathname.includes("/html")) {
      const roastId = url.pathname.split("/").pop();
      if (!isValidRoastIdLoose(roastId)) {
        return new Response("Invalid roast ID", { status: 400, headers: corsHeaders });
      }
      const roast = await env22.DB.prepare("SELECT overall_score, url, seo_data FROM roasts WHERE id = ?").bind(roastId).first();
      if (!roast || isStoredChallengeRoast(roast.seo_data)) {
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
      const roast = await env22.DB.prepare("SELECT overall_score, url, hero_score, cta_score, trust_score, copy_score, design_score, seo_data FROM roasts WHERE id = ?").bind(roastId).first();
      if (!roast || isStoredChallengeRoast(roast.seo_data)) {
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
        "SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, industry, created_at, seo_data FROM roasts WHERE id = ?"
      ).bind(roastId).first();
      if (!roast || isStoredChallengeRoast(roast.seo_data)) {
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
    if (url.pathname.match(/^\/api\/badge\/[^/]+\/large$/) && request.method === "GET") {
      const roastId = url.pathname.split("/")[3];
      const roast = await env22.DB.prepare("SELECT overall_score, url, seo_data FROM roasts WHERE id = ?").bind(roastId).first();
      if (!roast || isStoredChallengeRoast(roast.seo_data)) {
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
    if (url.pathname.startsWith("/api/og-image/") && request.method === "GET") {
      const roastId = url.pathname.split("/").pop();
      const base = env22.BASE_URL || PRODUCTION_ORIGINS[0];
      return Response.redirect(`${base}/api/og/${roastId}`, 301);
    }
  return null;
}
