/**
 * #80 — Shareable competitor compare card (SVG → PNG via Browser Rendering).
 */
import { escapeHtml } from './utils.js';
import { renderSvgToPng } from './render.js';

export function getCategoryWinners(scores1 = {}, scores2 = {}) {
  const cats = ["hero", "cta", "trust", "copy", "design"];
  const winners = {};
  for (const cat of cats) {
    const s1 = Number(scores1[cat]) || 0;
    const s2 = Number(scores2[cat]) || 0;
    winners[cat] = s1 > s2 ? "page1" : s2 > s1 ? "page2" : "tie";
  }
  return winners;
}

export function pickShareHighlight(scores1 = {}, scores2 = {}, host1 = "Page 1", host2 = "Page 2") {
  const labels = {
    hero: "Hero",
    cta: "CTA",
    trust: "Trust",
    copy: "Copy",
    design: "Design"
  };
  let best = null;
  for (const cat of Object.keys(labels)) {
    const s1 = Number(scores1[cat]) || 0;
    const s2 = Number(scores2[cat]) || 0;
    const diff = Math.abs(s1 - s2);
    if (diff < 0.1) continue;
    if (!best || diff > best.diff) {
      best = {
        category: labels[cat],
        key: cat,
        diff,
        winnerHost: s1 > s2 ? host1 : host2,
        loserHost: s1 > s2 ? host2 : host1,
        winnerScore: Math.max(s1, s2),
        loserScore: Math.min(s1, s2)
      };
    }
  }
  return best;
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return String(url || "page").slice(0, 40);
  }
}

export function buildCompareCardSvg({
  url1,
  url2,
  score1,
  score2,
  scores1 = {},
  scores2 = {},
  winner = "tie"
}) {
  const h1 = escapeHtml(hostFromUrl(url1));
  const h2 = escapeHtml(hostFromUrl(url2));
  const s1 = Number(score1) || 0;
  const s2 = Number(score2) || 0;
  const c1 = s1 >= s2 ? "#34D399" : "#F87171";
  const c2 = s2 >= s1 ? "#34D399" : "#F87171";
  const headline = winner === "page1"
    ? `${h1} wins`
    : winner === "page2"
      ? `${h2} wins`
      : "It's a tie";
  const cats = [
    { key: "hero", label: "Hero", color: "#A78BFA" },
    { key: "cta", label: "CTA", color: "#FB923C" },
    { key: "trust", label: "Trust", color: "#34D399" },
    { key: "copy", label: "Copy", color: "#60A5FA" },
    { key: "design", label: "Design", color: "#F472B6" }
  ];
  const rows = cats.map((cat, i) => {
    const a = Number(scores1[cat.key]) || 0;
    const b = Number(scores2[cat.key]) || 0;
    const y = 330 + i * 42;
    const w1 = Math.max(4, (a / 10) * 180);
    const w2 = Math.max(4, (b / 10) * 180);
    const badge = a > b ? "🏆" : b > a ? "🏆" : "=";
    const badgeX = a > b ? 250 : b > a ? 950 : 600;
    return `
      <text x="80" y="${y}" font-family="system-ui,sans-serif" font-size="18" fill="#9CA3AF">${cat.label}</text>
      <rect x="200" y="${y - 14}" width="180" height="12" rx="6" fill="#2a2a2a"/>
      <rect x="200" y="${y - 14}" width="${w1}" height="12" rx="6" fill="${cat.color}"/>
      <text x="390" y="${y}" font-family="system-ui,sans-serif" font-size="16" fill="#E5E7EB" text-anchor="end">${a.toFixed(1)}</text>
      <text x="${badgeX}" y="${y}" font-family="system-ui,sans-serif" font-size="18" text-anchor="middle">${badge}</text>
      <text x="810" y="${y}" font-family="system-ui,sans-serif" font-size="16" fill="#E5E7EB">${b.toFixed(1)}</text>
      <rect x="820" y="${y - 14}" width="180" height="12" rx="6" fill="#2a2a2a"/>
      <rect x="${820 + (180 - w2)}" y="${y - 14}" width="${w2}" height="12" rx="6" fill="${cat.color}"/>
    `;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#0A0908"/>
        <stop offset="100%" style="stop-color:#1a1410"/>
      </linearGradient>
      <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" style="stop-color:#E85D04"/>
        <stop offset="100%" style="stop-color:#FF8C42"/>
      </linearGradient>
    </defs>
    <rect width="1200" height="630" fill="url(#bg)"/>
    <rect width="1200" height="8" fill="url(#accent)"/>
    <text x="80" y="70" font-family="system-ui,sans-serif" font-size="28" font-weight="700" fill="#F5F0E8">Roast My Landing Page</text>
    <text x="80" y="110" font-family="system-ui,sans-serif" font-size="22" fill="#E85D04">Competitor Compare</text>
    <text x="600" y="110" font-family="system-ui,sans-serif" font-size="34" font-weight="700" fill="#F5F0E8" text-anchor="middle">${escapeHtml(headline)}</text>

    <rect x="80" y="140" width="480" height="150" rx="20" fill="#141210" stroke="${winner === "page1" ? "#34D399" : "#2a2a2a"}" stroke-width="2"/>
    <rect x="640" y="140" width="480" height="150" rx="20" fill="#141210" stroke="${winner === "page2" ? "#34D399" : "#2a2a2a"}" stroke-width="2"/>
    <text x="320" y="185" font-family="system-ui,sans-serif" font-size="22" fill="#9CA3AF" text-anchor="middle">${h1.length > 28 ? h1.slice(0, 28) + "…" : h1}</text>
    <text x="320" y="255" font-family="system-ui,sans-serif" font-size="64" font-weight="700" fill="${c1}" text-anchor="middle">${s1.toFixed(1)}</text>
    <text x="880" y="185" font-family="system-ui,sans-serif" font-size="22" fill="#9CA3AF" text-anchor="middle">${h2.length > 28 ? h2.slice(0, 28) + "…" : h2}</text>
    <text x="880" y="255" font-family="system-ui,sans-serif" font-size="64" font-weight="700" fill="${c2}" text-anchor="middle">${s2.toFixed(1)}</text>
    <circle cx="600" cy="215" r="28" fill="#E85D04"/>
    <text x="600" y="223" font-family="system-ui,sans-serif" font-size="18" font-weight="700" fill="#fff" text-anchor="middle">VS</text>

    ${rows}

    <text x="600" y="600" font-family="system-ui,sans-serif" font-size="18" fill="#6B7280" text-anchor="middle">Compare yours at roastmypage.site/compare</text>
  </svg>`;
}

export async function renderCompareCardPng(env, payload) {
  const svg = buildCompareCardSvg(payload);
  try {
    const { png } = await renderSvgToPng(env, svg, `compare-${payload.id1 || "a"}-${payload.id2 || "b"}`);
    return { body: png, contentType: "image/png", cache: "public, max-age=86400" };
  } catch {
    return { body: svg, contentType: "image/svg+xml", cache: "public, max-age=3600" };
  }
}
