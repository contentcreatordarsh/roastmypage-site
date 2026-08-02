import { fetchWithTimeout } from './utils.js';

const VISUAL_SIMILARITY_LABEL = "Metadata token-overlap heuristic (not ML vision)";
const VISUAL_SIMILARITY_TIMEOUT_MS = 1200;
const VISUAL_SIMILARITY_MAX_DOMAINS = 12;
const VISUAL_SIMILARITY_HIGH_SCORE = 70;
const VISUAL_SIMILARITY_MEDIUM_SCORE = 30;
const METADATA_EXCERPT_LENGTH = 180;
const TOKEN_STOP_WORDS = new Set([
  "www", "com", "net", "org", "io", "co", "app", "dev", "xyz", "info", "biz", "us", "me",
  "the", "and", "for", "with", "from", "your", "you", "our", "official", "home", "page",
  "login", "sign", "signin", "account", "secure", "support", "help", "online", "site"
]);

function decodeHtmlEntities(value) {
  if (!value) return "";
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => {
      const value2 = Number(code);
      return Number.isFinite(value2) ? String.fromCodePoint(value2) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function normalizeMetadataText(value, maxLength = METADATA_EXCERPT_LENGTH) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function tokenizeSimilarityText(value) {
  const normalized = decodeHtmlEntities(String(value || ""))
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[0@]/g, "o")
    .replace(/[1!|]/g, "l")
    .replace(/[3]/g, "e")
    .replace(/[4]/g, "a")
    .replace(/[5$]/g, "s")
    .replace(/[7+]/g, "t");
  return normalized
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !TOKEN_STOP_WORDS.has(token));
}

function buildBrandTokens(brandName, targetDomain) {
  const tokens = new Set();
  const domainName = String(targetDomain || "").split(".")[0] || "";
  for (const source of [brandName, domainName]) {
    const sourceTokens = tokenizeSimilarityText(source);
    for (const token of sourceTokens) tokens.add(token);
    const compact = sourceTokens.join("");
    if (compact.length >= 3) tokens.add(compact);
  }
  return tokens;
}

function scoreMetadataSimilarity(metadata = {}, brandName = "", targetDomain = "") {
  const brandTokens = buildBrandTokens(brandName, targetDomain);
  const haystack = [
    metadata.title,
    metadata.ogTitle,
    metadata.description,
    metadata.ogDescription,
    metadata.twitterTitle,
    metadata.twitterDescription
  ].filter(Boolean).join(" ");
  const metadataTokens = new Set(tokenizeSimilarityText(haystack));
  const normalizedHaystack = tokenizeSimilarityText(haystack).join("");
  const matchedTokens = [...brandTokens].filter((token) => metadataTokens.has(token) || normalizedHaystack.includes(token));
  const overlapScore = brandTokens.size > 0 ? Math.round((matchedTokens.length / brandTokens.size) * 100) : 0;
  const score = Math.max(0, Math.min(100, overlapScore));
  const risk = score >= VISUAL_SIMILARITY_HIGH_SCORE ? "high" : score >= VISUAL_SIMILARITY_MEDIUM_SCORE ? "medium" : "low";
  return {
    label: VISUAL_SIMILARITY_LABEL,
    score,
    risk,
    highSimilarity: risk === "high",
    matchedTokens,
    explanation: score > 0
      ? `Matched ${matchedTokens.length} of ${brandTokens.size} brand/domain token(s) in fetched title or metadata.`
      : "No brand/domain token overlap found in fetched title or metadata."
  };
}

function parseMetaAttributes(attributeText) {
  const attrs = {};
  const attrPattern = /([a-zA-Z_:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match;
  while ((match = attrPattern.exec(attributeText))) {
    attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[2] || match[3] || match[4] || "");
  }
  return attrs;
}

function extractMetadataFromHtml(html) {
  const metadata = {};
  const titleMatch = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    metadata.title = normalizeMetadataText(titleMatch[1]);
  }
  const metaPattern = /<meta\s+([^>]*?)>/gi;
  let match;
  while ((match = metaPattern.exec(String(html || "")))) {
    const attrs = parseMetaAttributes(match[1]);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    const content = normalizeMetadataText(attrs.content);
    if (!key || !content) continue;
    if (key === "description") metadata.description = metadata.description || content;
    if (key === "og:title") metadata.ogTitle = metadata.ogTitle || content;
    if (key === "og:description") metadata.ogDescription = metadata.ogDescription || content;
    if (key === "twitter:title") metadata.twitterTitle = metadata.twitterTitle || content;
    if (key === "twitter:description") metadata.twitterDescription = metadata.twitterDescription || content;
  }
  return metadata;
}

function generateTyposquats(domain22) {
  const variations = /* @__PURE__ */ new Set();
  const parts = domain22.split(".");
  const name = parts[0];
  const tld = parts.slice(1).join(".");
  const tlds = ["com", "net", "org", "io", "co", "app", "dev", "xyz", "info", "biz", "us", "me"];
  for (let i = 0; i < name.length; i++) {
    const variant = name.slice(0, i) + name.slice(i + 1);
    if (variant.length > 1) variations.add(`${variant}.${tld}`);
  }
  for (let i = 0; i < name.length; i++) {
    const variant = name.slice(0, i + 1) + name[i] + name.slice(i + 1);
    variations.add(`${variant}.${tld}`);
  }
  for (let i = 0; i < name.length - 1; i++) {
    const arr = name.split("");
    [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    variations.add(`${arr.join("")}.${tld}`);
  }
  const substitutions = {
    "a": ["4", "@", "e"],
    "e": ["3", "a"],
    "i": ["1", "l", "!"],
    "l": ["1", "i", "|"],
    "o": ["0", "q"],
    "s": ["5", "$", "z"],
    "t": ["7", "+"],
    "g": ["9", "q"],
    "b": ["8", "d"],
    "z": ["2", "s"]
  };
  for (let i = 0; i < name.length; i++) {
    const char = name[i].toLowerCase();
    if (substitutions[char]) {
      for (const sub of substitutions[char]) {
        const variant = name.slice(0, i) + sub + name.slice(i + 1);
        variations.add(`${variant}.${tld}`);
      }
    }
  }
  const homoglyphs = {
    "a": ["\u0430", "\u0251"],
    // Cyrillic а
    "c": ["\u0441", "\xE7"],
    "e": ["\u0435", "\u0451"],
    "o": ["\u043E", "\u03BF"],
    "p": ["\u0440", "\u03C1"],
    "x": ["\u0445", "\u0436"],
    "y": ["\u0443", "\xFD"]
  };
  for (let i = 0; i < name.length; i++) {
    const char = name[i].toLowerCase();
    if (homoglyphs[char]) {
      for (const glyph of homoglyphs[char]) {
        const variant = name.slice(0, i) + glyph + name.slice(i + 1);
        variations.add(`${variant}.${tld}`);
      }
    }
  }
  const prefixes = ["www", "ww", "wwww", "login", "secure", "my", "account", "app", "get", "go"];
  const suffixes = ["login", "secure", "app", "online", "official", "support", "help", "verify", "account", "signin"];
  for (const prefix of prefixes) {
    variations.add(`${prefix}${name}.${tld}`);
    variations.add(`${prefix}-${name}.${tld}`);
  }
  for (const suffix of suffixes) {
    variations.add(`${name}${suffix}.${tld}`);
    variations.add(`${name}-${suffix}.${tld}`);
  }
  for (const altTld of tlds) {
    if (altTld !== tld) {
      variations.add(`${name}.${altTld}`);
    }
  }
  for (let i = 1; i < name.length; i++) {
    variations.add(`${name.slice(0, i)}-${name.slice(i)}.${tld}`);
  }
  if (name.includes("-")) {
    variations.add(`${name.replace(/-/g, "")}.${tld}`);
  }
  const doubleLetters = ["l", "s", "t", "n", "m", "r", "p", "e", "o"];
  for (let i = 0; i < name.length; i++) {
    if (doubleLetters.includes(name[i].toLowerCase())) {
      const doubled = name.slice(0, i + 1) + name[i] + name.slice(i + 1);
      variations.add(`${doubled}.${tld}`);
      if (i > 0 && name[i] === name[i - 1]) {
        const singled = name.slice(0, i) + name.slice(i + 1);
        variations.add(`${singled}.${tld}`);
      }
    }
  }
  variations.delete(domain22);
  return Array.from(variations).slice(0, 200);
}
async function checkDomainRegistrations(domains) {
  const results = [];
  const batchSize = 20;
  for (let i = 0; i < Math.min(domains.length, 100); i += batchSize) {
    const batch = domains.slice(i, i + batchSize);
    const checks = await Promise.all(
      batch.map(async (domain22) => {
        try {
          const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${domain22}&type=A`, {
            headers: { "Accept": "application/dns-json" }
          });
          const data = await response.json();
          const registered = data.Status === 0 && data.Answer && data.Answer.length > 0;
          let risk = "low";
          let type = "typosquat";
          if (registered) {
            if (domain22.includes("login") || domain22.includes("secure") || domain22.includes("account") || domain22.includes("verify") || domain22.includes("signin") || domain22.includes("password")) {
              risk = "high";
              type = "potential-phishing";
            } else if (domain22.includes("support") || domain22.includes("help") || domain22.includes("official")) {
              risk = "medium";
              type = "impersonation";
            } else {
              risk = "medium";
              type = "lookalike";
            }
          }
          return { domain: domain22, registered, risk, type };
        } catch {
          return { domain: domain22, registered: false, risk: "low", type: "unknown" };
        }
      })
    );
    results.push(...checks);
  }
  return results.sort((a, b) => {
    if (a.registered !== b.registered) return a.registered ? -1 : 1;
    const riskOrder = { high: 0, medium: 1, low: 2 };
    return riskOrder[a.risk] - riskOrder[b.risk];
  });
}

async function fetchLookalikeMetadata(domain22, timeoutMs = VISUAL_SIMILARITY_TIMEOUT_MS) {
  const schemes = ["https", "http"];
  let lastError = "Fetch failed";
  for (const scheme of schemes) {
    try {
      const response = await fetchWithTimeout(`${scheme}://${domain22}`, {
        timeout: timeoutMs,
        redirect: "follow",
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "Range": "bytes=0-65535",
          "User-Agent": "Mozilla/5.0 (compatible; BrandMonitor/1.0)"
        }
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const html = (await response.text()).slice(0, 8e4);
      return {
        status: "fetched",
        url: response.url || `${scheme}://${domain22}`,
        metadata: extractMetadataFromHtml(html)
      };
    } catch (error32) {
      lastError = error32 instanceof Error ? error32.message : "Fetch failed";
    }
  }
  return {
    status: "unavailable",
    error: lastError,
    metadata: {}
  };
}

async function analyzeLookalikeVisualSimilarity(domainChecks, brandName, targetDomain, options = {}) {
  const maxDomains = options.maxDomains ?? VISUAL_SIMILARITY_MAX_DOMAINS;
  const timeoutMs = options.timeoutMs ?? VISUAL_SIMILARITY_TIMEOUT_MS;
  const registeredDomains = domainChecks.filter((domainCheck) => domainCheck.registered).slice(0, maxDomains);
  const analyses = await Promise.all(
    registeredDomains.map(async (domainCheck) => {
      const fetched = await fetchLookalikeMetadata(domainCheck.domain, timeoutMs);
      const similarity = scoreMetadataSimilarity(fetched.metadata, brandName, targetDomain);
      return [
        domainCheck.domain,
        {
          ...similarity,
          status: fetched.status,
          url: fetched.url,
          metadata: fetched.metadata,
          error: fetched.error
        }
      ];
    })
  );
  const similarityByDomain = new Map(analyses);
  const enrichedChecks = domainChecks.map((domainCheck) => {
    const visualSimilarity = similarityByDomain.get(domainCheck.domain);
    if (!visualSimilarity) return domainCheck;
    const risk = visualSimilarity.highSimilarity && domainCheck.risk !== "high" ? "high" : domainCheck.risk;
    return { ...domainCheck, risk, visualSimilarity };
  });
  const highSimilarityDomains = enrichedChecks.filter((domainCheck) => domainCheck.visualSimilarity?.highSimilarity);
  return {
    domains: enrichedChecks,
    summary: {
      label: VISUAL_SIMILARITY_LABEL,
      scanned: registeredDomains.length,
      highSimilarity: highSimilarityDomains.length,
      domains: highSimilarityDomains.map((domainCheck) => ({
        domain: domainCheck.domain,
        score: domainCheck.visualSimilarity.score,
        matchedTokens: domainCheck.visualSimilarity.matchedTokens
      }))
    }
  };
}

async function checkSecurityHeaders(targetUrl) {
  const headers = [];
  const issues = [];
  let score = 100;
  try {
    const response = await fetch(targetUrl, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SecurityScanner/1.0)" }
    });
    const securityHeaders = [
      { name: "Strict-Transport-Security", importance: "critical", penalty: 15 },
      { name: "Content-Security-Policy", importance: "high", penalty: 10 },
      { name: "X-Frame-Options", importance: "high", penalty: 10 },
      { name: "X-Content-Type-Options", importance: "medium", penalty: 5 },
      { name: "X-XSS-Protection", importance: "low", penalty: 3 },
      { name: "Referrer-Policy", importance: "medium", penalty: 5 },
      { name: "Permissions-Policy", importance: "medium", penalty: 5 }
    ];
    for (const header of securityHeaders) {
      const value = response.headers.get(header.name);
      const present = !!value;
      headers.push({
        name: header.name,
        present,
        value: value || void 0,
        importance: header.importance
      });
      if (!present) {
        score -= header.penalty;
        if (header.importance === "critical") {
          issues.push(`Missing ${header.name} - Critical security header`);
        } else if (header.importance === "high") {
          issues.push(`Missing ${header.name} - Recommended security header`);
        }
      }
    }
    const isHttps = targetUrl.startsWith("https://") || response.url.startsWith("https://");
    if (!isHttps) {
      score -= 20;
      issues.push("Site not using HTTPS - Major security risk");
    }
    const csp = response.headers.get("Content-Security-Policy");
    if (csp && csp.includes("upgrade-insecure-requests")) {
    }
  } catch (error32) {
    score = 50;
    issues.push("Could not fetch security headers - site may be blocking requests");
  }
  score = Math.max(0, Math.min(100, score));
  let grade;
  if (score >= 90) grade = "A";
  else if (score >= 80) grade = "B";
  else if (score >= 70) grade = "C";
  else if (score >= 60) grade = "D";
  else grade = "F";
  return { score, grade, headers, issues };
}
async function scanSocialMediaImposters(brandName, domain22) {
  const imposters = [];
  const suspiciousHandles = generateSuspiciousHandles(brandName);
  for (const handle of suspiciousHandles.slice(0, 15)) {
    try {
      const response = await fetch(`https://twitter.com/${handle}`, {
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BrandMonitor/1.0)" }
      });
      if (response.ok || response.status === 200) {
        const risk = determineHandleRisk(handle, brandName);
        if (risk !== "low") {
          imposters.push({
            platform: "Twitter/X",
            handle: `@${handle}`,
            displayName: handle,
            risk,
            reason: getImposterReason(handle, brandName),
            url: `https://twitter.com/${handle}`
          });
        }
      }
    } catch {
    }
  }
  for (const handle of suspiciousHandles.slice(0, 10)) {
    try {
      const response = await fetch(`https://www.instagram.com/${handle}/`, {
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BrandMonitor/1.0)" }
      });
      if (response.ok) {
        const risk = determineHandleRisk(handle, brandName);
        if (risk !== "low") {
          imposters.push({
            platform: "Instagram",
            handle: `@${handle}`,
            displayName: handle,
            risk,
            reason: getImposterReason(handle, brandName),
            url: `https://instagram.com/${handle}`
          });
        }
      }
    } catch {
    }
  }
  return imposters.sort((a, b) => {
    const riskOrder = { high: 0, medium: 1, low: 2 };
    return riskOrder[a.risk] - riskOrder[b.risk];
  });
}
function generateSuspiciousHandles(brandName) {
  const handles = /* @__PURE__ */ new Set();
  const name = brandName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const supportSuffixes = ["support", "help", "helpdesk", "care", "service", "assist", "official"];
  for (const suffix of supportSuffixes) {
    handles.add(`${name}${suffix}`);
    handles.add(`${name}_${suffix}`);
    handles.add(`${suffix}${name}`);
    handles.add(`${name}${suffix}1`);
    handles.add(`${name}${suffix}24`);
  }
  const officialVariations = ["official", "real", "the", "get", "try", "use"];
  for (const prefix of officialVariations) {
    handles.add(`${prefix}${name}`);
    handles.add(`${prefix}_${name}`);
    handles.add(`${name}_${prefix}`);
  }
  for (let i = 1; i <= 3; i++) {
    handles.add(`${name}${i}`);
    handles.add(`${name}_${i}`);
  }
  handles.add(`${name}_`);
  handles.add(`_${name}`);
  handles.add(`${name}__`);
  if (name.length > 3) {
    for (let i = 0; i < name.length; i++) {
      handles.add(name.slice(0, i) + name.slice(i + 1));
    }
    for (let i = 0; i < name.length; i++) {
      handles.add(name.slice(0, i + 1) + name[i] + name.slice(i + 1));
    }
  }
  handles.add(`${name}hq`);
  handles.add(`${name}inc`);
  handles.add(`${name}app`);
  handles.add(`${name}io`);
  return Array.from(handles).slice(0, 30);
}
function determineHandleRisk(handle, brandName) {
  const h = handle.toLowerCase();
  const b = brandName.toLowerCase();
  if (h.includes("support") || h.includes("help") || h.includes("care") || h.includes("service") || h.includes("assist") || h.includes("verify")) {
    return "high";
  }
  if (h.includes("official") || h.includes("real") || h.includes("team") || h.includes("hq") || h.includes("inc")) {
    return "medium";
  }
  if (h === b || h === `${b}_` || h === `_${b}` || h === `the${b}`) {
    return "medium";
  }
  return "low";
}
function getImposterReason(handle, brandName) {
  const h = handle.toLowerCase();
  if (h.includes("support") || h.includes("help") || h.includes("care")) {
    return "Appears to be fake customer support - commonly used for scams";
  }
  if (h.includes("official") || h.includes("real")) {
    return "Claims to be official account - may confuse customers";
  }
  if (h.includes("verify") || h.includes("secure")) {
    return "Security-related name - high phishing risk";
  }
  return "Similar to your brand name - could cause confusion";
}
function generateThreatRecommendations(domainChecks, securityGrade, riskLevel, socialImposters, visualSimilaritySummary) {
  const recommendations = [];
  const highRiskDomains = domainChecks.filter((d) => d.registered && d.risk === "high");
  const mediumRiskDomains = domainChecks.filter((d) => d.registered && d.risk === "medium");
  if (highRiskDomains.length > 0) {
    recommendations.push(`URGENT: ${highRiskDomains.length} potentially malicious lookalike domain(s) detected. Consider taking legal action or contacting registrars.`);
  }
  if (mediumRiskDomains.length > 0) {
    recommendations.push(`Found ${mediumRiskDomains.length} registered lookalike domain(s). Consider purchasing key variations to protect your brand.`);
  }
  if (visualSimilaritySummary?.highSimilarity > 0) {
    recommendations.push(`HEURISTIC: ${visualSimilaritySummary.highSimilarity} registered lookalike domain(s) reused brand/domain terms in page title or metadata. Review these potential visual-similarity impersonation signals manually.`);
  }
  if (socialImposters && socialImposters.length > 0) {
    const highRiskImposters = socialImposters.filter((i) => i.risk === "high");
    if (highRiskImposters.length > 0) {
      recommendations.push(`ALERT: ${highRiskImposters.length} suspicious social media account(s) found that may be impersonating your brand's support/official channels.`);
    }
    const totalImposters = socialImposters.filter((i) => i.risk !== "low").length;
    if (totalImposters > 0) {
      recommendations.push(`Report impostor accounts to the respective platforms. ${totalImposters} account(s) using variations of your brand name.`);
    }
  }
  if (securityGrade.score < 70) {
    recommendations.push(`Security grade is ${securityGrade.grade}. Implement missing security headers to improve protection.`);
  }
  for (const issue of securityGrade.issues.slice(0, 2)) {
    if (issue.includes("Critical") || issue.includes("HTTPS")) {
      recommendations.push(issue);
    }
  }
  if (recommendations.length === 0) {
    recommendations.push("Good job! No critical threats detected. Continue monitoring your brand regularly.");
  }
  return recommendations.slice(0, 8);
}

export { generateTyposquats, checkDomainRegistrations, checkSecurityHeaders, scanSocialMediaImposters, generateSuspiciousHandles, determineHandleRisk, getImposterReason, generateThreatRecommendations, scoreMetadataSimilarity, extractMetadataFromHtml, analyzeLookalikeVisualSimilarity };
