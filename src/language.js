const LANGUAGE_NAMES = {
  ar: "Arabic",
  de: "German",
  en: "English",
  es: "Spanish",
  fr: "French",
  hi: "Hindi",
  id: "Indonesian",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  nl: "Dutch",
  pl: "Polish",
  pt: "Portuguese",
  ru: "Russian",
  sv: "Swedish",
  tr: "Turkish",
  uk: "Ukrainian",
  vi: "Vietnamese",
  zh: "Chinese"
};

const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);

function getFirstLanguageToken(rawValue) {
  if (!rawValue) return "";
  return String(rawValue)
    .trim()
    .split(",")[0]
    .split(";")[0]
    .trim()
    .replace(/^["']|["']$/g, "");
}

function normalizeLanguageTag(rawValue) {
  const token = getFirstLanguageToken(rawValue).replace(/_/g, "-");
  if (!token) return null;

  const parts = token.split("-").filter(Boolean);
  const primary = parts[0]?.toLowerCase();
  if (!primary || !/^[a-z]{2,3}$/.test(primary)) return null;
  if (primary.length === 3 && !LANGUAGE_NAMES[primary]) return null;

  const normalizedParts = [primary];
  for (const part of parts.slice(1, 4)) {
    if (/^[a-z]{4}$/i.test(part)) {
      normalizedParts.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
    } else if (/^[a-z]{2}$/i.test(part)) {
      normalizedParts.push(part.toUpperCase());
    } else if (/^\d{3}$/.test(part)) {
      normalizedParts.push(part);
    } else if (/^[a-z0-9]{5,8}$/i.test(part)) {
      normalizedParts.push(part.toLowerCase());
    }
  }

  return normalizedParts.join("-");
}

function getLanguageName(code) {
  const primary = String(code || "").split("-")[0].toLowerCase();
  return LANGUAGE_NAMES[primary] || String(code || "").toUpperCase();
}

function detectPageLanguage(hints = {}) {
  const candidates = [
    { raw: hints.htmlLang, source: "html lang", confidence: 0.95 },
    { raw: hints.metaLanguage, source: "meta language", confidence: 0.85 },
    { raw: hints.contentLanguage, source: "content-language meta", confidence: 0.85 },
    { raw: hints.ogLocale, source: "og:locale", confidence: 0.8 }
  ];

  for (const candidate of candidates) {
    const code = normalizeLanguageTag(candidate.raw);
    if (!code) continue;
    const primary = code.split("-")[0].toLowerCase();
    return {
      code,
      name: getLanguageName(code),
      confidence: candidate.confidence,
      source: candidate.source,
      raw: String(candidate.raw).trim(),
      direction: RTL_LANGUAGES.has(primary) ? "rtl" : "ltr"
    };
  }

  return null;
}

function isHighConfidenceLanguage(pageLanguage) {
  return !!pageLanguage?.code && Number(pageLanguage.confidence || 0) >= 0.8;
}

export { detectPageLanguage, getLanguageName, isHighConfidenceLanguage, normalizeLanguageTag };
