import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE,
  normalizeLocale,
  negotiateLocale,
  detectLocale,
  t,
  createTranslator,
  catalogKeySet,
  flattenCatalog,
  getCatalog
} from "../src/i18n.js";

test("normalizeLocale accepts BCP-47 prefixes", () => {
  assert.equal(normalizeLocale("es-MX"), "es");
  assert.equal(normalizeLocale("fr_CA"), "fr");
  assert.equal(normalizeLocale("HI"), "hi");
  assert.equal(normalizeLocale("xx"), null);
  assert.equal(normalizeLocale(""), null);
});

test("negotiateLocale picks highest-q supported language", () => {
  assert.equal(negotiateLocale("fr-FR,fr;q=0.9,en;q=0.8"), "fr");
  assert.equal(negotiateLocale("de-DE,de;q=0.9"), null);
  assert.equal(negotiateLocale("hi-IN,en;q=0.5"), "hi");
});

test("detectLocale priority: query > stored > Accept-Language > en", () => {
  assert.equal(
    detectLocale({
      searchParams: new URLSearchParams("lang=es"),
      acceptLanguage: "fr",
      stored: "hi"
    }),
    "es"
  );
  assert.equal(
    detectLocale({
      searchParams: new URLSearchParams(""),
      acceptLanguage: "fr",
      stored: "hi"
    }),
    "hi"
  );
  assert.equal(
    detectLocale({
      searchParams: new URLSearchParams(""),
      acceptLanguage: "fr-FR,en;q=0.5",
      stored: null
    }),
    "fr"
  );
  assert.equal(detectLocale({}), DEFAULT_LOCALE);
  assert.equal(
    detectLocale({ searchParams: new URLSearchParams("lang=xx") }),
    DEFAULT_LOCALE
  );
});

test("t interpolates variables and falls back to English", () => {
  assert.equal(
    t("es", "errors.rateLimited", { minutes: 5 }),
    "Límite de solicitudes excedido. Inténtalo en 5 minutos."
  );
  assert.equal(t("en", "toast.enterUrl"), "Please enter a URL");
  // Unknown key falls back to key string
  assert.equal(t("en", "does.not.exist"), "does.not.exist");
});

test("createTranslator binds a locale", () => {
  const { locale, t: tr } = createTranslator("fr");
  assert.equal(locale, "fr");
  assert.equal(tr("nav.gallery"), "Galerie");
});

test("all locales share the same key set as English", () => {
  const enKeys = catalogKeySet("en");
  assert.ok(enKeys.size > 50);
  for (const locale of SUPPORTED_LOCALES) {
    const keys = catalogKeySet(locale);
    const missing = [...enKeys].filter((k) => !keys.has(k));
    const extra = [...keys].filter((k) => !enKeys.has(k));
    assert.deepEqual(missing, [], `${locale} missing keys: ${missing.join(", ")}`);
    assert.deepEqual(extra, [], `${locale} extra keys: ${extra.join(", ")}`);
  }
});

test("flattenCatalog produces dotted paths", () => {
  const flat = flattenCatalog(getCatalog("en"));
  assert.equal(flat["hero.roastIt"], "Roast It");
  assert.equal(flat["ssr.notFoundTitle"], "Roast Not Found");
});
