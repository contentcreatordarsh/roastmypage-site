import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectWebhookPlatform,
  isAllowedWebhookUrl,
  buildNotifyPayload,
  buildTestPayload,
  fireWebhook
} from "../src/webhooks.js";

test("detectWebhookPlatform accepts Slack and Discord https URLs", () => {
  assert.equal(
    detectWebhookPlatform("https://hooks.slack.com/services/T000/B000/XXX"),
    "slack"
  );
  assert.equal(
    detectWebhookPlatform("https://discord.com/api/webhooks/123/abc"),
    "discord"
  );
  assert.equal(
    detectWebhookPlatform("https://discordapp.com/api/webhooks/123/abc"),
    "discord"
  );
});

test("isAllowedWebhookUrl rejects non-webhook hosts and http", () => {
  assert.equal(isAllowedWebhookUrl("https://evil.example/webhook"), false);
  assert.equal(isAllowedWebhookUrl("http://hooks.slack.com/services/T/B/X"), false);
  assert.equal(isAllowedWebhookUrl("not-a-url"), false);
});

test("buildNotifyPayload formats Slack blocks and Discord embeds", () => {
  const roast = {
    id: "abcd1234",
    url: "https://www.acme.com",
    overallScore: 8.2,
    scores: { hero: 9, cta: 8, trust: 8, copy: 7, design: 8 },
    quickWins: ["Sharpen the CTA", "Add social proof"]
  };
  const slack = buildNotifyPayload("slack", roast);
  assert.match(slack.text, /acme\.com/);
  assert.ok(Array.isArray(slack.blocks));
  assert.ok(slack.blocks.some((b) => b.type === "header"));

  const discord = buildNotifyPayload("discord", roast);
  assert.ok(Array.isArray(discord.embeds));
  assert.match(discord.embeds[0].title, /acme\.com/);
  assert.equal(discord.embeds[0].fields[0].name, "Quick wins");
});

test("buildTestPayload returns a valid platform payload", () => {
  const payload = buildTestPayload("slack");
  assert.ok(payload.text);
  assert.ok(payload.blocks?.length);
});

test("fireWebhook rejects disallowed URLs without fetching", async () => {
  const result = await fireWebhook("https://example.com/hook", { text: "hi" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "webhook_not_allowed");
});

test("fireWebhook posts JSON to allowed Slack URLs", async () => {
  const original = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, opts) => {
    seen = { url, body: JSON.parse(opts.body), method: opts.method };
    return new Response("ok", { status: 200 });
  };
  try {
    const result = await fireWebhook(
      "https://hooks.slack.com/services/T000/B000/XXX",
      { text: "hello" }
    );
    assert.equal(result.ok, true);
    assert.equal(seen.method, "POST");
    assert.equal(seen.body.text, "hello");
  } finally {
    globalThis.fetch = original;
  }
});
