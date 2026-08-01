/**
 * Extra product routes extracted from the monolith (#39/#84):
 * admin, API keys, annotations, export, watchlist, schedule, turnstile helper.
 */
import { generateId, isValidUrl, sanitizeUrl, hashIp, hashUrl, getSecurityHeaders } from '../utils.js';
import { createApiKey, authenticateApiKey, fireWebhook } from '../apiKeys.js';
import { isAdminAuthorized, renderAdminPage } from '../admin.js';
import { sendEmail, roastSummaryHtml } from '../mail.js';
import { checkOperationRateLimit } from '../db.js';
import { PRODUCTION_ORIGINS } from '../config.js';

export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return { ok: true, skipped: true };
  if (!token) return { ok: false, error: "Captcha required" };
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: ip || ""
      })
    });
    const data = await res.json();
    return { ok: !!data.success, error: data.success ? null : "Captcha failed" };
  } catch {
    return { ok: false, error: "Captcha verification unavailable" };
  }
}

export async function handleExtraRoutes(request, env, ctx, { corsHeaders, origin }) {
  const url = new URL(request.url);
  const path = url.pathname;

  // Public client config (Turnstile site key, feature flags)
  if (path === "/api/config" && request.method === "GET") {
    return Response.json({
      turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
      emailEnabled: !!env.RESEND_API_KEY,
      features: {
        apiKeys: true,
        watchlist: true,
        schedule: true,
        annotations: true,
        embed: true
      }
    }, { headers: { ...corsHeaders, "Cache-Control": "public, max-age=60" } });
  }

  // #81 Admin dashboard
  if (path === "/admin" && request.method === "GET") {
    if (!env.ADMIN_TOKEN) {
      return new Response("Admin not configured. Set ADMIN_TOKEN secret.", {
        status: 503,
        headers: { "Content-Type": "text/plain", ...getSecurityHeaders(origin, env.ENVIRONMENT) }
      });
    }
    if (!isAdminAuthorized(request, env)) {
      return new Response("Unauthorized", { status: 401, headers: { "Content-Type": "text/plain" } });
    }
    const [totals, feedback, subscribers, optOuts] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) as totalRoasts,
        SUM(CASE WHEN created_at > datetime('now','-1 day') THEN 1 ELSE 0 END) as todayRoasts,
        AVG(overall_score) as avgScore FROM roasts`).first(),
      env.DB.prepare("SELECT vote, context, message, created_at FROM feedback ORDER BY created_at DESC LIMIT 50").all(),
      env.DB.prepare("SELECT email, roast_id, created_at FROM email_subscribers ORDER BY created_at DESC LIMIT 50").all(),
      env.DB.prepare("SELECT hostname, roast_count, created_at FROM opt_out_requests ORDER BY created_at DESC LIMIT 50").all()
    ]);
    const subCount = await env.DB.prepare("SELECT COUNT(*) as c FROM email_subscribers").first();
    const fbCount = await env.DB.prepare("SELECT COUNT(*) as c FROM feedback").first();
    const html = renderAdminPage({
      stats: {
        totalRoasts: totals?.totalRoasts || 0,
        todayRoasts: totals?.todayRoasts || 0,
        avgScore: totals?.avgScore || 0,
        subscribers: subCount?.c || 0,
        feedback: fbCount?.c || 0
      },
      feedback: feedback.results || [],
      subscribers: subscribers.results || [],
      optOuts: optOuts.results || [],
      baseUrl: env.BASE_URL || PRODUCTION_ORIGINS[0]
    });
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8", ...getSecurityHeaders(origin, env.ENVIRONMENT) }
    });
  }

  // #24/#85 Create API key (admin-gated or open in non-prod for DX)
  if (path === "/api/keys" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const isProd = env.ENVIRONMENT === "production";
    if (isProd && !isAdminAuthorized(request, env)) {
      return Response.json({ error: "Admin token required to mint keys in production" }, { status: 401, headers: corsHeaders });
    }
    const created = await createApiKey(env, {
      label: body.label || "default",
      tier: ["free", "pro", "agency"].includes(body.tier) ? body.tier : "free",
      webhookUrl: body.webhookUrl || null
    });
    return Response.json({
      success: true,
      ...created,
      note: "Store this API key now — it will not be shown again."
    }, { headers: corsHeaders });
  }

  // #56 Annotations
  if (path === "/api/annotations" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const roastId = body.roastId;
    const category = String(body.category || "").slice(0, 20);
    const status = body.status === "fixed" || body.status === "wont_fix" ? body.status : null;
    if (!roastId || !category || !status) {
      return Response.json({ error: "roastId, category, and status required" }, { status: 400, headers: corsHeaders });
    }
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const ipHash = await hashIp(ip, env.IP_HASH_SALT, env.ENVIRONMENT);
    const id = generateId();
    await env.DB.prepare(`
      INSERT INTO annotations (id, roast_id, category, status, note, ip_hash)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(roast_id, category) DO UPDATE SET status = excluded.status, note = excluded.note
    `).bind(id, roastId, category, status, String(body.note || "").slice(0, 300), ipHash).run();
    return Response.json({ success: true }, { headers: corsHeaders });
  }

  if (path.startsWith("/api/annotations/") && request.method === "GET") {
    const roastId = path.split("/").pop();
    const rows = await env.DB.prepare(
      "SELECT category, status, note, created_at FROM annotations WHERE roast_id = ?"
    ).bind(roastId).all();
    return Response.json({ annotations: rows.results || [] }, { headers: corsHeaders });
  }

  // #65 Data export
  if (path === "/api/export" && request.method === "GET") {
    const target = sanitizeUrl(url.searchParams.get("url") || "");
    if (!target || !isValidUrl(target)) {
      return Response.json({ error: "Valid url query param required" }, { status: 400, headers: corsHeaders });
    }
    let hostname = "";
    try { hostname = new URL(target).hostname.replace(/^www\./, "").toLowerCase(); } catch {
      return Response.json({ error: "Invalid url" }, { status: 400, headers: corsHeaders });
    }
    const roasts = await env.DB.prepare(`
      SELECT id, url, overall_score, hero_score, cta_score, trust_score, copy_score, design_score,
             industry, device, full_page, created_at
      FROM roasts
      WHERE lower(url) LIKE ? OR lower(url) LIKE ?
      ORDER BY created_at DESC LIMIT 100
    `).bind(`https://${hostname}%`, `http://${hostname}%`).all();
    return Response.json({
      exportedAt: new Date().toISOString(),
      hostname,
      roasts: roasts.results || []
    }, { headers: corsHeaders });
  }

  // #49 Watchlist
  if (path === "/api/watchlist" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const target = sanitizeUrl(body.url || "");
    if (!target || !isValidUrl(target)) {
      return Response.json({ error: "Valid url required" }, { status: 400, headers: corsHeaders });
    }
    const id = generateId();
    const urlHash = await hashUrl(target, "desktop");
    await env.DB.prepare(`
      INSERT INTO watchlist (id, url, url_hash, email, webhook_url, notify_on_change)
      VALUES (?, ?, ?, ?, ?, 1)
    `).bind(id, target, urlHash, body.email || null, body.webhookUrl || null).run();
    return Response.json({ success: true, id }, { headers: corsHeaders });
  }

  // #48 Scheduled re-roasts
  if (path === "/api/schedule" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const target = sanitizeUrl(body.url || "");
    if (!target || !isValidUrl(target)) {
      return Response.json({ error: "Valid url required" }, { status: 400, headers: corsHeaders });
    }
    const cadence = body.cadence === "daily" ? "daily" : "weekly";
    const days = cadence === "daily" ? 1 : 7;
    const next = new Date(Date.now() + days * 864e5).toISOString();
    const id = generateId();
    await env.DB.prepare(`
      INSERT INTO scheduled_roasts (id, url, email, cadence, next_run_at, active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).bind(id, target, body.email || null, cadence, next).run();
    return Response.json({ success: true, id, nextRunAt: next }, { headers: corsHeaders });
  }

  // #31 Webhook test helper
  if (path === "/api/webhook/test" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!body.url) return Response.json({ error: "url required" }, { status: 400, headers: corsHeaders });
    ctx.waitUntil(fireWebhook(body.url, { type: "test", at: new Date().toISOString() }));
    return Response.json({ success: true }, { headers: corsHeaders });
  }

  // #26 Opt-out / deletion request
  if (path === "/api/opt-out" && request.method === "POST") {
    try {
      const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
      const ipHash = await hashIp(clientIp, env.IP_HASH_SALT, env.ENVIRONMENT);
      const body = await request.json();
      const targetUrl = sanitizeUrl(body.url || body.domain || "");
      if (!targetUrl || !isValidUrl(targetUrl)) {
        return Response.json({ error: "Please provide a valid URL to remove" }, { status: 400, headers: corsHeaders });
      }
      const rateLimit = await checkOperationRateLimit(env, ipHash, "optout");
      if (!rateLimit.allowed) {
        return Response.json(
          { error: `Too many opt-out requests. Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.` },
          { status: 429, headers: corsHeaders }
        );
      }
      let hostname = "";
      try {
        hostname = new URL(targetUrl).hostname.replace(/^www\./, "").toLowerCase();
      } catch {
        return Response.json({ error: "Invalid URL" }, { status: 400, headers: corsHeaders });
      }
      if (!hostname || hostname.length < 3) {
        return Response.json({ error: "Invalid hostname" }, { status: 400, headers: corsHeaders });
      }
      const matches = await env.DB.prepare(`
        SELECT id, screenshot_key, url FROM roasts
        WHERE lower(url) LIKE ?
           OR lower(url) LIKE ?
           OR lower(url) LIKE ?
           OR lower(url) LIKE ?
           OR lower(url) LIKE ?
           OR lower(url) LIKE ?
        LIMIT 100
      `).bind(
        `https://${hostname}/%`,
        `https://${hostname}`,
        `http://${hostname}/%`,
        `http://${hostname}`,
        `https://www.${hostname}%`,
        `http://www.${hostname}%`
      ).all();
      const rows = matches.results || [];
      let deletedScreenshots = 0;
      for (const row of rows) {
        if (row.screenshot_key) {
          try {
            await env.SCREENSHOTS.delete(row.screenshot_key);
            deletedScreenshots++;
          } catch { /* ignore */ }
        }
      }
      if (rows.length) {
        const placeholders = rows.map(() => "?").join(",");
        await env.DB.prepare(`DELETE FROM roasts WHERE id IN (${placeholders})`).bind(...rows.map((r) => r.id)).run();
      }
      const requestId = generateId();
      await env.DB.prepare(
        `INSERT INTO opt_out_requests (id, url, hostname, roast_count, ip_hash) VALUES (?, ?, ?, ?, ?)`
      ).bind(requestId, targetUrl, hostname, rows.length, ipHash).run();
      return Response.json({
        success: true,
        hostname,
        deletedRoasts: rows.length,
        deletedScreenshots,
        requestId,
        message: rows.length
          ? `Removed ${rows.length} roast${rows.length === 1 ? "" : "s"} for ${hostname}.`
          : `No stored roasts found for ${hostname}. Your opt-out was recorded.`
      }, { headers: corsHeaders });
    } catch (error) {
      console.error("Opt-out failed:", error);
      return Response.json({ error: "Failed to process opt-out request" }, { status: 500, headers: corsHeaders });
    }
  }

  // #47 Email roast report (optional Resend)
  if (path === "/api/email-report" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!body.email || !body.roastId) {
      return Response.json({ error: "email and roastId required" }, { status: 400, headers: corsHeaders });
    }
    const roast = await env.DB.prepare("SELECT id, url, overall_score FROM roasts WHERE id = ?").bind(body.roastId).first();
    if (!roast) return Response.json({ error: "Roast not found" }, { status: 404, headers: corsHeaders });
    const base = env.BASE_URL || PRODUCTION_ORIGINS[0];
    const result = await sendEmail(env, {
      to: body.email,
      subject: `Your roast score: ${roast.overall_score}/10`,
      html: roastSummaryHtml({
        url: roast.url,
        score: roast.overall_score,
        shareUrl: `${base}/roast/${roast.id}`
      }),
      text: `Score ${roast.overall_score}/10 for ${roast.url} — ${base}/roast/${roast.id}`
    });
    return Response.json(result, { status: result.sent ? 200 : 503, headers: corsHeaders });
  }

  return null;
}

export { authenticateApiKey, fireWebhook, createApiKey };
