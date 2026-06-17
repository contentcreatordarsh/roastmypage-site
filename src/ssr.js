import { escapeHtml, getTimeAgoSSR, getCountryFlag } from './utils.js';
import { INDUSTRY_BENCHMARKS } from './config.js';

function generateNotFoundPage(baseUrl) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Roast Not Found</title><script src="https://cdn.tailwindcss.com"><\/script><style>body{background:#000;color:#e5e7eb;font-family:system-ui,sans-serif}</style></head><body class="min-h-screen flex items-center justify-center"><div class="text-center"><div class="text-6xl mb-4">\u{1F525}</div><h1 class="text-2xl font-bold mb-2">Roast Not Found</h1><p class="text-[#a1a1a6] mb-6">This roast may have expired or never existed.</p><a href="/" class="px-6 py-3 bg-[#FF6B35] hover:bg-[#E8552D] text-white font-semibold rounded-xl transition-colors">Roast Your Page</a><br><a href="/gallery" class="inline-block mt-4 text-sm text-[#6e6e73] hover:text-[#d1d1d6]">Browse the Gallery</a></div></body></html>`;
}
var PRODUCTION_ORIGINS = [
  "https://roastmypage.site",
  "https://roast-my-landing-page.falling-hall-ac41.workers.dev"
];
var DEV_ORIGINS = [
  "http://localhost:8787",
  "http://127.0.0.1:8787"
];

export function renderRoastPage(params) {
    const {
        roast, hostname, scoreColor, score, emoji, dateStr, categories, sections,
        quickWins, seo, performance22, BASE_URL, screenshotUrl, heatmapDotsHtml,
        heatmapSidebarHtml, a11y, a11yDetailsHtml, verdictText, scoreLabel
    } = params;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(ogTitle)}</title>
<meta name="description" content="${escapeHtml(ogDesc)}">
<meta name="robots" content="index, follow">

<!-- Open Graph -->
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(ogTitle)}">
<meta property="og:description" content="${escapeHtml(ogDesc)}">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${pageUrl}">
<meta property="og:site_name" content="Roast My Landing Page">
<meta property="article:published_time" content="${createdAt.toISOString()}">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@hegdedarsh">
<meta name="twitter:creator" content="@hegdedarsh">
<meta name="twitter:title" content="${escapeHtml(ogTitle)}">
<meta name="twitter:description" content="${escapeHtml(ogDesc)}">
<meta name="twitter:image" content="${ogImage}">

<!-- Canonical -->
<link rel="canonical" href="${pageUrl}">

<script src="https://cdn.tailwindcss.com"><\/script>
<style>
  body { background: #000; color: #e5e7eb; font-family: system-ui, -apple-system, sans-serif; }
  .card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; }
  .score-ring { width: 160px; height: 160px; border-radius: 50%; border: 8px solid ${scoreColor}; display: flex; align-items: center; justify-content: center; flex-direction: column; background: rgba(255,255,255,0.03); }
  .cat-bar { height: 8px; border-radius: 4px; background: rgba(255,255,255,0.06); overflow: hidden; }
  .cat-fill { height: 100%; border-radius: 4px; transition: width 0.7s ease; }
  .tab-btn { padding: 8px 16px; border-radius: 8px; font-size: 14px; color: #9ca3af; cursor: pointer; transition: all 0.2s; background: rgba(255,255,255,0.03); border: 1px solid transparent; }
  .tab-btn:hover { color: #e5e7eb; background: rgba(255,255,255,0.06); }
  .tab-btn.active { color: #fff; background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.12); }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
  .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .expandable { cursor: pointer; transition: all 0.2s; }
  .expandable:hover { background: rgba(255,255,255,0.05); }
  .expandable .expand-icon { transition: transform 0.2s; font-size: 10px; color: #6b7280; }
  .expandable.open .expand-icon { transform: rotate(90deg); }
  .expand-detail { max-height: 0; overflow: hidden; transition: max-height 0.3s ease, opacity 0.2s ease; opacity: 0; }
  .expandable.open .expand-detail { max-height: 500px; opacity: 1; }
</style>
</head>
<body class="min-h-screen">

<!-- Nav -->
<nav class="fixed top-0 w-full z-50 px-4 py-3">
  <div class="max-w-4xl mx-auto flex justify-between items-center bg-black/60 backdrop-blur-xl border border-white/[0.06] rounded-2xl px-5 py-3">
    <a href="/" class="flex items-center gap-2">
      <span class="text-xl">\u{1F525}</span>
      <span class="font-semibold text-white/90 text-sm">Roast My Landing Page</span>
    </a>
    <div class="flex items-center gap-1">
      <a href="/gallery" class="text-sm text-white/50 hover:text-white/90 px-3 py-1.5 rounded-lg hover:bg-white/[0.06] transition-colors">Gallery</a>
      <a href="/" class="text-sm text-white/50 hover:text-white/90 px-3 py-1.5 rounded-lg hover:bg-white/[0.06] transition-colors">Roast Yours</a>
    </div>
  </div>
</nav>

<main class="max-w-4xl mx-auto px-4 pt-24 pb-16">

  <!-- Header -->
  <div class="text-center mb-8">
    <div class="inline-flex items-center gap-2 text-xs text-[#6e6e73] bg-white/[0.03] border border-white/[0.06] rounded-full px-4 py-1.5 mb-4">
      <span>Roasted on ${dateStr}</span>
      ${roast.country && roast.country !== "XX" ? `<span>from ${roast.country}</span>` : ""}
    </div>
    <h1 class="text-2xl md:text-3xl font-bold mb-2">${escapeHtml(hostname)}</h1>
    <a href="${escapeHtml(roast.url)}" target="_blank" rel="noopener" class="text-sm text-[#6e6e73] hover:text-[#d1d1d6] transition-colors break-all">${escapeHtml(roast.url)}</a>
  </div>

  <!-- Score Overview Cards -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
    <!-- Overall Score -->
    <div class="card p-5 text-center cursor-pointer hover:border-white/[0.12] transition-colors" onclick="showTab('overview')">
      <div class="flex justify-center mb-2">
        <div class="score-ring" style="width:100px;height:100px;border-width:6px;">
          <span class="text-2xl font-bold" style="color:${scoreColor}">${score}</span>
          <span class="text-xs text-[#a1a1a6]">/10</span>
        </div>
      </div>
      <div class="text-sm font-semibold" style="color:${scoreColor}">${emoji} ${verdict}</div>
      <div class="text-xs text-[#6e6e73]">Conversion</div>
    </div>
    <!-- SEO Score -->
    ${seo ? (() => {
        const seoNorm = (seo.score / 10).toFixed(1);
        const seoCardColor = seo.score >= 80 ? "#22C55E" : seo.score >= 50 ? "#EAB308" : "#EF4444";
        return `<div class="card p-5 text-center cursor-pointer hover:border-white/[0.12] transition-colors" onclick="showTab('seo')">
      <div class="flex justify-center mb-2">
        <div class="score-ring" style="width:100px;height:100px;border-width:6px;border-color:${seoCardColor}">
          <span class="text-2xl font-bold" style="color:${seoCardColor}">${seoNorm}</span>
          <span class="text-xs text-[#a1a1a6]">/10</span>
        </div>
      </div>
      <div class="text-sm font-semibold" style="color:${seoCardColor}">\u{1F50D} SEO</div>
      <div class="text-xs text-[#6e6e73]">${seo.issues ? seo.issues.length : 0} issues found</div>
    </div>`;
      })() : ""}
    <!-- Performance Score -->
    ${performance22 ? (() => {
        const perfNorm = (performance22.score / 10).toFixed(1);
        const perfCardColor = performance22.score >= 80 ? "#22C55E" : performance22.score >= 50 ? "#EAB308" : "#EF4444";
        return `<div class="card p-5 text-center cursor-pointer hover:border-white/[0.12] transition-colors" onclick="showTab('performance')">
      <div class="flex justify-center mb-2">
        <div class="score-ring" style="width:100px;height:100px;border-width:6px;border-color:${perfCardColor}">
          <span class="text-2xl font-bold" style="color:${perfCardColor}">${perfNorm}</span>
          <span class="text-xs text-[#a1a1a6]">/10</span>
        </div>
      </div>
      <div class="text-sm font-semibold" style="color:${perfCardColor}">\u{1F680} Performance</div>
      <div class="text-xs text-[#6e6e73]">${(performance22.loadTime / 1e3).toFixed(1)}s load time</div>
    </div>`;
      })() : ""}
    <!-- Accessibility Score -->
    ${a11yScore !== null ? (() => {
        const a11yNorm = (a11yScore / 10).toFixed(1);
        const a11yCardColor = a11yScore >= 80 ? "#22C55E" : a11yScore >= 50 ? "#EAB308" : "#EF4444";
        return `<div class="card p-5 text-center cursor-pointer hover:border-white/[0.12] transition-colors" onclick="showTab('accessibility')">
      <div class="flex justify-center mb-2">
        <div class="score-ring" style="width:100px;height:100px;border-width:6px;border-color:${a11yCardColor}">
          <span class="text-2xl font-bold" style="color:${a11yCardColor}">${a11yNorm}</span>
          <span class="text-xs text-[#a1a1a6]">/10</span>
        </div>
      </div>
      <div class="text-sm font-semibold" style="color:${a11yCardColor}">\u267F Accessibility</div>
      <div class="text-xs text-[#6e6e73]">WCAG checks</div>
    </div>`;
      })() : ""}
  </div>

  <!-- Industry Benchmark + Tweet Callout -->
  <div class="card p-5 mb-6" style="background:linear-gradient(135deg,rgba(139,92,246,0.08),rgba(236,72,153,0.06));border-color:rgba(139,92,246,0.2);">
    <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div class="flex items-start gap-3 flex-1">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style="background:rgba(139,92,246,0.2);">
          <span class="text-lg">${industryBench.emoji}</span>
        </div>
        <div>
          <div class="flex items-center gap-2 flex-wrap mb-1">
            <span class="text-sm font-semibold text-white">${industryBench.label} Benchmark</span>
            ${isAtAvg ? `<span class="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">\u2248 Average</span>` : isAboveAvg ? `<span class="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">\u2191 Above Average</span>` : `<span class="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">\u2193 Below Average</span>`}
          </div>
          <p class="text-xs text-[#a1a1a6]">
            ${isAtAvg ? `Your score of <strong class="text-white">${score}/10</strong> is right at the ${industryBench.label} industry average of <strong class="text-white">${industryAvgScore}/10</strong>.` : isAboveAvg ? `Your score of <strong class="text-white">${score}/10</strong> beats the ${industryBench.label} average of <strong class="text-[#a1a1a6]">${industryAvgScore}/10</strong> by <strong style="color:#22C55E">+${scoreDiff} points</strong>${industrySampleSize > 5 ? ` \u2014 better than most of the ${industrySampleSize} ${industryBench.label} pages we've analyzed` : ""}.` : `Your score of <strong class="text-white">${score}/10</strong> is <strong style="color:#EF4444">${Math.abs(scoreDiffNum).toFixed(1)} points below</strong> the ${industryBench.label} average of <strong class="text-[#a1a1a6]">${industryAvgScore}/10</strong>. The quick wins below can help close the gap.`}
          </p>
          <div class="flex items-center gap-4 mt-2 flex-wrap">
            <div class="flex items-center gap-1.5">
              <div class="text-xs text-[#6e6e73]">Your Score</div>
              <div class="text-xs font-bold" style="color:${scoreColor}">${score}/10</div>
            </div>
            <div class="w-px h-3 bg-white/10"></div>
            <div class="flex items-center gap-1.5">
              <div class="text-xs text-[#6e6e73]">${industryBench.label} Avg</div>
              <div class="text-xs font-bold text-[#a1a1a6]">${industryAvgScore}/10</div>
            </div>
            ${industrySampleSize > 0 ? `<div class="w-px h-3 bg-white/10"></div><div class="text-xs text-[#6e6e73]">${industrySampleSize} pages analyzed</div>` : ""}
          </div>
        </div>
      </div>
      <div class="flex gap-2 flex-shrink-0">
        <a
          id="tweet-score-btn"
          href="https://twitter.com/intent/tweet?text=${encodeURIComponent(`My landing page scored ${score}/10 on @roastmypage \u{1F525}

Hero: ${roast.hero_score} | CTA: ${roast.cta_score} | Trust: ${roast.trust_score} | Copy: ${roast.copy_score} | Design: ${roast.design_score}

Get yours \u2192`)}&url=${encodeURIComponent(pageUrl)}"
          target="_blank"
          rel="noopener"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
          style="background:rgba(29,161,242,0.15);border:1px solid rgba(29,161,242,0.3);color:#1DA1F2;"
          onmouseover="this.style.background='rgba(29,161,242,0.25)'"
          onmouseout="this.style.background='rgba(29,161,242,0.15)'"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          Tweet Score
        </a>
        <a
          href="/"
          class="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all"
          style="background:rgba(255,107,53,0.15);border:1px solid rgba(255,107,53,0.3);color:#FF6B35;"
          onmouseover="this.style.background='rgba(255,107,53,0.25)'"
          onmouseout="this.style.background='rgba(255,107,53,0.15)'"
        >
          \u{1F525} Roast Another
        </a>
      </div>
    </div>
  </div>

  <!-- Tab Navigation -->
  <div class="flex flex-wrap gap-2 mb-6 justify-center">
    <button class="tab-btn active" data-tab="overview" onclick="showTab('overview')">Overview</button>
    ${seo ? `<button class="tab-btn" data-tab="seo" onclick="showTab('seo')">SEO</button>` : ""}
    ${performance22 ? `<button class="tab-btn" data-tab="performance" onclick="showTab('performance')">Performance</button>` : ""}
    ${heatmap ? `<button class="tab-btn" data-tab="heatmap" onclick="showTab('heatmap')">Heatmap</button>` : ""}
    ${a11y ? `<button class="tab-btn" data-tab="accessibility" onclick="showTab('accessibility')">Accessibility</button>` : ""}
    ${roast.roast_response ? `<button class="tab-btn" data-tab="report" onclick="showTab('report')">Full Report</button>` : ""}
  </div>

  <!-- Overview Tab -->
  <div id="tab-overview" class="tab-content active">
    <!-- Screenshot -->
    <div class="card p-4 mb-6">
      <img src="${screenshotUrl}" alt="Screenshot of ${escapeHtml(hostname)}" class="w-full rounded-xl" loading="lazy">
    </div>

    <!-- Category Breakdown with Roast/Fix details -->
    <div class="card p-6 mb-6">
      <h2 class="text-lg font-semibold mb-2">Conversion Breakdown</h2>
      <p class="text-xs text-[#6e6e73] mb-5">AI analysis of each conversion factor \u2014 tap any category to learn more</p>
      <div class="space-y-4">
        ${categories.map((c) => {
        const catScoreColor = c.score >= 8 ? "#22C55E" : c.score >= 6 ? "#EAB308" : "#EF4444";
        const sec = sections[c.key];
        return `<div class="expandable p-4 rounded-2xl bg-white/[0.02] border border-white/[0.04]" onclick="this.classList.toggle('open')">
            <div class="flex items-center gap-4">
              <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/[0.05]">
                <span class="text-sm">${c.emoji}</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between">
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-semibold text-[#d1d1d6]">${c.label}</span>
                      <span class="expand-icon">&#9654;</span>
                    </div>
                    <div class="text-xs text-[#6e6e73]">${c.question}</div>
                  </div>
                  <div class="text-2xl font-bold flex-shrink-0" style="color:${catScoreColor}">${c.score}/10</div>
                </div>
                <div class="h-1.5 bg-white/[0.06] rounded-full mt-2 overflow-hidden">
                  <div class="h-full rounded-full transition-all" style="width:${c.score * 10}%;background:${c.color}"></div>
                </div>
              </div>
            </div>
            <div class="expand-detail">
              <div class="mt-3 pt-3" style="border-top:1px solid ${c.color}20">
                <!-- What this means -->
                <div class="p-2.5 bg-white/[0.03] rounded-lg mb-2">
                  <div class="text-xs text-[#6e6e73] mb-1">What this measures</div>
                  <p class="text-xs text-[#a1a1a6] leading-relaxed">${c.description}</p>
                </div>
                ${sec && sec.roast ? sec.isStrength ? `<div class="p-2.5 bg-green-500/5 rounded-lg mb-2">
                      <div class="text-xs text-[#6e6e73] mb-1">\u2705 Strength</div>
                      <p class="text-sm text-green-400/80">${escapeHtml(sec.roast)}</p>
                    </div>` : `<div class="p-2.5 bg-red-500/5 rounded-lg mb-2">
                      <div class="text-xs text-[#6e6e73] mb-1">\u{1F534} Problem found</div>
                      <p class="text-sm text-[#d1d1d6]">${escapeHtml(sec.roast)}</p>
                    </div>` : ""}
                ${sec && sec.fix ? `<div class="p-2.5 bg-blue-500/5 rounded-lg">
                  <div class="text-xs text-[#6e6e73] mb-1">\u{1F4A1} Recommendation</div>
                  <p class="text-sm text-blue-400/80">${escapeHtml(sec.fix)}</p>
                </div>` : ""}
              </div>
            </div>
          </div>`;
      }).join("\n        ")}
      </div>
    </div>

    <!-- Quick Wins -->
    ${quickWins.length > 0 ? `<div class="card p-6 mb-6">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 bg-yellow-500/20 rounded-xl flex items-center justify-center"><span class="text-xl">\u{1F4A1}</span></div>
        <div>
          <h2 class="text-lg font-semibold">Quick Wins</h2>
          <p class="text-xs text-[#6e6e73]">Tap any item to learn why it matters</p>
        </div>
      </div>
      <div class="space-y-2">
        ${quickWins.map((w, i) => {
        const wl = w.toLowerCase();
        const tip = wl.includes("cta") || wl.includes("call-to-action") || wl.includes("button") ? 'A clear, prominent CTA is the single biggest driver of conversions. Use contrasting colors, action verbs ("Get started", "Try free"), and place it above the fold.' : wl.includes("social proof") || wl.includes("testimonial") || wl.includes("review") || wl.includes("trust") ? "Social proof reduces buying anxiety. Even one testimonial or a row of client logos can increase conversion rates by 15-30%." : wl.includes("headline") || wl.includes("heading") || wl.includes("hero") ? "Your headline has about 5 seconds to hook visitors. Lead with the benefit, not the feature. Make it specific and outcome-focused." : wl.includes("copy") || wl.includes("text") || wl.includes("clarity") || wl.includes("message") ? "Clear, scannable copy converts better than clever copy. Use short paragraphs, bullet points, and focus on what the reader gets \u2014 not what you do." : wl.includes("image") || wl.includes("visual") || wl.includes("design") || wl.includes("color") ? "Visual hierarchy guides the eye to what matters. Use whitespace, contrast, and size to make your key message and CTA impossible to miss." : wl.includes("speed") || wl.includes("load") || wl.includes("performance") || wl.includes("fast") ? "Every extra second of load time costs ~7% in conversions. Compress images, defer scripts, and use a CDN for faster delivery." : "Small improvements compound. Fixing the easiest issues first gives you the biggest return on effort.";
        return `<div class="expandable flex items-start gap-3 p-3 bg-white/[0.03] rounded-xl" onclick="this.classList.toggle('open')">
          <span class="flex-shrink-0 w-6 h-6 rounded-full bg-yellow-500/10 text-yellow-400 flex items-center justify-center text-xs font-bold mt-0.5">${i + 1}</span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm text-[#d1d1d6]">${escapeHtml(w)}</span>
              <span class="expand-icon flex-shrink-0">&#9654;</span>
            </div>
            <div class="expand-detail mt-2">
              <div class="p-2.5 bg-yellow-500/5 border border-yellow-500/10 rounded-lg">
                <div class="text-xs text-[#a1a1a6] mb-1">Why this matters</div>
                <p class="text-xs text-[#d1d1d6] leading-relaxed">${tip}</p>
              </div>
            </div>
          </div>
        </div>`;
      }).join("\n        ")}
      </div>
    </div>` : ""}
  </div>

  <!-- SEO Tab -->
  ${seo ? `<div id="tab-seo" class="tab-content">${seoDetailsHtml}</div>` : ""}

  <!-- Performance Tab -->
  ${performance22 ? `<div id="tab-performance" class="tab-content">${perfDetailsHtml}</div>` : ""}

  <!-- Heatmap Tab -->
  ${heatmap ? `<div id="tab-heatmap" class="tab-content">
    <div class="grid md:grid-cols-3 gap-4">
      <div class="md:col-span-2 card p-5">
        <div class="mb-3">
          <h3 class="text-sm font-semibold">AI Predicted Attention Heatmap</h3>
          <p class="text-xs text-[#6e6e73]">Where users are most likely to look</p>
        </div>
        <div class="relative inline-block w-full">
          <img src="${screenshotUrl}" alt="Screenshot with heatmap" class="w-full rounded-lg border border-white/[0.06]" loading="lazy">
          <div id="heatmap-overlay" class="absolute inset-0 pointer-events-none rounded-lg overflow-hidden">
            ${heatmapDotsHtml}
          </div>
        </div>
        <div class="mt-3 p-2.5 bg-white/[0.03] rounded-lg flex items-center justify-between flex-wrap gap-2">
          <span class="text-xs text-[#a1a1a6] font-medium">ATTENTION:</span>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-1"><div class="w-3 h-3 rounded-full" style="background:radial-gradient(circle,rgba(239,68,68,0.5),transparent)"></div><span class="text-xs text-[#d1d1d6]">High</span></div>
            <div class="flex items-center gap-1"><div class="w-3 h-3 rounded-full" style="background:radial-gradient(circle,rgba(249,115,22,0.4),transparent)"></div><span class="text-xs text-[#d1d1d6]">Medium</span></div>
            <div class="flex items-center gap-1"><div class="w-3 h-3 rounded-full" style="background:radial-gradient(circle,rgba(234,179,8,0.3),transparent)"></div><span class="text-xs text-[#d1d1d6]">Low</span></div>
          </div>
        </div>
      </div>
      ${heatmapSidebarHtml}
    </div>
  </div>` : ""}

  <!-- Accessibility Tab -->
  ${a11y ? `<div id="tab-accessibility" class="tab-content">${a11yDetailsHtml}</div>` : ""}

  <!-- Full Report Tab -->
  ${roast.roast_response ? (() => {
        const verdictMatch = roast.roast_response.match(/## Overall Score:.*?\n\n([\s\S]*?)(?=\n---)/);
        const verdictText = verdictMatch ? verdictMatch[1].trim() : "";
        const scoreLabel = score >= 8 ? "Actually Pretty Good" : score >= 6 ? "Needs Work" : score >= 4 ? "Concerning" : score >= 2 ? "Needs CPR" : "Dead on Arrival";
        return `<div id="tab-report" class="tab-content">
    <!-- Report Header -->
    <div class="card p-6 mb-4">
      <div class="flex items-center gap-4 mb-4">
        <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-white/[0.05]">
          <span class="text-sm">\u{1F525}</span>
        </div>
        <div>
          <h2 class="text-[15px] font-semibold text-white">Landing Page Roast</h2>
          <p class="text-xs text-[#a1a1a6]">${escapeHtml(hostname)} &middot; ${dateStr}</p>
        </div>
      </div>
      <div class="p-4 bg-white/[0.03] rounded-xl">
        <div class="flex items-center gap-4 mb-3">
          <div class="score-ring" style="width:80px;height:80px;border-width:5px;border-color:${scoreColor};flex-shrink:0;">
            <span class="text-xl font-bold" style="color:${scoreColor}">${score}</span>
            <span class="text-xs text-[#a1a1a6]">/10</span>
          </div>
          <div>
            <div class="text-sm font-semibold" style="color:${scoreColor}">${emoji} ${scoreLabel}</div>
            ${verdictText ? `<p class="text-xs text-[#a1a1a6] mt-1 leading-relaxed">${escapeHtml(verdictText)}</p>` : ""}
          </div>
        </div>
      </div>
    </div>

    <!-- Detailed Breakdown -->
    <div class="card p-6 mb-4">
      <div class="flex items-center gap-3 mb-5">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:rgba(139,92,246,0.2)">
          <span class="text-xl">\u{1F4CA}</span>
        </div>
        <div>
          <h3 class="text-sm font-semibold text-white">Detailed Breakdown</h3>
          <p class="text-xs text-[#6e6e73]">Tap any category for details and advice</p>
        </div>
      </div>
      <div class="space-y-3">
        ${categories.map((c) => {
          const catScoreColor = c.score >= 8 ? "#22C55E" : c.score >= 6 ? "#EAB308" : "#EF4444";
          const sec = sections[c.key];
          return `<div class="expandable p-4 rounded-2xl bg-white/[0.02] border border-white/[0.04]" onclick="this.classList.toggle('open')">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/[0.05]">
                <span class="text-sm">${c.emoji}</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-1">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-semibold text-[#d1d1d6]">${c.label}</span>
                    <span class="expand-icon">&#9654;</span>
                  </div>
                  <span class="text-lg font-bold flex-shrink-0" style="color:${catScoreColor}">${c.score}/10</span>
                </div>
                <div class="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                  <div class="h-full rounded-full" style="width:${c.score * 10}%;background:${c.color}"></div>
                </div>
              </div>
            </div>
            <div class="expand-detail">
              <div class="mt-3 pt-3 space-y-2" style="border-top:1px solid ${c.color}20">
                <div class="p-2.5 bg-white/[0.03] rounded-lg">
                  <div class="text-xs text-[#6e6e73] mb-1">What this measures</div>
                  <p class="text-xs text-[#a1a1a6] leading-relaxed">${c.description}</p>
                </div>
                ${sec && sec.roast ? sec.isStrength ? `<div class="p-2.5 bg-green-500/5 rounded-lg">
                      <div class="text-xs text-[#6e6e73] mb-1">\u2705 Strength</div>
                      <div class="text-sm text-green-400/80">${escapeHtml(sec.roast)}</div>
                    </div>` : `<div class="p-2.5 bg-red-500/5 rounded-lg">
                      <div class="text-xs text-[#6e6e73] mb-1">\u{1F534} Problem</div>
                      <div class="text-sm text-[#d1d1d6]">${escapeHtml(sec.roast)}</div>
                    </div>` : ""}
                ${sec && sec.fix ? `<div class="p-2.5 bg-blue-500/5 rounded-lg">
                  <div class="text-xs text-[#6e6e73] mb-1">\u{1F4A1} Recommendation</div>
                  <div class="text-sm text-blue-400/80">${escapeHtml(sec.fix)}</div>
                </div>` : ""}
              </div>
            </div>
          </div>`;
        }).join("\n        ")}
      </div>
    </div>

    <!-- Quick Wins -->
    ${quickWins.length > 0 ? `<div class="card p-6 mb-4">
      <div class="flex items-center gap-3 mb-4">
        <div class="w-10 h-10 bg-yellow-500/20 rounded-xl flex items-center justify-center"><span class="text-xl">\u26A1</span></div>
        <div>
          <h3 class="text-sm font-semibold text-white">Quick Wins</h3>
          <p class="text-xs text-[#6e6e73]">Tap any item to learn why it matters</p>
        </div>
      </div>
      <div class="space-y-2">
        ${quickWins.map((w, i) => {
          const wl = w.toLowerCase();
          const tip = wl.includes("cta") || wl.includes("call-to-action") || wl.includes("button") ? "A clear, prominent CTA is the single biggest driver of conversions. Use contrasting colors, action verbs, and place it above the fold." : wl.includes("social proof") || wl.includes("testimonial") || wl.includes("review") || wl.includes("trust") ? "Social proof reduces buying anxiety. Even one testimonial or a row of client logos can increase conversion rates by 15-30%." : wl.includes("headline") || wl.includes("heading") || wl.includes("hero") ? "Your headline has about 5 seconds to hook visitors. Lead with the benefit, not the feature." : wl.includes("copy") || wl.includes("text") || wl.includes("clarity") || wl.includes("message") ? "Clear, scannable copy converts better than clever copy. Use short paragraphs and focus on what the reader gets." : wl.includes("image") || wl.includes("visual") || wl.includes("design") || wl.includes("color") ? "Visual hierarchy guides the eye to what matters. Use whitespace, contrast, and size to make your CTA impossible to miss." : wl.includes("speed") || wl.includes("load") || wl.includes("performance") || wl.includes("fast") ? "Every extra second of load time costs ~7% in conversions. Compress images, defer scripts, and use a CDN." : "Small improvements compound. Fixing the easiest issues first gives you the biggest return on effort.";
          return `<div class="expandable flex items-start gap-3 p-3 bg-white/[0.03] rounded-xl" onclick="this.classList.toggle('open')">
          <span class="flex-shrink-0 w-6 h-6 rounded-full bg-yellow-500/10 text-yellow-400 flex items-center justify-center text-xs font-bold mt-0.5">${i + 1}</span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="text-sm text-[#d1d1d6]">${escapeHtml(w)}</span>
              <span class="expand-icon flex-shrink-0">&#9654;</span>
            </div>
            <div class="expand-detail mt-2">
              <div class="p-2.5 bg-yellow-500/5 border border-yellow-500/10 rounded-lg">
                <div class="text-xs text-[#a1a1a6] mb-1">Why this matters</div>
                <p class="text-xs text-[#d1d1d6] leading-relaxed">${tip}</p>
              </div>
            </div>
          </div>
        </div>`;
        }).join("\n        ")}
      </div>
    </div>` : ""}

    <!-- Score Summary Grid -->
    <div class="grid grid-cols-5 gap-2 mb-4">
      ${categories.map((c) => {
          const catColor = c.score >= 8 ? "#22C55E" : c.score >= 6 ? "#EAB308" : "#EF4444";
          return `<div class="card p-3 text-center">
          <span class="text-lg">${c.emoji}</span>
          <div class="text-lg font-bold mt-1" style="color:${catColor}">${c.score}</div>
          <div class="text-xs text-[#6e6e73]">${c.label.split(" ")[0]}</div>
        </div>`;
        }).join("\n      ")}
    </div>

    <!-- Footer -->
    <div class="p-4 bg-white/[0.02] rounded-xl text-center">
      <p class="text-xs text-[#6e6e73]">Roasted with \u{1F525} by <a href="/" class="text-orange-500/70 hover:text-orange-400 transition-colors">Roast My Landing Page</a></p>
    </div>
  </div>`;
      })() : ""}

  <!-- Share CTA -->
  <div class="card p-6 mb-6 text-center mt-6">
    <h2 class="text-lg font-semibold mb-2">Share This Roast</h2>
    <p class="text-sm text-[#6e6e73] mb-4">Let the world see this score</p>
    <div class="flex flex-wrap gap-3 justify-center">
      <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(`${hostname} scored ${score}/10 on Roast My Landing Page! ${emoji}

Get your free AI analysis:`)}&url=${encodeURIComponent(pageUrl)}" target="_blank" rel="noopener" class="px-4 py-2 bg-[#1DA1F2]/10 hover:bg-[#1DA1F2]/20 border border-[#1DA1F2]/30 rounded-xl text-sm font-medium transition-colors">Post on X</a>
      <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}" target="_blank" rel="noopener" class="px-4 py-2 bg-[#0A66C2]/10 hover:bg-[#0A66C2]/20 border border-[#0A66C2]/30 rounded-xl text-sm font-medium transition-colors">LinkedIn</a>
      <button onclick="navigator.clipboard.writeText('${pageUrl}');this.textContent='Copied!';setTimeout(()=>this.textContent='Copy Link',2000)" class="px-4 py-2 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-xl text-sm font-medium transition-colors">Copy Link</button>
    </div>
  </div>

  <!-- Feedback Bar -->
  <div class="card p-4 flex items-center justify-between" id="ssr-feedback-bar">
    <span class="text-sm text-[#a1a1a6]">Was this roast helpful?</span>
    <div class="flex items-center gap-2">
      <button onclick="ssrFeedback('up')" id="ssr-fb-up" class="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-green-500/10 border border-white/[0.06] hover:border-green-500/20 transition-all text-[#a1a1a6] hover:text-green-400">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5"></path></svg>
        <span class="text-xs font-medium">Yes</span>
      </button>
      <button onclick="ssrFeedback('down')" id="ssr-fb-down" class="group flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.04] hover:bg-red-500/10 border border-white/[0.06] hover:border-red-500/20 transition-all text-[#a1a1a6] hover:text-red-400">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3h4.018a2 2 0 01.485.06L17 4m-7 10v2a3.5 3.5 0 003.5 3.5h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-6h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5"></path></svg>
        <span class="text-xs font-medium">No</span>
      </button>
    </div>
  </div>

  <!-- Get Your Own Roast CTA -->
  <div class="card p-8 text-center">
    <h2 class="text-lg font-semibold mb-2">Want to roast your landing page?</h2>
    <p class="text-sm text-[#6e6e73] mb-5">Get your free AI conversion analysis in 30 seconds</p>
    <a href="/" class="inline-block px-8 py-3 bg-[#FF6B35] hover:bg-[#E8552D] text-white font-semibold rounded-xl transition-colors">Roast My Page</a>
  </div>

</main>

<!-- Footer -->
<footer class="border-t border-white/[0.06] py-8 text-center">
  <a href="/gallery" class="text-sm text-[#6e6e73] hover:text-[#d1d1d6] transition-colors">Browse All Roasts</a>
  <span class="text-[#6e6e73] mx-3">|</span>
  <a href="/" class="text-sm text-[#6e6e73] hover:text-[#d1d1d6] transition-colors">Get Your Roast</a>
</footer>

<!-- Tab switching -->
<script>
function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  const tab = document.getElementById('tab-' + name);
  if (tab) tab.classList.add('active');
  const btn = document.querySelector('.tab-btn[data-tab="' + name + '"]');
  if (btn) btn.classList.add('active');
}
function ssrFeedback(vote) {
  var bar = document.getElementById('ssr-feedback-bar');
  fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ vote: vote, context: 'ssr-roast', roastId: '${escapeHtml(roast.id)}', url: '${escapeHtml(roast.url)}' })
  }).then(function() {
    bar.innerHTML = '<span class="text-sm text-green-400">Thanks for your feedback!</span><a href="mailto:contentcreatordarsh@gmail.com" class="text-xs text-[#6e6e73] hover:text-[#FF6B35] transition-colors">Reach out: contentcreatordarsh@gmail.com</a>';
  }).catch(function() {
    bar.innerHTML = '<span class="text-sm text-[#a1a1a6]">Thanks!</span>';
  });
}
<\/script>

<!-- JSON-LD Structured Data -->
<script type="application/ld+json">
${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": `${hostname} Landing Page Analysis - Score ${score}/10`,
        "description": ogDesc,
        "image": ogImage,
        "datePublished": createdAt.toISOString(),
        "author": { "@type": "Person", "name": "Darsh Hegde", "url": "https://x.com/hegdedarsh" },
        "publisher": { "@type": "Organization", "name": "Roast My Landing Page", "url": "https://roastmypage.site" },
        "mainEntityOfPage": pageUrl
      })}
<\/script>

</body>
</html>`;
    return html;
}

export function renderGalleryPage(params) {
    const {
        roastsResult, total, page, totalPages, prevPageUrl, nextPageUrl, validIndustry, BASE_URL
    } = params;
    const galleryHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Roast Gallery - ${total} Landing Pages Analyzed | Roast My Landing Page</title>
<meta name="description" content="Browse ${total} landing page roasts. See real AI conversion scores, SEO audits, and design critiques from pages across the web.">
<meta name="robots" content="index, follow">

<meta property="og:type" content="website">
<meta property="og:title" content="Roast Gallery - ${total} Pages Analyzed">
<meta property="og:description" content="Browse real AI landing page roasts. See conversion scores, common mistakes, and what makes pages convert.">
<meta property="og:image" content="${BASE_URL}/og/default">
<meta property="og:url" content="${BASE_URL}/gallery">
<meta property="og:site_name" content="Roast My Landing Page">

<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@hegdedarsh">
<meta name="twitter:creator" content="@hegdedarsh">
<meta name="twitter:title" content="Roast Gallery - ${total} Pages Analyzed">
<meta name="twitter:description" content="Browse real AI landing page roasts with conversion scores.">
<meta name="twitter:image" content="${BASE_URL}/og/default">

<link rel="canonical" href="${BASE_URL}/gallery${page > 1 ? `?page=${page}` : ""}">
${page > 1 ? `<link rel="prev" href="${BASE_URL}/gallery${page > 2 ? `?page=${page - 1}` : ""}">` : ""}
${page < totalPages ? `<link rel="next" href="${BASE_URL}/gallery?page=${page + 1}">` : ""}

<script src="https://cdn.tailwindcss.com"><\/script>
<style>
  body { background: #000; color: #e5e7eb; font-family: system-ui, -apple-system, sans-serif; }
  .card { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; }
  .gallery-card { transition: all 0.3s ease; }
  .gallery-card:hover { transform: translateY(-4px); border-color: rgba(255,255,255,0.12); box-shadow: 0 20px 40px -12px rgba(0,0,0,0.5); }
</style>
</head>
<body class="min-h-screen">

<!-- Nav -->
<nav class="fixed top-0 w-full z-50 px-4 py-3">
  <div class="max-w-6xl mx-auto flex justify-between items-center bg-black/60 backdrop-blur-xl border border-white/[0.06] rounded-2xl px-5 py-3">
    <a href="/" class="flex items-center gap-2">
      <span class="text-xl">\u{1F525}</span>
      <span class="font-semibold text-white/90 text-sm">Roast My Landing Page</span>
    </a>
    <div class="flex items-center gap-1">
      <a href="/gallery" class="text-sm text-white/90 px-3 py-1.5 rounded-lg bg-white/[0.06]">Gallery</a>
      <a href="/" class="text-sm text-white/50 hover:text-white/90 px-3 py-1.5 rounded-lg hover:bg-white/[0.06] transition-colors">Roast Yours</a>
    </div>
  </div>
</nav>

<main class="max-w-6xl mx-auto px-4 pt-24 pb-16">

  <div class="text-center mb-10">
    <h1 class="text-3xl md:text-4xl font-bold mb-3">${industryMeta ? `${industryMeta.emoji} ${industryMeta.label} ` : ""}Roast Gallery</h1>
    <p class="text-[#a1a1a6]">${total} landing pages analyzed by AI. ${industryMeta ? `Showing ${industryMeta.label} pages only.` : "Browse scores, learn from others' mistakes."}</p>
  </div>

  <!-- Industry Filter -->
  <div class="flex flex-wrap gap-2 justify-center mb-8">
    <a href="/gallery" class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${!validIndustry ? "bg-[#FF6B35] text-white" : "bg-white/[0.04] text-[#a1a1a6] hover:bg-white/[0.08] hover:text-white"} border border-white/[0.06]">
      \u{1F310} All
    </a>
    ${INDUSTRY_KEYS.filter((k) => k !== "other").map((k) => {
        const ind = INDUSTRY_BENCHMARKS[k];
        const isActive = validIndustry === k;
        return `<a href="/gallery?industry=${k}" class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${isActive ? "bg-[#FF6B35] text-white" : "bg-white/[0.04] text-[#a1a1a6] hover:bg-white/[0.08] hover:text-white"} border border-white/[0.06]">
        ${ind.emoji} ${ind.label}
      </a>`;
      }).join("")}
  </div>

  <!-- Gallery Grid -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
    ${roasts.map((r) => {
        let rHostname = "unknown";
        try {
          rHostname = new URL(r.url).hostname.replace(/^www\./, "");
        } catch {
        }
        const rScore = r.overall_score;
        const rColor = rScore >= 8 ? "#22C55E" : rScore >= 6 ? "#EAB308" : rScore >= 4 ? "#F97316" : "#EF4444";
        const rEmoji = rScore >= 8 ? "\u{1F525}" : rScore >= 6 ? "\u{1F610}" : rScore >= 4 ? "\u{1F62C}" : "\u{1F480}";
        const rDate = /* @__PURE__ */ new Date(r.created_at + "Z");
        const rTimeAgo = getTimeAgoSSR(rDate);
        const rFlag = r.country && r.country !== "XX" ? getCountryFlag(r.country) : "";
        return `<a href="/roast/${r.id}" class="gallery-card card p-4 block hover:no-underline">
      <div class="aspect-video bg-black/40 rounded-xl overflow-hidden mb-3 border border-white/[0.04]">
        <img src="/api/screenshot/${r.id}" alt="${escapeHtml(rHostname)}" class="w-full h-full object-cover object-top" loading="lazy">
      </div>
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm font-medium text-[#d1d1d6] truncate flex-1 mr-3">${escapeHtml(rHostname)}</span>
        <span class="text-lg font-bold flex-shrink-0" style="color:${rColor}">${rScore}</span>
      </div>
      <div class="flex items-center gap-2 text-xs text-[#6e6e73]">
        <span>${rEmoji} ${rScore >= 8 ? "Excellent" : rScore >= 6 ? "Needs Work" : rScore >= 4 ? "Concerning" : "Needs Help"}</span>
        <span class="text-[#6e6e73]">\xB7</span>
        ${rFlag ? `<span>${rFlag}</span>` : ""}
        <span>${rTimeAgo}</span>
      </div>
      <div class="flex gap-1.5 mt-3">
        ${[
          { s: r.hero_score, c: "#8B5CF6" },
          { s: r.cta_score, c: "#F97316" },
          { s: r.trust_score, c: "#22C55E" },
          { s: r.copy_score, c: "#3B82F6" },
          { s: r.design_score, c: "#EC4899" }
        ].map((b) => `<div class="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><div class="h-full rounded-full" style="width:${b.s * 10}%;background:${b.c}"></div></div>`).join("")}
      </div>
    </a>`;
      }).join("\n    ")}
  </div>

  <!-- Pagination -->
  ${totalPages > 1 ? (() => {
        const baseUrl = validIndustry ? `/gallery?industry=${validIndustry}` : "/gallery";
        const prevUrl = page > 2 ? `${baseUrl}${validIndustry ? "&" : "?"}page=${page - 1}` : baseUrl;
        const nextUrl = `${baseUrl}${validIndustry ? "&" : "?"}page=${page + 1}`;
        return `<div class="flex justify-center items-center gap-2">
      ${page > 1 ? `<a href="${prevUrl}" class="px-4 py-2 bg-white/[0.03] border border-white/[0.06] rounded-xl text-sm hover:bg-white/[0.06] transition-colors">&larr; Previous</a>` : ""}
      <span class="text-sm text-[#6e6e73] px-4">Page ${page} of ${totalPages}</span>
      ${page < totalPages ? `<a href="${nextUrl}" class="px-4 py-2 bg-white/[0.03] border border-white/[0.06] rounded-xl text-sm hover:bg-white/[0.06] transition-colors">Next &rarr;</a>` : ""}
    </div>`;
      })() : ""}

  <!-- CTA -->
  <div class="card p-8 mt-10 text-center">
    <h2 class="text-lg font-semibold mb-2">Get your page roasted</h2>
    <p class="text-sm text-[#6e6e73] mb-5">Free AI conversion analysis in 30 seconds</p>
    <a href="/" class="inline-block px-8 py-3 bg-[#FF6B35] hover:bg-[#E8552D] text-white font-semibold rounded-xl transition-colors">Roast My Page</a>
  </div>

</main>

<footer class="border-t border-white/[0.06] py-8 text-center">
  <span class="text-sm text-[#6e6e73]">${total} pages roasted and counting</span>
</footer>

<!-- JSON-LD -->
<script type="application/ld+json">
${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "name": "Roast Gallery - Landing Page Analysis Collection",
        "description": `Browse ${total} AI landing page roasts with conversion scores.`,
        "url": `${BASE_URL}/gallery`,
        "numberOfItems": total
      })}
<\/script>

</body>
</html>`;
    return galleryHtml;
}

export { generateNotFoundPage };
