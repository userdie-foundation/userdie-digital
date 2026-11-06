import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../migrations/011_audit_events_append_only.sql", import.meta.url),
  "utf8",
);

test("audit log migration blocks row mutation and table truncation", () => {
  assert.match(sql, /CREATE FUNCTION prevent_audit_event_mutation/);
  assert.match(sql, /RAISE EXCEPTION 'audit_events is append-only'/);
  assert.match(sql, /CREATE TRIGGER audit_events_no_update_delete\s+BEFORE UPDATE OR DELETE ON audit_events/);
  assert.match(sql, /CREATE TRIGGER audit_events_no_truncate\s+BEFORE TRUNCATE ON audit_events/);
  assert.match(sql, /restrict DDL and table ownership separately/i);
  assert.match(sql, /COMMIT;\s*$/);
});

test("audit guard uses one balanced PL/pgSQL function body", () => {
  const delimiters = sql.match(/\$\$/g) ?? [];
  assert.equal(delimiters.length, 2);
});
