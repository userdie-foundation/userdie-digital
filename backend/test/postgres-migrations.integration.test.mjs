import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createServer as createNodeServer } from "node:http";
import { once } from "node:events";
import { createPrincipalResolver } from "../src/security/principal.mjs";
import { createSessionToken } from "../src/security/session.mjs";
import { createLoginRateLimiter } from "../src/security/login-rate-limit.mjs";
import { createPartnershipRepository, createServer as createHttpHandler } from "../src/server.mjs";

const databaseUrl = process.env.PG_INTEGRATION_URL;

test("PostgreSQL applies migrations 001-021 and enforces workflow, authorization, recovery-token, MFA persistence, audit immutability, login-throttling, partnership, analytical-document, and privacy-consent invariants", {
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
      "011_audit_events_append_only.sql",
      "012_mfa_persistence.sql",
      "013_auth_recovery_rate_limits.sql",
      "014_partnership_workspace.sql",
      "015_asset_valuator_role.sql",
      "016_analytical_document_registry.sql",
      "017_analytical_document_lifecycle_guard.sql",
      "018_analytical_document_pdf_artifacts.sql",
      "019_analytical_document_lifecycle_immutability.sql",
      "020_analytical_document_artifact_immutability.sql",
      "021_privacy_consent_ledger.sql",
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

    await assert.rejects(
      client.query(
        `INSERT INTO privacy_consent_documents
          (document_code, document_version, consent_type, purpose_code, document_sha256,
           choice_keys, approved_by, approved_at, published_at)
         VALUES ('invalid_choices', '2026-11-19.1', 'personal_data', 'case_review', $1,
           ARRAY['contact_by_email', 'contact_by_email'], $2, now() - interval '2 minutes',
           now() - interval '1 minute')`,
        ["d".repeat(64), actorId],
      ),
      /privacy consent document choice keys must be unique and valid/i,
    );
    const consentDocument = await client.query(
      `INSERT INTO privacy_consent_documents
        (document_code, document_version, consent_type, purpose_code, document_sha256,
         choice_keys, approved_by, approved_at, published_at)
       VALUES ('aid_support', '2026-11-19.1', 'personal_data', 'case_review', $1,
         ARRAY['contact_by_email', 'contact_by_phone'], $2, now() - interval '2 minutes',
         now() - interval '1 minute')
       RETURNING id`,
      ["a".repeat(64), actorId],
    );
    const consentDocumentId = consentDocument.rows[0].id;
    await assert.rejects(
      client.query(
        "UPDATE privacy_consent_documents SET document_sha256 = $2 WHERE id = $1",
        [consentDocumentId, "b".repeat(64)],
      ),
      /privacy consent document version is immutable/i,
    );
    await assert.rejects(
      client.query("DELETE FROM privacy_consent_documents WHERE id = $1", [consentDocumentId]),
      /privacy consent document versions cannot be deleted/i,
    );
    await assert.rejects(
      client.query(
        `INSERT INTO privacy_consent_events
          (document_id, subject_user_id, actor_user_id, event_type, choices)
         VALUES ($1, $2, $2, 'granted', '{"contact_by_email":true}'::jsonb)`,
        [consentDocumentId, actorId],
      ),
      /privacy consent choices do not match the approved document/i,
    );

    const consentEvent = await client.query(
      `INSERT INTO privacy_consent_events
        (document_id, subject_user_id, actor_user_id, event_type, choices)
       VALUES ($1, $2, $2, 'granted', '{"contact_by_email":true,"contact_by_phone":false}'::jsonb)
       RETURNING id, capture_method`,
      [consentDocumentId, actorId],
    );
    assert.equal(consentEvent.rows[0].capture_method, "authenticated_session");

    await assert.rejects(
      client.query(
        `INSERT INTO privacy_consent_events
          (document_id, subject_user_id, actor_user_id, event_type, choices)
         VALUES ($1, $2, $3, 'granted', '{"contact_by_email":true,"contact_by_phone":false}'::jsonb)`,
        [consentDocumentId, actorId, workerId],
      ),
      /authenticated-session consent actor must be the subject/i,
    );
    await assert.rejects(
      client.query(
        `INSERT INTO privacy_consent_events
          (document_id, subject_user_id, actor_user_id, event_type, choices, previous_event_id)
         VALUES ($1, $2, $2, 'withdrawn', '{}'::jsonb, $3)`,
        [consentDocumentId, workerId, consentEvent.rows[0].id],
      ),
      /withdrawal must reference the latest active grant/i,
    );

    const withdrawalEvent = await client.query(
      `INSERT INTO privacy_consent_events
        (document_id, subject_user_id, actor_user_id, event_type, choices, previous_event_id)
       VALUES ($1, $2, $2, 'withdrawn', '{}'::jsonb, $3)
       RETURNING id, event_type`,
      [consentDocumentId, actorId, consentEvent.rows[0].id],
    );
    assert.equal(withdrawalEvent.rows[0].event_type, "withdrawn");
    await assert.rejects(
      client.query(
        `INSERT INTO privacy_consent_events
          (document_id, subject_user_id, actor_user_id, event_type, choices, previous_event_id)
         VALUES ($1, $2, $2, 'withdrawn', '{}'::jsonb, $3)`,
        [consentDocumentId, actorId, consentEvent.rows[0].id],
      ),
      /withdrawal must reference the latest active grant/i,
    );

    const renewedConsent = await client.query(
      `INSERT INTO privacy_consent_events
        (document_id, subject_user_id, actor_user_id, event_type, choices, occurred_at)
       VALUES ($1, $2, $2, 'granted', '{"contact_by_email":true,"contact_by_phone":false}'::jsonb,
         now() + interval '1 year')
       RETURNING occurred_at`,
      [consentDocumentId, actorId],
    );
    assert.ok(new Date(renewedConsent.rows[0].occurred_at).getTime() < Date.now() + 60_000);

    await assert.rejects(
      client.query(
        "UPDATE privacy_consent_events SET choices = '{}'::jsonb WHERE id = $1",
        [consentEvent.rows[0].id],
      ),
      /privacy consent events are append-only/i,
    );
    await assert.rejects(
      client.query("DELETE FROM privacy_consent_events WHERE id = $1", [consentEvent.rows[0].id]),
      /privacy consent events are append-only/i,
    );
    await assert.rejects(
      client.query("TRUNCATE privacy_consent_events"),
      /privacy consent events are append-only/i,
    );
    await client.query(
      "UPDATE privacy_consent_documents SET revoked_at = now() WHERE id = $1",
      [consentDocumentId],
    );
    await assert.rejects(
      client.query(
        "UPDATE privacy_consent_documents SET revoked_at = now() + interval '1 second' WHERE id = $1",
        [consentDocumentId],
      ),
      /privacy consent document version is immutable/i,
    );
    await assert.rejects(
      client.query("TRUNCATE privacy_consent_documents"),
      /privacy consent document versions cannot be truncated/i,
    );
    await assert.rejects(
      client.query(
        `INSERT INTO privacy_consent_events
          (document_id, subject_user_id, actor_user_id, event_type, choices)
         VALUES ($1, $2, $2, 'granted', '{"contact_by_email":true,"contact_by_phone":false}'::jsonb)`,
        [consentDocumentId, actorId],
      ),
      /privacy consent document version is not active/i,
    );

    const specialConsentDocument = await client.query(
      `INSERT INTO privacy_consent_documents
        (document_code, document_version, consent_type, purpose_code, document_sha256,
         choice_keys, approved_by, approved_at, published_at)
       VALUES ('special_support', '2026-11-19.1', 'special_category', 'health_support', $1,
         ARRAY['health_data'], $2, now() - interval '2 minutes', now() - interval '1 minute')
       RETURNING id`,
      ["c".repeat(64), actorId],
    );
    await assert.rejects(
      client.query(
        `INSERT INTO privacy_consent_events
          (document_id, subject_user_id, actor_user_id, event_type, choices)
         VALUES ($1, $2, $2, 'granted', '{"health_data":true}'::jsonb)`,
        [specialConsentDocument.rows[0].id, actorId],
      ),
      /written consent capture is required for special-category data/i,
    );

    const auditFixture = await client.query(
      "INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, 'integration.audit_fixture', 'test', 'append-only', '{}'::jsonb) RETURNING id",
      [actorId],
    );
    const auditId = auditFixture.rows[0].id;
    await assert.rejects(
      client.query("UPDATE audit_events SET action = 'tampered' WHERE id = $1", [auditId]),
      /audit_events is append-only/i,
    );
    await assert.rejects(
      client.query("DELETE FROM audit_events WHERE id = $1", [auditId]),
      /audit_events is append-only/i,
    );
    await assert.rejects(
      client.query("TRUNCATE audit_events"),
      /audit_events is append-only/i,
    );

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


    const recoveryBuckets = await client.query(
      `INSERT INTO auth_recovery_rate_limit_buckets
        (bucket_type, key_hash, window_started_at, attempt_count)
       VALUES ('account', $1, now(), 1), ('network', $2, now(), 1)
       RETURNING bucket_type, octet_length(key_hash) AS digest_bytes`,
      [Buffer.alloc(32, 21), Buffer.alloc(32, 22)],
    );
    assert.deepEqual(
      recoveryBuckets.rows.map((row) => [row.bucket_type, row.digest_bytes]),
      [["account", 32], ["network", 32]],
    );
    await assert.rejects(
      client.query(
        `INSERT INTO auth_recovery_rate_limit_buckets
          (bucket_type, key_hash, window_started_at, attempt_count)
         VALUES ('account', $1, now(), 1)`,
        [Buffer.alloc(31, 23)],
      ),
      /check constraint/i,
    );

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

    const factor = await client.query(
      `INSERT INTO auth_mfa_factors
        (user_id, factor_type, secret_ciphertext, secret_nonce, secret_auth_tag, encryption_key_id)
       VALUES ($1, 'totp', $2, $3, $4, 'integration-key-v1')
       RETURNING id, status, last_accepted_step`,
      [actorId, Buffer.alloc(32, 3), Buffer.alloc(12, 4), Buffer.alloc(16, 5)],
    );
    assert.equal(factor.rows[0].status, "pending");
    assert.equal(factor.rows[0].last_accepted_step, null);
    await assert.rejects(
      client.query(
        `INSERT INTO auth_mfa_factors
          (user_id, factor_type, secret_ciphertext, secret_nonce, secret_auth_tag, encryption_key_id)
         VALUES ($1, 'totp', $2, $3, $4, 'integration-key-v1')`,
        [workerId, Buffer.alloc(32, 10), Buffer.alloc(12, 4), Buffer.alloc(16, 11)],
      ),
      /unique constraint/i,
    );
    await assert.rejects(
      client.query(
        `INSERT INTO auth_mfa_factors
          (user_id, factor_type, secret_ciphertext, secret_nonce, secret_auth_tag, encryption_key_id, status, confirmed_at)
         VALUES ($1, 'totp', $2, $3, $4, 'integration-key-v1', 'active', now())`,
        [actorId, Buffer.alloc(32, 3), Buffer.alloc(11, 4), Buffer.alloc(16, 5)],
      ),
      /check constraint/i,
    );
    const challenge = await client.query(
      `INSERT INTO auth_mfa_challenges (user_id, challenge_hash, expires_at)
       VALUES ($1, $2, now() + interval '5 minutes') RETURNING id, attempt_count`,
      [actorId, Buffer.alloc(32, 6)],
    );
    assert.equal(challenge.rows[0].attempt_count, 0);
    await assert.rejects(
      client.query(
        `INSERT INTO auth_mfa_challenges (user_id, challenge_hash, expires_at, attempt_count)
         VALUES ($1, $2, now() + interval '5 minutes', 6)`,
        [actorId, Buffer.alloc(32, 7)],
      ),
      /check constraint/i,
    );
    const recoveryCode = await client.query(
      `INSERT INTO auth_mfa_recovery_codes (user_id, batch_id, verifier)
       VALUES ($1, $2, $3) RETURNING id, consumed_at`,
      [actorId, randomUUID(), Buffer.alloc(32, 8)],
    );
    assert.equal(recoveryCode.rows[0].consumed_at, null);
    await client.query(
      "UPDATE auth_mfa_factors SET status = 'active', confirmed_at = now(), last_accepted_step = 123456 WHERE id = $1",
      [factor.rows[0].id],
    );
    const activeFactor = await client.query(
      "SELECT status, last_accepted_step, octet_length(secret_nonce) AS nonce_bytes, octet_length(secret_auth_tag) AS tag_bytes FROM auth_mfa_factors WHERE id = $1",
      [factor.rows[0].id],
    );
    assert.deepEqual(activeFactor.rows[0], {
      status: "active", last_accepted_step: "123456", nonce_bytes: 12, tag_bytes: 16,
    });
    await client.query(
      "UPDATE auth_mfa_recovery_codes SET consumed_at = now() WHERE id = $1",
      [recoveryCode.rows[0].id],
    );

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

    const partnerOrganization = await client.query(
      "INSERT INTO organizations (name, organization_type, status) VALUES ('Historical partner fixture', 'partner', 'pending') RETURNING id",
    );
    const partnerOrganizationId = partnerOrganization.rows[0].id;
    await client.query(
      `INSERT INTO partner_profiles
        (organization_id, historical_name, identity_status, source_reference, assigned_to)
       VALUES ($1, 'Historical partner fixture', 'requires_identification',
         'docs/HISTORICAL_PARTNERS_REGISTER.md', $2)`,
      [partnerOrganizationId, workerId],
    );
    const partnership = await client.query(
      `INSERT INTO partnerships
        (organization_id, relationship_type, status, summary, created_by)
       VALUES ($1, 'historical', 'historical_record', 'Unverified historical reference', $2)
       RETURNING id`,
      [partnerOrganizationId, actorId],
    );
    const partnershipId = partnership.rows[0].id;

    const secondPartnerOrganization = await client.query(
      "INSERT INTO organizations (name, organization_type, status) VALUES ('Second partner fixture', 'partner', 'pending') RETURNING id",
    );
    const secondPartnerOrganizationId = secondPartnerOrganization.rows[0].id;
    await client.query(
      `INSERT INTO partner_profiles
        (organization_id, historical_name, identity_status, source_reference, assigned_to)
       VALUES ($1, 'Second partner fixture', 'requires_identification',
         'docs/SECOND_HISTORICAL_PARTNER.md', $2)`,
      [secondPartnerOrganizationId, otherWorkerId],
    );
    const secondPartnership = await client.query(
      `INSERT INTO partnerships
        (organization_id, relationship_type, status, summary, created_by)
       VALUES ($1, 'historical', 'historical_record', 'Second unverified reference', $2)
       RETURNING id`,
      [secondPartnerOrganizationId, actorId],
    );
    const secondPartnershipId = secondPartnership.rows[0].id;

    const partnershipRepository = createPartnershipRepository(client);
    const ownOrganizationRows = await partnershipRepository.listVisible({
      id: workerId,
      grants: [{
        roleCode: "partner",
        scopeType: "organization",
        scopeId: partnerOrganizationId,
      }],
    }, 25);
    assert.deepEqual(ownOrganizationRows.map((row) => row.id), [partnershipId]);
    assert.equal(ownOrganizationRows[0].assignedTo, workerId);

    const otherOrganizationRows = await partnershipRepository.listVisible({
      id: workerId,
      grants: [{
        roleCode: "partner",
        scopeType: "organization",
        scopeId: secondPartnerOrganizationId,
      }],
    }, 25);
    assert.deepEqual(otherOrganizationRows.map((row) => row.id), [secondPartnershipId]);

    const assignedCaseRows = await partnershipRepository.listVisible({
      id: workerId,
      grants: [{ roleCode: "case_worker", scopeType: "global" }],
    }, 25);
    assert.deepEqual(assignedCaseRows.map((row) => row.id), [partnershipId]);

    const auditorRows = await partnershipRepository.listVisible({
      id: otherWorkerId,
      grants: [{ roleCode: "auditor", scopeType: "global" }],
    }, 25);
    assert.deepEqual(new Set(auditorRows.map((row) => row.id)), new Set([partnershipId, secondPartnershipId]));

    const administratorRows = await partnershipRepository.listVisible({
      id: actorId,
      grants: [{ roleCode: "administrator", scopeType: "global" }],
    }, 25);
    assert.equal(administratorRows.length, 2);

    const limitedRows = await partnershipRepository.listVisible({
      id: actorId,
      grants: [{ roleCode: "auditor", scopeType: "global" }],
    }, 1);
    assert.equal(limitedRows.length, 1);

    const unscopedRows = await partnershipRepository.listVisible({
      id: otherWorkerId,
      grants: [],
    }, 25);
    assert.deepEqual(unscopedRows, []);

    const partnershipDetail = await partnershipRepository.getById(partnershipId);
    assert.equal(partnershipDetail.id, partnershipId);
    assert.equal(partnershipDetail.organizationId, partnerOrganizationId);
    assert.equal(partnershipDetail.assignedTo, workerId);

    const pendingPartnershipApproval = await client.query(
      `INSERT INTO approval_requests
        (object_type, object_id, title, summary, submitted_by, reviewer_id, materials_version)
       VALUES ('partnership', $1, 'Confirm partnership', 'Independent verification',
         $2, $3, 'v1')
       RETURNING id`,
      [partnershipId, actorId, workerId],
    );
    await assert.rejects(
      client.query(
        `UPDATE partnerships
         SET status = 'active_confirmed', confirmation_submitted_by = $2,
             confirmation_approval_id = $3, confirmed_by = $4, confirmed_at = now()
         WHERE id = $1`,
        [partnershipId, actorId, pendingPartnershipApproval.rows[0].id, workerId],
      ),
      /requires a matching independent approved decision/i,
    );

    await client.query(
      "UPDATE approval_requests SET status = 'approved', decided_at = now() WHERE id = $1",
      [pendingPartnershipApproval.rows[0].id],
    );
    await client.query(
      `UPDATE partnerships
       SET status = 'active_confirmed', confirmation_submitted_by = $2,
           confirmation_approval_id = $3, confirmed_by = $4, confirmed_at = now(),
           updated_by = $4
       WHERE id = $1`,
      [partnershipId, actorId, pendingPartnershipApproval.rows[0].id, workerId],
    );
    const confirmedPartnership = await client.query(
      "SELECT status, confirmation_submitted_by, confirmed_by FROM partnerships WHERE id = $1",
      [partnershipId],
    );
    assert.deepEqual(confirmedPartnership.rows[0], {
      status: "active_confirmed",
      confirmation_submitted_by: actorId,
      confirmed_by: workerId,
    });

    const evidence = await client.query(
      `INSERT INTO partnership_evidence
        (partnership_id, evidence_type, title, storage_key, created_by)
       VALUES ($1, 'archive_record', 'Archived source reference',
         $2, $3)
       RETURNING id, verification_status, access_level, publication_status`,
      [partnershipId, `private/partnerships/${partnershipId}/evidence-1`, actorId],
    );
    assert.deepEqual(evidence.rows[0], {
      id: evidence.rows[0].id,
      verification_status: "pending",
      access_level: "restricted",
      publication_status: "not_publishable",
    });

    const evidenceMetadata = await partnershipRepository.listEvidenceByPartnership(partnershipId);
    assert.equal(evidenceMetadata.length, 1);
    assert.deepEqual(evidenceMetadata[0], {
      id: evidence.rows[0].id,
      partnershipId,
      evidenceType: "archive_record",
      title: "Archived source reference",
      documentDate: null,
      issuer: null,
      verificationStatus: "pending",
      verifiedAt: null,
      accessLevel: "restricted",
      publicationStatus: "not_publishable",
      createdAt: evidenceMetadata[0].createdAt,
      updatedAt: evidenceMetadata[0].updatedAt,
    });
    assert.equal("storageKey" in evidenceMetadata[0], false);
    assert.equal("storage_key" in evidenceMetadata[0], false);
    await assert.rejects(
      client.query(
        "UPDATE partnership_evidence SET publication_status = 'approved' WHERE id = $1",
        [evidence.rows[0].id],
      ),
      /check constraint/i,
    );
    await client.query(
      `UPDATE partnership_evidence
       SET verification_status = 'verified', verified_by = $2, verified_at = now(),
           publication_status = 'approved'
       WHERE id = $1`,
      [evidence.rows[0].id, workerId],
    );

    await client.query(
      `INSERT INTO partnership_status_events
        (partnership_id, previous_status, new_status, actor_id, rationale,
         evidence_id, approval_id)
       VALUES ($1, 'historical_record', 'active_confirmed', $2,
         'Independent approval verified', $3, $4)`,
      [partnershipId, workerId, evidence.rows[0].id, pendingPartnershipApproval.rows[0].id],
    );
    await assert.rejects(
      client.query(
        "UPDATE partnership_status_events SET rationale = 'tampered' WHERE partnership_id = $1",
        [partnershipId],
      ),
      /partnership history is append-only/i,
    );
    await assert.rejects(
      client.query(
        "DELETE FROM partnership_status_events WHERE partnership_id = $1",
        [partnershipId],
      ),
      /partnership history is append-only/i,
    );

    const analyticalDocument = await client.query(
      `INSERT INTO analytical_documents
        (document_type, organizational_contour, asset_reference, title,
         created_by, assigned_reviewer_id)
       VALUES ('preliminary_valuation', 'assets', 'ASSET-TEST-001',
         'Synthetic asset analysis', $1, $2)
       RETURNING id, status, document_number`,
      [actorId, workerId],
    );
    const analyticalDocumentId = analyticalDocument.rows[0].id;
    assert.equal(analyticalDocument.rows[0].status, "draft");
    assert.equal(analyticalDocument.rows[0].document_number, null);

    const firstVersion = await client.query(
      `INSERT INTO analytical_document_versions
        (document_id, version_number, content, content_sha256, created_by)
       VALUES ($1, 1, '{"summary":"Synthetic test content v1"}'::jsonb, $2, $3)
       RETURNING id, version_number`,
      [analyticalDocumentId, "a".repeat(64), actorId],
    );
    const firstVersionId = firstVersion.rows[0].id;
    assert.equal(firstVersion.rows[0].version_number, 1);
    await assert.rejects(
      client.query(
        "UPDATE analytical_document_versions SET content = '{}'::jsonb WHERE id = $1",
        [firstVersionId],
      ),
      /analytical document versions are immutable/i,
    );
    await assert.rejects(
      client.query(
        "DELETE FROM analytical_document_versions WHERE id = $1",
        [firstVersionId],
      ),
      /analytical document versions are immutable/i,
    );

    const firstApproval = await client.query(
      `INSERT INTO analytical_document_approvals
        (document_id, document_version_id, submitted_by, reviewer_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, status`,
      [analyticalDocumentId, firstVersionId, actorId, workerId],
    );
    assert.equal(firstApproval.rows[0].status, "pending");
    await assert.rejects(
      client.query(
        `INSERT INTO analytical_document_approvals
          (document_id, document_version_id, submitted_by, reviewer_id)
         VALUES ($1, $2, $3, $3)`,
        [analyticalDocumentId, firstVersionId, actorId],
      ),
      /check constraint/i,
    );

    await client.query(
      "UPDATE analytical_documents SET status = 'submitted_for_review', updated_at = now() WHERE id = $1",
      [analyticalDocumentId],
    );
    await client.query(
      "UPDATE analytical_document_approvals SET status = 'changes_requested', decided_at = now(), decision_rationale = 'Please add verified comparable evidence' WHERE id = $1",
      [firstApproval.rows[0].id],
    );
    await client.query(
      "UPDATE analytical_documents SET status = 'changes_requested', updated_at = now() WHERE id = $1",
      [analyticalDocumentId],
    );
    await assert.rejects(
      client.query(
        "UPDATE analytical_document_approvals SET decision_rationale = 'tampered' WHERE id = $1",
        [firstApproval.rows[0].id],
      ),
      /analytical document approval decision is immutable/i,
    );
    await assert.rejects(
      client.query(
        "DELETE FROM analytical_document_approvals WHERE id = $1",
        [firstApproval.rows[0].id],
      ),
      /analytical document approval history is append-only/i,
    );

    const secondVersion = await client.query(
      `INSERT INTO analytical_document_versions
        (document_id, version_number, content, content_sha256, created_by)
       VALUES ($1, 2, '{"summary":"Synthetic test content v2 with revised evidence"}'::jsonb, $2, $3)
       RETURNING id, version_number`,
      [analyticalDocumentId, "b".repeat(64), actorId],
    );
    const secondVersionId = secondVersion.rows[0].id;
    assert.equal(secondVersion.rows[0].version_number, 2);
    await client.query(
      "UPDATE analytical_documents SET status = 'draft', updated_at = now() WHERE id = $1",
      [analyticalDocumentId],
    );

    const secondApproval = await client.query(
      `INSERT INTO analytical_document_approvals
        (document_id, document_version_id, submitted_by, reviewer_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, status`,
      [analyticalDocumentId, secondVersionId, actorId, workerId],
    );
    assert.equal(secondApproval.rows[0].status, "pending");
    await client.query(
      "UPDATE analytical_documents SET status = 'submitted_for_review', updated_at = now() WHERE id = $1",
      [analyticalDocumentId],
    );

    await assert.rejects(
      client.query(
        `UPDATE analytical_documents
         SET status = 'approved', approved_by = $2, approved_at = now(),
             approved_version_id = $3, updated_at = now()
         WHERE id = $1`,
        [analyticalDocumentId, workerId, firstVersionId],
      ),
      /approval must match the author, independent reviewer, and exact document version/i,
    );

    await client.query(
      "UPDATE analytical_document_approvals SET status = 'approved', decided_at = now(), decision_rationale = 'Independent synthetic review accepted version 2' WHERE id = $1",
      [secondApproval.rows[0].id],
    );
    await client.query(
      `UPDATE analytical_documents
       SET status = 'approved', approved_by = $2, approved_at = now(),
           approved_version_id = $3, updated_at = now()
       WHERE id = $1`,
      [analyticalDocumentId, workerId, secondVersionId],
    );

    await assert.rejects(
      client.query(
        `UPDATE analytical_documents
         SET status = 'issued', document_number = 'UA-2026-000001',
             issued_at = now(), issued_version_id = $2, updated_at = now()
         WHERE id = $1`,
        [analyticalDocumentId, firstVersionId],
      ),
      /only the (previously )?approved document version may be issued/i,
    );

    await client.query(
      `UPDATE analytical_documents
       SET status = 'issued', document_number = 'UA-2026-000001',
           issued_at = now(), issued_version_id = $2, updated_at = now()
       WHERE id = $1`,
      [analyticalDocumentId, secondVersionId],
    );
    const issuedDocument = await client.query(
      "SELECT status, document_number, approved_by, created_by, approved_version_id, issued_version_id FROM analytical_documents WHERE id = $1",
      [analyticalDocumentId],
    );
    assert.deepEqual(issuedDocument.rows[0], {
      status: "issued",
      document_number: "UA-2026-000001",
      approved_by: workerId,
      created_by: actorId,
      approved_version_id: secondVersionId,
      issued_version_id: secondVersionId,
    });

    await assert.rejects(
      client.query(
        "UPDATE analytical_documents SET approved_version_id = $2 WHERE id = $1",
        [analyticalDocumentId, firstVersionId],
      ),
      /approved analytical document facts are immutable/i,
    );
    await assert.rejects(
      client.query(
        "UPDATE analytical_documents SET issued_version_id = $2 WHERE id = $1",
        [analyticalDocumentId, firstVersionId],
      ),
      /issued analytical document facts are immutable/i,
    );
    await assert.rejects(
      client.query(
        "UPDATE analytical_documents SET title = 'Tampered issued title' WHERE id = $1",
        [analyticalDocumentId],
      ),
      /analytical document identity is immutable after submission/i,
    );
    await assert.rejects(
      client.query(
        "UPDATE analytical_documents SET status = 'draft', approved_by = NULL, approved_at = NULL, approved_version_id = NULL, issued_version_id = NULL, document_number = NULL, issued_at = NULL WHERE id = $1",
        [analyticalDocumentId],
      ),
      /invalid analytical document lifecycle transition/i,
    );

    await assert.rejects(
      client.query(
        `INSERT INTO analytical_documents
          (document_type, organizational_contour, title, status, created_by,
           approved_by, approved_at, document_number, issued_at)
         VALUES ('asset_analysis', 'assets', 'Invalid self-issued document',
           'issued', $1, $1, now(), 'UA-2026-000002', now())`,
        [actorId],
      ),
      /check constraint/i,
    );

    await client.query(
      `INSERT INTO analytical_document_events
        (document_id, document_version_id, actor_id, event_type,
         previous_status, new_status, details)
       VALUES ($1, $2, $3, 'issued', 'approved', 'issued',
         '{"registration":"UA-2026-000001","version":2}'::jsonb)`,
      [analyticalDocumentId, secondVersionId, workerId],
    );
    await assert.rejects(
      client.query(
        "UPDATE analytical_document_events SET details = '{}'::jsonb WHERE document_id = $1",
        [analyticalDocumentId],
      ),
      /analytical document events are append-only/i,
    );
    await assert.rejects(
      client.query(
        "DELETE FROM analytical_document_events WHERE document_id = $1",
        [analyticalDocumentId],
      ),
      /analytical document events are append-only/i,
    );


    const reviewerGrant = await client.query(
      `INSERT INTO user_role_grants (user_id, role_id, scope_type, scope_id, granted_by)
       SELECT $1, id, 'contour', 'assets', $2 FROM roles WHERE code = 'independent_approver'
       RETURNING id`,
      [workerId, actorId],
    );
    assert.equal(reviewerGrant.rowCount, 1, "independent reviewer role must exist in the migrated schema");

    const pdfStorageDirectory = await mkdtemp(join(tmpdir(), "userdie-pdf-it-"));
    const apiPool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      options: `-c search_path=${schema}`,
    });
    const principals = {
      author: {
        id: actorId, accountStatus: "active",
        grants: [{ roleCode: "asset_valuator", scopeType: "contour", scopeId: "assets" }],
      },
      reviewer: {
        id: workerId, accountStatus: "active",
        grants: [{ roleCode: "independent_approver", scopeType: "contour", scopeId: "assets" }],
      },
      outsider: { id: otherWorkerId, accountStatus: "active", grants: [] },
    };
    const server = createNodeServer(createHttpHandler({
      pool: apiPool,
      allowedOrigin: "https://platform.example",
      resolvePrincipal: async (req) => principals[req.headers["x-test-actor"]] ?? null,
      pdfStorageDirectory,
      pdfFontRegularPath: "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
      pdfFontBoldPath: "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
    }));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const apiBase = `http://127.0.0.1:${address.port}`;
    const apiRequest = (path, { actor = "author", method = "GET", body } = {}) => fetch(apiBase + path, {
      method,
      headers: {
        origin: "https://platform.example",
        "x-test-actor": actor,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    try {
      const createResponse = await apiRequest("/api/v1/analytical-documents", {
        method: "POST",
        body: {
          documentType: "preliminary_valuation",
          organizationalContour: "assets",
          assetReference: "ASSET-HTTP-E2E-001",
          title: "Synthetic API lifecycle conclusion",
          reviewerId: workerId,
          content: { summary: "Version 1", methodology: "Synthetic integration fixture" },
        },
      });
      assert.equal(createResponse.status, 201);
      const created = await createResponse.json();
      const apiDocumentId = created.document.id;
      const apiFirstVersionId = created.version.id;
      assert.match(created.version.sha256, /^[0-9a-f]{64}$/);

      const outsiderList = await apiRequest("/api/v1/analytical-documents", { actor: "outsider" });
      assert.equal(outsiderList.status, 200);
      assert.equal((await outsiderList.json()).count, 0);
      const outsiderDetail = await apiRequest(`/api/v1/analytical-documents/${apiDocumentId}`, { actor: "outsider" });
      assert.equal(outsiderDetail.status, 404);

      const submitFirst = await apiRequest(`/api/v1/analytical-documents/${apiDocumentId}/submit`, { method: "POST" });
      assert.equal(submitFirst.status, 201);
      const selfDecision = await apiRequest(`/api/v1/analytical-documents/${apiDocumentId}/decision`, {
        method: "POST",
        body: { decision: "approved", rationale: "Self-approval must be denied" },
      });
      assert.equal(selfDecision.status, 403);

      const changesRequested = await apiRequest(`/api/v1/analytical-documents/${apiDocumentId}/decision`, {
        actor: "reviewer",
        method: "POST",
        body: { decision: "changes_requested", rationale: "Add verified comparable evidence" },
      });
      assert.equal(changesRequested.status, 200);
      assert.equal((await changesRequested.json()).decision.status, "changes_requested");

      const reviseResponse = await apiRequest(`/api/v1/analytical-documents/${apiDocumentId}/versions`, {
        method: "POST",
        body: { content: { summary: "Version 2", methodology: "Revised synthetic fixture", comparables: ["Comparable A"] } },
      });
      assert.equal(reviseResponse.status, 201);
      const revised = await reviseResponse.json();
      assert.equal(revised.version.number, 2);
      assert.notEqual(revised.version.sha256, created.version.sha256);

      const submitSecond = await apiRequest(`/api/v1/analytical-documents/${apiDocumentId}/submit`, { method: "POST" });
      assert.equal(submitSecond.status, 201);
      const approved = await apiRequest(`/api/v1/analytical-documents/${apiDocumentId}/decision`, {
        actor: "reviewer",
        method: "POST",
        body: { decision: "approved", rationale: "Independent review accepted revised version" },
      });
      assert.equal(approved.status, 200);
      assert.equal((await approved.json()).decision.status, "approved");

      const concurrentIssues = await Promise.all([
        apiRequest(`/api/v1/analytical-documents/${apiDocumentId}/issue`, { method: "POST" }),
        apiRequest(`/api/v1/analytical-documents/${apiDocumentId}/issue`, { method: "POST" }),
      ]);
      assert.deepEqual(concurrentIssues.map((response) => response.status).sort(), [200, 409]);

      const detailResponse = await apiRequest(`/api/v1/analytical-documents/${apiDocumentId}`);
      assert.equal(detailResponse.status, 200);
      const detail = await detailResponse.json();
      assert.equal(detail.document.status, "issued");
      assert.equal(detail.versions.length, 2);
      assert.equal(detail.approvals.length, 2);
      assert.equal(detail.events.filter((event) => event.event_type === "changes_requested").length, 1);
      assert.equal(detail.events.filter((event) => event.event_type === "issued").length, 1);
      const finalVersion = detail.versions.find((version) => version.id === revised.version.id);
      assert.ok(finalVersion);
      assert.equal(detail.approvals.find((approval) => approval.status === "approved").document_version_id, revised.version.id);
      const issuedRow = await apiPool.query(
        "SELECT approved_version_id, issued_version_id FROM analytical_documents WHERE id = $1::uuid",
        [apiDocumentId],
      );
      assert.equal(issuedRow.rows[0].approved_version_id, revised.version.id);
      assert.equal(issuedRow.rows[0].issued_version_id, revised.version.id);
      assert.notEqual(revised.version.id, apiFirstVersionId);

      const unauthorizedPdf = await apiRequest(`/api/v1/analytical-documents/${apiDocumentId}/pdf`, { actor: "outsider" });
      assert.equal(unauthorizedPdf.status, 404);
      const pdfResponse = await apiRequest(`/api/v1/analytical-documents/${apiDocumentId}/pdf`);
      assert.equal(pdfResponse.status, 200);
      assert.equal(pdfResponse.headers.get("content-type"), "application/pdf");
      assert.match(pdfResponse.headers.get("content-disposition") ?? "", /^attachment; filename="UA-2026-/);
      const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
      assert.equal(pdfBytes.subarray(0, 5).toString("ascii"), "%PDF-");
      assert.ok(pdfBytes.length > 1000);
      const pdfArtifact = await apiPool.query(
        `SELECT storage_key, content_sha256, byte_size, document_version_id
         FROM analytical_document_artifacts WHERE document_id = $1::uuid`,
        [apiDocumentId],
      );
      assert.equal(pdfArtifact.rowCount, 1);
      assert.equal(pdfArtifact.rows[0].document_version_id, revised.version.id);
      assert.equal(Number(pdfArtifact.rows[0].byte_size), pdfBytes.length);

    await assert.rejects(
      client.query(
        "UPDATE analytical_document_artifacts SET content_sha256 = $2 WHERE document_id = $1",
        [apiDocumentId, "c".repeat(64)],
      ),
      /analytical document artifacts are append-only/i,
    );
    await assert.rejects(
      client.query("DELETE FROM analytical_document_artifacts WHERE document_id = $1", [apiDocumentId]),
      /analytical document artifacts are append-only/i,
    );
    await assert.rejects(
      client.query("TRUNCATE analytical_document_artifacts"),
      /analytical document artifacts are append-only/i,
    );
      const secondPdfResponse = await apiRequest(`/api/v1/analytical-documents/${apiDocumentId}/pdf`);
      assert.equal(secondPdfResponse.status, 200);
      assert.deepEqual(Buffer.from(await secondPdfResponse.arrayBuffer()), pdfBytes);
      const pdfAudit = await apiPool.query(
        `SELECT action FROM audit_events
         WHERE entity_type = 'analytical_document' AND entity_id = $1
           AND action IN ('analytical_document.pdf_generated', 'analytical_document.pdf_downloaded')
         ORDER BY action`,
        [apiDocumentId],
      );
      assert.deepEqual(pdfAudit.rows.map((row) => row.action), [
        "analytical_document.pdf_downloaded",
        "analytical_document.pdf_downloaded",
        "analytical_document.pdf_generated",
      ]);

      await client.query(`
        CREATE FUNCTION reject_analytical_document_draft_audit()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.entity_type = 'analytical_document' AND NEW.action = 'analytical_document.draft_created' THEN
            RAISE EXCEPTION 'synthetic audit rollback probe';
          END IF;
          RETURN NEW;
        END;
        $$;
      `);
      await client.query(`
        CREATE TRIGGER reject_analytical_document_draft_audit
        BEFORE INSERT ON audit_events
        FOR EACH ROW EXECUTE FUNCTION reject_analytical_document_draft_audit()
      `);
      try {
        const rollbackResponse = await apiRequest("/api/v1/analytical-documents", {
          method: "POST",
          body: {
            documentType: "asset_analysis",
            organizationalContour: "assets",
            assetReference: "ASSET-ROLLBACK-PROBE",
            title: "Synthetic audit rollback probe",
            reviewerId: workerId,
            content: { summary: "This document must roll back with its audit record" },
          },
        });
        assert.equal(rollbackResponse.status, 503);
        const rolledBack = await apiPool.query(
          "SELECT count(*)::int AS count FROM analytical_documents WHERE asset_reference = 'ASSET-ROLLBACK-PROBE'",
        );
        assert.equal(rolledBack.rows[0].count, 0);
      } finally {
        await client.query("DROP TRIGGER IF EXISTS reject_analytical_document_draft_audit ON audit_events");
        await client.query("DROP FUNCTION IF EXISTS reject_analytical_document_draft_audit()");
      }
    } finally {
      server.close();
      await once(server, "close");
      await apiPool.end();
      await rm(pdfStorageDirectory, { recursive: true, force: true });
    }

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
