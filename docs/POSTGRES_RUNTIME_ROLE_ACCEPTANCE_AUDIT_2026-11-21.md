# PostgreSQL runtime-role acceptance audit — 2026-11-21

**Status:** read-only audit procedure and source-level findings. No live PostgreSQL connection was available in this review; therefore no claim is made that staging/production role privileges have been verified.

**Scope:** USERDIE Digital PR #29, branch `feature/valuation-workspace-api-integration`, migration `021_privacy_consent_ledger.sql`. This document does not apply migrations, change grants, create roles, enable consent capture, or authorize production use.

## 1. Source-level findings

The repository's operator procedure specifies a separate non-owner API runtime role and a distinct schema-owner/migration credential. The migration runner requires both `MIGRATIONS_ALLOW_APPLY=true` and `MIGRATIONS_DATABASE_URL`; API startup does not run migrations. The privacy-consent feature flag defaults to false.

Migration 021 creates append-only event triggers, immutable document-version guards, choice-key validation, subject/document advisory-lock serialization, and database-side grant/withdrawal integrity checks. These controls are useful against ordinary DML by a constrained role, but they do not protect against a table owner, schema owner with sufficient DDL rights, superuser, or a role able to disable triggers/change privileges.

**Critical acceptance gap:** migration 021 does not itself create the runtime/DBA roles or issue a complete least-privilege GRANT/REVOKE policy. A documentation statement describing the intended role split is not evidence that the deployed database has that split. Effective privileges must be measured in the target database.

## 2. Required role model

Use distinct identities:

- **schema owner / migration role:** owns schema objects and applies reviewed migrations; never used by the API.
- **API runtime role:** non-superuser, not an owner of schema/tables/functions; has only the DML and function permissions required by the running application.
- **operator / DBA role:** performs controlled registry administration and operational review; separate from ordinary API runtime.
- **human approver and independent checker:** approvals are attributable to separate people; database roles alone do not prove their legal authority.

Do not reuse a single database credential across these roles. Do not place credentials in Git, browser storage, issue comments, or this report.

## 3. Read-only acceptance queries

Run against the exact isolated staging database after the reviewed migration set has been applied. Use a DBA/read-only inspection identity. Replace the psql variable before execution:

```sql
\set runtime_role 'userdie_api_runtime'

-- A. Role attributes: runtime must not be superuser, inherit privileged roles,
-- create roles/databases, replicate, or bypass RLS.
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
       rolcanlogin, rolreplication, rolbypassrls
FROM pg_roles
WHERE rolname = :'runtime_role';

-- B. Direct and transitive role memberships. Investigate every returned role;
-- any inherited owner/DDL/admin capability is a release blocker.
WITH RECURSIVE memberships(role_oid, depth, path) AS (
  SELECT m.roleid, 1, ARRAY[m.roleid]
  FROM pg_auth_members m
  WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = :'runtime_role')
  UNION ALL
  SELECT m.roleid, memberships.depth + 1, memberships.path || m.roleid
  FROM memberships
  JOIN pg_auth_members m ON m.member = memberships.role_oid
  WHERE NOT m.roleid = ANY(memberships.path)
)
SELECT DISTINCT r.rolname, memberships.depth
FROM memberships
JOIN pg_roles r ON r.oid = memberships.role_oid
ORDER BY memberships.depth, r.rolname;

-- C. Ownership of relevant schemas, tables, sequences and routines.
SELECT 'schema' AS object_type, n.nspname AS object_name,
       pg_get_userbyid(n.nspowner) AS owner
FROM pg_namespace n
WHERE n.nspname IN ('public')
UNION ALL
SELECT 'table', format('%I.%I', n.nspname, c.relname),
       pg_get_userbyid(c.relowner)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r','p','S','v','m','f')
UNION ALL
SELECT 'routine', p.oid::regprocedure::text,
       pg_get_userbyid(p.proowner)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY object_type, object_name;

-- D. Effective table privileges for the runtime role. The consent ledger
-- minimum is documents SELECT only; events SELECT/INSERT only.
SELECT table_name,
       has_table_privilege(:'runtime_role', format('public.%I', table_name), 'SELECT') AS can_select,
       has_table_privilege(:'runtime_role', format('public.%I', table_name), 'INSERT') AS can_insert,
       has_table_privilege(:'runtime_role', format('public.%I', table_name), 'UPDATE') AS can_update,
       has_table_privilege(:'runtime_role', format('public.%I', table_name), 'DELETE') AS can_delete,
       has_table_privilege(:'runtime_role', format('public.%I', table_name), 'TRUNCATE') AS can_truncate,
       has_table_privilege(:'runtime_role', format('public.%I', table_name), 'REFERENCES') AS can_references,
       has_table_privilege(:'runtime_role', format('public.%I', table_name), 'TRIGGER') AS can_trigger
FROM (VALUES
  ('privacy_consent_documents'),
  ('privacy_consent_events'),
  ('audit_events'),
  ('app_users')
) AS required(table_name)
ORDER BY table_name;

-- E. Schema capabilities. Runtime must not CREATE objects in the application
-- schema and must not own it.
SELECT
  has_schema_privilege(:'runtime_role', 'public', 'USAGE') AS can_use_public,
  has_schema_privilege(:'runtime_role', 'public', 'CREATE') AS can_create_in_public;

-- F. Trigger state. All migration 021 protection triggers must be enabled.
SELECT c.relname AS table_name, t.tgname, t.tgenabled,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('privacy_consent_documents','privacy_consent_events')
  AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

-- G. Default privileges that could silently grant future objects to runtime.
SELECT pg_get_userbyid(d.defaclrole) AS grantor,
       n.nspname AS schema_name,
       d.defaclobjtype,
       d.defaclacl
FROM pg_default_acl d
LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE d.defaclacl::text LIKE '%' || :'runtime_role' || '%'
   OR d.defaclacl::text LIKE '%=arwdDxt%';

-- H. Runtime ability to execute routines. Review all EXECUTE grants,
-- especially SECURITY DEFINER functions and functions that mutate data.
SELECT p.oid::regprocedure AS routine,
       p.prosecdef AS security_definer,
       has_function_privilege(:'runtime_role', p.oid, 'EXECUTE') AS runtime_can_execute,
       pg_get_userbyid(p.proowner) AS owner
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY routine::text;
```

## 4. Expected minimum consent-ledger privilege matrix

| Object | API runtime minimum | Release-blocking excess |
|---|---|---|
| `privacy_consent_documents` | SELECT | INSERT, UPDATE, DELETE, TRUNCATE, ownership |
| `privacy_consent_events` | SELECT, INSERT | UPDATE, DELETE, TRUNCATE, ownership |
| `audit_events` | INSERT where required by audited routes | UPDATE, DELETE, TRUNCATE, ownership |
| `app_users` | Narrow SELECT columns needed for identity/authorization; verify application queries | Unneeded UPDATE/DELETE, ownership |
| `public` schema | USAGE | CREATE, ownership |
| migration ledger | No runtime migration rights | CREATE/ALTER/DROP/UPDATE/DELETE/TRUNCATE |
| migration/DDL functions | No execution unless explicitly justified | Broad SECURITY DEFINER or privilege-management routines |

The application may need additional privileges on other tables for unrelated API features. Review them separately; do not broaden the consent-ledger grants to make unrelated endpoints work.

## 5. Acceptance criteria

Do not pass this gate until all are true:

1. Runtime role exists and is not superuser, table/schema owner, or member of any privileged role.
2. No direct or inherited ability to create/alter/drop objects, alter role membership, grant privileges, disable triggers, or truncate protected tables.
3. Effective privileges match the approved least-privilege matrix, including column-level grants and inherited grants.
4. All migration 021 triggers are present and enabled; no unexpected trigger exceptions or replication-role bypass configuration is in effect for the application session.
5. Default privileges for future tables, sequences, and routines do not grant excessive access to runtime.
6. SECURITY DEFINER functions, if any, have a reviewed owner, fixed safe search_path, narrow EXECUTE grants, and no privilege-escalation path.
7. Evidence is captured from the target database: timestamp, environment identifier, PostgreSQL version, role names (never passwords/connection strings), query outputs, reviewer identity, and approval record.
8. A second operator independently reviews the evidence and signs off.

A role privilege report is environment-specific. Re-run after role changes, migration changes, hosting-provider changes, and before each staging/production release.

## 6. Remediation approach if the audit fails

Do not run blanket REVOKE/GRANT statements from this document. First export the complete effective privilege state, identify the grant source (direct grant, PUBLIC, inherited role, object ownership, default privileges, or provider-managed role), and prepare a reviewed least-privilege change plan. Apply changes only in isolated staging, then rerun the full API and PostgreSQL integration suites. Never revoke privileges blindly: doing so can break unrelated application operations or the migration process.

## 7. Current decision

**Status: NOT VERIFIED — staging database evidence required.**

The repository source and operator documentation support the intended separation, but no live database role catalog or effective-privilege output was available during this review. Do not mark the runtime-role control as passed, do not enable `PRIVACY_CONSENT_LEDGER_ENABLED`, do not apply migration 021 to production, and do not collect real personal data on the strength of this source audit.

This report is a technical acceptance checklist, not legal approval, a production deployment record, or proof of a completed database security assessment.
