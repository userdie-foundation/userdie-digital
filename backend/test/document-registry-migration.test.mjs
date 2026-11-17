import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../migrations/015_workspace_document_registry.sql", import.meta.url),
  "utf8",
);

test("document registry is a separate metadata domain with the three organizational contours", () => {
  assert.ok(sql.includes("CREATE TABLE workspace_documents"));
  assert.ok(sql.includes("CREATE TABLE workspace_document_versions"));
  for (const contour of ["foundation", "asset_valuation", "analytics"]) {
    assert.ok(sql.includes("'" + contour + "'"));
  }
  assert.ok(!sql.includes("CREATE TABLE documents ("));
  assert.ok(!sql.includes("CREATE TABLE partnership_evidence ("));
  assert.doesNotMatch(sql, /storage_key|original_filename|content_type|size_bytes/i);
});

test("document relationships use explicit foreign-key tables, not polymorphic object IDs", () => {
  for (const [table, target] of [
    ["workspace_document_program_links", "programs"],
    ["workspace_document_application_links", "applications"],
    ["workspace_document_task_links", "application_tasks"],
    ["workspace_document_partnership_links", "partnerships"],
  ]) {
    assert.ok(sql.includes("CREATE TABLE " + table));
    assert.ok(sql.includes("REFERENCES " + target + "(id)"));
  }
  assert.doesNotMatch(sql, /object_type\s+text[\s\S]{0,100}object_id\s+text/i);
});

test("document versions and domain events are append-only including truncate protection", () => {
  for (const table of ["workspace_document_versions", "workspace_document_events"]) {
    assert.ok(sql.includes("CREATE TRIGGER " + table + "_no_update_delete"));
    assert.ok(sql.includes("BEFORE UPDATE OR DELETE ON " + table));
    assert.ok(sql.includes("CREATE TRIGGER " + table + "_no_truncate"));
    assert.ok(sql.includes("BEFORE TRUNCATE ON " + table));
  }
  assert.ok(sql.includes("is append-only"));
});

test("migration is transaction wrapped and contains balanced trigger function bodies", () => {
  // Leading SQL comments are valid; no executable statement may precede BEGIN.
  const firstStatement = sql
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("--"));
  assert.equal(firstStatement, "BEGIN;");
  assert.ok(sql.trimEnd().endsWith("COMMIT;"));
  const delimiters = sql.match(/\$\$/g) ?? [];
  assert.equal(delimiters.length, 2);
});
