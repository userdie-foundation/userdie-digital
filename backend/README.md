# USERDIE Digital API foundation

This directory is the initial backend service scaffold. It is separate from the static site in `website/`; it does not change the current GitHub Pages publication target.

## Included

- Node.js HTTP API foundation with liveness and database-readiness endpoints.
- PostgreSQL connection pool and graceful shutdown.
- Initial relational schema for users, roles, programs, applications, status history, private document metadata, and audit events.
- A separate migration that records application creation and status changes in the status-history table.
- Automated HTTP tests for health checks, error handling, and the fail-closed applications endpoint.

## Local development

Requirements: Node.js 22+ and PostgreSQL with `gen_random_uuid()` available.

1. Create a local PostgreSQL database.
2. Apply `migrations/001_initial_schema.sql` to a new database after review.
3. For an existing database created from migration 001, review and apply `migrations/002_application_status_history_trigger.sql`.
4. Install dependencies with `npm install`.
5. Set `DATABASE_URL` and optional configuration variables from `.env.example` in your shell.
6. Run `npm test`, `npm run check`, then `npm start`.

Migrations are reviewed SQL files, not an automated migration runner. Apply them through a controlled deployment process and verify backups first.

## Endpoints

- `GET /api/v1/health/live` — process liveness; no database query.
- `GET /api/v1/health/ready` — checks database connectivity and returns only a generic status.
- `GET /api/v1/applications` — returns `503 applications_module_unavailable` until authentication and record-level authorization are implemented.

All other unknown routes return 404; non-GET/HEAD methods return 405. The applications module deliberately fails closed: it does not read or write application records until identity, authorization, validation, and audit requirements are implemented and tested.

## Production blockers — do not accept real applications yet

- Authentication, session lifecycle, account recovery, and MFA policy are not implemented.
- Role-based authorization and per-record access control are not implemented.
- Application CRUD, file upload/download, malware scanning, notifications, and reporting are not implemented.
- Secrets management, production hosting, TLS termination, migrations automation, monitoring, backups, and restore tests must be configured and verified separately.
- Review applicable personal-data, consent, retention, and incident-response requirements before collecting real beneficiary data.

Never put real applicant data, uploaded documents, database credentials, or access tokens in this repository or test fixtures.
