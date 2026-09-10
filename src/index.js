import { PRODUCTION_ORIGINS } from "./config.js";
import { getAllowedOrigins, getSecurityHeaders } from "./utils.js";
import { processWatchlistAlerts } from "./watchlist.js";
import { dispatch } from "./routes/router.js";
import { handle as handleRoast } from "./routes/roast.js";
import { handle as handleCompare } from "./routes/compare.js";
import { handle as handleBatch } from "./routes/batch.js";
import { handle as handleGallery } from "./routes/gallery.js";
import { handle as handleSocial } from "./routes/social.js";
import { handle as handleWatchlist } from "./routes/watchlist.js";
import { handle as handlePlatform } from "./routes/platform.js";
import { handle as handleBadges } from "./routes/badges.js";
import { handle as handleThreats } from "./routes/threats.js";
import { handle as handleApiV1 } from "./routes/apiV1.js";
import { handle as handleSsr } from "./routes/ssr-routes.js";

const ROUTE_HANDLERS = [
  handleRoast,
  handleCompare,
  handleBatch,
  handleGallery,
  handleSocial,
  handleWatchlist,
  handlePlatform,
  handleBadges,
  handleThreats,
  handleApiV1,
  handleSsr
];

export default {
  async fetch(request, env22, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const securityHeaders = getSecurityHeaders(origin, env22.ENVIRONMENT);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: securityHeaders });
    }
    const corsHeaders = securityHeaders;
    if (request.method === "POST" && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/v1/")) {
      const reqOrigin = request.headers.get("Origin");
      const allowedOrigins = getAllowedOrigins(env22.ENVIRONMENT);
      if (reqOrigin && !allowedOrigins.includes(reqOrigin)) {
        return Response.json({ error: "Forbidden: origin not allowed" }, { status: 403, headers: corsHeaders });
      }
    }
    const routed = await dispatch(ROUTE_HANDLERS, request, env22, ctx, url, corsHeaders);
    if (routed) return routed;
    if (env22.ASSETS) {
      return env22.ASSETS.fetch(request);
    }
    return new Response("Not Found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    const baseUrl = env.BASE_URL || PRODUCTION_ORIGINS[0];
    ctx.waitUntil(
      processWatchlistAlerts(env, { limit: 40, baseUrl }).catch((err) => {
        console.error("Watchlist cron failed:", err?.message || err);
      })
    );
  }
};
