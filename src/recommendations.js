const SCORE_CATEGORIES = ["hero", "cta", "trust", "copy", "design"];

const CATEGORY_META = {
  hero: {
    label: "Hero Section",
    testTitle: "Test a sharper above-the-fold value proposition",
    hypothesis: "A more specific headline and supporting subheadline will help visitors understand the offer faster and increase CTA engagement.",
    control: "Current hero headline, subheadline, and visual treatment.",
    variant: "Benefit-led headline with a concrete outcome, tighter subheadline, and primary CTA visible without scrolling.",
    metric: "Above-fold CTA click-through rate"
  },
  cta: {
    label: "Call to Action",
    testTitle: "Test a higher-contrast, benefit-driven CTA",
    hypothesis: "A clearer CTA treatment will reduce decision friction and move more visitors into the next step.",
    control: "Current CTA copy, placement, color, and sizing.",
    variant: "High-contrast CTA with action-oriented copy, repeated near key proof points and kept above the fold.",
    metric: "Primary CTA click-through rate"
  },
  trust: {
    label: "Trust Signals",
    testTitle: "Test stronger proof near the conversion moment",
    hypothesis: "Putting relevant proof close to the CTA will reduce anxiety and improve conversion intent.",
    control: "Current testimonials, logos, badges, and proof placement.",
    variant: "Add recognizable customer logos, one quantified testimonial, and a security or credibility cue beside the CTA.",
    metric: "Visitor-to-lead conversion rate"
  },
  copy: {
    label: "Copywriting",
    testTitle: "Test more scannable benefit-focused copy",
    hypothesis: "Shorter, benefit-led copy will help skimmers find the value quickly and continue toward the CTA.",
    control: "Current body copy structure, claims, and section order.",
    variant: "Rewrite key sections into outcome-led bullets, clearer pain points, and concise benefit statements.",
    metric: "Scroll depth and CTA click-through rate"
  },
  design: {
    label: "Visual Design",
    testTitle: "Test a clearer visual hierarchy",
    hypothesis: "A stronger hierarchy will guide attention to the message and CTA, improving comprehension and action.",
    control: "Current layout, spacing, typography, color, and visual priority.",
    variant: "Increase whitespace around the main message, simplify competing elements, and visually prioritize the CTA path.",
    metric: "CTA visibility and click-through rate"
  }
};

function benchmarkScoresFrom(benchmarks = {}) {
  return benchmarks.scores && typeof benchmarks.scores === "object" ? benchmarks.scores : benchmarks;
}

function normalizeScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return null;
  return Math.max(0, Math.min(10, score));
}

function normalizeLimit(value, fallback) {
  const limit = Number(value);
  return Number.isFinite(limit) ? Math.floor(limit) : fallback;
}

function formatGap(gap) {
  if (gap < 0) return `${Math.abs(gap).toFixed(1)} pts below benchmark`;
  if (gap > 0) return `${gap.toFixed(1)} pts above benchmark`;
  return "at benchmark";
}

function generateAbTestIdeas(scores = {}, benchmarks = {}, options = {}) {
  const benchmarkScores = benchmarkScoresFrom(benchmarks);
  const minIdeas = Math.max(0, Math.min(4, normalizeLimit(options.minIdeas, 2)));
  const maxIdeas = Math.max(minIdeas, Math.min(4, normalizeLimit(options.maxIdeas, 4)));

  const rankedCategories = SCORE_CATEGORIES.map((category) => {
    const score = normalizeScore(scores[category]);
    const benchmark = normalizeScore(benchmarkScores[category]);
    if (score === null || benchmark === null) return null;
    const gap = Number((score - benchmark).toFixed(1));
    return {
      category,
      score,
      benchmark,
      gap,
      belowBenchmark: gap < 0
    };
  }).filter(Boolean).sort((a, b) => {
    if (a.gap !== b.gap) return a.gap - b.gap;
    return a.score - b.score;
  });

  if (rankedCategories.length === 0 || maxIdeas === 0) return [];

  const belowBenchmark = rankedCategories.filter((item) => item.belowBenchmark);
  const selected = [];
  for (const item of belowBenchmark) {
    if (selected.length >= maxIdeas) break;
    selected.push(item);
  }
  for (const item of rankedCategories) {
    if (selected.length >= Math.min(minIdeas, rankedCategories.length) || selected.length >= maxIdeas) break;
    if (!selected.some((selectedItem) => selectedItem.category === item.category)) {
      selected.push(item);
    }
  }

  return selected.map((item) => {
    const meta = CATEGORY_META[item.category];
    return {
      category: item.category,
      categoryLabel: meta.label,
      score: item.score,
      benchmark: item.benchmark,
      gap: item.gap,
      gapLabel: formatGap(item.gap),
      title: meta.testTitle,
      hypothesis: meta.hypothesis,
      variants: {
        control: meta.control,
        variant: meta.variant
      },
      metric: meta.metric
    };
  });
}

export { SCORE_CATEGORIES, CATEGORY_META, generateAbTestIdeas };
