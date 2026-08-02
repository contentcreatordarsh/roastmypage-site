const SCORE_CATEGORIES = [
  { key: "overall", label: "Overall" },
  { key: "hero", label: "Hero" },
  { key: "cta", label: "CTA" },
  { key: "trust", label: "Trust" },
  { key: "copy", label: "Copy" },
  { key: "design", label: "Design" }
];

function asScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Number(score.toFixed(1)) : null;
}

function readScore(roast, key) {
  if (!roast) return null;
  if (key === "overall") {
    return asScore(roast.overallScore ?? roast.score ?? roast.overall_score);
  }
  return asScore(roast.scores?.[key] ?? roast[`${key}_score`]);
}

function deltaDirection(change) {
  if (change > 0) return "up";
  if (change < 0) return "down";
  return "flat";
}

function computeScoreDeltas(previous, current) {
  const deltas = {};
  for (const category of SCORE_CATEGORIES) {
    const previousScore = readScore(previous, category.key);
    const currentScore = readScore(current, category.key);
    if (previousScore === null || currentScore === null) continue;
    const change = Number((currentScore - previousScore).toFixed(1));
    deltas[category.key] = {
      label: category.label,
      previous: previousScore,
      current: currentScore,
      change,
      direction: deltaDirection(change)
    };
  }
  return deltas;
}

function formatRoastForDiff(roast) {
  if (!roast) return null;
  return {
    id: roast.id,
    url: roast.url,
    urlHash: roast.urlHash ?? roast.url_hash ?? null,
    score: readScore(roast, "overall"),
    overallScore: readScore(roast, "overall"),
    scores: {
      hero: readScore(roast, "hero"),
      cta: readScore(roast, "cta"),
      trust: readScore(roast, "trust"),
      copy: readScore(roast, "copy"),
      design: readScore(roast, "design")
    },
    date: roast.createdAt ?? roast.created_at ?? null,
    createdAt: roast.createdAt ?? roast.created_at ?? null,
    screenshotUrl: roast.screenshotUrl ?? (roast.id ? `/api/screenshot/${roast.id}` : null)
  };
}

function buildRoastDiff(previous, current) {
  const formattedCurrent = formatRoastForDiff(current);
  const formattedPrevious = formatRoastForDiff(previous);
  return {
    previous: formattedPrevious,
    current: formattedCurrent,
    deltas: formattedPrevious && formattedCurrent ? computeScoreDeltas(formattedPrevious, formattedCurrent) : null
  };
}

function numericCategoryChanges(deltas) {
  if (!deltas) return {};
  return Object.fromEntries(
    SCORE_CATEGORIES
      .filter((category) => category.key !== "overall" && deltas[category.key])
      .map((category) => [category.key, deltas[category.key].change])
  );
}

export { SCORE_CATEGORIES, computeScoreDeltas, formatRoastForDiff, buildRoastDiff, numericCategoryChanges };
