import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED_TABLES = [
  "roasts",
  "rate_limits",
  "visitors",
  "email_subscribers",
  "feedback",
  "api_v1_counters",
  "watchlist",
  "watchlist_alerts"
];

const BASELINE_TABLES = [
  "roasts",
  "rate_limits",
  "visitors",
  "email_subscribers",
  "feedback",
  "api_v1_counters"
];

function load(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

function loadSrcFiles() {
  const srcDir = join(root, "src");
  return readdirSync(srcDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({ name, source: load(`src/${name}`) }));
}

function loadMigrations() {
  const dir = join(root, "migrations");
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => parseInt(a.split("_")[0], 10) - parseInt(b.split("_")[0], 10))
    .map((name) => ({ name, sql: load(`migrations/${name}`) }));
}

function stripSqlComments(sql) {
  return sql.replace(/--.*$/gm, "");
}

function createTableNames(sql) {
  return [...stripSqlComments(sql).matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)].map(
    (match) => match[1]
  );
}

function createIndexNames(sql) {
  return [...stripSqlComments(sql).matchAll(/CREATE INDEX IF NOT EXISTS\s+(\w+)/gi)].map(
    (match) => match[1]
  );
}

function extractColumns(sql, table) {
  const match = sql.match(
    new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(([\\s\\S]*?)\\n\\);`)
  );
  assert.ok(match, `${table} table definition should exist`);
  return match[1]
    .split("\n")
    .map((line) => line.trim().replace(/,$/, ""))
    .filter(Boolean)
    .filter((line) => !/^(PRIMARY|UNIQUE|FOREIGN|CHECK)\b/i.test(line))
    .map((line) => line.split(/\s+/)[0]);
}

function extractInserts(source) {
  const inserts = [];
  const re = /INSERT(?:\s+OR\s+(?:IGNORE|REPLACE))?\s+INTO\s+(\w+)\s*\(([^)]+)\)/gi;
  for (const match of source.matchAll(re)) {
    inserts.push({
      table: match[1],
      columns: match[2].split(",").map((column) => column.trim())
    });
  }
  return inserts;
}

test("src/ never creates tables at runtime", () => {
  for (const { name, source } of loadSrcFiles()) {
    assert.doesNotMatch(
      source,
      /CREATE\s+TABLE/i,
      `${name} must not issue CREATE TABLE (schema lives in migrations/)`
    );
  }
});

test("migrations capture the full schema snapshot", () => {
  const migrations = loadMigrations();
  assert.deepEqual(
    migrations.map((file) => file.name),
    ["0000_initial.sql", "001_watchlist.sql"]
  );

  const baselineTables = createTableNames(migrations[0].sql);
  const watchlistTables = createTableNames(migrations[1].sql);
  assert.deepEqual(baselineTables, BASELINE_TABLES);
  assert.deepEqual(watchlistTables, ["watchlist", "watchlist_alerts"]);

  const schemaSql = load("schema.sql");
  const schemaTables = createTableNames(schemaSql);
  const migratedTables = [...baselineTables, ...watchlistTables];
  assert.deepEqual(schemaTables, EXPECTED_TABLES);
  assert.deepEqual(migratedTables, EXPECTED_TABLES);

  for (const table of EXPECTED_TABLES) {
    const schemaColumns = extractColumns(schemaSql, table);
    const migrationSql = BASELINE_TABLES.includes(table)
      ? migrations[0].sql
      : migrations[1].sql;
    assert.deepEqual(
      extractColumns(migrationSql, table),
      schemaColumns,
      `${table} columns must match between schema.sql and migrations/`
    );
  }

  const schemaIndexes = createIndexNames(schemaSql).sort();
  const migratedIndexes = [...createIndexNames(migrations[0].sql), ...createIndexNames(migrations[1].sql)].sort();
  assert.deepEqual(migratedIndexes, schemaIndexes);
});

test("application inserts only use columns declared in schema.sql", () => {
  const schemaSql = load("schema.sql");
  const schemaTables = new Set(createTableNames(schemaSql));

  for (const { name, source } of loadSrcFiles()) {
    for (const insert of extractInserts(source)) {
      assert.ok(
        schemaTables.has(insert.table),
        `${name} inserts into ${insert.table}, which is missing from schema.sql`
      );
      const schemaColumns = extractColumns(schemaSql, insert.table);
      for (const column of insert.columns) {
        assert.ok(
          schemaColumns.includes(column),
          `${name} inserts ${insert.table}.${column}, which is missing from schema.sql`
        );
      }
    }
  }
});
