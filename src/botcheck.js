// Bot-challenge / interstitial detection.
//
// The capture pipeline used to happily screenshot and score whatever the headless
// browser landed on. When a target sits behind Cloudflare Bot Fight Mode (or a
// similar WAF), that is a challenge interstitial — "Just a moment..." with no meta
// description and 8 resources — and the AI would confidently roast the interstitial
// instead of the real page. This module detects that case so the pipeline can fail
// honestly instead of publishing a wrong score.
//
// SCOPE: detection only. Nothing here attempts to solve, bypass, or evade a
// challenge — no token forging, no fingerprint patching, no retry-until-it-passes.
// If a site does not want to be crawled, the answer is an honest error message.

const BOT_CHALLENGE_ERROR_PREFIX = "BotProtection:";

const BOT_CHALLENGE_MESSAGE = "This site is behind bot protection, so we couldn't load the real page.";

// Titles served by challenge/deny interstitials. Anchored at the start so a real
// page whose title merely *contains* one of these words is not caught.
const CHALLENGE_TITLE_RE = /^\s*(just a moment|attention required|checking your browser|please wait|access denied|verifying you are human)/i;

// Main-document statuses that mean we never received the real page.
const CHALLENGE_STATUSES = new Set([403, 429, 503]);

// Below this much rendered text the page carries no content worth scoring. On its
// own that proves nothing (plenty of legitimate pages render late), so it only
// counts when paired with a soft challenge marker.
const NEAR_EMPTY_BODY_CHARS = 200;

/**
 * Decide whether a captured page is a bot-challenge / interstitial rather than the
 * real page. Pure function over signals collected in the browser — unit tested.
 *
 * @param {object} signals
 * @param {string} [signals.title]            document.title
 * @param {number} [signals.status]           HTTP status of the main document (0 = unknown)
 * @param {number} [signals.bodyTextLength]   length of document.body.innerText
 * @param {object} [signals.markers]          boolean DOM markers, see collectors in puppeteer.js
 * @returns {{ blocked: boolean, reasons: string[] }}
 */
function detectBotChallenge(signals = {}) {
  const title = typeof signals.title === "string" ? signals.title : "";
  const status = Number.isFinite(signals.status) ? signals.status : 0;
  const bodyTextLength = Number.isFinite(signals.bodyTextLength) ? signals.bodyTextLength : 0;
  const markers = signals.markers && typeof signals.markers === "object" ? signals.markers : {};
  const reasons = [];

  // Hard markers: these elements/scripts only exist on a challenge page.
  if (markers.cfChallengeRunning) reasons.push("#cf-challenge-running present");
  if (markers.challengeForm) reasons.push("#challenge-form present");
  if (markers.cfBrowserVerification) reasons.push("cf-browser-verification present");
  if (markers.cfChlOptScript) reasons.push("_cf_chl_opt script present");

  if (CHALLENGE_TITLE_RE.test(title)) {
    reasons.push(`challenge title (${JSON.stringify(title.slice(0, 60))})`);
  }

  if (CHALLENGE_STATUSES.has(status)) {
    reasons.push(`main document returned HTTP ${status}`);
  }

  // Soft markers only count against a page with essentially no content. A live
  // Turnstile widget or a challenge-platform script on a fully rendered page is
  // normal (login forms, contact forms) and must not block a legitimate roast.
  const softMarkers = [];
  if (markers.challengePlatformScript) softMarkers.push("cdn-cgi/challenge-platform script");
  if (markers.turnstile) softMarkers.push("Turnstile widget");
  if (markers.noscriptChallenge) softMarkers.push("enable-JS-and-cookies noscript");
  if (softMarkers.length > 0 && bodyTextLength < NEAR_EMPTY_BODY_CHARS) {
    reasons.push(`near-empty body (${bodyTextLength} chars) with ${softMarkers.join(", ")}`);
  }

  return { blocked: reasons.length > 0, reasons };
}

/** Build the sentinel error thrown by the capture pipeline. */
function botChallengeError(reasons = []) {
  const detail = reasons.length > 0 ? ` (${reasons.join("; ")})` : "";
  return new Error(`${BOT_CHALLENGE_ERROR_PREFIX} ${BOT_CHALLENGE_MESSAGE}${detail}`);
}

/** True when an error (or message) came from bot-challenge detection. */
function isBotChallengeError(error) {
  const message = typeof error === "string" ? error : error?.message || "";
  return message.startsWith(BOT_CHALLENGE_ERROR_PREFIX);
}

export {
  detectBotChallenge,
  botChallengeError,
  isBotChallengeError,
  BOT_CHALLENGE_ERROR_PREFIX,
  BOT_CHALLENGE_MESSAGE,
  CHALLENGE_TITLE_RE,
  NEAR_EMPTY_BODY_CHARS
};
