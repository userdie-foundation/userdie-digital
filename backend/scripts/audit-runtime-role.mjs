import { Pool } from "pg";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const REQUIRED_TRIGGERS = new Set([
  "privacy_consent_documents_immutable",
  "privacy_consent_documents_no_truncate",
  "privacy_consent_documents_validate_choices",
  "privacy_consent_events_integrity",
  "privacy_consent_events_no_update_delete",
  "privacy_consent_events_no_truncate",
]);

const TABLE_POLICY = {
  privacy_consent_documents: {
    SELECT: true, INSERT: false, UPDATE: false, DELETE: false,
    TRUNCATE: false, REFERENCES: false, TRIGGER: false,
  },
  privacy_consent_events: {
    SELECT: true, INSERT: true, UPDATE: false, DELETE: false,
    TRUNCATE: false, REFERENCES: false, TRIGGER: false,
  },
};

function addFinding(findings, condition, message) {
  if (!condition) findings.push(message);
}

export function evaluateRuntimeRoleAudit({ role, memberships, schema, tables, triggers, defaultGrants }) {
  const findings = [];
  addFinding(findings, Boolean(role), "Configured runtime role does not exist.");
  if (!role) return findings;

  addFinding(findings, role.rolcanlogin === true, "Runtime role must be able to log in.");
  for (const attribute of ["rolsuper", "rolcreaterole", "rolcreatedb", "rolreplication", "rolbypassrls"]) {
    addFinding(findings, role[attribute] === false, `Runtime role has forbidden attribute: ${attribute}.`);
  }
  addFinding(findings, memberships.length === 0, "Runtime role has direct or transitive role memberships.");
  addFinding(findings, schema?.can_use === true, "Runtime role is missing USAGE on the application schema.");
  addFinding(findings, schema?.can_create === false, "Runtime role can CREATE objects in the application schema.");
  addFinding(findings, schema?.owner !== role.rolname, "Runtime role owns the application schema.");

  for (const [tableName, policy] of Object.entries(TABLE_POLICY)) {
    const table = tables.find((entry) => entry.table_name === tableName);
    addFinding(findings, Boolean(table), `Required table is missing: ${tableName}.`);
    if (!table) continue;
    addFinding(findings, table.owner !== role.rolname, `Runtime role owns protected table: ${tableName}.`);
    for (const [privilege, expected] of Object.entries(policy)) {
      addFinding(
        findings,
        table[`can_${privilege.toLowerCase()}`] === expected,
        `${tableName}: unexpected effective ${privilege} privilege (expected ${expected}).`,
      );
    }
  }

  const enabledTriggers = new Set(
    triggers.filter((trigger) => trigger.enabled === "O" || trigger.enabled === "A")
      .map((trigger) => trigger.trigger_name),
  );
  for (const triggerName of REQUIRED_TRIGGERS) {
    addFinding(findings, enabledTriggers.has(triggerName), `Required protection trigger is missing or disabled: ${triggerName}.`);
  }
  for (const trigger of triggers) {
    addFinding(findings, trigger.function_owner !== role.rolname, `Runtime role owns protection function for trigger: ${trigger.trigger_name}.`);
  }
  for (const grant of defaultGrants) {
    addFinding(findings, false, `Runtime role receives a default privilege on future objects via ${grant.grantee ?? "an unclassified grantee"}: ${grant.object_type} in ${grant.schema_name ?? "all schemas"}.`);
  }
  return findings;
}

async function main() {
  const connectionString = process.env.PG_AUDIT_DATABASE_URL;
  const runtimeRole = process.env.PG_RUNTIME_ROLE;

  if (!connectionString || !runtimeRole) {
    process.stderr.write(
      "Set PG_AUDIT_DATABASE_URL (read-only DBA audit connection) and PG_RUNTIME_ROLE. No database changes are made.\n",
    );
    process.exitCode = 2;
    return;
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_$]{0,62}$/.test(runtimeRole)) {
    process.stderr.write("PG_RUNTIME_ROLE must be a valid PostgreSQL role identifier.\n");
    process.exitCode = 2;
    return;
  }

  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000 });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    const roleResult = await client.query(
      `SELECT oid, rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
              rolcanlogin, rolreplication, rolbypassrls
       FROM pg_roles WHERE rolname = $1`,
      [runtimeRole],
    );
    const role = roleResult.rows[0] ?? null;
    let memberships = [];
    let schema = null;
    let tables = [];
    let triggers = [];
    let defaultGrants = [];

    if (role) {
      const membershipResult = await client.query(
        `WITH RECURSIVE inherited(role_oid, path) AS (
           SELECT m.roleid, ARRAY[m.roleid]
           FROM pg_auth_members m WHERE m.member = $1
           UNION ALL
           SELECT m.roleid, inherited.path || m.roleid
           FROM inherited
           JOIN pg_auth_members m ON m.member = inherited.role_oid
           WHERE NOT m.roleid = ANY(inherited.path)
         )
         SELECT DISTINCT r.rolname
         FROM inherited JOIN pg_roles r ON r.oid = inherited.role_oid
         ORDER BY r.rolname`,
        [role.oid],
      );
      memberships = membershipResult.rows;

      const schemaResult = await client.query(
        `SELECT has_schema_privilege($1, 'public', 'USAGE') AS can_use,
                has_schema_privilege($1, 'public', 'CREATE') AS can_create,
                pg_get_userbyid(n.nspowner) AS owner
         FROM pg_namespace n WHERE n.nspname = 'public'`,
        [runtimeRole],
      );
      schema = schemaResult.rows[0] ?? null;

      const tableResult = await client.query(
        `SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner,
                has_table_privilege($1, c.oid, 'SELECT') AS can_select,
                has_table_privilege($1, c.oid, 'INSERT') AS can_insert,
                has_table_privilege($1, c.oid, 'UPDATE') AS can_update,
                has_table_privilege($1, c.oid, 'DELETE') AS can_delete,
                has_table_privilege($1, c.oid, 'TRUNCATE') AS can_truncate,
                has_table_privilege($1, c.oid, 'REFERENCES') AS can_references,
                has_table_privilege($1, c.oid, 'TRIGGER') AS can_trigger
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = ANY($2::text[])
           AND c.relkind IN ('r', 'p')`,
        [runtimeRole, Object.keys(TABLE_POLICY)],
      );
      tables = tableResult.rows;

      const triggerResult = await client.query(
        `SELECT t.tgname AS trigger_name, t.tgenabled AS enabled,
                pg_get_userbyid(p.proowner) AS function_owner
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_proc p ON p.oid = t.tgfoid
         WHERE n.nspname = 'public'
           AND c.relname = ANY($1::text[])
           AND NOT t.tgisinternal`,
        [Object.keys(TABLE_POLICY)],
      );
      triggers = triggerResult.rows;

      const defaultGrantResult = await client.query(
        `SELECT COALESCE(n.nspname, 'all schemas') AS schema_name,
                d.defaclobjtype AS object_type,
                CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee
         FROM pg_default_acl d
         LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
         CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
         WHERE acl.grantee IN (0, $1)`,
        [role.oid],
      );
      defaultGrants = defaultGrantResult.rows;
    }

    const findings = evaluateRuntimeRoleAudit({ role, memberships, schema, tables, triggers, defaultGrants });
    await client.query("ROLLBACK");
    if (findings.length) {
      process.stderr.write(`Runtime-role acceptance: FAIL (${findings.length} finding(s)).\n`);
      for (const finding of findings) process.stderr.write(`- ${finding}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write("Runtime-role acceptance: PASS. Read-only privilege and trigger checks passed.\n");
  } catch {
    try { await client.query("ROLLBACK"); } catch { /* connection may already be closed */ }
    process.stderr.write("Runtime-role acceptance: ERROR. Audit query failed; inspect database availability and read-only audit permissions. Details suppressed.\n");
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
