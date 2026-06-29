#!/usr/bin/env python3
"""Create GitHub issues from the Roast My Landing Page codebase audit.

Requires a GitHub token with issues:write (or repo) scope.
Usage:
  export GITHUB_TOKEN=ghp_...   # or: gh auth login
  python3 scripts/create-audit-issues.py [--dry-run] [--repo owner/name]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

DEFAULT_REPO = "contentcreatordarsh/roastmypage-site"

ISSUES = [
    # ── Bugs: High impact ──────────────────────────────────────────────────────
    {
        "title": "Email subscribe UI claims report was sent but no email is delivered",
        "labels": ["bug"],
        "body": """## Problem
The email capture UI shows **"Report sent! Check your inbox"** and promises improvement tips, but `/api/subscribe` only stores emails in D1. There is no email delivery integration.

## Affected files
- `public/index.html` — email success messaging (`#email-success`, email gate modal)
- `src/index.js` — `POST /api/subscribe` handler

## Expected behavior
Either integrate an email provider (Resend, SendGrid, etc.) to actually send reports/tips, or update copy to say "You're subscribed" without implying delivery.

## Priority
High — misleading user-facing promise
""",
    },
    {
        "title": "/pricing route serves homepage with no pricing content",
        "labels": ["bug"],
        "body": """## Problem
`GET /pricing` is routed in `src/index.js` to serve `index.html`, but `public/index.html` contains no pricing page content, nav links, or client-side routing for pricing.

## Expected behavior
A dedicated pricing section/page with plan tiers, limits, and CTAs.

## Affected files
- `src/index.js` (pricing route ~line 3413)
- `public/index.html` (missing pricing UI)

## Priority
High
""",
    },
    {
        "title": "Threat report PDF export is stubbed with coming-soon toast",
        "labels": ["bug"],
        "body": """## Problem
`exportThreatPDF()` shows "PDF export coming soon!" while roast PDF export via jsPDF is fully implemented.

## Affected files
- `public/index.html` — `exportThreatPDF()` (~line 4549), TODO comment

## Expected behavior
Implement threat report PDF export (mirror the existing `generatePDF()` flow for roast results).

## Priority
High
""",
    },
    {
        "title": "Frontend references visualSimilarity field that threat-scan API never returns",
        "labels": ["bug"],
        "body": """## Problem
`shareThreatReport()` references `d.visualSimilarity?.found`, but `/api/threat-scan` does not return a `visualSimilarity` field. Share text may incorrectly show "0 similar sites detected".

## Affected files
- `public/index.html` — `shareThreatReport()` (~line 4528)
- `src/index.js` — threat-scan response (~line 2295)

## Fix options
1. Remove the visualSimilarity reference from share text, or
2. Implement visual similarity detection and return it from the API.

## Priority
High
""",
    },
    {
        "title": "Rate limits are charged before URL validation",
        "labels": ["bug"],
        "body": """## Problem
`checkOperationRateLimit()` increments the request counter before URL validation runs. Invalid URLs, SSRF blocks, and malformed requests still consume the user's hourly quota.

## Affected files
- `src/db.js` — `checkOperationRateLimit()`
- `src/index.js` — roast, compare, batch, stream handlers

## Suggested fix
Move rate limit increment to after successful validation, or decrement on validation failure.

## Priority
High
""",
    },
    {
        "title": "Subscribe, feedback, and threat-scan share the roast rate limit bucket",
        "labels": ["bug"],
        "body": """## Problem
`/api/subscribe`, `/api/feedback`, and `/api/threat-scan` all call `checkOperationRateLimit(..., "roast")`. Subscribing or giving feedback can block actual roast requests.

## Affected files
- `src/index.js` — subscribe (~924), feedback (~881), threat-scan (~2239)

## Suggested fix
Add separate rate limit operations (e.g. `"subscribe"`, `"feedback"`, `"threat"`) with appropriate limits.

## Priority
High
""",
    },
    # ── Bugs: Medium impact ────────────────────────────────────────────────────
    {
        "title": "Rename comparePaqes typo to comparePages",
        "labels": ["bug", "good first issue"],
        "body": """## Problem
The compare function is named `comparePaqes()` (typo) in `public/index.html`. It works but hurts maintainability.

## Affected files
- `public/index.html` — function definition (~4954) and button onclick (~1035)

## Priority
Low effort fix
""",
    },
    {
        "title": "Compare mode ignores fullPage screenshot option",
        "labels": ["bug"],
        "body": """## Problem
Single roast supports `fullPage: true`, but compare always captures viewport-only screenshots via `capturePageWithMetrics(env, url, { device })` without passing `fullPage`.

## Affected files
- `src/index.js` — compare handler (~253-254)
- `public/index.html` — compare UI has device toggle but no full-page toggle

## Priority
Medium
""",
    },
    {
        "title": "Batch roast does not persist SEO, performance, or heatmap data",
        "labels": ["bug"],
        "body": """## Problem
`/api/batch-roast` inserts roasts without `seo_data`, `performance_data`, or `heatmap_data` columns, unlike the main roast path. Batch results are incomplete in D1 and on re-fetch.

## Affected files
- `src/index.js` — batch handler INSERT (~556)

## Priority
Medium
""",
    },
    {
        "title": "Gallery API and SSR gallery have inconsistent pagination",
        "labels": ["bug"],
        "body": """## Problem
- `/api/gallery` hardcodes `LIMIT 12` with no `page` parameter
- SSR `/gallery` paginates at 24 items per page with `?page=N`
- Homepage gallery preview uses the API (12 items); full gallery page uses SSR

## Affected files
- `src/index.js` — `/api/gallery` (~784), SSR `/gallery` (~3363)
- `public/index.html` — `loadGallery()` (~8108)

## Priority
Medium
""",
    },
    {
        "title": "Improvement API exists but frontend only uses localStorage",
        "labels": ["bug"],
        "body": """## Problem
`GET /api/improvement/:urlHash` is implemented server-side for cross-session improvement tracking, but the frontend (`checkImprovement`, `checkBeforeAfter`) only reads `localStorage` roast history.

## Affected files
- `src/index.js` — improvement endpoint (~1523)
- `public/index.html` — `checkImprovement()` (~6251)

## Priority
Medium
""",
    },
    {
        "title": "Duplicate API v1 rate limit helpers in index.js shadow db.js imports",
        "labels": ["bug"],
        "body": """## Problem
`checkApiV1RateLimits`, `incrementApiV1Counters`, `apiV1RateLimitHeaders`, `getApiDayKey`, and `secondsUntilMidnightUTC` are duplicated locally in `src/index.js` (~2483) while also imported from `db.js` and `utils.js`. Risk of logic drift.

## Suggested fix
Remove local duplicates and use the imported module functions exclusively.

## Priority
Medium — tech debt / maintenance
""",
    },
    {
        "title": "Global rate limit fails open when KV is unavailable",
        "labels": ["bug"],
        "body": """## Problem
If KV (`CONFIG`) is unavailable, `checkGlobalRateLimit()` catches the error and returns `{ allowed: true }`, bypassing the global circuit breaker.

## Affected files
- `src/db.js` — `checkGlobalRateLimit()` (~20-22)

## Suggested fix
Fail closed (deny requests) or degrade gracefully with logging/alerting.

## Priority
Medium — security/ops
""",
    },
    {
        "title": "API v1 rate limit counters have a race condition",
        "labels": ["bug"],
        "body": """## Problem
API v1 KV counters use read-then-write without atomicity. Concurrent requests can exceed the 50/day global cap or 5/day per-IP limit.

## Affected files
- `src/db.js` — `incrementApiV1Counters()`
- `src/index.js` — duplicate implementation

## Suggested fix
Use atomic KV operations or D1 transactions for counter increments.

## Priority
Medium
""",
    },
    {
        "title": "Social media imposter detection is unreliable",
        "labels": ["bug"],
        "body": """## Problem
`scanSocialMediaImposters()` uses `HEAD` requests to `twitter.com` and `instagram.com`. These platforms often block bots or return misleading status codes, producing false positives and false negatives.

## Affected files
- `src/threats.js` — `scanSocialMediaImposters()` (~196)

## Suggested fix
Use official APIs, third-party brand monitoring, or clearly label results as heuristic/unverified.

## Priority
Medium
""",
    },
    {
        "title": "Accessibility check treats placeholder as valid form label",
        "labels": ["bug"],
        "body": """## Problem
In `puppeteer.js`, form inputs with only a `placeholder` attribute (no `<label>` or ARIA) pass the "Form labels" accessibility check. This understates real a11y issues.

## Affected files
- `src/puppeteer.js` — form label check (~69-78)

## Suggested fix
Only count `label[for]`, `aria-label`, and `aria-labelledby` as valid labels.

## Priority
Medium
""",
    },
    {
        "title": "Cached roast responses do not persist device or fullPage metadata",
        "labels": ["bug"],
        "body": """## Problem
Cache key includes device + fullPage suffix via `hashUrl(targetUrl, device + (fullPage ? "-full" : ""))`, but the `roasts` table has no `device` or `full_page` columns. `getCachedRoast()` only adds these at response time from the request, not from stored data.

## Priority
Low-Medium
""",
    },
    # ── Bugs: Low impact ───────────────────────────────────────────────────────
    {
        "title": "IP_HASH_SALT falls back to public constant when secret is unset",
        "labels": ["bug"],
        "body": """## Problem
Without `IP_HASH_SALT` secret, IP hashes use a hardcoded fallback (`"roast-salt"`), making them reversible. A warning is logged but production should require the secret.

## Affected files
- `src/utils.js` — `hashIp()` (~45-54)

## Fix
Require secret in production or fail startup/deploy validation.

## Priority
Low — security hardening
""",
    },
    {
        "title": "Sitemap lastmod may parse dates incorrectly",
        "labels": ["bug"],
        "body": """## Problem
Sitemap generation appends `"Z"` to `created_at` when building `lastmod`. If D1 already stores UTC timestamps with `Z`, dates may parse incorrectly.

## Affected files
- `src/index.js` — sitemap handler (~2824)

## Priority
Low
""",
    },
    {
        "title": "Integration tests only cover GET routes, not core POST flows",
        "labels": ["bug"],
        "body": """## Problem
`test_all.py` only smoke-tests GET routes on the deployed test worker. No coverage for:
- `POST /api/roast`
- `POST /api/compare`
- `POST /api/threat-scan`
- SSE `/api/roast-stream`
- Rate limiting behavior

## Priority
Medium — testing gap
""",
    },
    # ── Security ───────────────────────────────────────────────────────────────
    {
        "title": "CSP uses unsafe-inline for scripts and styles",
        "labels": ["bug"],
        "body": """## Problem
Content Security Policy includes `'unsafe-inline'` for scripts and styles. Documented TODO in `src/utils.js` to migrate to nonces.

## Affected files
- `src/utils.js` — `getSecurityHeaders()` (~139-142)

## Priority
Medium — security hardening
""",
    },
    {
        "title": "Public API v1 has no authentication or API keys",
        "labels": ["enhancement"],
        "body": """## Problem
`/api/v1/roast` has open CORS and no API keys. Anyone can consume the shared 50/day global pool.

## Affected files
- `src/index.js` — API v1 handlers
- `public/index.html` — API docs section

## Suggested enhancement
Optional API keys with tiered limits; keep free tier with IP limits.

## Priority
Medium
""",
    },
    {
        "title": "SSRF protection has edge-case coverage gaps",
        "labels": ["bug"],
        "body": """## Problem
SSRF defenses are solid for common cases (private IPs, metadata endpoints, redirects) but edge cases remain:
- Decimal/octal/hex IP encodings
- IPv6 literals like `::ffff:127.0.0.1`
- DNS rebinding (time-of-check vs time-of-use)

## Affected files
- `src/utils.js` — `isUrlSafeForFetching()`
- `src/puppeteer.js` — request interception

## Priority
Medium — security
""",
    },
    {
        "title": "No way for users to request roast or screenshot deletion",
        "labels": ["enhancement"],
        "body": """## Problem
Users cannot request removal of their URL, screenshot (R2), or roast from the gallery/leaderboard. No opt-out or GDPR-style deletion flow.

## Suggested enhancement
Add `POST /api/opt-out` or contact form flow with admin tooling to purge roasts by URL/domain.

## Priority
Medium — privacy/compliance
""",
    },
    {
        "title": "No CAPTCHA or bot protection for expensive roast operations",
        "labels": ["enhancement"],
        "body": """## Problem
Beyond IP rate limits, there is no bot mitigation for expensive browser + AI operations. Vulnerable to distributed abuse.

## Suggested enhancement
Cloudflare Turnstile on roast/compare forms; stricter limits for anonymous users.

## Priority
Medium
""",
    },
    {
        "title": "Cloudflare account and zone IDs committed in wrangler.toml",
        "labels": ["bug"],
        "body": """## Problem
`CF_ACCOUNT_TAG` and `CF_ZONE_TAG` are committed in `wrangler.toml`. Lower risk than secrets but still operational metadata that could be moved to secrets or env-specific config.

## Affected files
- `wrangler.toml`

## Priority
Low
""",
    },
    # ── UX / Product gaps ──────────────────────────────────────────────────────
    {
        "title": "No user accounts — history and subscriptions are localStorage-only",
        "labels": ["enhancement"],
        "body": """## Problem
Roast history, improvement tracking, email subscription state, and before/after comparisons all depend on `localStorage`. Clearing browser data loses everything; no cross-device sync.

## Affected files
- `public/index.html` — `roastHistory`, `userEmail` in localStorage

## Suggested enhancement
Optional auth (email magic link, OAuth) with saved roasts in D1.

## Priority
High — product
""",
    },
    {
        "title": "No progress persistence if user closes tab during roast",
        "labels": ["enhancement"],
        "body": """## Problem
Roasts can take 60+ seconds. If the user closes the tab during SSE streaming, there is no way to resume or retrieve the in-progress result.

## Suggested enhancement
Server-side job IDs; poll or reconnect to `/api/roast/:jobId` for status.

## Priority
Medium
""",
    },
    {
        "title": "API v1 has no webhook or callback support",
        "labels": ["enhancement"],
        "body": """## Problem
Developers using `POST /api/v1/roast` must wait synchronously or poll. No `callback_url` for async notification when a roast completes.

## Priority
Medium — developer experience
""",
    },
    {
        "title": "Compare UI missing full-page screenshot toggle",
        "labels": ["enhancement"],
        "body": """## Problem
Single roast has a full-page mode toggle (`fullPageMode`), but the compare tab only has device selection (desktop/tablet/mobile).

## Affected files
- `public/index.html` — compare form section

## Priority
Low
""",
    },
    {
        "title": "No dark/light mode toggle",
        "labels": ["enhancement"],
        "body": """## Problem
App is dark-mode only. No theme toggle for user preference or system sync.

## Priority
Low — may be intentional design choice
""",
    },
    {
        "title": "No internationalization — English only",
        "labels": ["enhancement"],
        "body": """## Problem
UI, AI prompts, SSR pages, and error messages are English only. No i18n framework or locale detection.

## Priority
Low-Medium
""",
    },
    # ── Technical debt ─────────────────────────────────────────────────────────
    {
        "title": "Frontend is a single 9000-line index.html monolith",
        "labels": ["enhancement"],
        "body": """## Problem
All frontend logic, styles, and markup live in `public/index.html` (~9000 lines). Hard to maintain, test, review, and collaborate on.

## Suggested approach
Split into components/modules (Vite, Astro, or similar) while keeping Cloudflare Workers deployment model.

## Priority
High — maintainability
""",
    },
    {
        "title": "No frontend build step — Tailwind loaded from CDN at runtime",
        "labels": ["enhancement"],
        "body": """## Problem
Tailwind is loaded from `cdn.tailwindcss.com` at runtime. Slower loads, no purge/tree-shaking, CDN dependency, and JIT in production.

## Suggested approach
Add build step with compiled Tailwind CSS.

## Priority
Medium
""",
    },
    {
        "title": "No unit tests for core modules",
        "labels": ["enhancement"],
        "body": """## Problem
No isolated tests for:
- `src/ai.js` — response parsing
- `src/utils.js` — URL safety, hashing
- `src/db.js` — rate limiting logic
- `src/threats.js` — scoring

Only `test_all.py` live smoke tests exist.

## Priority
High — quality
""",
    },
    {
        "title": "No CI/CD pipeline",
        "labels": ["enhancement"],
        "body": """## Problem
No GitHub Actions (or similar) for lint, test, or deploy on PR. Manual deploy only via `wrangler deploy`.

## Suggested approach
GitHub Actions: lint → unit tests → integration tests on test worker → deploy production on merge.

## Priority
High — ops
""",
    },
    {
        "title": "index.js worker entry point is ~3400 lines",
        "labels": ["enhancement"],
        "body": """## Problem
`src/index.js` contains all routing, API handlers, inline HTML generation, and duplicate helpers in one file.

## Suggested approach
Extract route handlers into `src/routes/` modules (roast, gallery, api-v1, threats, etc.).

## Priority
Medium — maintainability
""",
    },
    {
        "title": "No data retention or cleanup policy for roasts and screenshots",
        "labels": ["enhancement"],
        "body": """## Problem
Roasts (D1), screenshots (R2), and rate-limit rows grow indefinitely. No cleanup cron, TTL, or archival strategy.

## Suggested approach
Scheduled Worker cron to purge roasts/screenshots older than N days (except featured/gallery picks).

## Priority
Medium — cost/storage
""",
    },
    {
        "title": "In-flight roast deduplication is Worker isolate-scoped only",
        "labels": ["bug"],
        "body": """## Problem
`deduplicatedRoast()` uses an in-memory `Map` in `src/db.js`. Concurrent roasts for the same URL on different Worker isolates are not deduplicated, wasting browser + AI resources.

## Suggested fix
Use KV or D1 lock for cross-isolate deduplication.

## Priority
Low-Medium — cost optimization
""",
    },
    {
        "title": "feedback table created at runtime instead of via schema migration",
        "labels": ["enhancement"],
        "body": """## Problem
The `feedback` table is created with `CREATE TABLE IF NOT EXISTS` inside the request handler rather than managed via `schema.sql` migrations.

## Affected files
- `src/index.js` — feedback handler (~896)
- `schema.sql` — table exists but runtime also creates it

## Priority
Low
""",
    },
    # ── Backend exists, frontend missing ───────────────────────────────────────
    {
        "title": "Add UI for batch roast API (up to 3 URLs)",
        "labels": ["enhancement"],
        "body": """## Problem
`POST /api/batch-roast` is fully implemented server-side but has no frontend UI.

## API
- Endpoint: `POST /api/batch-roast`
- Body: `{ "urls": ["..."], "device": "desktop" }`
- Max 3 URLs per batch

## Suggested UI
New tab or section on homepage to paste multiple URLs and view batch results.

## Priority
Medium
""",
    },
    {
        "title": "Add UI for tech stack scan (Cloudflare URL Scanner)",
        "labels": ["enhancement"],
        "body": """## Problem
`POST /api/tech-scan` and `GET /api/tech-scan/:id` are implemented but not wired in the frontend. Requires `URL_SCANNER_TOKEN` secret.

## Affected files
- `src/index.js` — tech-scan handlers (~2320)

## Suggested UI
Panel on results page showing detected technologies, scripts, and security findings.

## Priority
Medium
""",
    },
    {
        "title": "Wire /api/improvement into frontend for cross-device tracking",
        "labels": ["enhancement"],
        "body": """## Problem
`GET /api/improvement/:urlHash` returns server-side improvement data but frontend uses only `localStorage`.

## Suggested approach
Call improvement API after roast completes; show badge and before/after from server history.

## Priority
Medium
""",
    },
    {
        "title": "Build pricing page with plan tiers and limits",
        "labels": ["enhancement"],
        "body": """## Problem
`/pricing` route exists but serves the homepage. No pricing content, tiers, or upgrade CTAs.

## Suggested content
- Free tier (current limits)
- Pro tier (higher limits, API keys, priority queue)
- Enterprise (team features, white-label)

## Priority
High — monetization
""",
    },
    # ── Feature enhancements ─────────────────────────────────────────────────────
    {
        "title": "Integrate real email delivery for reports and tips",
        "labels": ["enhancement"],
        "body": """## Problem
Email capture exists but nothing is sent. Users expect roast PDFs, threat reports, and improvement tips via email.

## Suggested approach
Resend, SendGrid, or Cloudflare Email Workers. Trigger on subscribe and scheduled re-roast reminders.

## Priority
High
""",
    },
    {
        "title": "Scheduled re-roasts with email reminders",
        "labels": ["enhancement"],
        "body": """## Description
Allow users to schedule "check my page again in 30 days" with email reminders when scores change.

## Dependencies
- User accounts or email verification
- Email delivery integration
- Cron Worker for scheduled scans

## Priority
Medium
""",
    },
    {
        "title": "Competitor watchlists with score change alerts",
        "labels": ["enhancement"],
        "body": """## Description
Let users save a list of competitor URLs and get notified when their scores change over time.

## Priority
Medium
""",
    },
    {
        "title": "White-label embeddable roast widget for agencies",
        "labels": ["enhancement"],
        "body": """## Description
Embeddable widget/button agencies can add to client sites. Badge endpoints exist; full widget with branding options does not.

## Priority
Medium
""",
    },
    {
        "title": "API key tiers with paid higher limits",
        "labels": ["enhancement"],
        "body": """## Description
Free tier: current IP limits (5/day API, 30/hour web). Paid tiers: API keys, higher limits, priority queue, webhooks.

## Priority
Medium — monetization
""",
    },
    {
        "title": "Implement visual similarity detection for threat reports",
        "labels": ["enhancement"],
        "body": """## Description
Frontend share text references visual similarity but it is not implemented. Add screenshot fingerprinting or perceptual hash to detect lookalike sites.

## Related issue
See also: visualSimilarity field bug in threat-scan response.

## Priority
Medium
""",
    },
    {
        "title": "Integrate Lighthouse or Core Web Vitals for real performance data",
        "labels": ["enhancement"],
        "body": """## Description
Current performance metrics are Puppeteer estimates (load time, FCP). Integrate Lighthouse, PageSpeed Insights API, or CrUX for real-world data.

## Priority
Medium
""",
    },
    {
        "title": "A/B test recommendations based on industry benchmarks",
        "labels": ["enhancement"],
        "body": """## Description
Suggest specific headline/CTA variants to test based on industry benchmarks and common patterns in top-scoring pages.

## Priority
Low-Medium
""",
    },
    {
        "title": "Team workspaces for shared roasts and client management",
        "labels": ["enhancement"],
        "body": """## Description
Agencies need shared workspaces: team members, client URL lists, branded PDF exports, and comparison history.

## Priority
Low-Medium
""",
    },
    {
        "title": "Roast annotations — mark findings as fixed or wont-fix",
        "labels": ["enhancement"],
        "body": """## Description
Let users annotate roast findings (fixed, in progress, won't fix) and track remediation progress over time.

## Priority
Low
""",
    },
    {
        "title": "Industry filter on homepage gallery preview section",
        "labels": ["enhancement"],
        "body": """## Description
SSR `/gallery` supports `?industry=saas` filtering. Homepage SPA gallery section (`loadGallery()`) does not expose industry filters.

## Priority
Low
""",
    },
    {
        "title": "Gallery pagination and load-more in SPA homepage section",
        "labels": ["enhancement"],
        "body": """## Description
Homepage gallery preview fetches `/api/gallery` (12 items, no pagination). Add "Load more" or link to full paginated gallery.

## Priority
Low
""",
    },
    {
        "title": "PWA support with service worker and install manifest",
        "labels": ["enhancement"],
        "body": """## Description
Add web app manifest, service worker for offline shell, and install prompt for mobile users.

## Priority
Low
""",
    },
    {
        "title": "Slack and Discord notifications for roast results",
        "labels": ["enhancement"],
        "body": """## Description
Allow users to connect Slack/Discord webhooks to post roast results to a channel automatically.

## Priority
Low
""",
    },
    {
        "title": "Custom rubric weights for personalized scoring",
        "labels": ["enhancement"],
        "body": """## Description
Let users prioritize categories (e.g. weight CTA 30%, design 10%) for a personalized overall score relevant to their goals.

## Priority
Low
""",
    },
    {
        "title": "Multi-language roasts — detect page language and respond accordingly",
        "labels": ["enhancement"],
        "body": """## Description
Detect landing page language and generate roast text, quick wins, and fixes in that language.

## Priority
Low-Medium
""",
    },
    {
        "title": "Video landing page analysis support",
        "labels": ["enhancement"],
        "body": """## Description
Analyze pages with autoplay video heroes — evaluate video impact on conversion, load performance, and accessibility (captions, autoplay policy).

## Priority
Low
""",
    },
    {
        "title": "CMS-specific improvement tips (Webflow, Framer, WordPress, etc.)",
        "labels": ["enhancement"],
        "body": """## Description
Detect CMS/platform (via tech-scan or heuristics) and provide platform-specific fix instructions.

## Related
Tech scan API already exists; needs frontend + tip generation.

## Priority
Low-Medium
""",
    },
    {
        "title": "GDPR consent flow and user data export",
        "labels": ["enhancement"],
        "body": """## Description
Cookie/consent banner, privacy policy integration, and self-service data export for EU users.

## Priority
Medium — compliance
""",
    },
    {
        "title": "Admin dashboard for moderation and analytics",
        "labels": ["enhancement"],
        "body": """## Description
Internal admin UI to: moderate gallery entries, view platform analytics, manage rate limits, handle opt-out requests, and feature roasts.

## Priority
Low-Medium
""",
    },
    {
        "title": "Roast diff view for category score changes between roasts",
        "labels": ["enhancement"],
        "body": """## Description
Before/after slider exists for screenshots. Add a diff view showing per-category score changes (hero, CTA, trust, copy, design) between roasts.

## Priority
Low
""",
    },
]


def get_token() -> str:
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        return token
    try:
        result = subprocess.run(
            ["gh", "auth", "token"],
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        pass
    print("Error: set GITHUB_TOKEN or run `gh auth login` with issues:write scope.", file=sys.stderr)
    sys.exit(1)


def fetch_existing_titles(repo: str, token: str) -> set[str]:
    titles: set[str] = set()
    page = 1
    while True:
        url = f"https://api.github.com/repos/{repo}/issues?state=all&per_page=100&page={page}"
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        try:
            with urllib.request.urlopen(req) as resp:
                batch = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 403:
                print("Warning: cannot list existing issues (403). Will attempt to create all.", file=sys.stderr)
                return set()
            raise
        if not batch:
            break
        for issue in batch:
            if "pull_request" not in issue:
                titles.add(issue["title"])
        page += 1
    return titles


def create_issue(repo: str, token: str, issue: dict, dry_run: bool) -> dict | None:
    payload = {
        "title": issue["title"],
        "body": issue["body"].strip(),
        "labels": issue.get("labels", []),
    }
    if dry_run:
        print(f"[DRY RUN] Would create: {issue['title']}")
        return None

    url = f"https://api.github.com/repos/{repo}/issues"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def main() -> None:
    parser = argparse.ArgumentParser(description="Create audit GitHub issues")
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--delay", type=float, default=0.5, help="Seconds between API calls")
    args = parser.parse_args()

    token = get_token()
    existing = fetch_existing_titles(args.repo, token)

    created = 0
    skipped = 0
    failed = 0

    print(f"Repository: {args.repo}")
    print(f"Issues to process: {len(ISSUES)}")
    print(f"Existing issues found: {len(existing)}")
    print("-" * 60)

    for issue in ISSUES:
        if issue["title"] in existing:
            print(f"[SKIP] Already exists: {issue['title']}")
            skipped += 1
            continue
        try:
            result = create_issue(args.repo, token, issue, args.dry_run)
            if result:
                print(f"[OK] #{result['number']} {issue['title']}")
                print(f"     {result['html_url']}")
                created += 1
            elif args.dry_run:
                created += 1
            time.sleep(args.delay)
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            print(f"[FAIL] {issue['title']}: HTTP {e.code} — {body[:200]}", file=sys.stderr)
            failed += 1
            if e.code == 403:
                print("\nToken lacks issues:write permission. Grant repo/issues access and retry.", file=sys.stderr)
                sys.exit(1)

    print("-" * 60)
    print(f"Created: {created} | Skipped: {skipped} | Failed: {failed}")


if __name__ == "__main__":
    main()
