import { PRODUCTION_ORIGINS } from '../config.js';
import { safeLogError } from '../utils.js';

export async function handleExtrasRoutes(request, env22, _ctx, { url, corsHeaders }) {
    if (url.pathname === "/sitemap.xml" && request.method === "GET") {
      try {
        const BASE_URL_SM = PRODUCTION_ORIGINS[0];
        const totalResult = await env22.DB.prepare("SELECT COUNT(*) as count FROM roasts").first();
        const totalRoasts = totalResult?.count || 0;
        const galleryPages = Math.ceil(totalRoasts / 24);
        const roasts = await env22.DB.prepare(
          "SELECT id, created_at FROM roasts ORDER BY created_at DESC LIMIT 50000"
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
          for (const roast of roasts.results) {
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
    // Alias /api/og-image/:id → /api/og/:id for backward compatibility
    if (url.pathname.startsWith("/api/og-image/") && request.method === "GET") {
      const roastId = url.pathname.split("/").pop();
      const base = env22.BASE_URL || PRODUCTION_ORIGINS[0];
      return Response.redirect(`${base}/api/og/${roastId}`, 301);
    }
    // Pricing page — served as SPA route from index.html
    if (url.pathname === "/pricing" && request.method === "GET") {
      if (env22.ASSETS) {
        const indexUrl = new URL(request.url);
        indexUrl.pathname = "/";
        return env22.ASSETS.fetch(new Request(indexUrl.toString(), request));
      }
    }
  return null;
}
