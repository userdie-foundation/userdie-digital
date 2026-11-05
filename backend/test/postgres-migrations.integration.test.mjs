import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createPrincipalResolver } from "../src/security/principal.mjs";
import { createSessionToken } from "../src/security/session.mjs";
import { createLoginRateLimiter } from "../src/security/login-rate-limit.mjs";

const databaseUrl = process.env.PG_INTEGRATION_URL;

test("PostgreSQL applies migrations 001-010 and enforces workflow, authorization, recovery-token, and login-throttling invariants", {
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
      "007_scoped_role_grant_lifecycle.sql",
      "008_independent_approvals.sql",
      "009_auth_rate_limit_buckets.sql",
      "010_auth_recovery_tokens.sql",
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

    const limiter = createLoginRateLimiter({
      pool: client,
      hmacKey: Buffer.alloc(32, 7),
      maxAttempts: 5,
      windowSeconds: 900,
      blockSeconds: 900,
    });
    const loginEmail = `throttle-${schema}@example.test`;
    const peerAddress = "203.0.113.17";
    assert.equal(await limiter.isBlocked({ email: loginEmail, clientAddress: peerAddress }), false);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await limiter.recordFailure({ email: loginEmail, clientAddress: peerAddress });
      assert.equal(result.blocked, attempt === 5);
    }
    assert.equal(await limiter.isBlocked({ email: loginEmail, clientAddress: peerAddress }), true);
    const buckets = await client.query(
      "SELECT bucket_type, octet_length(key_hash) AS digest_bytes FROM auth_rate_limit_buckets ORDER BY bucket_type",
    );
    assert.deepEqual(buckets.rows.map((row) => [row.bucket_type, row.digest_bytes]), [
      ["account", 32], ["network", 32],
    ]);
    await limiter.clearAccountFailures({ email: loginEmail });
    assert.equal(await limiter.isBlocked({ email: loginEmail, clientAddress: peerAddress }), true);
    const remainingBuckets = await client.query(
      "SELECT bucket_type FROM auth_rate_limit_buckets ORDER BY bucket_type",
    );
    assert.deepEqual(remainingBuckets.rows.map((row) => row.bucket_type), ["network"]);
    await client.query(
      "UPDATE auth_rate_limit_buckets SET window_started_at = now() - interval '16 minutes' WHERE bucket_type = 'network'",
    );
    assert.equal(await limiter.isBlocked({ email: loginEmail, clientAddress: peerAddress }), true);
    await client.query(
      "UPDATE auth_rate_limit_buckets SET blocked_until = now() - interval '1 second' WHERE bucket_type = 'network'",
    );
    const afterWindow = await limiter.recordFailure({ email: loginEmail, clientAddress: peerAddress });
    assert.equal(afterWindow.blocked, false);
    const resetNetworkBucket = await client.query(
      "SELECT attempt_count, blocked_until FROM auth_rate_limit_buckets WHERE bucket_type = 'network'",
    );
    assert.equal(resetNetworkBucket.rows[0].attempt_count, 1);
    assert.equal(resetNetworkBucket.rows[0].blocked_until, null);


    const recoveryToken = await client.query(
      "INSERT INTO auth_recovery_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 minutes') RETURNING id",
      [actorId, Buffer.alloc(32, 9)],
    );
    assert.equal(recoveryToken.rowCount, 1);
    const recoveryStored = await client.query(
      "SELECT octet_length(token_hash) AS digest_bytes, consumed_at FROM auth_recovery_tokens WHERE id = $1",
      [recoveryToken.rows[0].id],
    );
    assert.equal(recoveryStored.rows[0].digest_bytes, 32);
    assert.equal(recoveryStored.rows[0].consumed_at, null);

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
    const resolvePrincipal = createPrincipalResolver({ pool: client });
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
        "INSERT INTO user_role_grants (user_id, role_id, scope_type, scope_id, granted_by) SELECT $1, id, 'program', $2, $3 FROM roles WHERE code = 'program_manager'",
        [workerId, programId, actorId],
      ),
      /unique constraint/i,
    );
    await client.query(
      "UPDATE user_role_grants SET revoked_at = now(), revoked_by = $2, revoke_reason = 'Access no longer required' WHERE id = $1",
      [scopedGrant.rows[0].id, actorId],
    );
    const revokedPrincipal = await resolvePrincipal({
      headers: { cookie: `__Host-userdie_session=${session.token}` },
    });
    assert.deepEqual(revokedPrincipal, {
      id: workerId, accountStatus: "active", grants: [],
    });
    const grantEvents = await client.query(
      "SELECT event_type, actor_id FROM user_role_grant_events WHERE grant_id = $1 ORDER BY id",
      [scopedGrant.rows[0].id],
    );
    assert.deepEqual(grantEvents.rows.map((row) => [row.event_type, row.actor_id]), [
      ["grant_created", actorId], ["grant_revoked", actorId],
    ]);
    await assert.rejects(
      client.query("DELETE FROM user_role_grants WHERE id = $1", [scopedGrant.rows[0].id]),
      /cannot be hard-deleted/i,
    );
    await assert.rejects(
      client.query("UPDATE user_role_grant_events SET details = '{}'::jsonb WHERE grant_id = $1", [scopedGrant.rows[0].id]),
      /append-only/i,
    );

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

    const approval = await client.query(
      `INSERT INTO approval_requests
        (object_type, object_id, program_id, title, summary, submitted_by,
         reviewer_id, materials_version)
       VALUES ('application', $1, $2, 'Independent review', 'Synthetic approval',
         $3, $4, 'v1')
       RETURNING id`,
      [applicationId, programId, actorId, workerId],
    );
    const approvalId = approval.rows[0].id;
    await assert.rejects(
      client.query(
        `INSERT INTO approval_requests
          (object_type, object_id, program_id, title, submitted_by, reviewer_id, materials_version)
         VALUES ('application', $1, $2, 'Self approval must fail', $3, $3, 'v1')`,
        [applicationId, programId, actorId],
      ),
      /check constraint/i,
    );
    await client.query(
      "INSERT INTO approval_events (approval_id, actor_id, event_type, rationale, materials_version) VALUES ($1, $2, 'submitted', 'Independent review requested', 'v1')",
      [approvalId, actorId],
    );
    await assert.rejects(
      client.query("UPDATE approval_events SET rationale = 'tampered' WHERE approval_id = $1", [approvalId]),
      /append-only/i,
    );
    await assert.rejects(
      client.query("DELETE FROM approval_events WHERE approval_id = $1", [approvalId]),
      /append-only/i,
    );

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
