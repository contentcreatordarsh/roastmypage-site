# 🔥 Roast My Page

> **AI-powered landing page analyzer** — Instantly score, critique, and improve any landing page using computer vision, Cloudflare Workers AI, and real browser rendering.

Live: [roastmypage.site](https://roastmypage.site) · Dev Worker: [roast-my-landing-page-test.falling-hall-ac41.workers.dev](https://roast-my-landing-page-test.falling-hall-ac41.workers.dev)

---

## What It Does

Roast My Page takes any public URL and runs it through a multi-stage analysis pipeline:

1. **Browser capture** — Launches a real Chromium instance via Cloudflare Browser Rendering to screenshot the page at desktop, tablet, or mobile viewports
2. **Metrics extraction** — Collects SEO signals (title, meta, headings, alt text, structured data), performance data (load time, resource counts, TTFB), and fold position
3. **Vision AI analysis** — Sends the screenshot + metadata to `@cf/meta/llama-3.2-11b-vision-instruct` to generate rubric-scored critiques across 5 categories
4. **Heatmap generation** — Overlays predicted attention zones and UX improvement regions on the screenshot
5. **Industry benchmarking** — Compares scores against real-time computed averages from the roast database, grouped by industry
6. **Percentile ranking** — Shows "better than X% of pages" using live D1 database stats
7. **Threat scanning** — Detects typosquatting domains, social media impersonators, and missing security headers
8. **SSR page rendering** — Server-side renders full result and gallery pages for fast, SEO-friendly sharing

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Cloudflare Worker Edge                  │
│                                                         │
│  Request → src/index.js (Router + API handlers)         │
│                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ src/puppeteer│  │   src/ai.js  │  │ src/threats.js│  │
│  │  .js         │  │              │  │               │  │
│  │ Screenshot + │  │ Vision model │  │ Typosquats +  │  │
│  │ SEO/Perf     │  │ + Heatmap +  │  │ Social scan + │  │
│  │ metrics      │  │ Benchmarks   │  │ Header check  │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                  │          │
│  ┌──────▼─────────────────▼──────────────────▼───────┐  │
│  │              src/db.js                            │  │
│  │  Rate limiting · Deduplication · Cache lookup     │  │
│  └──────┬────────────────────────────────────────────┘  │
│         │                                               │
│  ┌──────▼──────┐  ┌──────────┐  ┌────────────────────┐  │
│  │  src/ssr.js │  │src/radar │  │   src/config.js    │  │
│  │  SSR pages  │  │  .js     │  │   src/utils.js     │  │
│  │  + Gallery  │  │ CF Radar │  │   src/render.js    │  │
│  └─────────────┘  └──────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────┘

Cloudflare Bindings:
  BROWSER     → Cloudflare Browser Rendering (Puppeteer)
  AI          → Workers AI (Llama 3.2 Vision)
  DB          → D1 SQLite (roasts, rate_limits tables)
  SCREENSHOTS → R2 Object Storage (JPEG screenshots)
  CONFIG      → KV Namespace (rate limit counters, feature flags)
  ASSETS      → Static asset serving (public/index.html)
```

---

## Project Structure

```
roast-my-landing-page-v2/
├── src/
│   ├── index.js       # Main router — all API endpoints & request handling
│   ├── config.js      # Constants, rate limits, viewports, industry benchmarks
│   ├── ai.js          # AI analysis, vision model, heatmap, score parsing
│   ├── db.js          # D1 queries, rate limiting, deduplication, caching
│   ├── puppeteer.js   # Browser rendering, screenshot capture, SEO/perf metrics
│   ├── radar.js       # Cloudflare Radar API — domain ranking & geo distribution
│   ├── render.js      # SVG → PNG rendering utility
│   ├── ssr.js         # Server-side rendered HTML (roast page, gallery, 404)
│   ├── threats.js     # Brand threat detection — typosquats, social imposters
│   └── utils.js       # Shared utilities — ID gen, hashing, sanitization, headers
├── public/
│   └── index.html     # Frontend SPA (served via Cloudflare Assets)
├── schema.sql         # D1 database schema
├── wrangler.toml      # Cloudflare Worker configuration & bindings
└── package.json
```

---

## Source Modules

### `src/index.js` — Router & API Handlers
The main entry point. Handles all HTTP routing, CORS enforcement, and orchestrates the full analysis pipeline per endpoint. All POST endpoints to `/api/*` (excluding `/api/v1/*`) enforce origin allowlisting.

### `src/config.js` — Configuration & Constants
Single source of truth for all tunable parameters:
- **Rate limits**: 30 roasts/user/hour · 5 compares/hour · 3 batches/hour
- **Global circuit breakers**: 2,000 requests/hour · 10,000 browser sessions/day
- **Timeouts**: 65s total roast · 45s AI · 30s screenshot · 90s compare
- **Cache TTL**: 7 days (30 days for popular domains like stripe.com, github.com)
- **Industry benchmarks**: 12 industry categories (SaaS, ecommerce, fintech, etc.) with category-level score averages for comparison
- **Feature flags**: `ENABLE_COMPUTED_INDUSTRY_BENCHMARKS`, `ENABLE_PERCENTILE_RANKING`

### `src/ai.js` — AI Analysis Engine
Drives the core intelligence of the product:
- **`analyzeWithVisionAndHeatmap`** — Sends base64 JPEG + URL context to `llama-3.2-11b-vision-instruct`; parses markdown response into structured scores
- **`parseMarkdownResponse`** — Extracts overall + 5 category scores from freeform AI text using regex chains with multiple fallback patterns
- **`ensureLlamaLicenseAgreed`** — Ensures the Llama model license is accepted before inference
- **`formatRoast`** — Formats the AI critique into structured JSON for storage and display
- **`resolveIndustry`** — Maps AI-detected page content to one of 12 industry keys
- **`calculatePercentile`** — Queries D1 to rank the current page's score against all previously roasted pages in the same industry
- **`createFallbackAnalysis`** — Returns a graceful degraded result if AI is unavailable

**Scoring rubric (each scored 0–10):**
| Category | What it evaluates |
|----------|-------------------|
| **Hero** | Headline clarity, value proposition, above-fold content |
| **CTA** | Button visibility, action copy, urgency, contrast |
| **Trust** | Social proof, authority signals, security indicators |
| **Copy** | Readability, benefit focus, scannable structure |
| **Design** | Visual hierarchy, whitespace, typography, mobile readiness |

### `src/db.js` — Database & Rate Limiting
Manages all D1 database interactions and in-memory state:
- **`checkGlobalRateLimit`** — KV-based circuit breaker: blocks all traffic when hourly or daily browser caps are hit
- **`checkOperationRateLimit`** — Per-IP sliding window rate limiting via D1 `rate_limits` table; operation-aware (roast/compare/batch have different limits)
- **`deduplicatedRoast`** — In-memory Map deduplification: concurrent requests for the same URL share a single browser session and AI call
- **`getCachedRoast`** — Returns cached result from D1 if within TTL window; skips screenshot + AI entirely
- **`trackBrowserUsage`** — Increments daily browser session counter in KV
- **`checkApiV1RateLimits` / `incrementApiV1Counters`** — Separate daily quotas for the public v1 API (per-IP and global)

### `src/puppeteer.js` — Browser Rendering & Metrics
Operates Cloudflare Browser Rendering (Puppeteer-compatible):
- Launches browser, navigates to URL, waits for network idle
- Captures JPEG screenshots at configurable viewports (desktop 1280×720, tablet 768×1024, mobile 375×667)
- Supports full-page scroll screenshots
- **SEO extraction**: title, meta description, H1/H2 counts, canonical, Open Graph, structured data presence, image alt coverage, internal/external link counts
- **Performance extraction**: load time, TTFB, resource count, total transfer size, render-blocking scripts, Largest Contentful Paint element
- **Fold detection**: calculates the above-the-fold percentage for heatmap anchoring
- Retry logic with configurable delays and max retries

### `src/radar.js` — Cloudflare Radar Integration
Enriches roast results with real-world traffic data via Cloudflare's GraphQL API:
- **`getRadarDomainRanking`** — Global + country-level traffic rank for the analyzed domain
- **`getRadarGeoDistribution`** — Top countries sending traffic to the domain
- **`getRadarInsights`** — Aggregated traffic and bot ratio signals
- **`queryCloudflareGraphQL`** — Generic authenticated GraphQL client using the `ANALYTICS_API_TOKEN` secret

### `src/threats.js` — Brand Threat Detection
Runs a lightweight threat intelligence scan for brand impersonation:
- **`generateTyposquats`** — Algorithmic generation of domain variants: character deletion, insertion, transposition, leet substitutions (a→4, e→3, etc.), and Cyrillic/Greek homoglyph swaps
- **`checkDomainRegistrations`** — DNS resolution checks against generated variants to identify registered typosquat domains
- **`checkSecurityHeaders`** — Fetches the target URL and grades security headers (CSP, HSTS, X-Frame-Options, etc.)
- **`scanSocialMediaImposters`** — Generates plausible fake handles and checks for suspicious registrations on Twitter/X, Instagram, GitHub, LinkedIn
- **`generateThreatRecommendations`** — Produces prioritized, actionable recommendations based on discovered threats

### `src/ssr.js` — Server-Side Rendering
Generates full HTML pages at the edge, no client-side framework required:
- **`renderRoastPage`** — Complete result page with score breakdown, heatmap overlay, quick wins, SEO/perf data, industry comparison, and shareable screenshot
- **`renderGalleryPage`** — Paginated gallery of recent public roasts fetched from D1, with filtering by score and industry
- **`generateNotFoundPage`** — Branded 404 page

### `src/render.js` — SVG Rendering
Converts SVG heatmap overlays to PNG using the Workers AI image pipeline for consistent cross-browser rendering.

### `src/utils.js` — Shared Utilities
- **`generateId`** — Cryptographically random base36 roast IDs
- **`hashUrl` / `hashIp`** — SHA-256 HMAC hashing for cache keys and privacy-preserving rate limit tracking
- **`sanitizeHtml` / `sanitizeUrl`** — Input sanitization to prevent XSS and SSRF
- **`isUrlSafeForFetching`** — Blocks requests to private IP ranges, localhost, and internal metadata endpoints
- **`getAllowedOrigins` / `getSecurityHeaders`** — Environment-aware CORS and security header generation
- **`withTimeout`** — Promise wrapper with configurable timeout and descriptive error messages
- **`getTimeAgo` / `getTimeAgoSSR`** — Human-readable relative timestamps

---

## API Reference

All endpoints require CORS-compliant requests. POST endpoints only accept requests from allowed origins (production or localhost in dev).

### `POST /api/roast`
Analyze a single landing page.

**Request:**
```json
{
  "url": "https://example.com",
  "device": "desktop",        // "desktop" | "tablet" | "mobile"
  "fullPage": false,          // true for full scroll screenshot
  "brandName": "Acme Inc"     // optional, used in roast copy
}
```

**Response:**
```json
{
  "id": "abc123",
  "url": "https://example.com",
  "overallScore": 7.2,
  "scores": { "hero": 8, "cta": 6.5, "trust": 7, "copy": 7.5, "design": 7 },
  "sections": { "hero": { "roast": "...", "fix": "..." }, ... },
  "verdict": "Strong hero but weak CTA...",
  "quickWins": ["Add urgency to CTA", "Include customer count"],
  "screenshotUrl": "/api/screenshot/abc123",
  "seo": { "score": 72, "title": "...", "issues": [...] },
  "performance": { "score": 65, "loadTime": 2300, ... },
  "heatmap": { "hotZones": [...], "coldZones": [...], "foldLine": 45 },
  "industry": "saas",
  "benchmarks": { "hero": 6.8, "cta": 6.2, ... },
  "percentile": { "percentile": 73, "betterThan": 73, "totalSamples": 412 },
  "cached": false,
  "device": "desktop"
}
```

**Headers:** `X-Cache: HIT | MISS | DEDUP`

---

### `POST /api/roast-stream`
Same as `/api/roast` but streams progress via **Server-Sent Events** (SSE). Returns early cache hits as JSON, otherwise streams `screenshot`, `analysis`, `complete`, and `error` events.

---

### `POST /api/compare`
Side-by-side analysis of two landing pages.

**Request:**
```json
{ "url1": "https://pageA.com", "url2": "https://pageB.com", "device": "desktop" }
```

**Response:** Includes both full roast objects plus `winner`, `insights[]` (auto-generated comparative observations), and per-category strength breakdown.

---

### `POST /api/batch`
Analyze up to 3 URLs in a single request.

**Request:**
```json
{ "urls": ["https://a.com", "https://b.com", "https://c.com"], "device": "desktop" }
```

**Response:** `{ results: [...], errors: [...], summary: { total, successful, failed, avgScore } }`

---

### `POST /api/v1/roast` — Public API
Publicly accessible roast endpoint with separate daily quotas (per-IP and global). Returns rate limit headers:
- `X-RateLimit-Limit` · `X-RateLimit-Remaining` · `X-RateLimit-Reset`
- `X-RateLimit-Global-Limit` · `X-RateLimit-Global-Remaining`

---

### `GET /api/roast/:id`
Fetch a previously generated roast by ID.

### `GET /api/screenshot/:id`
Serve the JPEG screenshot from R2 storage.

### `GET /api/gallery`
Paginated list of recent public roasts from D1. Supports `?page=`, `?industry=`, `?minScore=` query params.

### `GET /api/threats`
Run brand threat scan. Requires `?url=` param.

### `GET /api/stats`
Public stats — total roasts, average score, top industries, recent activity.

### `GET /api/health`
Worker health check endpoint.

### `GET /api/og-image/:id`
Generate Open Graph PNG image for social sharing (SVG → PNG via AI render pipeline).

---

## Database Schema

```sql
-- Roast results
CREATE TABLE roasts (
  id              TEXT PRIMARY KEY,
  url             TEXT NOT NULL,
  url_hash        TEXT NOT NULL,
  screenshot_key  TEXT,
  overall_score   REAL,
  hero_score      REAL,
  cta_score       REAL,
  trust_score     REAL,
  copy_score      REAL,
  design_score    REAL,
  roast_response  TEXT,
  quick_wins      TEXT,       -- JSON array
  country         TEXT,
  seo_data        TEXT,       -- JSON object
  performance_data TEXT,      -- JSON object
  heatmap_data    TEXT,       -- JSON object
  industry        TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Per-IP sliding window rate limits
CREATE TABLE rate_limits (
  ip_hash       TEXT PRIMARY KEY,
  request_count INTEGER DEFAULT 0,
  window_start  DATETIME,
  last_request  DATETIME
);
```

---

## Cloudflare Bindings

| Binding       | Type              | Purpose                                      |
|---------------|-------------------|----------------------------------------------|
| `AI`          | Workers AI        | Llama 3.2 Vision — screenshot analysis        |
| `DB`          | D1 Database       | Roast storage, rate limits, percentile data   |
| `SCREENSHOTS` | R2 Bucket         | JPEG screenshot storage                       |
| `BROWSER`     | Browser Rendering | Real Chromium for page capture                |
| `CONFIG`      | KV Namespace      | Global rate limit counters, feature flags     |
| `ASSETS`      | Static Assets     | Serves `public/index.html` frontend           |

**Secrets (set via `wrangler secret put`):**
- `IP_HASH_SALT` — HMAC salt for privacy-preserving IP hashing
- `ANALYTICS_API_TOKEN` — Cloudflare API token for Radar GraphQL access

---

## Rate Limits & Quotas

| Operation | Per-User (per hour) | Global (per hour) | Global (per day) |
|-----------|--------------------|--------------------|------------------|
| Single Roast | 30 | 2,000 | 10,000 browser sessions |
| Compare | 5 | ↑ shared | ↑ shared |
| Batch (≤3 URLs) | 3 | ↑ shared | ↑ shared |
| Public API v1 | 5/day | 50/day | — |

Rate limits are enforced at two levels:
- **Global (KV)** — Circuit breaker that blocks all traffic when platform capacity is reached
- **Per-IP (D1)** — Sliding window per operation type, keyed by HMAC-hashed IP

---

## Local Development

```bash
# Install dependencies
npm install

# Run local dev server (hot reload)
npm run dev
# → http://localhost:8787

# Deploy to Cloudflare
npm run deploy

# Tail live logs
npm run tail
```

### Prerequisites
- Node.js 18+
- Wrangler authenticated: `npx wrangler login`
- D1 database created and migrated:
  ```bash
  npx wrangler d1 create roast-db
  npx wrangler d1 execute roast-db --file=./schema.sql
  ```
- R2 bucket created:
  ```bash
  npx wrangler r2 bucket create roast-screenshots
  ```
- KV namespace created:
  ```bash
  npx wrangler kv namespace create CONFIG
  # → paste the returned ID into wrangler.toml
  ```
- Secrets configured:
  ```bash
  npx wrangler secret put IP_HASH_SALT
  npx wrangler secret put ANALYTICS_API_TOKEN
  ```

---

## Deployment

This worker is deployed to Cloudflare's global edge network. The `wrangler.toml` targets the test worker by default. To deploy to production, update `name` in `wrangler.toml`:

```toml
name = "roast-my-landing-page"   # production
# name = "roast-my-landing-page-test"  # dev/staging
```

```bash
npm run deploy
```

**Current deployments:**
| Environment | Worker Name | URL |
|-------------|-------------|-----|
| Production | `roast-my-landing-page` | [roastmypage.site](https://roastmypage.site) |
| Dev/Test | `roast-my-landing-page-test` | [roast-my-landing-page-test.falling-hall-ac41.workers.dev](https://roast-my-landing-page-test.falling-hall-ac41.workers.dev) |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Cloudflare Workers (V8 isolates, `nodejs_compat`) |
| Browser | Cloudflare Browser Rendering (`@cloudflare/puppeteer`) |
| AI | Workers AI — `@cf/meta/llama-3.2-11b-vision-instruct` |
| Database | Cloudflare D1 (SQLite at the edge) |
| Storage | Cloudflare R2 (S3-compatible object storage) |
| Cache/State | Cloudflare KV + in-memory Map deduplication |
| Traffic Intel | Cloudflare Radar GraphQL API |
| SSR | Vanilla JS template literals (zero framework) |
| Frontend | Static HTML/CSS/JS served via Cloudflare Assets |

---

## Security

- **Origin enforcement** — POST API endpoints only accept requests from allowed origins
- **Input sanitization** — All user-supplied URLs and strings are sanitized before processing
- **SSRF protection** — `isUrlSafeForFetching` blocks private IPs, localhost, and cloud metadata endpoints
- **Privacy-preserving rate limits** — IPs are HMAC-hashed before storage; raw IPs are never persisted
- **Security headers** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options applied to all responses
- **Screenshot size cap** — 5MB maximum to prevent storage abuse

---

*Built on Cloudflare Workers · Powered by Llama 3.2 Vision*
