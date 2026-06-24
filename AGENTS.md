# AGENTS.md

## Cursor Cloud specific instructions

This repo is a single **Cloudflare Worker** ("Roast My Landing Page"). There is no
separate backend/frontend — `src/index.js` handles routing, SSR, and APIs; static
assets live in `public/`. Standard commands are in `package.json` (`dev`, `deploy`,
`tail`) and `README.md`.

### Running locally (no Cloudflare account required)

The committed `wrangler.toml` declares `[browser]` and `[ai]` bindings. These are
Cloudflare-managed services and are the only thing that blocks a credential-free
local run:

- Wrangler **v3** (the pinned version) cannot simulate the `[browser]` binding and
  exits at startup with *"Browser Rendering is not supported locally"*.
- Wrangler **v4** can simulate `[browser]` locally, but the `[ai]` binding forces a
  remote proxy session that needs `CLOUDFLARE_API_TOKEN`.

To run everything that does **not** need Browser/AI (all page rendering and every
D1/R2/KV-backed API), use the committed local-only config `wrangler.dev.toml`, which
is identical to the dev environment minus the `[browser]` binding. The `[ai]` binding
stays but only connects when actually invoked, so startup succeeds:

```
# one-time per fresh VM: create the local D1 tables (.wrangler/ is gitignored)
npx wrangler d1 execute roast-db-dev --local --file schema.sql

# run the dev server (serves http://localhost:8787)
npx wrangler dev -c wrangler.dev.toml --local --port 8787
```

`wrangler.dev.toml` is **only** for local dev. Production/dev deploys still use
`wrangler.toml` (`npx wrangler deploy` / `--env production`) — do not deploy with the
dev config.

### Seeding data for local testing

A fresh local DB is empty, so the gallery/stats/roast pages have nothing to show.
The actual roast flow (`/api/roast-stream`) needs Browser + AI, so to exercise the
read/render path locally, insert a row directly, e.g.:

```
npx wrangler d1 execute roast-db-dev --local --command \
  "INSERT INTO roasts (id,url,overall_score,hero_score,cta_score,trust_score,copy_score,design_score,roast_response,quick_wins,industry,created_at) VALUES ('demo1234','https://example.com',7.4,8,6.5,7,7.5,8,'### Hero\n**Problem:** ...\n**Fix:** ...','[\"Add a CTA\"]','saas',datetime('now'));"
```

Then visit `/roast/demo1234`, `/gallery`, `/api/stats`, etc. Note: screenshots and
SEO/performance numbers will be missing/`NaN` for hand-seeded rows because no real
capture ran — that is expected, not a bug.

### Full functionality (real roasting)

Capturing a screenshot + AI roast requires a Cloudflare account with Browser
Rendering + Workers AI. Set `CLOUDFLARE_API_TOKEN` and run `npx wrangler dev --remote`
(or `--remote` with `wrangler.dev.toml`) to use the live bindings end-to-end.

### Lint / test / build

- No linter or unit-test framework is configured.
- `test_all.py` hits the **remote** deployed worker URL, not localhost — it is a
  smoke test for a live deployment, not a local test suite.
- Build/validate the bundle locally with `npx wrangler deploy --dry-run --outdir /tmp/build`.
