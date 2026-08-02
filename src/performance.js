const CORE_WEB_VITAL_THRESHOLDS = {
  lcp: {
    label: "Largest Contentful Paint (LCP)",
    good: 2500,
    poor: 4000,
    unit: "ms"
  },
  fcp: {
    label: "First Contentful Paint (FCP)",
    good: 1800,
    poor: 3000,
    unit: "ms"
  },
  ttfb: {
    label: "Time to First Byte (TTFB)",
    good: 800,
    poor: 1800,
    unit: "ms"
  }
};

function finiteTiming(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function gradeCoreWebVital(metric, value) {
  const thresholds = CORE_WEB_VITAL_THRESHOLDS[metric];
  const timing = finiteTiming(value);
  if (!thresholds || timing === null) return "not-available";
  if (timing <= thresholds.good) return "good";
  if (timing <= thresholds.poor) return "needs-improvement";
  return "poor";
}

function buildCoreWebVitals(timings = {}) {
  return Object.fromEntries(
    Object.entries(CORE_WEB_VITAL_THRESHOLDS).map(([metric, thresholds]) => {
      const value = finiteTiming(timings[metric]);
      return [metric, {
        label: thresholds.label,
        value,
        unit: thresholds.unit,
        rating: gradeCoreWebVital(metric, value),
        thresholds: {
          good: thresholds.good,
          poor: thresholds.poor
        }
      }];
    })
  );
}

export {
  CORE_WEB_VITAL_THRESHOLDS,
  buildCoreWebVitals,
  finiteTiming,
  gradeCoreWebVital
};
