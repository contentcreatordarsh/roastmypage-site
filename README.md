# Roast My Landing Page - Serverless Architecture

Roast My Landing Page is a serverless application built on Cloudflare Workers, providing AI-powered, humorous "roasts" and constructive feedback for landing pages. It captures screenshots, analyzes performance and SEO metrics, and uses AI vision to generate a comprehensive landing page review.

## Architecture Overview

The system is deployed as a single Cloudflare Worker, but it is structured modularly for maintainability.

### Core Components

- **Cloudflare Workers**: The core compute platform that handles routing, server-side rendering (SSR), and orchestrates the roasting process.
- **Cloudflare D1**: A serverless SQLite database used to store roasts, gallery items, leaderboards, and site statistics.
- **Cloudflare R2**: Object storage for persisting full-page and viewport screenshots captured during the roasting process.
- **Cloudflare Puppeteer (Browser Rendering API)**: A headless browser service used to capture screenshots and extract on-page metrics.
- **Cloudflare AI**: Integrates with LLMs (e.g., Llama 3) for vision analysis and generating the roast text.
- **Cloudflare KV**: Used for rate limiting and caching transient data.

### Modular Codebase Structure

The application's source code in `src/` is separated into focused modules:

- **`index.js`**: The main entry point. Handles routing, API endpoints, CORS headers, and request orchestration.
- **`config.js`**: Centralized configuration, constants, industry benchmarks, and origin definitions.
- **`ai.js`**: Prompts and AI integration logic. Handles interactions with Cloudflare AI and parsing the AI responses into structured reports.
- **`db.js`**: Database operations, queries for the gallery/leaderboard, and rate limiting logic.
- **`puppeteer.js`**: Browser automation. Captures screenshots and gathers performance/SEO metrics.
- **`render.js`**: Handles server-side generation of Open Graph (OG) images using Puppeteer.
- **`ssr.js`**: Server-side rendering for HTML pages, injecting dynamic variables into the `public/` templates.
- **`radar.js`**: Integrates with Cloudflare Radar for fetching domain insights and geographical traffic data.
- **`threats.js`**: Analyzes domains for typosquatting, security headers, and potential social media impersonation threats.
- **`utils.js`**: Shared utility functions for hashing, sanitization, validation, and ID generation.

## How the Roasting Works (The Flow)

1. **Submission**: A user submits a URL via the front-end to the `/api/roast-stream` endpoint.
2. **Validation & Limits**: The request is validated, sanitized, and checked against global and IP-based rate limits.
3. **Browser Capture**: Puppeteer is launched to navigate to the URL, capture a screenshot, and extract SEO/Performance data.
4. **AI Analysis**: The screenshot and data are passed to the AI vision model, which evaluates the page against standard landing page heuristics (Hero, CTA, Copy, Trust, Design) and generates a humorous roast.
5. **Persistence**: The resulting screenshot is saved to R2, and the structured roast data is stored in D1.
6. **Streaming**: As these steps execute, progress updates are streamed back to the client via Server-Sent Events (SSE).

## Local Development

1. Install dependencies: `npm install`
2. Run locally: `npx wrangler dev` (Requires your Cloudflare account to have access to Browser Rendering, AI, D1, and R2)
3. Deploy: `npx wrangler deploy`

## Environment Setup

The worker requires bindings for `DB` (D1), `SCREENSHOTS` (R2), `CONFIG` (KV), `BROWSER`, and `AI`. Ensure your `wrangler.toml` is configured with the corresponding namespace IDs for your Cloudflare account.
