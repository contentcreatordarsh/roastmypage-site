import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildReminderEmail,
  buildReminderLink,
  createRoastSchedule,
  handleSchedulesRequest,
  processDueSchedules
} from "../src/schedules.js";

function makeScheduleRow(overrides = {}) {
  return {
    id: "sched123",
    owner_key: "owner_key_123456",
    url: "https://example.com",
    url_hash: "hash",
    email: "founder@example.com",
    cadence: "weekly",
    next_run_at: "2026-08-01 00:00:00",
    last_roast_id: "abc12345",
    active: 1,
    ...overrides
  };
}

test("createRoastSchedule validates input and stores the next cadence run", async () => {
  let inserted;
  const env = {
    DB: {
      prepare: (sql) => ({
        bind: (...values) => {
          inserted = { sql, values };
          return { run: async () => ({ meta: { changes: 1 } }) };
        }
      })
    }
  };

  const result = await createRoastSchedule(env, {
    ownerKey: "owner_key_123456",
    url: "https://example.com",
    email: "Founder@Example.com ",
    cadence: "weekly",
    lastRoastId: "abc12345"
  }, new Date("2026-08-02T12:00:00Z"));

  assert.equal(result.error, undefined);
  assert.equal(result.schedule.url, "https://example.com");
  assert.equal(result.schedule.email, "founder@example.com");
  assert.equal(result.schedule.cadence, "weekly");
  assert.equal(result.schedule.nextRunAt, "2026-08-09 12:00:00");
  assert.match(inserted.sql, /INSERT INTO roast_schedules/);
  assert.equal(inserted.values[1], "owner_key_123456");
  assert.equal(inserted.values[4], "founder@example.com");
});

test("createRoastSchedule rejects unsafe private URLs before touching D1", async () => {
  const env = {
    DB: {
      prepare: () => {
        throw new Error("D1 should not be queried");
      }
    }
  };

  const result = await createRoastSchedule(env, {
    ownerKey: "owner_key_123456",
    url: "http://127.0.0.1",
    email: "founder@example.com",
    cadence: "weekly"
  });

  assert.match(result.error, /internal\/private/i);
});

test("buildReminderEmail links to the re-roast CTA with the URL prefilled", () => {
  const env = {
    BASE_URL: "https://roastmypage.site",
    EMAIL_FROM: "Roast My Landing Page <hello@roastmypage.site>"
  };
  const schedule = makeScheduleRow();
  const email = buildReminderEmail(env, {
    url: schedule.url,
    email: schedule.email
  });

  assert.equal(buildReminderLink(env, schedule), "https://roastmypage.site/?url=https%3A%2F%2Fexample.com");
  assert.equal(email.to, "founder@example.com");
  assert.equal(email.from, "Roast My Landing Page <hello@roastmypage.site>");
  assert.match(email.subject, /Time to re-roast https:\/\/example\.com/);
  assert.match(email.text, /\/\?url=https%3A%2F%2Fexample\.com/);
});

test("processDueSchedules sends reminders and advances due rows", async () => {
  let updated;
  let emailPayload;
  const env = {
    BASE_URL: "https://roastmypage.site",
    EMAIL_FROM: "hello@roastmypage.site",
    RESEND_API_KEY: "resend-key",
    DB: {
      prepare: (sql) => ({
        bind: (...values) => {
          if (/UPDATE roast_schedules/.test(sql)) {
            updated = { sql, values };
            return { run: async () => ({ meta: { changes: 1 } }) };
          }
          return {
            all: async () => ({ results: [makeScheduleRow()] })
          };
        }
      })
    }
  };

  const result = await processDueSchedules(env, {
    now: new Date("2026-08-02T12:00:00Z"),
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(options.headers.Authorization, "Bearer resend-key");
      emailPayload = JSON.parse(options.body);
      return { ok: true, text: async () => "" };
    }
  });

  assert.deepEqual(result.processed, [{ id: "sched123", nextRunAt: "2026-08-08 00:00:00", sent: true }]);
  assert.match(emailPayload.subject, /Time to re-roast/);
  assert.match(updated.sql, /SET next_run_at = \?/);
  assert.equal(updated.values[0], "2026-08-08 00:00:00");
  assert.equal(updated.values[1], "sched123");
});

test("handleSchedulesRequest returns 400 for invalid owner keys", async () => {
  const response = await handleSchedulesRequest(
    new Request("https://example.com/api/schedules?ownerKey=short", { method: "GET" }),
    { DB: {} }
  );
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "Invalid owner key");
});
