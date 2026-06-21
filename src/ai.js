import { CONFIG, INDUSTRY_BENCHMARKS, INDUSTRY_KEYS, RUBRIC_CRITERIA } from './config.js';
import { uint8ArrayToBase64, hashUrl, withTimeout } from './utils.js';

// Bundler shim: __name2 was injected by esbuild to name arrow functions.
// In the modular source it's a safe no-op passthrough.
const __name2 = (fn, _name) => fn;

function parseMarkdownResponse(text, isFullPage) {
  try {
    const extractScore = /* @__PURE__ */ __name2((pattern) => {
      const m = text.match(pattern);
      if (m) {
        const val = parseFloat(m[1]);
        return isNaN(val) ? 0 : Math.min(10, Math.max(0, val));
      }
      return 0;
    }, "extractScore");
    const overallScore = extractScore(/overall\s*(?:score)?[:\s]*(\d+(?:\.\d+)?)\s*(?:\/\s*10)?/i) || extractScore(/(\d+(?:\.\d+)?)\s*\/\s*10/i) || 0;
    const catScore = /* @__PURE__ */ __name2((cat) => {
      const patterns = [
        new RegExp(`${cat}[:\\s]+(?:\\*\\*)?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:\\/\\s*10)?`, "i"),
        new RegExp(`\\*\\*${cat}[:\\s]*\\*\\*\\s*(\\d+(?:\\.\\d+)?)`, "i"),
        new RegExp(`${cat}\\s*\\(?(\\d+(?:\\.\\d+)?)\\s*\\/\\s*10\\)?`, "i"),
        new RegExp(`${cat}[^\\d]{0,30}(\\d+(?:\\.\\d+)?)\\s*(?:\\/\\s*10)?`, "i")
      ];
      for (const p of patterns) {
        const m = text.match(p);
        if (m) {
          const val = parseFloat(m[1]);
          if (!isNaN(val) && val >= 1 && val <= 10) return val;
        }
      }
      return 0;
    }, "catScore");
    const heroScore = catScore("hero");
    const ctaScore = catScore("cta") || catScore("call.to.action");
    const trustScore = catScore("trust");
    const copyScore = catScore("copy");
    const designScore = catScore("design");
    const validCats = [heroScore, ctaScore, trustScore, copyScore, designScore].filter((s) => s > 0).length;
    if (overallScore === 0 && validCats < 3) return null;
    const finalOverall = overallScore || (validCats > 0 ? parseFloat(([heroScore, ctaScore, trustScore, copyScore, designScore].filter((s) => s > 0).reduce((a, b) => a + b, 0) / validCats).toFixed(1)) : 5);
    const extractSectionText = /* @__PURE__ */ __name2((cat) => {
      let roast = "Needs improvement";
      let fix = "Review and optimize this section";
      const catRegex = new RegExp(`\\b${cat}\\b`, "i");
      const lines = text.split("\n");
      let inSection = false;
      const sectionLines = [];
      for (const line of lines) {
        if (catRegex.test(line) && (line.includes("Score") || line.includes("score") || line.match(/\d+\s*\/\s*10/) || line.includes("**"))) {
          inSection = true;
          continue;
        }
        if (inSection) {
          if (line.match(/\*\*\s*(?:hero|cta|call|trust|copy|design)\s*[\s(]/i) && !catRegex.test(line)) break;
          if (line.match(/\*\*\s*(?:quick|overall|verdict|industry|accessibility)/i)) break;
          if (line.match(/^\s*\*\s*\*\*/) && sectionLines.length > 2) break;
          sectionLines.push(line);
        }
      }
      const sectionText = sectionLines.join("\n");
      const problemMatch = sectionText.match(/(?:main\s+)?(?:problem|issue|weakness|concern)[:\s]+(.+?)(?:\n|$)/i) || sectionText.match(/(?:roast|critique)[:\s]+(.+?)(?:\n|$)/i);
      if (problemMatch) {
        const cleaned = problemMatch[1].replace(/\*\*/g, "").replace(/^[\s+\-*]+/, "").trim();
        if (cleaned.length > 5) roast = cleaned;
      }
      const fixMatch = sectionText.match(/(?:suggested?\s+)?(?:fix|suggestion|improvement|recommendation)[:\s]+(.+?)(?:\n|$)/i) || sectionText.match(/(?:solution|action\s*item)[:\s]+(.+?)(?:\n|$)/i);
      if (fixMatch) {
        const cleaned = fixMatch[1].replace(/\*\*/g, "").replace(/^[\s+\-*]+/, "").trim();
        if (cleaned.length > 5) fix = cleaned;
      }
      if (roast === "Needs improvement" && sectionLines.length > 0) {
        const cleanLines = sectionLines.map((l) => l.replace(/^[\s*#+\-\t]+/, "").replace(/\*\*/g, "").trim()).filter((l) => l.length > 15 && !l.match(/^\d+\s*\/?\s*10/) && !l.match(/^score/i));
        if (cleanLines.length > 0) roast = cleanLines[0].substring(0, 200);
        if (cleanLines.length > 1 && fix === "Review and optimize this section") fix = cleanLines[1].substring(0, 200);
      }
      return { roast, fix };
    }, "extractSectionText");
    const heroText = extractSectionText("hero");
    const ctaText = extractSectionText("cta|call.to.action");
    const trustText = extractSectionText("trust");
    const copyText = extractSectionText("copy");
    const designText = extractSectionText("design");
    const knownIndustries = ["saas", "ecommerce", "e-commerce", "agency", "fintech", "health", "education", "media", "startup", "devtools", "marketplace", "nonprofit"];
    let industry = "other";
    const industrySection = text.match(/industry[:\s]*(?:\*\*)?(.{1,50})/i);
    if (industrySection) {
      const found = knownIndustries.find((ind) => industrySection[1].toLowerCase().includes(ind));
      if (found) industry = found === "e-commerce" ? "ecommerce" : found;
    }
    if (industry === "other") {
      const lowerText = text.toLowerCase();
      const found = knownIndustries.find((ind) => lowerText.includes(ind));
      if (found) industry = found === "e-commerce" ? "ecommerce" : found;
    }
    const verdictMatch = text.match(/verdict[:\s]*(?:\*\*)?(.+?)(?:\n|$)/i) || text.match(/overall[^]*?(?:["']|:\s*)([^"'\n]{10,100})/i);
    const verdict = verdictMatch ? verdictMatch[1].replace(/\*\*/g, "").trim() : `This page scores ${finalOverall}/10 overall and has room for improvement.`;
    const quickWins = [];
    const qwSection = text.match(/quick\s*wins?[:\s]*([^]*?)(?=\n\n\**(?:verdict|industry|accessibility|overall)|$)/i);
    if (qwSection) {
      const items = qwSection[1].match(/(?:^|\n)\s*[\d*•+\-]+\.?\s*(.+)/g);
      if (items) {
        for (const item of items.slice(0, 5)) {
          const clean = item.replace(/^[\s\d*•+.\-]+/, "").replace(/\*\*/g, "").trim();
          if (clean.length > 10) quickWins.push(clean);
        }
      }
    }
    if (quickWins.length === 0) {
      const fixLines = text.match(/(?:suggested?\s*)?fix[:\s]+(.+?)(?:\n|$)/gi);
      if (fixLines) {
        for (const line of fixLines.slice(0, 5)) {
          const clean = line.replace(/^.*?fix[:\s]+/i, "").replace(/\*\*/g, "").trim();
          if (clean.length > 10 && !clean.match(/^review and optimize/i)) quickWins.push(clean);
        }
      }
    }
    const buildSection = /* @__PURE__ */ __name2((score, texts) => ({
      score: score || 5,
      roast: texts.roast,
      fix: texts.fix,
      scoreBreakdown: []
      // Will be filled by ensureScoreBreakdowns
    }), "buildSection");
    return {
      industry,
      overallScore: finalOverall,
      scores: {
        hero: heroScore || 5,
        cta: ctaScore || 5,
        trust: trustScore || 5,
        copy: copyScore || 5,
        design: designScore || 5
      },
      verdict,
      sections: {
        hero: buildSection(heroScore, heroText),
        cta: buildSection(ctaScore, ctaText),
        trust: buildSection(trustScore, trustText),
        copy: buildSection(copyScore, copyText),
        design: buildSection(designScore, designText)
      },
      quickWins: quickWins.length > 0 ? quickWins : [
        "Improve your headline to clearly state the value proposition",
        "Make the primary CTA button more visible and action-oriented",
        "Add social proof like testimonials or trust badges"
      ],
      heatmap: {
        attention: [
          { x: 50, y: 10, intensity: 95 },
          { x: 50, y: 30, intensity: 80 },
          { x: 50, y: 50, intensity: 60 },
          { x: 25, y: 70, intensity: 40 },
          { x: 75, y: 70, intensity: 40 }
        ],
        clickPredictions: [
          { element: "Primary CTA", probability: 70 },
          { element: "Navigation", probability: 40 },
          { element: "Secondary link", probability: 25 }
        ],
        foldLine: isFullPage ? 25 : 65
      }
    };
  } catch (e) {
    console.error("parseMarkdownResponse failed:", e);
    return null;
  }
}
async function ensureLlamaLicenseAgreed(env22) {
  try {
    const agreed = await env22.CONFIG.get("llama_license_agreed");
    if (agreed === "true") return;
    await env22.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", { prompt: "agree", max_tokens: 1 });
    await env22.CONFIG.put("llama_license_agreed", "true", { expirationTtl: 86400 * 365 });
    console.log("Llama 3.2 Vision license agreement sent");
  } catch (e) {
    console.log("Llama license agreement check failed (may already be agreed):", e);
  }
}
async function analyzeWithVisionAndHeatmap(env22, screenshotBase64, url, isFullPage = false, attempt = 1) {
  try {
    await ensureLlamaLicenseAgreed(env22);
    const prompt = `Analyze this landing page screenshot as a conversion optimization expert. Rate each category 1-10 and CALIBRATE carefully using the full range:

- 9-10: Exceptional, best-in-class execution (rare).
- 7-8: Strong and effective; only minor improvements needed.
- 5-6: Average; functional but with clear weaknesses.
- 3-4: Weak; notable problems that hurt conversion.
- 1-2: Broken or essentially missing (reserve for genuinely severe cases only).

Be fair and consistent: a clean, functional, professional page should typically land in the 6-8 range. Do NOT give 1-2 unless the category is truly absent or broken, and do NOT cluster every score at 4-6 — differentiate based on what you actually see in the screenshot.

Categories: hero, cta, trust, copy, design
Industry options: saas, ecommerce, agency, fintech, health, education, media, startup, devtools, marketplace, nonprofit, other

For each category give: score, main problem, suggested fix.
Also provide: overall score, 3 quick wins, verdict sentence, industry classification.

Respond with your analysis.`;
    let response;
    const imageDataUri = `data:image/jpeg;base64,${screenshotBase64}`;
    response = await withTimeout(
      env22.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
        messages: [
          {
            role: "system",
            content: "You are a landing page conversion rate optimization expert. Analyze the screenshot and provide specific, actionable feedback."
          },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageDataUri } },
              { type: "text", text: prompt }
            ]
          }
        ],
        max_tokens: CONFIG.AI_MAX_TOKENS,
        temperature: 0.3
      }),
      CONFIG.AI_TIMEOUT_MS,
      "AI vision analysis"
    );
    const rawText = response.response || JSON.stringify(response);
    console.log(`AI response length: ${rawText.length}, first 300 chars: ${rawText.substring(0, 300)}`);
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    let parsed = null;
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        console.log("JSON parse failed, falling back to text extraction");
      }
    }
    if (!parsed) {
      parsed = parseMarkdownResponse(rawText, isFullPage);
      if (!parsed) {
        throw new Error("Could not parse AI response as JSON or structured text");
      }
      console.log(`Parsed from markdown: overallScore=${parsed.overallScore}, industry=${parsed.industry}`);
    }
    if (parsed) {
      const placeholders = /^(Win \d|Issue|Solution|One sentence|specific|your |<.*>$)/i;
      if (!parsed.quickWins || !Array.isArray(parsed.quickWins)) {
        parsed.quickWins = [
          "Add a clear, benefit-driven headline above the fold",
          "Make your primary CTA button larger and higher contrast",
          "Add customer testimonials or trust badges"
        ];
      } else {
        parsed.quickWins = parsed.quickWins.filter((w) => w && !placeholders.test(w.trim()));
        if (parsed.quickWins.length === 0) {
          parsed.quickWins = [
            "Add a clear, benefit-driven headline above the fold",
            "Make your primary CTA button larger and higher contrast",
            "Add customer testimonials or trust badges",
            "Reduce page load time by optimizing images",
            "Add urgency or scarcity to your CTA copy"
          ];
        }
      }
      if (parsed.verdict && placeholders.test(parsed.verdict.trim())) {
        parsed.verdict = "This page has room for improvement across several key areas.";
      }
      if (parsed.sections) {
        for (const key of Object.keys(parsed.sections)) {
          const s = parsed.sections[key];
          if (s.roast && placeholders.test(s.roast.trim())) s.roast = "Needs review and improvement";
          if (s.fix && placeholders.test(s.fix.trim())) s.fix = "Focus on clarity and user intent";
          if (s.scoreBreakdown && Array.isArray(s.scoreBreakdown)) {
            for (const item of s.scoreBreakdown) {
              if (item.reason && placeholders.test(item.reason.trim())) {
                item.reason = item.points >= 2 ? "Good" : item.points >= 1 ? "Needs improvement" : "Missing or poor";
              }
              item.points = Math.max(0, Math.min(2, item.points || 0));
              item.maxPoints = 2;
            }
          }
        }
        ensureScoreBreakdowns(parsed);
      }
      parsed.industry = resolveIndustry(parsed.industry);
      parsed.benchmarks = INDUSTRY_BENCHMARKS[parsed.industry] || INDUSTRY_BENCHMARKS.other;
      if (parsed.competitorInsight && placeholders.test(parsed.competitorInsight.trim())) {
        parsed.competitorInsight = "This page could benefit from studying top competitors in its space.";
      }
      if (parsed.detailedRoast && placeholders.test(parsed.detailedRoast.trim())) {
        parsed.detailedRoast = "The page needs improvements in visual hierarchy, copy clarity, and conversion optimization. Focus on making the value proposition immediately clear and the call-to-action impossible to miss.";
      }
      // Calibration: coerce + clamp each category score to a sane 1-10 range, then
      // derive the overall as the average of the five categories so the headline
      // number always matches the breakdown the user sees (no more 1.3-style outliers
      // that contradict the category bars).
      const SCORE_CATS = ["hero", "cta", "trust", "copy", "design"];
      if (parsed.scores && typeof parsed.scores === "object") {
        let sum = 0;
        let count = 0;
        for (const cat of SCORE_CATS) {
          let v = Number(parsed.scores[cat]);
          if (!Number.isFinite(v)) v = 5;
          v = Math.max(1, Math.min(10, v));
          v = Math.round(v * 2) / 2;
          parsed.scores[cat] = v;
          sum += v;
          count++;
        }
        if (count > 0) {
          parsed.overallScore = Math.round(sum / count * 10) / 10;
        }
      }
      if (!Number.isFinite(Number(parsed.overallScore))) {
        parsed.overallScore = 5;
      } else {
        parsed.overallScore = Math.max(1, Math.min(10, Math.round(Number(parsed.overallScore) * 10) / 10));
      }
      const heatmap = parsed.heatmap || {
        attention: [
          { x: 50, y: 10, intensity: 95 },
          { x: 50, y: 30, intensity: 80 },
          { x: 50, y: 50, intensity: 60 },
          { x: 25, y: 70, intensity: 40 },
          { x: 75, y: 70, intensity: 40 }
        ],
        clickPredictions: [
          { element: "Primary CTA", probability: 70 },
          { element: "Navigation", probability: 40 },
          { element: "Secondary link", probability: 25 }
        ],
        foldLine: 65
      };
      return { analysis: parsed, heatmap };
    }
    throw new Error("Could not extract analysis from AI response");
  } catch (error32) {
    const errMsg = error32 instanceof Error ? error32.message : String(error32);
    console.error(`AI analysis failed (attempt ${attempt}): ${errMsg}`, error32);
    return {
      analysis: { ...createFallbackAnalysis("", url), aiUnavailable: true },
      heatmap: {
        attention: [
          { x: 50, y: 15, intensity: 90 },
          { x: 50, y: 40, intensity: 70 },
          { x: 50, y: 65, intensity: 50 }
        ],
        clickPredictions: [
          { element: "Main CTA", probability: 65 },
          { element: "Navigation", probability: 35 }
        ],
        foldLine: 60
      }
    };
  }
}
function formatRoast(analysis, url, brandName) {
  const getEmoji = /* @__PURE__ */ __name2((score) => {
    if (score >= 8) return "\u{1F525}";
    if (score >= 6) return "\u{1F610}";
    if (score >= 4) return "\u{1F62C}";
    return "\u{1F480}";
  }, "getEmoji");
  const getVerdict = /* @__PURE__ */ __name2((score) => {
    if (score >= 8) return "Actually Pretty Good";
    if (score >= 6) return "Needs Work";
    if (score >= 4) return "Concerning";
    if (score >= 2) return "Needs CPR";
    return "Dead on Arrival";
  }, "getVerdict");
  const brand = brandName || "Roast My Landing Page";
  return `# \u{1F525} Landing Page Roast

**URL:** ${url}

---

## Overall Score: ${analysis.overallScore}/10 \u2014 "${getVerdict(analysis.overallScore)}"

${analysis.verdict}

---

## Breakdown

### ${getEmoji(analysis.sections.hero.score)} Hero Section (${analysis.sections.hero.score}/10)
**Problem:** ${analysis.sections.hero.roast}
**Fix:** ${analysis.sections.hero.fix}

### ${getEmoji(analysis.sections.cta.score)} Call-to-Action (${analysis.sections.cta.score}/10)
**Problem:** ${analysis.sections.cta.roast}
**Fix:** ${analysis.sections.cta.fix}

### ${getEmoji(analysis.sections.trust.score)} Trust Signals (${analysis.sections.trust.score}/10)
**Problem:** ${analysis.sections.trust.roast}
**Fix:** ${analysis.sections.trust.fix}

### ${getEmoji(analysis.sections.copy.score)} Copy Quality (${analysis.sections.copy.score}/10)
**Problem:** ${analysis.sections.copy.roast}
**Fix:** ${analysis.sections.copy.fix}

### ${getEmoji(analysis.sections.design.score)} Design (${analysis.sections.design.score}/10)
**Problem:** ${analysis.sections.design.roast}
**Fix:** ${analysis.sections.design.fix}

---

## \u26A1 Quick Wins (Do These Today)

${(analysis.quickWins || ["Clarify your headline", "Improve CTA visibility", "Add trust signals"]).map((win, i) => `${i + 1}. ${win}`).join("\n")}

---

*Roasted with \u{1F525} by [${brand}]*
`;
}

function generateBreakdownFromScore(categoryKey, score) {
  const criteria = RUBRIC_CRITERIA[categoryKey] || RUBRIC_CRITERIA.hero;
  const totalPoints = Math.round(Math.max(0, Math.min(10, score)));
  let remaining = totalPoints;
  return criteria.map((criterion, i) => {
    let pts;
    if (i < criteria.length - 1) {
      pts = Math.min(2, remaining);
      remaining = Math.max(0, remaining - pts);
    } else {
      pts = Math.min(2, remaining);
    }
    const reason = pts >= 2 ? "Meets expectations" : pts >= 1 ? "Room for improvement" : "Needs significant work";
    return { criterion, points: pts, maxPoints: 2, reason };
  });
}
function ensureScoreBreakdowns(parsed) {
  if (!parsed.sections) return;
  for (const key of Object.keys(parsed.sections)) {
    const s = parsed.sections[key];
    if (!s.scoreBreakdown || !Array.isArray(s.scoreBreakdown) || s.scoreBreakdown.length === 0) {
      s.scoreBreakdown = generateBreakdownFromScore(key, s.score || parsed.scores?.[key] || 5);
    }
  }
}

function resolveIndustry(aiIndustry) {
  if (!aiIndustry) return "other";
  const key = aiIndustry.toLowerCase().trim().replace(/[^a-z]/g, "");
  if (INDUSTRY_BENCHMARKS[key]) return key;
  if (key.includes("saas") || key.includes("software")) return "saas";
  if (key.includes("ecommerce") || key.includes("shop") || key.includes("store") || key.includes("retail")) return "ecommerce";
  if (key.includes("agency") || key.includes("consult") || key.includes("service")) return "agency";
  if (key.includes("fintech") || key.includes("finance") || key.includes("bank") || key.includes("payment")) return "fintech";
  if (key.includes("health") || key.includes("medical") || key.includes("wellness") || key.includes("fitness")) return "health";
  if (key.includes("edu") || key.includes("learn") || key.includes("course") || key.includes("school")) return "education";
  if (key.includes("media") || key.includes("news") || key.includes("blog") || key.includes("publish")) return "media";
  if (key.includes("startup") || key.includes("landing")) return "startup";
  if (key.includes("dev") || key.includes("tool") || key.includes("api") || key.includes("developer")) return "devtools";
  if (key.includes("market") || key.includes("platform")) return "marketplace";
  if (key.includes("nonprofit") || key.includes("charity") || key.includes("ngo")) return "nonprofit";
  return "other";
}
async function calculatePercentile(db, score, industry, category) {
  if (!CONFIG.ENABLE_PERCENTILE_RANKING) {
    return { percentile: 50, betterThan: 50, totalSamples: 0 };
  }
  try {
    const VALID_SCORE_COLUMNS = {
      overall: "overall_score",
      hero: "hero_score",
      cta: "cta_score",
      trust: "trust_score",
      copy: "copy_score",
      design: "design_score"
    };
    const column = VALID_SCORE_COLUMNS[category || "overall"] || "overall_score";
    const lowerOrEqual = await db.prepare(`
      SELECT COUNT(*) as count
      FROM roasts
      WHERE industry = ? AND ${column} IS NOT NULL AND ${column} <= ?
    `).bind(industry, score).first();
    const total = await db.prepare(`
      SELECT COUNT(*) as count
      FROM roasts
      WHERE industry = ? AND ${column} IS NOT NULL
    `).bind(industry).first();
    const countLower = lowerOrEqual?.count || 0;
    const countTotal = total?.count || 0;
    if (countTotal === 0) {
      return { percentile: 50, betterThan: 50, totalSamples: 0 };
    }
    const percentile = Math.round(countLower / countTotal * 100);
    const betterThan = Math.max(0, percentile - 1);
    return {
      percentile,
      betterThan,
      totalSamples: countTotal
    };
  } catch (error32) {
    console.error("Percentile calculation error:", error32);
    return { percentile: 50, betterThan: 50, totalSamples: 0 };
  }
}
function createFallbackAnalysis(rawText, url) {
  const hasPositive = /good|great|nice|clean|clear|professional|strong/i.test(rawText);
  const hasNegative = /bad|poor|missing|lack|weak|confusing|unclear/i.test(rawText);
  const baseScore = hasPositive && !hasNegative ? 6 : hasNegative ? 4 : 5;
  const fallback = {
    overallScore: baseScore,
    verdict: rawText.slice(0, 150) || "Analysis complete",
    scores: { hero: baseScore, cta: baseScore, trust: baseScore, copy: baseScore, design: baseScore },
    sections: {
      hero: { score: baseScore, roast: "Review needed", fix: "Ensure clear value proposition", scoreBreakdown: generateBreakdownFromScore("hero", baseScore) },
      cta: { score: baseScore, roast: "Review needed", fix: "Make CTA prominent", scoreBreakdown: generateBreakdownFromScore("cta", baseScore) },
      trust: { score: baseScore, roast: "Review needed", fix: "Add social proof", scoreBreakdown: generateBreakdownFromScore("trust", baseScore) },
      copy: { score: baseScore, roast: "Review needed", fix: "Focus on benefits", scoreBreakdown: generateBreakdownFromScore("copy", baseScore) },
      design: { score: baseScore, roast: "Review needed", fix: "Improve visual hierarchy", scoreBreakdown: generateBreakdownFromScore("design", baseScore) }
    },
    quickWins: ["Clarify your headline", "Add testimonials or logos", "Make CTA button stand out"],
    industry: "other",
    benchmarks: INDUSTRY_BENCHMARKS.other
  };
  return fallback;
}

export { parseMarkdownResponse, ensureLlamaLicenseAgreed, analyzeWithVisionAndHeatmap, formatRoast, generateBreakdownFromScore, ensureScoreBreakdowns, resolveIndustry, calculatePercentile, createFallbackAnalysis };
