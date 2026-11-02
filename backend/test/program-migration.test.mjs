import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migration = await readFile(resolve(root, "migrations/004_program_portfolio_lifecycle.sql"), "utf8");

test("program portfolio migration extends the existing program record", () => {
  assert.match(migration, /ALTER TABLE programs/);
  assert.match(migration, /organizational_contour IN \('foundation', 'asset_valuation', 'analytics'\)/);
  assert.match(migration, /target_groups jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(migration, /owner_id uuid REFERENCES app_users\(id\)/);
  assert.match(migration, /approved_by uuid REFERENCES app_users\(id\)/);
  assert.match(migration, /programs_code_unique_idx/);
});

test("program milestones have scoped ownership, lifecycle and completion evidence", () => {
  assert.match(migration, /CREATE TABLE program_milestones/);
  assert.match(migration, /program_id uuid NOT NULL REFERENCES programs\(id\) ON DELETE RESTRICT/);
  assert.match(migration, /status IN \('planned', 'in_progress', 'blocked', 'completed', 'cancelled'\)/);
  assert.match(migration, /UNIQUE \(program_id, code\)/);
  assert.match(migration, /status = 'completed' AND completed_at IS NOT NULL/);
  assert.match(migration, /completion_evidence text/);
  assert.match(migration, /program_milestones_owner_due_idx/);
});

test("program status transitions are written to an append-only history table", () => {
  assert.match(migration, /CREATE TABLE program_status_history/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION record_program_status_history/);
  assert.match(migration, /programs_status_history_on_insert/);
  assert.match(migration, /programs_status_history_on_update/);
  assert.match(migration, /OLD\.status IS DISTINCT FROM NEW\.status/);
  assert.match(migration, /current_setting\('app\.actor_id', true\)/);
});
