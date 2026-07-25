function finiteMetric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getComparisonMetrics(pageData) {
  const seo = pageData?.seo;
  const performance = pageData?.performance;

  return {
    hasSeo: seo != null,
    hasPerformance: performance != null,
    seoScore: finiteMetric(seo?.score),
    metaDescriptionStatus: seo?.metaDescription?.status ?? null,
    imgWithoutAlt: finiteMetric(seo?.imgWithoutAlt),
    loadTime: finiteMetric(performance?.loadTime),
    resourceCount: finiteMetric(performance?.resourceCount),
    ttfb: finiteMetric(performance?.ttfb)
  };
}

function hasMetricPair(first, second, metric) {
  return first[metric] !== null && second[metric] !== null;
}

export { getComparisonMetrics, hasMetricPair };
