const POPULAR_DOMAINS = /* @__PURE__ */ new Set([
  "stripe.com",
  "linear.app",
  "notion.so",
  "figma.com",
  "vercel.com",
  "github.com",
  "gitlab.com",
  "cloudflare.com",
  "netlify.com",
  "heroku.com",
  "shopify.com",
  "squarespace.com",
  "wix.com",
  "webflow.com",
  "framer.com",
  "tailwindcss.com",
  "nextjs.org",
  "react.dev",
  "vuejs.org",
  "svelte.dev",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "producthunt.com",
  "ycombinator.com"
]);
const CONFIG = {
  // Per-user rate limits
  RATE_LIMIT_MAX_REQUESTS: 30,
  // Reduced: Per user per hour for single roast
  RATE_LIMIT_COMPARE_MAX: 5,
  // NEW: Compare uses 2x resources
  RATE_LIMIT_BATCH_MAX: 3,
  // NEW: Batch uses up to 5x resources
  RATE_LIMIT_FEEDBACK_MAX: 20,
  // Feedback submissions per hour
  RATE_LIMIT_SUBSCRIBE_MAX: 10,
  // Email subscribe per hour
  RATE_LIMIT_THREAT_MAX: 10,
  // Threat scans per hour
  RATE_LIMIT_WINDOW_MINUTES: 60,
  // Global limits (circuit breaker)
  GLOBAL_HOURLY_LIMIT: 2e3,
  // NEW: Max requests/hour globally
  GLOBAL_DAILY_BROWSER_LIMIT: 1e4,
  // NEW: Max browser sessions/day
  // Caching
  CACHE_TTL_HOURS: 168,
  // 7 days cache
  // Browser settings
  SCREENSHOT_TIMEOUT_MS: 3e4,
  // Reduced from 45s — top-level timeout guards overall
  SCREENSHOT_QUALITY: 60,
  // Reduced for faster AI inference (smaller image)
  MAX_RETRIES: 2,
  // Reduced from 3 — top-level timeout guards overall
  RETRY_DELAY_MS: 1500,
  // Reduced from 2000
  BROWSER_RETRY_DELAY_MS: 2e3,
  // Reduced from 3000
  MAX_BROWSER_RETRIES: 2,
  // Reduced from 3 — faster fail, top-level timeout guards
  MAX_BATCH_URLS: 3,
  // Reduced from 5 to save costs
  // Storage limits
  MAX_SCREENSHOT_BYTES: 5 * 1024 * 1024,
  // 5MB — reject screenshots larger than this to prevent storage abuse
  // AI settings
  AI_MAX_TOKENS: 1536,
  // Reduced from 2500 — compact prompt needs less output
  AI_TIMEOUT_MS: 45e3,
  // 45s — give vision model a real chance (one shot, no fallback)
  RADAR_TIMEOUT_MS: 5e3,
  // 5s timeout for Radar API calls
  ROAST_TOTAL_TIMEOUT_MS: 65e3,
  // 65s max — allows 15s screenshot + 45s AI + buffer
  COMPARE_TOTAL_TIMEOUT_MS: 9e4,
  // 90s max for entire compare operation
  // Feature flags — set to false to easily revert features
  ENABLE_COMPUTED_INDUSTRY_BENCHMARKS: true,
  // Use real-time computed benchmarks from roast data instead of static values
  ENABLE_PERCENTILE_RANKING: true
  // Show "better than X% of pages" ranking on results
};
const VIEWPORTS = {
  desktop: { width: 1280, height: 720 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 667 }
};

const RUBRIC_CRITERIA = {
  hero: ["Headline clarity", "Subheadline support", "Hero visual", "Above-fold content", "Value proposition"],
  cta: ["Button visibility", "Action-oriented copy", "Urgency/scarcity", "Placement & repetition", "Contrast & size"],
  trust: ["Social proof", "Authority signals", "Security indicators", "Specificity & data", "Third-party validation"],
  copy: ["Clarity & readability", "Benefit focus", "Scannable structure", "Emotional hooks", "Grammar & tone"],
  design: ["Visual hierarchy", "Whitespace balance", "Color & contrast", "Typography", "Mobile readiness"]
};

const INDUSTRY_BENCHMARKS = {
  saas: { label: "SaaS", emoji: "\u{1F4BB}", scores: { hero: 6.8, cta: 6.2, trust: 5.5, copy: 6.5, design: 6.9 }, seo: 72, performance: 68, accessibility: 65 },
  ecommerce: { label: "E-Commerce", emoji: "\u{1F6D2}", scores: { hero: 6.2, cta: 7.1, trust: 6.8, copy: 5.8, design: 6.5 }, seo: 75, performance: 58, accessibility: 60 },
  agency: { label: "Agency / Services", emoji: "\u{1F3E2}", scores: { hero: 7, cta: 5.5, trust: 5.8, copy: 6.2, design: 7.5 }, seo: 65, performance: 62, accessibility: 58 },
  fintech: { label: "Fintech", emoji: "\u{1F4B0}", scores: { hero: 6, cta: 5.8, trust: 7.2, copy: 6, design: 6.4 }, seo: 70, performance: 65, accessibility: 68 },
  health: { label: "Health & Wellness", emoji: "\u{1F3E5}", scores: { hero: 6.5, cta: 6, trust: 6.5, copy: 6.8, design: 6.2 }, seo: 68, performance: 60, accessibility: 62 },
  education: { label: "Education / EdTech", emoji: "\u{1F4DA}", scores: { hero: 6.3, cta: 5.5, trust: 6, copy: 7, design: 6 }, seo: 70, performance: 63, accessibility: 70 },
  media: { label: "Media / Publishing", emoji: "\u{1F4F0}", scores: { hero: 6.8, cta: 4.8, trust: 5.2, copy: 7.2, design: 7 }, seo: 78, performance: 55, accessibility: 58 },
  startup: { label: "Startup / Landing Page", emoji: "\u{1F680}", scores: { hero: 6.5, cta: 6, trust: 4.5, copy: 6, design: 6.8 }, seo: 58, performance: 65, accessibility: 55 },
  devtools: { label: "Developer Tools", emoji: "\u{1F6E0}\uFE0F", scores: { hero: 6.2, cta: 5.5, trust: 5.8, copy: 6.8, design: 7.2 }, seo: 68, performance: 72, accessibility: 62 },
  marketplace: { label: "Marketplace", emoji: "\u{1F3EA}", scores: { hero: 6, cta: 6.5, trust: 6.2, copy: 5.5, design: 6 }, seo: 73, performance: 55, accessibility: 58 },
  nonprofit: { label: "Nonprofit", emoji: "\u{1F49A}", scores: { hero: 5.8, cta: 5.2, trust: 6.8, copy: 6.5, design: 5.5 }, seo: 60, performance: 58, accessibility: 65 },
  other: { label: "All Industries", emoji: "\u{1F310}", scores: { hero: 6.3, cta: 5.8, trust: 5.8, copy: 6.3, design: 6.5 }, seo: 68, performance: 62, accessibility: 62 }
};

const INDUSTRY_KEYS = Object.keys(INDUSTRY_BENCHMARKS);

const PRODUCTION_ORIGINS = [
  "https://roastmypage.site",
  "https://roast-my-landing-page.falling-hall-ac41.workers.dev",
  "https://roast-my-landing-page-test.falling-hall-ac41.workers.dev"
];

const DEV_ORIGINS = [
  "http://localhost:8787",
  "http://127.0.0.1:8787"
];

const API_V1_LIMITS = {
  PER_IP_DAILY: 5,
  GLOBAL_DAILY: 50
};

export { POPULAR_DOMAINS, CONFIG, VIEWPORTS, RUBRIC_CRITERIA, INDUSTRY_BENCHMARKS, INDUSTRY_KEYS, PRODUCTION_ORIGINS, DEV_ORIGINS, API_V1_LIMITS };
