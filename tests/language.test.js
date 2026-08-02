import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectPageLanguage,
  isHighConfidenceLanguage,
  normalizeLanguageTag
} from "../src/language.js";

test("normalizeLanguageTag normalizes common HTML and Open Graph forms", () => {
  assert.equal(normalizeLanguageTag("fr-FR"), "fr-FR");
  assert.equal(normalizeLanguageTag("pt_BR"), "pt-BR");
  assert.equal(normalizeLanguageTag("zh_Hant_TW"), "zh-Hant-TW");
  assert.equal(normalizeLanguageTag("es-MX, en;q=0.8"), "es-MX");
});

test("detectPageLanguage prefers html lang over meta hints", () => {
  const detected = detectPageLanguage({
    htmlLang: "de-DE",
    metaLanguage: "fr",
    contentLanguage: "es"
  });

  assert.deepEqual(detected, {
    code: "de-DE",
    name: "German",
    confidence: 0.95,
    source: "html lang",
    raw: "de-DE",
    direction: "ltr"
  });
});

test("detectPageLanguage falls back to meta language hints", () => {
  const detected = detectPageLanguage({
    htmlLang: "",
    metaLanguage: "",
    contentLanguage: "es-MX",
    ogLocale: "fr_FR"
  });

  assert.equal(detected.code, "es-MX");
  assert.equal(detected.name, "Spanish");
  assert.equal(detected.source, "content-language meta");
  assert.equal(isHighConfidenceLanguage(detected), true);
});

test("detectPageLanguage returns null for missing or invalid hints", () => {
  assert.equal(detectPageLanguage({}), null);
  assert.equal(detectPageLanguage({ htmlLang: "not_a_language" }), null);
});

test("detectPageLanguage marks right-to-left languages", () => {
  const detected = detectPageLanguage({ htmlLang: "ar" });

  assert.equal(detected.name, "Arabic");
  assert.equal(detected.direction, "rtl");
});
