import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCms, getCmsTips, GENERIC_WEB_TIPS } from "../src/cms.js";

test("detectCms identifies WordPress from generator meta and asset paths", () => {
  const cms = detectCms({
    generator: "WordPress 6.5.4",
    assetUrls: [
      "https://example.com/wp-content/themes/acme/style.css",
      "https://example.com/wp-includes/js/jquery/jquery.min.js"
    ]
  });

  assert.equal(cms.key, "wordpress");
  assert.equal(cms.name, "WordPress");
  assert.ok(cms.confidence >= 70);
  assert.ok(cms.signals.some((signal) => signal.includes("generator")));
});

test("detectCms identifies Webflow from HTML markers", () => {
  const cms = detectCms({
    markers: ["data-wf-page=abc123", "data-wf-site=site123"],
    assetUrls: ["https://assets.website-files.com/site/webflow.js"]
  });

  assert.equal(cms.key, "webflow");
});

test("detectCms identifies Framer and Shopify from technology signals", () => {
  assert.equal(detectCms({ technologies: [{ app: "Framer", categories: [{ name: "CMS" }] }] }).key, "framer");
  assert.equal(detectCms({ techSignals: ["Shopify Plus"] }).key, "shopify");
});

test("detectCms identifies Wix from headers", () => {
  const cms = detectCms({
    headers: {
      "x-wix-request-id": "1700000000.123|abc",
      server: "Pepyaka"
    }
  });

  assert.equal(cms.key, "wix");
});

test("detectCms returns null when no CMS signal is present", () => {
  assert.equal(detectCms({
    generator: "Custom static site",
    assetUrls: ["https://cdn.example.com/app.css"],
    headers: { server: "nginx" }
  }), null);
});

test("getCmsTips maps CMS keys to actionable tips and falls back to generic tips", () => {
  const wordpressTips = getCmsTips("wordpress");
  assert.ok(wordpressTips.length >= 3);
  assert.ok(wordpressTips.some((tip) => /plugin/i.test(tip)));

  const webflowTips = getCmsTips({ key: "webflow" });
  assert.ok(webflowTips.some((tip) => /Webflow/i.test(tip)));

  assert.deepEqual(getCmsTips("unknown-cms"), GENERIC_WEB_TIPS);
});
