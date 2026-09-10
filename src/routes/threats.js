// POST /api/threat-scan, POST /api/tech-scan, GET /api/tech-scan/:id
import { CONFIG } from '../config.js';

import {
    hashUrl,
    hashIp,
    safeLogError,
    sanitizeHtml,
    sanitizeUrl,
    isUrlSafeForFetching
} from '../utils.js';

import { checkGlobalRateLimit, checkOperationRateLimit } from '../db.js';

import {
    generateTyposquats,
    checkDomainRegistrations,
    checkSecurityHeaders,
    scanSocialMediaImposters,
    generateThreatRecommendations
} from '../threats.js';

export async function handle(request, env, ctx, url, corsHeaders) {
  const env22 = env;
    if (url.pathname === "/api/threat-scan" && request.method === "POST") {
      try {
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT, env22.ENVIRONMENT);
        const body = await request.json();
        let targetDomain;
        let brandName;
        let securityTargetUrl;
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
            securityTargetUrl = sanitizedUrl;
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
          securityTargetUrl = `https://${targetDomain}`;
          if (!isUrlSafeForFetching(securityTargetUrl)) {
            return Response.json({ error: "Cannot scan internal/private domains" }, { status: 400, headers: corsHeaders });
          }
        } else {
          return Response.json({ error: "URL or domain required" }, { status: 400, headers: corsHeaders });
        }
        const rateLimit = await checkOperationRateLimit(env22, ipHash, "threat");
        if (!rateLimit.allowed) {
          return Response.json({ error: `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.`, retryAfter: rateLimit.resetIn }, { status: 429, headers: corsHeaders });
        }
        const globalLimit = await checkGlobalRateLimit(env22);
        if (!globalLimit.allowed) {
          return Response.json({ error: globalLimit.reason, retryAfter: 300 }, { status: 503, headers: { ...corsHeaders, "Retry-After": "300" } });
        }
        const [typosquats, securityGrade, socialImposters] = await Promise.all([
          // 1. Generate and check typosquats
          (async () => {
            const variations = generateTyposquats(targetDomain);
            return checkDomainRegistrations(variations);
          })(),
          // 2. Security headers check
          checkSecurityHeaders(securityTargetUrl),
          // 3. Social media imposter scan
          scanSocialMediaImposters(brandName, targetDomain)
        ]);
        const registeredLookalikes = typosquats.filter((d) => d.registered);
        const suspiciousCount = registeredLookalikes.filter((d) => d.risk === "high" || d.risk === "medium").length;
        // #17: only verified social hits affect the numeric threat score.
        // Heuristic X/Instagram patterns are surfaced in the UI but not scored as confirmed imposters.
        const verifiedImposters = socialImposters.filter(
          (i) => i.verificationStatus === "verified" && (i.risk === "high" || i.risk === "medium")
        );
        const heuristicImposters = socialImposters.filter(
          (i) => i.verificationStatus !== "verified" && i.risk !== "low"
        );
        let threatScore = 100;
        threatScore -= registeredLookalikes.length * 2;
        threatScore -= suspiciousCount * 5;
        threatScore -= verifiedImposters.length * 8;
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
            impostersFound: verifiedImposters.length,
            heuristicCandidates: heuristicImposters.length,
            verifiedCount: verifiedImposters.length,
            unverifiedCount: heuristicImposters.length,
            method: "heuristic_plus_github_api",
            disclaimer: "X/Twitter and Instagram results are heuristic handle patterns and are not confirmed to exist. Platforms often block or mislead bot probes. GitHub accounts are checked via the official Users API when available.",
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
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT, env22.ENVIRONMENT);
        const body = await request.json();
        if (!body.url) {
          return Response.json({ error: "URL required" }, { status: 400, headers: corsHeaders });
        }
        const sanitizedUrl = sanitizeUrl(body.url);
        if (!sanitizedUrl || !isUrlSafeForFetching(sanitizedUrl)) {
          return Response.json({ error: "Invalid or unsafe URL" }, { status: 400, headers: corsHeaders });
        }
        const rateLimit = await checkOperationRateLimit(env22, ipHash, "threat");
        if (!rateLimit.allowed) {
          return Response.json({ error: `Rate limit exceeded. Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.`, retryAfter: rateLimit.resetIn }, { status: 429, headers: corsHeaders });
        }
        const globalLimit = await checkGlobalRateLimit(env22);
        if (!globalLimit.allowed) {
          return Response.json({ error: globalLimit.reason, retryAfter: 300 }, { status: 503, headers: { ...corsHeaders, "Retry-After": "300" } });
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
  return null;
}
