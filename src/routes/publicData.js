import { INDUSTRY_BENCHMARKS, INDUSTRY_KEYS } from '../config.js';
import { hashIp, isValidRoastId, isValidRoastIdLoose } from '../utils.js';

export async function handlePublicDataRoutes(request, env22, _ctx, { url, corsHeaders }) {
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
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
      const perPage = 24;
      const offset = (page - 1) * perPage;
      // #57 — optional industry filter for the homepage gallery. Validate against the
      // known key set so the value can only ever be a fixed column filter (never user text).
      const industryParam = url.searchParams.get("industry");
      const industryFilter = industryParam && INDUSTRY_KEYS.includes(industryParam) ? industryParam : null;
      const roasts = industryFilter ? await env22.DB.prepare(`
        SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, industry, created_at
        FROM roasts WHERE industry = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).bind(industryFilter, perPage, offset).all() : await env22.DB.prepare(`
        SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score, industry, created_at
        FROM roasts ORDER BY created_at DESC LIMIT ? OFFSET ?
      `).bind(perPage, offset).all();
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
  return null;
}
