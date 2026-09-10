import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyStripeEvent,
  createCheckoutSession,
  publicPlans,
  signUpgradeToken,
  verifyStripeSignature,
  verifyUpgradeToken
} from "../src/billing.js";

test("publicPlans reports checkout disabled without Stripe secrets", () => {
  const plans = publicPlans({});
  assert.equal(plans.checkoutEnabled, false);
  assert.equal(plans.plans[1].id, "pro");
  assert.equal(plans.plans[1].priority, true);
  assert.equal(plans.plans[1].webhooks, true);
  assert.equal(plans.plans[1].apiDaily, 500);
});

test("signed upgrade tokens expire and bind to a key id + tier", async () => {
  const secret = "upgrade-secret";
  const exp = Math.floor(Date.now() / 1000) + 600;
  const token = await signUpgradeToken(secret, "key-1", "pro", String(exp));
  assert.equal(await verifyUpgradeToken(secret, "key-1", "pro", exp, token), true);
  assert.equal(await verifyUpgradeToken(secret, "key-2", "pro", exp, token), false);
  assert.equal(await verifyUpgradeToken(secret, "key-1", "agency", exp, token), false);
  assert.equal(await verifyUpgradeToken(secret, "key-1", "pro", Math.floor(Date.now() / 1000) - 10, token), false);
});

test("createCheckoutSession refuses unknown tiers and missing Stripe config", async () => {
  const missing = await createCheckoutSession({}, { apiKey: { id: "k1" }, tier: "pro" });
  assert.equal(missing.error, "billing_not_configured");
  const badTier = await createCheckoutSession({
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_PRICE_PRO: "price_1"
  }, { apiKey: { id: "k1" }, tier: "free" });
  assert.equal(badTier.error, "invalid_tier");
});

test("verifyStripeSignature accepts a matching v1 HMAC", async () => {
  const secret = "whsec_test";
  const payload = '{"type":"checkout.session.completed"}';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  const sig = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await verifyStripeSignature(secret, payload, `t=${timestamp},v1=${sig}`), true);
  assert.equal(await verifyStripeSignature(secret, payload, `t=${timestamp},v1=deadbeef`), false);
});

test("applyStripeEvent upgrades on checkout and downgrades on cancel", async () => {
  const rows = {
    "key-1": { id: "key-1", key_prefix: "rmp_eeeeeeee", tier: "free", label: "CI", created_at: "2026-09-10", revoked: 0 }
  };
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...values) {
            return {
              async first() {
                if (sql.includes("UPDATE api_keys")) {
                  const [tier, customer, sub, id] = values;
                  rows[id] = { ...rows[id], tier, stripe_customer_id: customer, stripe_subscription_id: sub };
                  return rows[id];
                }
                if (sql.includes("stripe_subscription_id")) {
                  return Object.values(rows).find((row) => row.stripe_subscription_id === values[0]) || null;
                }
                return rows[values[0]] || null;
              }
            };
          }
        };
      }
    }
  };

  const upgraded = await applyStripeEvent(env, {
    type: "checkout.session.completed",
    data: {
      object: {
        client_reference_id: "key-1",
        customer: "cus_1",
        subscription: "sub_1",
        metadata: { tier: "pro" }
      }
    }
  });
  assert.equal(upgraded.applied, true);
  assert.equal(upgraded.apiKey.tier, "pro");

  const canceled = await applyStripeEvent(env, {
    type: "customer.subscription.deleted",
    data: { object: { id: "sub_1" } }
  });
  assert.equal(canceled.applied, true);
  assert.equal(canceled.apiKey.tier, "free");
});
