import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createPrincipalResolver } from "../src/security/principal.mjs";
import { createSessionToken } from "../src/security/session.mjs";

const databaseUrl = process.env.PG_INTEGRATION_URL;

test("PostgreSQL applies migrations 001-005 and enforces workflow invariants", {
  skip: !databaseUrl ? "PG_INTEGRATION_URL is not configured" : false,
}, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const schema = `userdie_it_${randomUUID().replaceAll("-", "")}`;

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const filename of [
      "001_initial_schema.sql",
      "002_application_status_history_trigger.sql",
      "003_auth_sessions.sql",
      "004_program_portfolio_lifecycle.sql",
      "005_application_workflow_tasks_sla.sql",
      "006_scoped_role_grants.sql",
    ]) {
      const sql = await readFile(new URL(`../migrations/${filename}`, import.meta.url), "utf8");
      await client.query(sql);
    }

    const users = await client.query(
      "INSERT INTO app_users (email, display_name, account_status) VALUES ($1, 'Actor', 'active'), ($2, 'Worker', 'active'), ($3, 'Other worker', 'active') RETURNING id",
      [`actor-${schema}@example.test`, `worker-${schema}@example.test`, `other-${schema}@example.test`],
    );
    const [actorId, workerId, otherWorkerId] = users.rows.map((row) => row.id);
    await client.query("SELECT set_config('app.actor_id', $1, false)", [actorId]);

    const programs = await client.query(
      "INSERT INTO programs (name, status) VALUES ('Integration program', 'open'), ('Other program', 'draft') RETURNING id",
    );
    const [programId, otherProgramId] = programs.rows.map((row) => row.id);
    const scopedGrant = await client.query(
      "INSERT INTO user_role_grants (user_id, role_id, scope_type, scope_id, granted_by) SELECT $1, id, 'program', $2, $3 FROM roles WHERE code = 'program_manager' RETURNING id",
      [workerId, programId, actorId],
    );
    assert.equal(scopedGrant.rowCount, 1);

    const session = createSessionToken();
    await client.query(
      "INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 hour')",
      [workerId, session.tokenHash],
    );
    const resolvePrincipal = createPrincipalResolver({ pool });
    const principal = await resolvePrincipal({
      headers: { cookie: `__Host-userdie_session=${session.token}` },
    });
    assert.deepEqual(principal, {
      id: workerId,
      accountStatus: "active",
      grants: [{ roleCode: "program_manager", scopeType: "program", scopeId: programId }],
    });

    await assert.rejects(
      client.query(
        "INSERT INTO user_role_grants (user_id, role_id, scope_type, scope_id) SELECT $1, id, 'invalid_scope', 'x' FROM roles WHERE code = 'program_manager'",
        [workerId],
      ),
      /check constraint/i,
    );
    const app = await client.query(
      "INSERT INTO applications (applicant_id, program_id, subject, description, assigned_to) VALUES ($1, $2, 'Synthetic case', 'Integration fixture', $3) RETURNING id",
      [actorId, programId, workerId],
    );
    const applicationId = app.rows[0].id;
    const otherApp = await client.query(
      "INSERT INTO applications (applicant_id, program_id, subject, description) VALUES ($1, $2, 'Other synthetic case', 'Second integration fixture') RETURNING id",
      [actorId, otherProgramId],
    );
    const otherApplicationId = otherApp.rows[0].id;

    const history = await client.query(
      "SELECT new_status, changed_by, reason FROM application_status_history WHERE application_id = $1",
      [applicationId],
    );
    assert.deepEqual(history.rows.map((row) => [row.new_status, row.changed_by, row.reason]), [
      ["submitted", actorId, "application_created"],
    ]);
    const caseEvents = await client.query(
      "SELECT event_type, actor_id FROM application_workflow_events WHERE application_id = $1 AND task_id IS NULL",
      [applicationId],
    );
    assert.deepEqual(caseEvents.rows.map((row) => [row.event_type, row.actor_id]), [["case_created", actorId]]);

    const task = await client.query(
      "INSERT INTO application_tasks (application_id, program_id, title, assigned_to, created_by, due_at) VALUES ($1, $2, 'Verify documents', $3, $4, now() - interval '1 day') RETURNING id",
      [applicationId, programId, workerId, actorId],
    );
    const taskId = task.rows[0].id;

    await assert.rejects(
      client.query(
        "INSERT INTO application_tasks (application_id, program_id, title) VALUES ($1, $2, 'Wrong program link')",
        [applicationId, otherProgramId],
      ),
      /foreign key/i,
    );
    await assert.rejects(
      client.query(
        "INSERT INTO application_tasks (application_id, program_id, title, status) VALUES ($1, $2, 'Invalid completion', 'completed')",
        [applicationId, programId],
      ),
      /check constraint/i,
    );
    await assert.rejects(
      client.query(
        "INSERT INTO application_workflow_events (application_id, task_id, event_type) VALUES ($1, $2, 'task_created')",
        [otherApplicationId, taskId],
      ),
      /foreign key/i,
    );

    await client.query(
      "UPDATE application_tasks SET assigned_to = $2, status = 'in_progress', priority = 'high', escalation_level = 1, escalated_at = now() WHERE id = $1",
      [taskId, otherWorkerId],
    );
    const events = await client.query(
      "SELECT event_type, actor_id FROM application_workflow_events WHERE task_id = $1 ORDER BY id",
      [taskId],
    );
    const eventTypes = events.rows.map((row) => row.event_type);
    for (const expected of ["task_created", "task_assigned", "task_status_changed", "sla_escalated", "task_updated"]) {
      assert.ok(eventTypes.includes(expected), `missing workflow event: ${expected}`);
    }
    assert.ok(events.rows.every((row) => row.actor_id === actorId));

    const eventId = (await client.query(
      "SELECT id FROM application_workflow_events WHERE task_id = $1 ORDER BY id LIMIT 1",
      [taskId],
    )).rows[0].id;
    await assert.rejects(
      client.query("UPDATE application_workflow_events SET summary = 'tampered' WHERE id = $1", [eventId]),
      /append-only/i,
    );
    await assert.rejects(
      client.query("DELETE FROM application_workflow_events WHERE id = $1", [eventId]),
      /append-only/i,
    );

    await client.query(
      "UPDATE application_tasks SET status = 'completed', completed_at = now() WHERE id = $1",
      [taskId],
    );
    const completed = await client.query(
      "SELECT status, completed_at FROM application_tasks WHERE id = $1",
      [taskId],
    );
    assert.equal(completed.rows[0].status, "completed");
    assert.ok(completed.rows[0].completed_at);
  } finally {
    try {
      await client.query("RESET search_path");
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      client.release();
      await pool.end();
    }
  }
});
