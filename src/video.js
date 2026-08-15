/**
 * #63 — Video landing page analysis helpers.
 * Evaluates autoplay hero videos for conversion, performance, and accessibility.
 */

function bool(v) {
  return !!v;
}

function compactPageControlledSignals(item) {
  if (!item || typeof item !== "object") return item;
  const compact = { ...item };
  if (compact.kind === "embed") {
    compact.title = bool(compact.title);
  }
  if (
    compact.kind === "video" &&
    compact.preload !== "auto" &&
    compact.preload !== "metadata" &&
    compact.preload !== "none"
  ) {
    compact.preload = "metadata";
  }
  return compact;
}

/**
 * Analyze raw DOM video signals collected in the browser.
 * @param {object|null} raw
 */
export function analyzeVideoSignals(raw) {
  if (!raw || !raw.count) {
    return {
      present: false,
      count: 0,
      hasHeroVideo: false,
      hasAutoplay: false,
      score: null,
      conversion: { score: null, issues: [], notes: [] },
      performance: { score: null, issues: [], impact: 0 },
      accessibility: { score: null, issues: [], checks: [] },
      items: [],
      recommendations: []
    };
  }

  const items = Array.isArray(raw.items)
    ? raw.items.map(compactPageControlledSignals)
    : [];
  const hasHeroVideo = items.some((i) => i.inHero || i.aboveFold);
  const hasAutoplay = items.some((i) => i.autoplay);
  const hasUnmutedAutoplay = items.some((i) => i.autoplay && !i.muted);
  const missingCaptions = items.filter((i) => i.kind === "video" && !i.hasCaptions);
  const missingPoster = items.filter((i) => i.kind === "video" && !i.poster);
  const embedCount = items.filter((i) => i.kind === "embed").length;
  const nativeCount = items.filter((i) => i.kind === "video").length;

  const conversionIssues = [];
  const conversionNotes = [];
  let conversionScore = 100;

  if (hasHeroVideo) {
    conversionNotes.push("Video is used in/near the hero — strong engagement potential when intentional.");
  }
  if (hasUnmutedAutoplay) {
    conversionIssues.push("Autoplay with sound — browsers often block this and users bounce.");
    conversionScore -= 25;
  } else if (hasAutoplay && hasHeroVideo) {
    conversionNotes.push("Muted autoplay hero detected — common pattern; ensure a clear CTA still wins attention.");
    conversionScore -= 5;
  }
  if (hasHeroVideo && items.some((i) => i.autoplay && !i.playsInline)) {
    conversionIssues.push("Autoplay video missing playsinline — can break mobile hero experiences.");
    conversionScore -= 10;
  }
  if (hasHeroVideo && !items.some((i) => i.controls || i.kind === "embed")) {
    conversionNotes.push("Hero video has no controls — fine for background loops; add a pause control for accessibility.");
  }
  if (raw.count >= 3) {
    conversionIssues.push(`${raw.count} videos/embeds on the page — risk of competing with the primary CTA.`);
    conversionScore -= 10;
  }
  if (hasHeroVideo && missingPoster.length && nativeCount) {
    conversionIssues.push("Hero/native video missing poster image — empty frame before load looks broken.");
    conversionScore -= 8;
  }

  const perfIssues = [];
  let perfImpact = 0;
  let perfScore = 100;
  if (hasAutoplay && hasHeroVideo) {
    perfIssues.push("Autoplay hero video competes with LCP and can delay interactive content.");
    perfImpact += 12;
    perfScore -= 12;
  }
  if (embedCount > 0) {
    perfIssues.push(`${embedCount} third-party video embed(s) add heavy JS/network cost.`);
    perfImpact += Math.min(embedCount * 8, 20);
    perfScore -= Math.min(embedCount * 8, 20);
  }
  if (items.some((i) => i.preload === "auto")) {
    perfIssues.push('Video preload="auto" forces early download — prefer metadata/none for non-critical clips.');
    perfImpact += 8;
    perfScore -= 8;
  }
  if (raw.count >= 2) {
    perfIssues.push("Multiple videos increase bandwidth — lazy-load below-the-fold media.");
    perfImpact += 6;
    perfScore -= 6;
  }

  const a11yIssues = [];
  const a11yChecks = [];
  let a11yScore = 100;

  if (nativeCount > 0) {
    const captionPass = missingCaptions.length === 0;
    a11yChecks.push({
      name: "Captions / tracks",
      pass: captionPass,
      detail: captionPass
        ? "Native videos expose text tracks/captions"
        : `${missingCaptions.length} native video(s) missing <track kind="captions|subtitles">`
    });
    if (!captionPass) {
      a11yIssues.push("Add captions/subtitles tracks for spoken video content.");
      a11yScore -= Math.min(missingCaptions.length * 15, 30);
    }
  }

  if (hasUnmutedAutoplay) {
    a11yChecks.push({
      name: "Autoplay policy",
      pass: false,
      detail: "Autoplay with sound violates common autoplay policies and WCAG guidance"
    });
    a11yIssues.push("Never autoplay video with sound; mute by default or require a user gesture.");
    a11yScore -= 20;
  } else if (hasAutoplay) {
    a11yChecks.push({
      name: "Autoplay policy",
      pass: true,
      detail: "Autoplay is muted (preferred for policy compliance)"
    });
  } else {
    a11yChecks.push({
      name: "Autoplay policy",
      pass: true,
      detail: "No autoplay video detected"
    });
  }

  const labeledEmbeds = items.filter((i) => i.kind === "embed");
  if (labeledEmbeds.length) {
    const unlabeled = labeledEmbeds.filter((i) => !i.title);
    a11yChecks.push({
      name: "Embed titles",
      pass: unlabeled.length === 0,
      detail: unlabeled.length === 0
        ? "Video embeds have accessible titles"
        : `${unlabeled.length} embed iframe(s) missing title`
    });
    if (unlabeled.length) {
      a11yIssues.push("Add descriptive title attributes on video embed iframes.");
      a11yScore -= Math.min(unlabeled.length * 8, 16);
    }
  }

  const recommendations = [];
  if (hasUnmutedAutoplay) {
    recommendations.push("Set muted (and preferably playsinline) on autoplay hero videos.");
  }
  if (missingCaptions.length) {
    recommendations.push("Provide captions via <track kind=\"captions\"> or the embed provider’s caption settings.");
  }
  if (missingPoster.length) {
    recommendations.push("Add a poster frame so the hero isn’t blank while video buffers.");
  }
  if (embedCount || hasAutoplay) {
    recommendations.push("Lazy-load non-hero videos; keep one intentional hero clip max.");
  }
  if (hasHeroVideo) {
    recommendations.push("Keep headline + CTA readable over video — avoid text that relies on a moving frame.");
  }
  if (!recommendations.length && raw.count) {
    recommendations.push("Video setup looks solid — monitor engagement vs. bounce on the hero.");
  }

  // Composite 0-100: weight conversion / perf / a11y
  const c = Math.max(0, conversionScore);
  const p = Math.max(0, perfScore);
  const a = Math.max(0, a11yScore);
  const score = Math.round(c * 0.4 + p * 0.3 + a * 0.3);

  return {
    present: true,
    count: raw.count,
    nativeCount,
    embedCount,
    hasHeroVideo,
    hasAutoplay,
    hasUnmutedAutoplay: bool(hasUnmutedAutoplay),
    providers: [...new Set(items.map((i) => i.provider).filter(Boolean))],
    score,
    conversion: {
      score: c,
      issues: conversionIssues,
      notes: conversionNotes
    },
    performance: {
      score: p,
      issues: perfIssues,
      impact: perfImpact
    },
    accessibility: {
      score: a,
      issues: a11yIssues,
      checks: a11yChecks
    },
    items: items.slice(0, 8),
    recommendations: recommendations.slice(0, 6)
  };
}

/** Short prompt blurb for the vision model. */
export function videoPromptNote(video) {
  if (!video?.present) return "";
  const bits = [
    `${video.count} video/embed(s) detected`,
    video.hasHeroVideo ? "hero/above-fold placement" : "below-fold or secondary",
    video.hasAutoplay ? (video.hasUnmutedAutoplay ? "autoplay WITH sound" : "muted autoplay") : "no autoplay"
  ];
  if (video.providers?.length) bits.push(`providers: ${video.providers.join(", ")}`);
  return `\nVideo landing-page signals: ${bits.join("; ")}. Comment on whether video helps or hurts conversion, and call out caption/autoplay risks.`;
}
