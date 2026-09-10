// GET /api/recent, /api/gallery, /api/leaderboard*, /api/feed, /api/showcase, /api/featured, /api/industry/*, /api/improvement/:hash
import { CONFIG, INDUSTRY_BENCHMARKS, INDUSTRY_KEYS } from '../config.js';

import { resolveIndustry } from '../ai.js';

import { visibleStoredRoasts, visibleStoredRoastSql } from './helpers.js';

export async function handle(request, env, ctx, url, corsHeaders) {
  const env22 = env;
    if (url.pathname === "/api/recent" && request.method === "GET") {
      const roasts = await env22.DB.prepare(
        `SELECT id, url, overall_score, created_at, seo_data FROM roasts
         WHERE ${visibleStoredRoastSql()} ORDER BY created_at DESC LIMIT 10`
      ).all();
      return Response.json(visibleStoredRoasts(roasts.results), { headers: corsHeaders });
    }
    if (url.pathname === "/api/gallery" && request.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
      const perPage = 24;
      const offset = (page - 1) * perPage;
      // #57 — optional industry filter for the homepage gallery. Validate against the
      // known key set so the value can only ever be a fixed column filter (never user text).
      const industryParam = url.searchParams.get("industry");
      const industryFilter = industryParam && INDUSTRY_KEYS.includes(industryParam) ? industryParam : null;
      const roasts = industryFilter ? await env22.DB.prepare(`
        SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, industry, created_at, seo_data
        FROM roasts WHERE industry = ? AND ${visibleStoredRoastSql()} ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).bind(industryFilter, perPage, offset).all() : await env22.DB.prepare(`
        SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, industry, created_at, seo_data
        FROM roasts WHERE ${visibleStoredRoastSql()} ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).bind(perPage, offset).all();
      const results = visibleStoredRoasts(roasts.results).map((roast) => ({
        ...roast,
        screenshotUrl: `/api/screenshot/${roast.id}`,
        hostname: new URL(roast.url).hostname
      }));
      return Response.json(results, { headers: corsHeaders });
    }
    if (url.pathname === "/api/leaderboard" && request.method === "GET") {
      const roasts = await env22.DB.prepare(`
        SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, created_at, seo_data
        FROM roasts 
        WHERE overall_score >= 7 AND ${visibleStoredRoastSql()}
        ORDER BY overall_score DESC, created_at DESC 
        LIMIT 10
      `).all();
      const results = visibleStoredRoasts(roasts.results).map((roast) => ({
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
          SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, created_at, seo_data
          FROM roasts 
          WHERE overall_score <= 4 AND ${visibleStoredRoastSql()}
          ORDER BY overall_score ASC, created_at DESC 
          LIMIT 20
        `).all();
        const results = visibleStoredRoasts(roasts.results).map((roast) => {
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
          SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, country, created_at, seo_data
          FROM roasts 
          WHERE ${visibleStoredRoastSql()}
          ORDER BY created_at DESC 
          LIMIT ? OFFSET ?
        `).bind(limit, offset).all();
        const total = await env22.DB.prepare(
          `SELECT COUNT(*) as count FROM roasts WHERE ${visibleStoredRoastSql()}`
        ).first();
        const results = visibleStoredRoasts(roasts.results).map((roast) => {
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
    if (url.pathname === "/api/leaderboard/weekly" && request.method === "GET") {
      const roasts = await env22.DB.prepare(`
        SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, created_at, seo_data
        FROM roasts 
        WHERE created_at > datetime('now', '-7 days') AND ${visibleStoredRoastSql()}
        ORDER BY overall_score DESC, created_at DESC 
        LIMIT 20
      `).all();
      const results = visibleStoredRoasts(roasts.results).map((roast, index) => {
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
        WHERE created_at > datetime('now', '-7 days') AND ${visibleStoredRoastSql()}
      `).first();
      return Response.json({
        leaderboard: results,
        stats: weekStats,
        period: "Last 7 days"
      }, { headers: corsHeaders });
    }
    if (url.pathname === "/api/leaderboard/alltime" && request.method === "GET") {
      const roasts = await env22.DB.prepare(`
        SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, created_at, seo_data
        FROM roasts 
        WHERE ${visibleStoredRoastSql()}
        ORDER BY overall_score DESC, created_at DESC 
        LIMIT 20
      `).all();
      const results = visibleStoredRoasts(roasts.results).map((roast, index) => {
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
        WHERE url_hash = ? AND ${visibleStoredRoastSql()}
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
          WHERE ${visibleStoredRoastSql()}
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
        SELECT r.id, r.url, r.overall_score, r.hero_score, r.cta_score, r.trust_score, r.copy_score, r.design_score, r.industry, r.created_at, r.seo_data
        FROM roasts r
        INNER JOIN (
          SELECT url, MAX(created_at) as latest
          FROM roasts
          WHERE ${likeClauses}
          GROUP BY url
        ) latest ON r.url = latest.url AND r.created_at = latest.latest
        WHERE ${visibleStoredRoastSql("r")}
        ORDER BY r.overall_score DESC
        LIMIT 12
      `).bind(...likeParams).all();
      let results = visibleStoredRoasts(featured.results);
      if (results.length < 6) {
        const existingIds = results.map((r) => r.id);
        const excludeClause = existingIds.length > 0 ? `AND id NOT IN (${existingIds.map(() => "?").join(",")})` : "";
        const padding = await env22.DB.prepare(`
          SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, industry, created_at, seo_data
          FROM roasts
          WHERE overall_score > 0 AND ${visibleStoredRoastSql()} ${excludeClause}
          ORDER BY overall_score DESC, created_at DESC
          LIMIT ?
        `).bind(...existingIds, 12 - results.length).all();
        results = [...results, ...visibleStoredRoasts(padding.results)];
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
            WHERE industry IS NOT NULL AND ${visibleStoredRoastSql()}
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
              AND ${visibleStoredRoastSql()}
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
          WHERE industry = ? AND ${visibleStoredRoastSql()}
        `).bind(normalizedIndustry).first();
        const topPages = await env22.DB.prepare(`
          SELECT id, url, overall_score, created_at
          FROM roasts
          WHERE industry = ? AND overall_score IS NOT NULL AND ${visibleStoredRoastSql()}
          ORDER BY overall_score DESC
          LIMIT 5
        `).bind(normalizedIndustry).all();
        const detailScores = await env22.DB.prepare(`
          SELECT seo_data, performance_data
          FROM roasts
          WHERE industry = ?
          AND seo_data IS NOT NULL
          AND performance_data IS NOT NULL
          AND ${visibleStoredRoastSql()}
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
  return null;
}
