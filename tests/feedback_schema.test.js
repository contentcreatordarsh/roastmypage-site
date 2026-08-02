import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const indexSource = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
const schemaSql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
const migrationSql = readFileSync(new URL("../migrations/001_feedback.sql", import.meta.url), "utf8");

function extractFeedbackColumns(sql) {
  const match = sql.match(/CREATE TABLE IF NOT EXISTS feedback\s*\(([\s\S]*?)\n\);/);
  assert.ok(match, "feedback table definition should exist");

  return match[1]
    .split("\n")
    .map((line) => line.trim().replace(/,$/, ""))
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0]);
}

test("feedback handler never creates the feedback table at runtime", () => {
  const feedbackStart = indexSource.indexOf('url.pathname === "/api/feedback"');
  const nextRouteStart = indexSource.indexOf('url.pathname === "/api/subscribe"', feedbackStart);
  assert.notEqual(feedbackStart, -1, "feedback route should exist");
  assert.notEqual(nextRouteStart, -1, "next route should delimit the feedback handler");

  const feedbackHandler = indexSource.slice(feedbackStart, nextRouteStart);
  assert.doesNotMatch(feedbackHandler, /CREATE TABLE/i);
  assert.doesNotMatch(indexSource, /CREATE TABLE IF NOT EXISTS\s+feedback/i);
});

test("feedback schema and migration cover all inserted columns", () => {
  const insertMatch = indexSource.match(/INSERT INTO feedback\s*\(([^)]+)\)/);
  assert.ok(insertMatch, "feedback insert should declare columns");

  const insertedColumns = insertMatch[1].split(",").map((column) => column.trim());
  const schemaColumns = extractFeedbackColumns(schemaSql);
  const migrationColumns = extractFeedbackColumns(migrationSql);

  for (const column of insertedColumns) {
    assert.ok(schemaColumns.includes(column), `schema.sql is missing ${column}`);
    assert.ok(migrationColumns.includes(column), `feedback migration is missing ${column}`);
  }

  assert.ok(schemaColumns.includes("created_at"), "schema.sql should default created_at");
  assert.deepEqual(migrationColumns, schemaColumns, "migration should match schema feedback definition");
});
