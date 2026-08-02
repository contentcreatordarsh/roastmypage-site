const GENERIC_WEB_TIPS = [
  "Keep the above-the-fold message focused on one audience, one outcome, and one primary call to action.",
  "Compress hero images, defer non-critical scripts, and keep third-party tags lean so the first screen loads fast.",
  "Add proof near the first CTA: testimonials, customer logos, review counts, security badges, or a concise guarantee."
];

const CMS_DEFINITIONS = {
  wordpress: {
    name: "WordPress",
    tech: ["wordpress", "woocommerce", "elementor", "wpbakery", "wp engine", "acf"],
    generators: [/wordpress/i, /woocommerce/i],
    paths: [/\/wp-content\//i, /\/wp-includes\//i, /\/wp-json\b/i, /\/xmlrpc\.php\b/i],
    headers: [/\bwordpress\b/i, /\bwp engine\b/i],
    html: [/\bwp-block-/i, /\bwp-embed/i, /\bwp-json\b/i],
    tips: [
      "Audit plugins that load on the landing page and disable anything not needed for conversion; plugin bloat is a common WordPress speed killer.",
      "Use full-page caching plus a CDN, then verify logged-out visitors get cached HTML for the landing page.",
      "Serve responsive WebP/AVIF images from the media library and set explicit width/height to reduce layout shift.",
      "Keep forms and checkout blocks lightweight: load CRM, chat, and analytics scripts only after the main CTA is visible."
    ]
  },
  webflow: {
    name: "Webflow",
    tech: ["webflow"],
    generators: [/webflow/i],
    paths: [/assets\.website-files\.com/i, /uploads-ssl\.webflow\.com/i, /\/js\/webflow\./i, /webflow\.js/i],
    headers: [/\bwebflow\b/i],
    html: [/\bdata-wf-page\b/i, /\bdata-wf-site\b/i, /\bw--/i],
    tips: [
      "Clean unused classes and interactions before publishing so Webflow ships less CSS and JavaScript.",
      "Compress large CMS and hero images in Webflow assets, then use responsive image variants for mobile visitors.",
      "Limit above-the-fold interactions; complex Webflow animations can delay the first CTA and distract from the offer.",
      "Place custom scripts near the end of the body and defer non-critical embeds like chat, analytics, and widgets."
    ]
  },
  framer: {
    name: "Framer",
    tech: ["framer"],
    generators: [/framer/i],
    paths: [/framerusercontent\.com/i, /framer\.com\/m\//i, /\/sites\/.*framer/i, /static\.framer\.com/i],
    headers: [/\bframer\b/i],
    html: [/\bdata-framer-/i, /\bframer-/i],
    tips: [
      "Keep the hero section simple and avoid stacking heavy effects before the first CTA; Framer pages convert best when motion supports clarity.",
      "Review mobile breakpoints in Framer, especially sticky CTAs and headline wrapping, because desktop canvas layouts can hide mobile friction.",
      "Optimize uploaded media before import and replace large background videos with poster images unless motion is essential.",
      "Use Framer CMS fields for concise, benefit-led cards so repeated sections stay scannable instead of becoming template filler."
    ]
  },
  shopify: {
    name: "Shopify",
    tech: ["shopify", "shopify plus"],
    generators: [/shopify/i],
    paths: [/cdn\.shopify\.com/i, /\/cdn\/shop\/files\//i, /myshopify\.com/i, /shopifycloud/i],
    headers: [/\bshopify\b/i, /\bx-shopid\b/i],
    html: [/\bShopify\./i, /\bshopify-section\b/i, /\bdata-shopify\b/i],
    tips: [
      "Move trust builders close to the buy button: shipping, returns, payment badges, reviews, and delivery estimates.",
      "Audit theme apps that inject scripts on product or landing pages; remove duplicate review, popup, and upsell widgets.",
      "Use Shopify image transforms for correctly sized product and hero images instead of loading original uploads.",
      "Make the primary product CTA sticky on mobile when the page is long or contains rich product storytelling."
    ]
  },
  squarespace: {
    name: "Squarespace",
    tech: ["squarespace"],
    generators: [/squarespace/i],
    paths: [/static1\.squarespace\.com/i, /images\.squarespace-cdn\.com/i, /squarespace\.com\/universal/i],
    headers: [/\bsquarespace\b/i, /\bx-servedby\b/i],
    html: [/\bsqs-/i, /\bStatic\.SQUARESPACE_CONTEXT\b/i],
    tips: [
      "Use section spacing and button styles consistently; Squarespace templates can look polished but often bury the CTA.",
      "Compress gallery and background images before upload, especially for portfolio-style landing pages.",
      "Replace generic template copy with specific outcomes, pricing cues, and proof so visitors do not feel like they are browsing a brochure.",
      "Keep third-party code injections minimal and load them after the main content to protect page speed."
    ]
  },
  wix: {
    name: "Wix",
    tech: ["wix"],
    generators: [/wix/i],
    paths: [/static\.wixstatic\.com/i, /static\.parastorage\.com/i, /wix-code/i, /\/_api\/wix/i],
    headers: [/\bwix\b/i, /\bx-wix-/i],
    html: [/\bwix-/i, /\bdata-testid=["']richTextElement/i],
    tips: [
      "Check mobile layout manually; Wix desktop designs often need separate mobile tuning for CTA placement and spacing.",
      "Reduce app-market widgets that load globally, especially chat, popups, reviews, and booking add-ons.",
      "Use Wix image optimization but still upload reasonably sized originals to avoid heavy first-screen assets.",
      "Make forms short and place confirmation or next-step copy near the submit button to reduce hesitation."
    ]
  },
  drupal: {
    name: "Drupal",
    tech: ["drupal"],
    generators: [/drupal/i],
    paths: [/\/sites\/default\/files\//i, /\/core\/misc\/drupal/i, /\/modules\/contrib\//i],
    headers: [/\bdrupal\b/i, /\bx-drupal-/i],
    html: [/\bdrupalSettings\b/i, /\bdata-drupal-/i],
    tips: [
      "Enable page and render caching for anonymous visitors so landing pages do not wait on Drupal bootstrap work.",
      "Aggregate and defer CSS/JS where possible, then remove modules that attach libraries to every page.",
      "Use image styles for responsive hero and card images rather than rendering original uploads.",
      "Keep editorial components conversion-focused: clear headline, proof block, CTA, and short supporting copy."
    ]
  },
  ghost: {
    name: "Ghost",
    tech: ["ghost"],
    generators: [/ghost/i],
    paths: [/\/ghost\/api\//i, /\/content\/images\//i, /static\.ghost\.org/i],
    headers: [/\bghost\b/i],
    html: [/\bghost-/i, /\bkg-card\b/i],
    tips: [
      "Turn strong article-style storytelling into a landing flow: promise, proof, CTA, objections, then final CTA.",
      "Use Ghost image sizes for hero and feature images so publication assets do not slow the landing page.",
      "Place newsletter or trial CTAs in context instead of relying only on the theme header.",
      "Keep theme scripts and embeds lean; publication templates often accumulate widgets that distract from conversion."
    ]
  }
};

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stringifyHeaderEntries(headers) {
  if (!headers) return [];
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return Array.from(headers.entries()).map(([key, value]) => `${key}: ${value}`);
  }
  if (typeof headers.entries === "function") {
    return Array.from(headers.entries()).map(([key, value]) => `${key}: ${value}`);
  }
  if (typeof headers === "object") {
    return Object.entries(headers).map(([key, value]) => `${key}: ${value}`);
  }
  return asArray(headers).map(String);
}

function stringifyTechnology(tech) {
  if (!tech) return "";
  if (typeof tech === "string") return tech;
  const parts = [
    tech.app,
    tech.name,
    tech.slug,
    tech.category,
    tech.website,
    ...(tech.categories || []).map((category) => category?.name || category)
  ];
  return parts.filter(Boolean).join(" ");
}

function addSignal(signals, type, value, points) {
  const normalized = String(value || "").trim();
  if (!normalized) return 0;
  const label = `${type}: ${normalized.slice(0, 120)}`;
  if (signals.some((signal) => signal.label === label)) return 0;
  signals.push({ type, label, points });
  return points;
}

function matchPatterns(values, patterns, type, signals, points) {
  let score = 0;
  for (const value of values) {
    for (const pattern of patterns) {
      if (pattern.test(value)) {
        score += addSignal(signals, type, value, points);
        break;
      }
    }
  }
  return score;
}

function collectInput(input = {}) {
  const generator = [
    ...asArray(input.generator),
    ...asArray(input.metaGenerator),
    ...asArray(input.html?.generator)
  ].map(String);

  const paths = [
    ...asArray(input.paths),
    ...asArray(input.assetUrls),
    ...asArray(input.scripts),
    ...asArray(input.links),
    ...asArray(input.html?.assetUrls),
    ...asArray(input.html?.paths)
  ].map(String);

  const html = [
    ...asArray(input.htmlText),
    ...asArray(input.html?.text),
    ...asArray(input.html?.markers),
    ...asArray(input.markers)
  ].map(String);

  const technologies = [
    ...asArray(input.technologies),
    ...asArray(input.techSignals)
  ].map(stringifyTechnology).filter(Boolean);

  const headers = stringifyHeaderEntries(input.headers);
  return { generator, paths, html, technologies, headers };
}

function detectCms(input = {}) {
  const collected = collectInput(input);
  const candidates = Object.entries(CMS_DEFINITIONS).map(([key, definition]) => {
    const signals = [];
    let score = 0;

    for (const tech of collected.technologies) {
      const normalizedTech = tech.toLowerCase();
      if (definition.tech.some((name) => normalizedTech.includes(name))) {
        score += addSignal(signals, "technology", tech, 65);
      }
    }
    score += matchPatterns(collected.generator, definition.generators, "generator", signals, 70);
    score += matchPatterns(collected.headers, definition.headers, "header", signals, 45);
    score += matchPatterns(collected.paths, definition.paths, "path", signals, 35);
    score += matchPatterns(collected.html, definition.html, "html", signals, 30);

    return { key, name: definition.name, score, signals };
  }).filter((candidate) => candidate.score >= 30 && candidate.signals.length > 0);

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;

  return {
    key: best.key,
    name: best.name,
    confidence: Math.min(99, best.score),
    signals: best.signals.map((signal) => signal.label),
    tips: getCmsTips(best.key)
  };
}

function getCmsDefinition(cms) {
  const key = typeof cms === "string" ? cms : cms?.key;
  return key ? CMS_DEFINITIONS[key] : null;
}

function getCmsTips(cms) {
  const definition = getCmsDefinition(cms);
  return definition ? [...definition.tips] : [...GENERIC_WEB_TIPS];
}

export { CMS_DEFINITIONS, GENERIC_WEB_TIPS, detectCms, getCmsTips };
