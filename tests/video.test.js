import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeVideoSignals, videoPromptNote, redactVideoItemUrls } from "../src/video.js";

test("analyzeVideoSignals returns empty shape when no videos", () => {
  const result = analyzeVideoSignals({ count: 0, items: [] });
  assert.equal(result.present, false);
  assert.equal(result.count, 0);
  assert.equal(result.score, null);
});

test("analyzeVideoSignals flags unmuted autoplay hero risks", () => {
  const result = analyzeVideoSignals({
    count: 1,
    items: [{
      kind: "video",
      provider: "html5",
      autoplay: true,
      muted: false,
      playsInline: false,
      poster: "",
      preload: "auto",
      hasCaptions: false,
      aboveFold: true,
      inHero: true
    }]
  });
  assert.equal(result.present, true);
  assert.equal(result.hasHeroVideo, true);
  assert.equal(result.hasUnmutedAutoplay, true);
  assert.ok(result.conversion.score < 90);
  assert.ok(result.accessibility.score < 90);
  assert.ok(result.performance.impact > 0);
  assert.ok(result.recommendations.length >= 1);
});

test("analyzeVideoSignals rewards muted autoplay with captions", () => {
  const good = analyzeVideoSignals({
    count: 1,
    items: [{
      kind: "video",
      provider: "html5",
      autoplay: true,
      muted: true,
      playsInline: true,
      poster: "/poster.jpg",
      preload: "metadata",
      hasCaptions: true,
      aboveFold: true,
      inHero: true
    }]
  });
  assert.equal(good.present, true);
  assert.ok(good.score >= 80);
  assert.equal(good.accessibility.issues.length, 0);
});

test("analyzeVideoSignals bounds attacker-controlled poster attributes", () => {
  const oversizedPoster = `data:image/jpeg;base64,${"a".repeat(1_000_000)}`;
  const result = analyzeVideoSignals({
    count: 1,
    items: [{
      kind: "video",
      provider: "html5",
      poster: oversizedPoster,
      aboveFold: true,
      inHero: true
    }]
  });

  assert.equal(result.items[0].poster, true);
  assert.equal(typeof result.items[0].poster, "boolean");
  assert.ok(JSON.stringify(result).length < 2_000);
  assert.equal(JSON.stringify(result).includes(oversizedPoster), false);
});

test("analyzeVideoSignals bounds page-controlled title and preload metadata", () => {
  const oversized = "x".repeat(1_000_000);
  const result = analyzeVideoSignals({
    count: 2,
    items: [
      {
        kind: "embed",
        provider: "youtube",
        title: oversized,
        aboveFold: true
      },
      {
        kind: "video",
        provider: "html5",
        preload: oversized,
        aboveFold: true
      }
    ]
  });

  assert.equal(result.items[0].title, true);
  assert.equal(result.items[1].preload, "metadata");
  assert.ok(JSON.stringify(result).length < 2_000);
  assert.equal(JSON.stringify(result).includes(oversized), false);
});

test("videoPromptNote summarizes detected signals", () => {
  const note = videoPromptNote({
    present: true,
    count: 2,
    hasHeroVideo: true,
    hasAutoplay: true,
    hasUnmutedAutoplay: false,
    providers: ["youtube", "html5"]
  });
  assert.match(note, /Video landing-page signals/);
  assert.match(note, /muted autoplay/);
  assert.match(note, /youtube/);
});

test("analyzeVideoSignals strips embed URLs from persisted analysis", () => {
  const result = analyzeVideoSignals({
    count: 1,
    items: [{
      kind: "embed",
      provider: "video-host",
      src: "https://video.example/embed/123?token=signed-value",
      autoplay: false,
      muted: false,
      aboveFold: true,
      inHero: true
    }]
  });

  assert.equal(result.present, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].provider, "video-host");
  assert.equal("src" in result.items[0], false);
  assert.doesNotMatch(JSON.stringify(result), /signed-value/);
});

test("redactVideoItemUrls sanitizes historical stored analysis", () => {
  const sanitized = redactVideoItemUrls({
    present: true,
    items: [{
      kind: "embed",
      provider: "video-host",
      src: "https://video.example/embed/old?signature=historical-value"
    }]
  });

  assert.equal(sanitized.items[0].provider, "video-host");
  assert.equal("src" in sanitized.items[0], false);
  assert.doesNotMatch(JSON.stringify(sanitized), /historical-value/);
});
