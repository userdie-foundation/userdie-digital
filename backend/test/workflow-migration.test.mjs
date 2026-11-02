import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL("../migrations/005_application_workflow_tasks_sla.sql", import.meta.url),
  "utf8",
);

test("workflow migration links tasks to the exact parent application and program", () => {
  assert.match(sql, /ADD CONSTRAINT applications_id_program_unique UNIQUE \(id, program_id\)/);
  assert.match(sql, /FOREIGN KEY \(application_id, program_id\)\s+REFERENCES applications\(id, program_id\)/);
  assert.match(sql, /CREATE TABLE application_tasks/);
});

test("task model constrains status, priority, completion and escalation state", () => {
  assert.match(sql, /status IN \('open', 'in_progress', 'blocked', 'completed', 'cancelled'\)/);
  assert.match(sql, /priority IN \('low', 'normal', 'high', 'critical'\)/);
  assert.match(sql, /escalation_level BETWEEN 0 AND 3/);
  assert.match(sql, /status = 'completed' AND completed_at IS NOT NULL/);
  assert.match(sql, /escalation_level = 0 AND escalated_at IS NULL/);
});

test("workflow event history is append-only and task changes create controlled events", () => {
  assert.match(sql, /CREATE TABLE application_workflow_events/);
  assert.match(sql, /CREATE TRIGGER application_tasks_workflow_event_insert/);
  assert.match(sql, /CREATE TRIGGER application_tasks_workflow_event_update/);
  assert.match(sql, /CREATE TRIGGER application_workflow_events_no_update/);
  assert.match(sql, /application_workflow_events is append-only/);
});

test("overdue task index excludes completed and cancelled tasks", () => {
  assert.match(sql, /CREATE INDEX application_tasks_overdue_idx/);
  assert.match(sql, /WHERE status IN \('open', 'in_progress', 'blocked'\) AND due_at IS NOT NULL/);
});
