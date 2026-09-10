// GET/POST /api/watchlist, DELETE /api/watchlist/:id, POST /api/watchlist/check
import { CONFIG, PRODUCTION_ORIGINS } from '../config.js';

import {
    generateId,
    isValidUrl,
    normalizeUrl,
    hashUrl,
    hashIp,
    isUrlSafeForFetching
} from '../utils.js';

import { checkOperationRateLimit } from '../db.js';

import { isWatchlistWebhookUrl, lookupLatestRoastScore, processWatchlistAlerts } from '../watchlist.js';

import { OWNER_KEY_RE } from './helpers.js';

export async function handle(request, env, ctx, url, corsHeaders) {
  const env22 = env;
    // #49 Competitor watchlists
    if (url.pathname === "/api/watchlist" && request.method === "GET") {
      try {
        const ownerKey = (url.searchParams.get("ownerKey") || "").trim();
        if (!OWNER_KEY_RE.test(ownerKey)) {
          return Response.json({ error: "Valid ownerKey required" }, { status: 400, headers: corsHeaders });
        }
        // An ownerKey is a bearer secret, so this read must not be a free oracle:
        // without a limit anyone could enumerate keys and harvest other people's lists.
        const wlIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const wlIpHash = await hashIp(wlIp, env22.IP_HASH_SALT, env22.ENVIRONMENT);
        const wlLimit = await checkOperationRateLimit(env22, wlIpHash, "watchlist");
        if (!wlLimit.allowed) {
          return Response.json(
            { error: "Too many watchlist requests. Please try again later." },
            { status: 429, headers: { ...corsHeaders, "Retry-After": String(wlLimit.resetIn || 3600) } }
          );
        }
        const items = await env22.DB.prepare(
          `SELECT id, url, url_hash, label, email, webhook_url, last_score, last_roast_id,
                  notify_on_change, active, created_at, updated_at
           FROM watchlist WHERE owner_key = ? AND active = 1
           ORDER BY created_at DESC LIMIT ?`
        ).bind(ownerKey, CONFIG.MAX_WATCHLIST_ITEMS).all();
        const alerts = await env22.DB.prepare(
          `SELECT id, watchlist_id, url, previous_score, new_score, roast_id, created_at
           FROM watchlist_alerts WHERE owner_key = ?
           ORDER BY created_at DESC LIMIT 20`
        ).bind(ownerKey).all();
        return Response.json({
          items: (items.results || []).map((row) => ({
            id: row.id,
            url: row.url,
            label: row.label || null,
            // Never echo the stored email or webhook URL back out. A Slack/Discord
            // webhook URL is itself a secret (anyone holding it can post to the
            // channel), and the email is PII. The UI only needs to know whether
            // alerts are configured.
            hasEmail: !!row.email,
            hasWebhook: !!row.webhook_url,
            lastScore: row.last_score,
            lastRoastId: row.last_roast_id,
            notifyOnChange: !!row.notify_on_change,
            createdAt: row.created_at,
            updatedAt: row.updated_at
          })),
          alerts: (alerts.results || []).map((a) => ({
            id: a.id,
            watchlistId: a.watchlist_id,
            url: a.url,
            previousScore: a.previous_score,
            newScore: a.new_score,
            roastId: a.roast_id,
            createdAt: a.created_at
          }))
        }, { headers: corsHeaders });
      } catch (error32) {
        console.error("Watchlist list error:", error32);
        return Response.json({ error: "Failed to load watchlist" }, { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === "/api/watchlist" && request.method === "POST") {
      try {
        const body = await request.json();
        const ownerKey = String(body.ownerKey || "").trim();
        if (!OWNER_KEY_RE.test(ownerKey)) {
          return Response.json({ error: "Valid ownerKey required (8–64 chars)" }, { status: 400, headers: corsHeaders });
        }
        const rawUrl = String(body.url || "").trim();
        const finalUrl = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
        if (!isValidUrl(finalUrl) || !isUrlSafeForFetching(finalUrl)) {
          return Response.json({ error: "Please provide a valid public URL" }, { status: 400, headers: corsHeaders });
        }
        const normalized = normalizeUrl(finalUrl);
        const label = body.label ? String(body.label).substring(0, 80).trim() : null;
        const emailRaw = body.email ? String(body.email).substring(0, 254).trim().toLowerCase() : "";
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const email = emailRaw && emailRegex.test(emailRaw) ? emailRaw : null;
        if (emailRaw && !email) {
          return Response.json({ error: "Invalid email address" }, { status: 400, headers: corsHeaders });
        }
        const webhookUrl = body.webhookUrl ? String(body.webhookUrl).substring(0, 500).trim() : "";
        if (webhookUrl && !isWatchlistWebhookUrl(webhookUrl)) {
          return Response.json({
            error: "Webhook must be a Slack or Discord HTTPS webhook URL"
          }, { status: 400, headers: corsHeaders });
        }
        if (email && (!env22.EMAIL || typeof env22.EMAIL.send !== "function")) {
          return Response.json({
            error: "Email alerts are not configured. Use a Slack or Discord webhook instead."
          }, { status: 503, headers: corsHeaders });
        }
        if (!email && !webhookUrl) {
          return Response.json({
            error: "Add an email and/or Slack/Discord webhook to receive score-change alerts"
          }, { status: 400, headers: corsHeaders });
        }

        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT, env22.ENVIRONMENT);
        const rateLimit = await checkOperationRateLimit(env22, ipHash, "watchlist");
        if (!rateLimit.allowed) {
          return Response.json({
            error: `Watchlist rate limit exceeded (${CONFIG.RATE_LIMIT_WATCHLIST_MAX}/hour). Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.`,
            retryAfter: rateLimit.resetIn
          }, { status: 429, headers: corsHeaders });
        }

        const countRow = await env22.DB.prepare(
          `SELECT COUNT(*) AS c FROM watchlist WHERE owner_key = ? AND active = 1`
        ).bind(ownerKey).first();
        if ((countRow?.c || 0) >= CONFIG.MAX_WATCHLIST_ITEMS) {
          return Response.json({
            error: `Watchlist full (max ${CONFIG.MAX_WATCHLIST_ITEMS}). Remove a URL first.`
          }, { status: 400, headers: corsHeaders });
        }

        const existing = await env22.DB.prepare(
          `SELECT id FROM watchlist WHERE owner_key = ? AND url = ? AND active = 1 LIMIT 1`
        ).bind(ownerKey, normalized).first();
        if (existing) {
          return Response.json({ error: "URL already on your watchlist", id: existing.id }, { status: 409, headers: corsHeaders });
        }

        const urlHash = await hashUrl(normalized, "desktop");
        const latest = await lookupLatestRoastScore(env22, { url: normalized, urlHash });
        const id = generateId();
        await env22.DB.prepare(
          `INSERT INTO watchlist
           (id, owner_key, url, url_hash, label, email, webhook_url, last_score, last_roast_id, notify_on_change, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`
        ).bind(
          id,
          ownerKey,
          normalized,
          urlHash,
          label,
          email,
          webhookUrl || null,
          latest?.overall_score ?? null,
          latest?.id ?? null
        ).run();

        return Response.json({
          success: true,
          item: {
            id,
            url: normalized,
            label,
            // Match the GET shape: report only whether alerts are configured, never
            // echo the stored email / webhook URL back out.
            hasEmail: !!email,
            hasWebhook: !!webhookUrl,
            lastScore: latest?.overall_score ?? null,
            lastRoastId: latest?.id ?? null
          }
        }, { headers: corsHeaders });
      } catch (error32) {
        console.error("Watchlist add error:", error32);
        return Response.json({ error: "Failed to add to watchlist" }, { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname.startsWith("/api/watchlist/") && request.method === "DELETE") {
      try {
        const id = url.pathname.split("/").pop();
        if (!id || id.length > 40) {
          return Response.json({ error: "Invalid id" }, { status: 400, headers: corsHeaders });
        }
        let ownerKey = (url.searchParams.get("ownerKey") || "").trim();
        if (!ownerKey) {
          try {
            const body = await request.json();
            ownerKey = String(body.ownerKey || "").trim();
          } catch { /* no body */ }
        }
        if (!OWNER_KEY_RE.test(ownerKey)) {
          return Response.json({ error: "Valid ownerKey required" }, { status: 400, headers: corsHeaders });
        }
        const result = await env22.DB.prepare(
          `UPDATE watchlist SET active = 0, updated_at = datetime('now')
           WHERE id = ? AND owner_key = ?`
        ).bind(id, ownerKey).run();
        if (!result.meta?.changes) {
          return Response.json({ error: "Watchlist item not found" }, { status: 404, headers: corsHeaders });
        }
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (error32) {
        console.error("Watchlist delete error:", error32);
        return Response.json({ error: "Failed to remove from watchlist" }, { status: 500, headers: corsHeaders });
      }
    }

    if (url.pathname === "/api/watchlist/check" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const ownerKey = String(body.ownerKey || "").trim();
        if (!OWNER_KEY_RE.test(ownerKey)) {
          return Response.json({ error: "Valid ownerKey required" }, { status: 400, headers: corsHeaders });
        }
        const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const ipHash = await hashIp(clientIp, env22.IP_HASH_SALT, env22.ENVIRONMENT);
        const rateLimit = await checkOperationRateLimit(env22, ipHash, "watchlist");
        if (!rateLimit.allowed) {
          return Response.json({
            error: `Watchlist rate limit exceeded (${CONFIG.RATE_LIMIT_WATCHLIST_MAX}/hour). Try again in ${Math.ceil(rateLimit.resetIn / 60)} minutes.`,
            retryAfter: rateLimit.resetIn
          }, { status: 429, headers: corsHeaders });
        }

        // Manual check: only this owner's URLs, DB score lookup (no Browser Rendering).
        const baseUrl = env22.BASE_URL || PRODUCTION_ORIGINS[0];
        const result = await processWatchlistAlerts(env22, {
          limit: CONFIG.MAX_WATCHLIST_ITEMS,
          baseUrl,
          ownerKey
        });
        return Response.json({
          success: true,
          checked: result.checked,
          alerted: result.alerted,
          alerts: result.alerts
        }, { headers: corsHeaders });
      } catch (error32) {
        console.error("Watchlist check error:", error32);
        return Response.json({ error: "Failed to check watchlist" }, { status: 500, headers: corsHeaders });
      }
    }

  return null;
}
