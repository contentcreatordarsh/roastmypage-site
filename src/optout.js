import {
  generateId,
  hashUrl,
  isValidRoastIdLoose,
  isValidUrl,
  normalizeUrl,
  sanitizeUrl
} from './utils.js';

const OPTOUT_HASH_DEVICES = [
  "desktop",
  "desktop-full",
  "tablet",
  "tablet-full",
  "mobile",
  "mobile-full"
];

class OptOutValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "OptOutValidationError";
    this.status = 400;
  }
}

function normalizeOptOutUrl(rawUrl) {
  if (typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return "";
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const sanitized = sanitizeUrl(withScheme);
  if (!sanitized || !isValidUrl(sanitized)) return "";
  return normalizeUrl(sanitized);
}

function normalizeOptOutEmail(rawEmail) {
  if (rawEmail === undefined || rawEmail === null || rawEmail === "") return "";
  if (typeof rawEmail !== "string") {
    throw new OptOutValidationError("Email must be a string");
  }
  const email = rawEmail.trim().toLowerCase();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (email.length > 254 || !emailRegex.test(email)) {
    throw new OptOutValidationError("Please provide a valid email address");
  }
  return email;
}

async function getOptOutUrlHash(normalizedUrl) {
  return hashUrl(normalizedUrl, "optout");
}

async function getRoastUrlHashes(normalizedUrl) {
  return Promise.all(OPTOUT_HASH_DEVICES.map((device) => hashUrl(normalizedUrl, device)));
}

async function parseOptOutRequestBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new OptOutValidationError("Request body must be an object");
  }
  const email = normalizeOptOutEmail(body.email);
  const roastId = typeof body.roastId === "string" ? body.roastId.trim() : "";
  if (roastId) {
    if (!isValidRoastIdLoose(roastId)) {
      throw new OptOutValidationError("Please provide a valid roast ID");
    }
    return { type: "roastId", roastId, email };
  }
  const normalizedUrl = normalizeOptOutUrl(body.url);
  if (!normalizedUrl) {
    throw new OptOutValidationError("Please provide a valid URL or roast ID");
  }
  return {
    type: "url",
    url: normalizedUrl,
    urlHash: await getOptOutUrlHash(normalizedUrl),
    email
  };
}

function addRows(rowsById, rows) {
  for (const row of rows || []) {
    if (row?.id) rowsById.set(row.id, row);
  }
}

async function findRoastsById(env, roastId) {
  const roast = await env.DB.prepare(`
    SELECT id, url, url_hash, screenshot_key
    FROM roasts
    WHERE id = ?
  `).bind(roastId).first();
  return roast ? [roast] : [];
}

async function findRoastsByUrl(env, normalizedUrl) {
  const rowsById = new Map();
  const urlHashes = await getRoastUrlHashes(normalizedUrl);
  const placeholders = urlHashes.map(() => "?").join(", ");
  const byHash = await env.DB.prepare(`
    SELECT id, url, url_hash, screenshot_key
    FROM roasts
    WHERE url_hash IN (${placeholders})
  `).bind(...urlHashes).all();
  addRows(rowsById, byHash.results);

  const parsedUrl = new URL(normalizedUrl);
  const originPrefix = `${parsedUrl.protocol}//${parsedUrl.hostname.toLowerCase()}%`;
  const byOrigin = await env.DB.prepare(`
    SELECT id, url, url_hash, screenshot_key
    FROM roasts
    WHERE LOWER(url) LIKE ?
  `).bind(originPrefix).all();
  const normalizedRows = (byOrigin.results || []).filter((row) => {
    return normalizeOptOutUrl(row.url) === normalizedUrl;
  });
  addRows(rowsById, normalizedRows);

  return Array.from(rowsById.values());
}

function screenshotKeysForRoasts(roasts) {
  const keys = new Set();
  for (const roast of roasts) {
    if (roast.screenshot_key) keys.add(roast.screenshot_key);
    if (roast.id) {
      keys.add(`screenshots/${roast.id}.jpg`);
      keys.add(`screenshots/${roast.id}.png`);
    }
  }
  return Array.from(keys);
}

async function deleteScreenshots(env, roasts) {
  if (!env.SCREENSHOTS?.delete) {
    return { screenshotsDeleted: 0, screenshotErrors: screenshotKeysForRoasts(roasts).length };
  }
  let screenshotsDeleted = 0;
  let screenshotErrors = 0;
  for (const key of screenshotKeysForRoasts(roasts)) {
    try {
      await env.SCREENSHOTS.delete(key);
      screenshotsDeleted += 1;
    } catch (error) {
      screenshotErrors += 1;
      console.warn("Opt-out screenshot deletion failed:", key, error?.message || error);
    }
  }
  return { screenshotsDeleted, screenshotErrors };
}

async function deleteRoasts(env, roasts) {
  const ids = roasts.map((roast) => roast.id).filter(Boolean);
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(", ");
  const result = await env.DB.prepare(`
    DELETE FROM roasts
    WHERE id IN (${placeholders})
  `).bind(...ids).run();
  return result?.meta?.changes ?? ids.length;
}

async function logOptOutRequest(env, { url = null, urlHash = null, email = "" }) {
  try {
    await env.DB.prepare(`
      INSERT INTO opt_outs (id, url, url_hash, email)
      VALUES (?, ?, ?, ?)
    `).bind(generateId(), url, urlHash, email || null).run();
  } catch (error) {
    console.warn("Opt-out request logging failed:", error?.message || error);
  }
}

async function deleteRoastsAndScreenshots(env, roasts) {
  const screenshotResult = await deleteScreenshots(env, roasts);
  const deletedCount = await deleteRoasts(env, roasts);
  return { deletedCount, ...screenshotResult };
}

async function processOptOutRequest(env, body) {
  const parsed = await parseOptOutRequestBody(body);
  let roasts = [];
  let logUrl = parsed.url || null;
  let logUrlHash = parsed.urlHash || null;

  if (parsed.type === "roastId") {
    roasts = await findRoastsById(env, parsed.roastId);
    if (roasts[0]?.url) {
      logUrl = normalizeOptOutUrl(roasts[0].url) || roasts[0].url;
      logUrlHash = logUrl ? await getOptOutUrlHash(logUrl) : null;
    }
  } else {
    roasts = await findRoastsByUrl(env, parsed.url);
  }

  await logOptOutRequest(env, { url: logUrl, urlHash: logUrlHash, email: parsed.email });
  const deletion = await deleteRoastsAndScreenshots(env, roasts);

  return {
    success: true,
    target: parsed.type === "roastId" ? { roastId: parsed.roastId } : { url: parsed.url },
    matched: roasts.length,
    deleted: deletion.deletedCount,
    screenshotsDeleted: deletion.screenshotsDeleted,
    screenshotErrors: deletion.screenshotErrors
  };
}

export {
  OptOutValidationError,
  deleteRoastsAndScreenshots,
  findRoastsByUrl,
  getRoastUrlHashes,
  normalizeOptOutEmail,
  normalizeOptOutUrl,
  parseOptOutRequestBody,
  processOptOutRequest,
  screenshotKeysForRoasts
};
