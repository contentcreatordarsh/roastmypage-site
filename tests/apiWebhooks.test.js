import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRoastWebhookUrl, isPaidWebhookUrl } from "../src/apiWebhooks.js";

test("isPaidWebhookUrl requires public HTTPS and blocks SSRF targets", () => {
  assert.equal(isPaidWebhookUrl("https://hooks.example.com/roast"), true);
  assert.equal(isPaidWebhookUrl("http://hooks.example.com/roast"), false);
  assert.equal(isPaidWebhookUrl("https://127.0.0.1/hook"), false);
  assert.equal(isPaidWebhookUrl("https://169.254.169.254/latest"), false);
  assert.equal(isPaidWebhookUrl("https://roastmypage.site/api/v1/roast"), false);
  assert.equal(isPaidWebhookUrl("not-a-url"), false);
});

test("extractRoastWebhookUrl accepts callbackUrl aliases", () => {
  assert.equal(extractRoastWebhookUrl({ callbackUrl: " https://hooks.example.com/a " }), "https://hooks.example.com/a");
  assert.equal(extractRoastWebhookUrl({ webhookUrl: "https://hooks.example.com/b" }), "https://hooks.example.com/b");
  assert.equal(extractRoastWebhookUrl({ callback_url: "https://hooks.example.com/c" }), "https://hooks.example.com/c");
  assert.equal(extractRoastWebhookUrl({}), "");
});
