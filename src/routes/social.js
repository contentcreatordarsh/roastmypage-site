// POST /api/feedback, POST /api/subscribe
import { generateId, isValidRoastIdLoose, hashIp } from '../utils.js';

import { checkOperationRateLimit } from '../db.js';

export async function handle(request, env, ctx, url, corsHeaders) {
  const env22 = env;
    if (url.pathname === "/api/feedback" && request.method === "POST") {
      try {
        const body = await request.json();
        const vote = body.vote === "up" || body.vote === "down" ? body.vote : null;
        if (!vote) {
          return Response.json({ error: "Invalid vote" }, { status: 400, headers: corsHeaders });
        }
        const fbIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const fbIpHash = await hashIp(fbIp, env22.IP_HASH_SALT, env22.ENVIRONMENT);
        const fbLimit = await checkOperationRateLimit(env22, fbIpHash, "feedback");
        if (!fbLimit.allowed) {
          return Response.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: corsHeaders });
        }
        const context3 = (body.context || "roast").substring(0, 20);
        const reasons = Array.isArray(body.reasons) ? body.reasons.slice(0, 10).map((r) => String(r).substring(0, 50)).join(",") : "";
        const message = body.message ? String(body.message).substring(0, 1e3).trim() : "";
        const email = body.email ? String(body.email).substring(0, 254).trim() : "";
        const roastId = isValidRoastIdLoose(body.roastId) ? body.roastId : null;
        const feedbackUrl = body.url ? String(body.url).substring(0, 500) : null;
        const country = request.cf?.country || null;
        const id = generateId();
        await env22.DB.prepare(
          `INSERT INTO feedback (id, vote, context, reasons, message, email, roast_id, url, ip_hash, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, vote, context3, reasons, message, email, roastId, feedbackUrl, fbIpHash, country).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (error32) {
        console.error("Feedback error:", error32);
        return Response.json({ error: "Failed to save feedback" }, { status: 500, headers: corsHeaders });
      }
    }
    if (url.pathname === "/api/subscribe" && request.method === "POST") {
      try {
        const body = await request.json();
        const rawEmail = body.email;
        const roastId = body.roastId;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!rawEmail || rawEmail.length > 254 || !emailRegex.test(rawEmail)) {
          return Response.json({ error: "Please provide a valid email address" }, { status: 400, headers: corsHeaders });
        }
        const subIp = request.headers.get("CF-Connecting-IP") || "unknown";
        const subIpHash = await hashIp(subIp, env22.IP_HASH_SALT, env22.ENVIRONMENT);
        const subLimit = await checkOperationRateLimit(env22, subIpHash, "subscribe");
        if (!subLimit.allowed) {
          return Response.json({ error: "Too many requests. Please try again later." }, { status: 429, headers: corsHeaders });
        }
        const email = rawEmail.toLowerCase().trim();
        const validRoastId = isValidRoastIdLoose(roastId) ? roastId : null;
        const id = generateId();
        await env22.DB.prepare(`INSERT OR IGNORE INTO email_subscribers (id, email, roast_id) VALUES (?, ?, ?)`).bind(id, email, validRoastId).run();
        return Response.json({ success: true, message: "Subscribed successfully!" }, { headers: corsHeaders });
      } catch (error32) {
        return Response.json({ error: "Failed to subscribe" }, { status: 500, headers: corsHeaders });
      }
    }
  return null;
}
