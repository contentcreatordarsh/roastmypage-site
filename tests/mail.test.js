import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidEmail,
  sendEmail,
  welcomeTipsHtml,
  roastReportHtml,
  weeklyTipsHtml,
  sendRoastReportEmail
} from "../src/mail.js";

test("isValidEmail accepts and rejects addresses", () => {
  assert.equal(isValidEmail("a@b.co"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail(""), false);
});

test("sendEmail no-ops when EMAIL binding is missing", async () => {
  const result = await sendEmail({}, {
    to: "user@example.com",
    subject: "Hi",
    text: "Hello"
  });
  assert.equal(result.sent, false);
  assert.equal(result.reason, "EMAIL_BINDING_MISSING");
});

test("sendEmail uses Cloudflare Email Workers structured send()", async () => {
  const calls = [];
  const env = {
    EMAIL_FROM: "Roast Bot <noreply@roastmypage.site>",
    EMAIL: {
      async send(payload) {
        calls.push(payload);
        return { messageId: "msg_123" };
      }
    }
  };
  const result = await sendEmail(env, {
    to: "user@example.com",
    subject: "Your roast",
    html: "<p>Score 8/10</p>",
    text: "Score 8/10"
  });
  assert.equal(result.sent, true);
  assert.equal(result.messageId, "msg_123");
  assert.equal(calls[0].to, "user@example.com");
  assert.equal(calls[0].from.email, "noreply@roastmypage.site");
  assert.equal(calls[0].subject, "Your roast");
  assert.match(calls[0].html, /Score 8\/10/);
});

test("templates include key roast content", () => {
  const welcome = welcomeTipsHtml({ email: "a@b.co", baseUrl: "https://roastmypage.site" });
  assert.match(welcome, /You're on the list/);
  assert.match(welcome, /a@b\.co/);

  const report = roastReportHtml({
    url: "https://www.acme.com",
    score: 7.5,
    scores: { hero: 8, cta: 7, trust: 7, copy: 6, design: 7 },
    quickWins: ["Sharpen CTA"],
    shareUrl: "https://roastmypage.site/roast/abc"
  });
  assert.match(report, /acme\.com/);
  assert.match(report, /7\.5/);
  assert.match(report, /Sharpen CTA/);

  const weekly = weeklyTipsHtml({ avgScore: "6.8", roastCount: 42, baseUrl: "https://roastmypage.site" });
  assert.match(weekly, /42/);
  assert.match(weekly, /6\.8/);
});

test("sendRoastReportEmail loads roast and sends via binding", async () => {
  const env = {
    EMAIL: {
      async send() { return { messageId: "m1" }; }
    },
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async first() {
            return {
              id: "abcd1234",
              url: "https://example.com",
              overall_score: 8.1,
              hero_score: 8,
              cta_score: 8,
              trust_score: 7,
              copy_score: 8,
              design_score: 8,
              quick_wins: JSON.stringify(["Add proof"])
            };
          }
        };
      }
    }
  };
  const result = await sendRoastReportEmail(env, {
    to: "user@example.com",
    roastId: "abcd1234",
    baseUrl: "https://roastmypage.site"
  });
  assert.equal(result.sent, true);
});
