/**
 * Client i18n bootstrap (#34).
 * Loads catalogs from /api/i18n/:lang and applies data-i18n* attributes.
 * Exposes window.RMLP_I18N = { t, setLocale, getLocale, locales }
 */
(function () {
  const STORAGE_KEY = "rmlp_lang";
  const SUPPORTED = ["en", "es", "fr", "hi"];
  const LABELS = { en: "English", es: "Español", fr: "Français", hi: "हिन्दी" };
  const cache = Object.create(null);
  let current = "en";
  let catalog = null;

  function normalize(raw) {
    if (!raw || typeof raw !== "string") return null;
    const base = raw.trim().toLowerCase().split(/[-_]/)[0];
    return SUPPORTED.includes(base) ? base : null;
  }

  function negotiate(accept) {
    if (!accept) return null;
    const parts = String(accept).split(",").map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? parseFloat(qParam.split("=")[1]) : 1;
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 1 };
    }).sort((a, b) => b.q - a.q);
    for (const { tag } of parts) {
      const m = normalize(tag);
      if (m) return m;
    }
    return null;
  }

  function detect() {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = normalize(params.get("lang"));
      if (fromQuery) return fromQuery;
      const stored = normalize(localStorage.getItem(STORAGE_KEY));
      if (stored) return stored;
    } catch { /* ignore */ }
    return negotiate(navigator.languages?.join(",") || navigator.language) || "en";
  }

  function interpolate(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (_, name) =>
      vars && vars[name] != null ? String(vars[name]) : `{${name}}`
    );
  }

  function lookup(dict, key) {
    const parts = String(key).split(".");
    let cur = dict;
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = cur[p];
    }
    return typeof cur === "string" ? cur : undefined;
  }

  function t(key, vars) {
    const primary = catalog ? lookup(catalog, key) : undefined;
    const en = cache.en ? lookup(cache.en, key) : undefined;
    return interpolate(primary ?? en ?? key, vars || {});
  }

  function applyTranslations() {
    document.documentElement.lang = current;
    document.documentElement.setAttribute("data-locale", current);

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      const val = t(key);
      if (el.children.length === 0 || el.hasAttribute("data-i18n-force")) {
        el.textContent = val;
      } else {
        // Prefer updating a dedicated text node when mixed content exists
        const textNode = Array.from(el.childNodes).find(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim()
        );
        if (textNode) textNode.textContent = val;
        else el.textContent = val;
      }
    });

    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      if (key) el.innerHTML = t(key);
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (key) el.setAttribute("placeholder", t(key));
    });

    document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria");
      if (key) el.setAttribute("aria-label", t(key));
    });

    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (key) el.setAttribute("title", t(key));
    });

    const titleKey = document.querySelector("meta[name='i18n-title']")?.content || "meta.title";
    document.title = t(titleKey);

    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", t("meta.description"));

    const select = document.getElementById("lang-select");
    if (select && select.value !== current) select.value = current;

    // Hindi: ensure Devanagari-capable fallback is active
    document.documentElement.classList.toggle("locale-hi", current === "hi");
  }

  async function loadCatalog(locale) {
    const code = normalize(locale) || "en";
    if (cache[code]) return cache[code];
    const res = await fetch("/api/i18n/" + encodeURIComponent(code), {
      headers: { Accept: "application/json" }
    });
    if (!res.ok) throw new Error("locale_load_failed");
    const data = await res.json();
    cache[code] = data.catalog || data;
    return cache[code];
  }

  async function setLocale(locale, { persist = true, replaceUrl = true } = {}) {
    const code = normalize(locale) || "en";
    if (!cache.en) {
      try { await loadCatalog("en"); } catch { /* continue */ }
    }
    catalog = await loadCatalog(code);
    current = code;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
    }
    if (replaceUrl) {
      try {
        const u = new URL(window.location.href);
        if (code === "en") u.searchParams.delete("lang");
        else u.searchParams.set("lang", code);
        history.replaceState(null, "", u.pathname + u.search + u.hash);
      } catch { /* ignore */ }
    }
    applyTranslations();
    window.dispatchEvent(new CustomEvent("rmlp:localechange", { detail: { locale: code } }));
    return code;
  }

  function buildSwitcherOptions(select) {
    if (!select) return;
    select.innerHTML = SUPPORTED.map(
      (code) => `<option value="${code}">${LABELS[code]}</option>`
    ).join("");
    select.value = current;
    select.addEventListener("change", () => {
      setLocale(select.value).catch(() => {});
    });
  }

  async function init() {
    const initial = detect();
    try {
      await setLocale(initial, {
        persist: !!normalize(new URLSearchParams(window.location.search).get("lang")),
        replaceUrl: false
      });
      // Persist negotiated or query locale so reload keeps preference
      try {
        if (!localStorage.getItem(STORAGE_KEY) || normalize(new URLSearchParams(window.location.search).get("lang"))) {
          localStorage.setItem(STORAGE_KEY, current);
        }
      } catch { /* ignore */ }
    } catch (err) {
      console.warn("[i18n] failed to load locale", err);
      current = "en";
      applyTranslations();
    }
    buildSwitcherOptions(document.getElementById("lang-select"));
  }

  window.RMLP_I18N = {
    t,
    setLocale,
    getLocale: () => current,
    locales: SUPPORTED,
    labels: LABELS,
    applyTranslations,
    init
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { init(); });
  } else {
    init();
  }
})();
