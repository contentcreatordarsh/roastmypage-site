import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const homepage = readFileSync(join(root, "public/index.html"), "utf8");

test("AI-authored text is escaped at every rich-results HTML sink", () => {
  const escapedInterpolations = [
    "${sanitizeHtml(item.criterion || '')}",
    "${sanitizeHtml(reason)}",
    "${sanitizeHtml(issue)}",
    "${sanitizeHtml(p.element)}",
    "${sanitizeHtml(problem)}",
    "${sanitizeHtml(fix)}"
  ];

  for (const interpolation of escapedInterpolations) {
    assert.ok(
      homepage.includes(interpolation),
      `missing output encoding for ${interpolation}`
    );
  }

  assert.doesNotMatch(homepage, />\$\{p\.element\}</);
  assert.doesNotMatch(homepage, />\$\{problem\}</);
  assert.doesNotMatch(homepage, />\$\{fix\}</);
  assert.match(
    homepage,
    /Array\.isArray\(data\.accessibilityIssues\)/
  );

  const reportQuickWins = homepage.match(
    /\/\/ Quick wins in report([\s\S]*?)\/\/ Competitor insight/
  )?.[1];
  assert.ok(reportQuickWins, "report quick-wins renderer should exist");
  assert.ok(reportQuickWins.includes("${sanitizeHtml(w)}"));
  assert.doesNotMatch(reportQuickWins, />\$\{w\}</);
});

test("AI-authored click probabilities are numeric before HTML interpolation", () => {
  assert.match(
    homepage,
    /Array\.isArray\(data\.heatmap\.clickPredictions\)/
  );
  assert.match(homepage, /const probabilityValue = Number\(p\.probability\)/);
  assert.match(
    homepage,
    /Math\.max\(0, Math\.min\(100, probabilityValue\)\)/
  );
  assert.doesNotMatch(homepage, /style="width:\$\{p\.probability\}%"/);
});
