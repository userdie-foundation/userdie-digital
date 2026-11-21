# PostgreSQL runtime-role audit CLI

This repository includes a read-only audit command for the two protected privacy-consent ledger tables introduced by migration 021.

## Purpose and boundary

The command measures effective PostgreSQL privileges in the database to which the audit connection is pointed. It does not create roles, change grants, apply migrations, write rows, enable consent capture, or certify the entire application database.

It checks:

- the configured runtime role exists and is not superuser, role/database creator, replication role, or RLS-bypass role;
- the runtime role has no direct or transitive role memberships;
- the runtime role does not own the application schema, protected tables, or their protection functions;
- the role has schema USAGE but not CREATE;
- `privacy_consent_documents` is SELECT-only;
- `privacy_consent_events` has SELECT and INSERT only;
- all six migration-021 protection triggers are enabled;
- no PostgreSQL default privileges grant future objects to the runtime role.

The audit intentionally checks effective privileges, not only direct GRANT statements. It is limited to the consent ledger and does not replace a full application-wide permission review, review of RLS policies, secrets management, network controls, or a DBA security assessment.

## Run against isolated staging

Use a dedicated read-only inspection credential with enough catalog visibility to inspect roles, ownership, privileges, default ACLs, and triggers. Do not use the application runtime credential for this audit.

From `backend/`:

```sh
PG_AUDIT_DATABASE_URL='postgresql://<read-only-auditor>@<staging-host>/<database>' \
PG_RUNTIME_ROLE='userdie_api_runtime' \
npm run audit:runtime-role
```

The connection string is supplied only through the environment; it is never printed. Prefer a secret manager or ephemeral shell environment rather than command history. The command opens a `READ ONLY` transaction and rolls it back on completion.

Exit codes:

- `0`: the defined consent-ledger runtime-role checks passed;
- `1`: a policy finding or database-query failure occurred;
- `2`: required configuration is missing or invalid.

A PASS means only that the checks implemented by this script passed against that specific database at that time. Preserve the sanitized output together with database/environment identity, timestamp, migration ledger, reviewer, and independent approval. Never attach credentials, connection strings, beneficiary records, or raw personal data.

## Release rule

Do not run this against production as a substitute for staging acceptance. Do not use the result to justify broad GRANT/REVOKE changes. Any privilege correction must be separately reviewed, tested in isolated staging, and approved by the database owner before production change control.
