/**
 * Lightweight i18n for Roast My Landing Page (#34).
 * No external framework — nested keys, {var} interpolation, locale negotiation.
 * AI roast prompts/output stay English; this covers UI chrome, SSR chrome, API errors.
 */

import en from "./locales/en.js";
import es from "./locales/es.js";
import fr from "./locales/fr.js";
import hi from "./locales/hi.js";

export const SUPPORTED_LOCALES = ["en", "es", "fr", "hi"];
export const DEFAULT_LOCALE = "en";
export const LOCALE_STORAGE_KEY = "rmlp_lang";

const CATALOGS = { en, es, fr, hi };

export const LOCALE_LABELS = {
  en: "English",
  es: "Español",
  fr: "Français",
  hi: "हिन्दी"
};

export function normalizeLocale(raw) {
  if (!raw || typeof raw !== "string") return null;
  const base = raw.trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(base) ? base : null;
}

/** Parse Accept-Language / navigator.languages into best supported locale. */
export function negotiateLocale(acceptLanguage) {
  if (!acceptLanguage) return null;
  const parts = String(acceptLanguage)
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? parseFloat(qParam.split("=")[1]) : 1;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 1 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of parts) {
    const match = normalizeLocale(tag);
    if (match) return match;
  }
  return null;
}

/**
 * Priority: ?lang= → stored preference → Accept-Language → en
 */
export function detectLocale({ searchParams, acceptLanguage, stored } = {}) {
  const fromQuery = normalizeLocale(
    searchParams?.get?.("lang") ?? searchParams?.lang ?? null
  );
  if (fromQuery) return fromQuery;

  const fromStored = normalizeLocale(stored);
  if (fromStored) return fromStored;

  return negotiateLocale(acceptLanguage) || DEFAULT_LOCALE;
}

export function detectLocaleFromRequest(request, url = null) {
  const u = url || new URL(request.url);
  return detectLocale({
    searchParams: u.searchParams,
    acceptLanguage: request.headers.get("Accept-Language")
  });
}

export function getCatalog(locale) {
  const code = normalizeLocale(locale) || DEFAULT_LOCALE;
  return CATALOGS[code] || CATALOGS[DEFAULT_LOCALE];
}

function lookup(dict, key) {
  if (!dict || !key) return undefined;
  const parts = key.split(".");
  let cur = dict;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function interpolate(template, vars = {}) {
  return String(template).replace(/\{(\w+)\}/g, (_, name) =>
    vars[name] != null ? String(vars[name]) : `{${name}}`
  );
}

/**
 * Translate a key for a locale. Falls back to English, then the raw key.
 */
export function t(localeOrDict, key, vars = {}) {
  const dict = typeof localeOrDict === "string"
    ? getCatalog(localeOrDict)
    : localeOrDict;
  const primary = lookup(dict, key);
  const fallback = lookup(CATALOGS[DEFAULT_LOCALE], key);
  const template = primary ?? fallback ?? key;
  return interpolate(template, vars);
}

export function createTranslator(locale) {
  const code = normalizeLocale(locale) || DEFAULT_LOCALE;
  const dict = getCatalog(code);
  return {
    locale: code,
    t: (key, vars) => t(dict, key, vars),
    catalog: dict
  };
}

/** Flatten nested catalog to dotted keys (for parity tests / client dumps). */
export function flattenCatalog(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flattenCatalog(v, path, out);
    } else if (typeof v === "string") {
      out[path] = v;
    }
  }
  return out;
}

export function catalogKeySet(locale = DEFAULT_LOCALE) {
  return new Set(Object.keys(flattenCatalog(getCatalog(locale))));
}
