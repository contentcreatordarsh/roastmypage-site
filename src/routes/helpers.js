import { isStoredChallengeRoast, CHALLENGE_TITLE_PREFIXES } from "../botcheck.js";

// Bundler shim: __name2 was injected by esbuild to name arrow functions.
// In the modular source it's a safe no-op passthrough.
export const __name2 = (fn, _name) => fn;

// Module-level dedup set — prevents duplicate concurrent roast requests for the same URL.
export const inFlightRequests = new Set();

export const OWNER_KEY_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export function visibleStoredRoasts(rows = []) {
  return rows
    .filter((roast) => !isStoredChallengeRoast(roast?.seo_data))
    .map(({ seo_data: _seoData, ...roast }) => roast);
}

export function visibleStoredRoastSql(alias = "") {
  const column = alias ? `${alias}.seo_data` : "seo_data";
  const title = `LOWER(LTRIM(COALESCE(json_extract(${column}, '$.title.text'), '')))`;
  const exclusions = CHALLENGE_TITLE_PREFIXES
    .map((prefix) => `${title} NOT LIKE '${prefix.replaceAll("'", "''")}%'`)
    .join(" AND ");
  return `(CASE WHEN ${column} IS NULL OR json_valid(${column}) = 0 THEN 1 ELSE ${exclusions} END)`;
}
