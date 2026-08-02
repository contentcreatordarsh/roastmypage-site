import {
  generateId,
  escapeHtml,
  hashUrl,
  isUrlSafeForFetching,
  isValidRoastIdLoose,
  isValidUrl,
  sanitizeUrl
} from "./utils.js";

const VALID_CADENCES = new Set(["weekly", "monthly"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OWNER_KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;

function isValidOwnerKey(ownerKey) {
  return typeof ownerKey === "string" && OWNER_KEY_RE.test(ownerKey);
}

function validateCadence(cadence) {
  return VALID_CADENCES.has(cadence) ? cadence : null;
}

function toD1Date(date) {
  return date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
}

function addCadence(date, cadence) {
  const next = new Date(date.getTime());
  if (cadence === "monthly") {
    next.setUTCMonth(next.getUTCMonth() + 1);
  } else {
    next.setUTCDate(next.getUTCDate() + 7);
  }
  return next;
}

function parseD1Date(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return new Date(`${value.replace(" ", "T")}Z`);
  }
  return new Date(value);
}

function advanceNextRunAt(currentRunAt, cadence, now = new Date()) {
  let next = parseD1Date(currentRunAt);
  if (Number.isNaN(next.getTime())) {
    next = new Date(now.getTime());
  }
  do {
    next = addCadence(next, cadence);
  } while (next <= now);
  return next;
}

function mapSchedule(row) {
  return {
    id: row.id,
    ownerKey: row.owner_key,
    url: row.url,
    urlHash: row.url_hash,
    email: row.email,
    cadence: row.cadence,
    nextRunAt: row.next_run_at,
    lastRoastId: row.last_roast_id || null,
    active: row.active === 1 || row.active === true
  };
}

function normalizeScheduleInput(input) {
  const ownerKey = String(input.ownerKey || input.owner_key || "").trim();
  if (!isValidOwnerKey(ownerKey)) {
    return { error: "Invalid owner key" };
  }

  const targetUrl = sanitizeUrl(input.url);
  if (!targetUrl || !isValidUrl(targetUrl)) {
    return { error: "Please provide a valid URL" };
  }
  if (!isUrlSafeForFetching(targetUrl)) {
    return { error: "Cannot schedule internal/private URLs" };
  }

  const email = String(input.email || "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return { error: "Please provide a valid email address" };
  }

  const cadence = validateCadence(input.cadence);
  if (!cadence) {
    return { error: "Cadence must be weekly or monthly" };
  }

  const lastRoastId = isValidRoastIdLoose(input.lastRoastId || input.last_roast_id)
    ? String(input.lastRoastId || input.last_roast_id)
    : null;

  return { ownerKey, targetUrl, email, cadence, lastRoastId };
}

async function createRoastSchedule(env, input, now = new Date()) {
  const normalized = normalizeScheduleInput(input);
  if (normalized.error) {
    return { error: normalized.error };
  }

  const id = generateId();
  const urlHash = await hashUrl(normalized.targetUrl, "desktop");
  const nextRunAt = toD1Date(advanceNextRunAt(now, normalized.cadence, now));

  await env.DB.prepare(`
    INSERT INTO roast_schedules (id, owner_key, url, url_hash, email, cadence, next_run_at, last_roast_id, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).bind(
    id,
    normalized.ownerKey,
    normalized.targetUrl,
    urlHash,
    normalized.email,
    normalized.cadence,
    nextRunAt,
    normalized.lastRoastId
  ).run();

  return {
    schedule: {
      id,
      ownerKey: normalized.ownerKey,
      url: normalized.targetUrl,
      urlHash,
      email: normalized.email,
      cadence: normalized.cadence,
      nextRunAt,
      lastRoastId: normalized.lastRoastId,
      active: true
    }
  };
}

async function getRoastSchedules(env, ownerKey) {
  if (!isValidOwnerKey(ownerKey)) {
    return { error: "Invalid owner key" };
  }
  const rows = await env.DB.prepare(`
    SELECT id, owner_key, url, url_hash, email, cadence, next_run_at, last_roast_id, active
    FROM roast_schedules
    WHERE owner_key = ? AND active = 1
    ORDER BY next_run_at ASC
  `).bind(ownerKey).all();
  return { schedules: (rows.results || []).map(mapSchedule) };
}

async function deleteRoastSchedule(env, ownerKey, id) {
  if (!isValidOwnerKey(ownerKey)) {
    return { error: "Invalid owner key" };
  }
  if (!id || !/^[A-Za-z0-9_-]{3,64}$/.test(String(id))) {
    return { error: "Invalid schedule id" };
  }
  const result = await env.DB.prepare(`
    UPDATE roast_schedules
    SET active = 0
    WHERE id = ? AND owner_key = ? AND active = 1
  `).bind(String(id), ownerKey).run();
  return { success: (result.meta?.changes || 0) > 0 };
}

function getReminderBaseUrl(env) {
  return env.BASE_URL || "https://roastmypage.site";
}

function buildReminderLink(env, schedule) {
  const link = new URL("/", getReminderBaseUrl(env));
  link.searchParams.set("url", schedule.url);
  return link.toString();
}

function getReminderFromAddress(env) {
  return env.EMAIL_FROM || env.RESEND_FROM || env.FROM_EMAIL || env.EMAIL || "";
}

function buildReminderEmail(env, schedule) {
  const link = buildReminderLink(env, schedule);
  const escapedUrl = escapeHtml(schedule.url);
  const escapedLink = escapeHtml(link);
  return {
    from: getReminderFromAddress(env),
    to: schedule.email,
    subject: `Time to re-roast ${schedule.url}`,
    text: [
      `Time to re-roast ${schedule.url}.`,
      "",
      "You scheduled a reminder to check whether your latest landing page changes improved your score.",
      `Start the re-roast here: ${link}`
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
        <h2>Time to re-roast ${escapedUrl}</h2>
        <p>You scheduled a reminder to check whether your latest landing page changes improved your score.</p>
        <p><a href="${escapedLink}" style="display:inline-block;background:#ff6b35;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Re-roast this page</a></p>
      </div>
    `
  };
}

async function sendReminderEmail(env, schedule, fetchImpl = fetch) {
  if (!env.RESEND_API_KEY || !getReminderFromAddress(env)) {
    return { sent: false, skipped: true, reason: "email-not-configured" };
  }

  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(buildReminderEmail(env, schedule))
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend failed with ${response.status}${body ? `: ${body.slice(0, 120)}` : ""}`);
  }

  return { sent: true };
}

async function processDueSchedules(env, options = {}) {
  const now = options.now || new Date();
  const limit = options.limit || 25;
  const fetchImpl = options.fetchImpl || fetch;
  const rows = await env.DB.prepare(`
    SELECT id, owner_key, url, url_hash, email, cadence, next_run_at, last_roast_id, active
    FROM roast_schedules
    WHERE active = 1 AND next_run_at <= ?
    ORDER BY next_run_at ASC
    LIMIT ?
  `).bind(toD1Date(now), limit).all();

  const processed = [];
  for (const row of rows.results || []) {
    const schedule = mapSchedule(row);
    try {
      const emailResult = await sendReminderEmail(env, schedule, fetchImpl);
      const nextRunAt = toD1Date(advanceNextRunAt(schedule.nextRunAt, schedule.cadence, now));
      await env.DB.prepare(`
        UPDATE roast_schedules
        SET next_run_at = ?
        WHERE id = ? AND active = 1
      `).bind(nextRunAt, schedule.id).run();
      processed.push({ id: schedule.id, nextRunAt, ...emailResult });
    } catch (error) {
      processed.push({ id: schedule.id, sent: false, error: error.message });
    }
  }

  return { processed };
}

async function handleSchedulesRequest(request, env, corsHeaders = {}) {
  const url = new URL(request.url);
  try {
    if (request.method === "GET") {
      const ownerKey = url.searchParams.get("ownerKey") || "";
      const result = await getRoastSchedules(env, ownerKey);
      if (result.error) return Response.json({ error: result.error }, { status: 400, headers: corsHeaders });
      return Response.json(result, { headers: corsHeaders });
    }

    if (request.method === "POST") {
      const body = await request.json();
      const result = await createRoastSchedule(env, body);
      if (result.error) return Response.json({ error: result.error }, { status: 400, headers: corsHeaders });
      return Response.json(result.schedule, { status: 201, headers: corsHeaders });
    }

    if (request.method === "DELETE") {
      let ownerKey = url.searchParams.get("ownerKey") || "";
      let id = url.searchParams.get("id") || "";
      if (!ownerKey || !id) {
        try {
          const body = await request.json();
          ownerKey = ownerKey || body.ownerKey || "";
          id = id || body.id || "";
        } catch {
        }
      }
      const result = await deleteRoastSchedule(env, ownerKey, id);
      if (result.error) return Response.json({ error: result.error }, { status: 400, headers: corsHeaders });
      return Response.json(result, { headers: corsHeaders });
    }

    return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: "Failed to process schedule request" }, { status: 500, headers: corsHeaders });
  }
}

export {
  advanceNextRunAt,
  buildReminderEmail,
  buildReminderLink,
  createRoastSchedule,
  deleteRoastSchedule,
  getRoastSchedules,
  handleSchedulesRequest,
  isValidOwnerKey,
  processDueSchedules,
  sendReminderEmail,
  toD1Date
};
