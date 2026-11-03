# USERDIE Digital API foundation

This directory is the initial backend service scaffold. It is separate from the static site in `website/`; it does not change the current GitHub Pages publication target.

## Included

- Node.js HTTP API foundation with liveness and database-readiness endpoints.
- PostgreSQL connection pool and graceful shutdown.
- Initial relational schema for users, roles, programs, applications, status history, private document metadata, and audit events.
- Program portfolio lifecycle fields, organizational contours, accountable owners, approval metadata, milestone gates, and append-only program status history (migration 004).
- A migration that records application creation and status changes in the status-history table.
- A session-storage migration designed to store only hashes of opaque random session tokens, with expiry and revocation support. Login and session issuance are not implemented.
- Tested security primitives for generating 256-bit opaque session tokens, hashing them for database lookup, parsing a unique session cookie, and serializing host-only `HttpOnly; Secure; SameSite=Lax` cookies. These primitives do not create sessions, authenticate users, or enable login.
- A production-wired principal resolver validates the opaque session cookie against active, unexpired, non-revoked database sessions and loads global and scoped role grants from trusted storage. No login/session issuance endpoint exists yet.
- Program detail reads include approved program fields and milestone timelines; program managers are restricted to their exact program scope.
- Application workflow migration 005 adds task ownership, priorities, due dates, escalation levels, and append-only workflow events linked to the parent application and program.
- A read-only internal workflow endpoint exposes task status, overdue flags, escalation metadata, and the latest 100 workflow events only to the assigned case worker or the program manager for that exact program.
- Synthetic HTTP and principal-resolution tests cover program access, cross-program denial, missing records, fail-closed authentication, and database-backed grant loading.
- Automated HTTP tests cover health checks, error handling, and the fail-closed application endpoint.

## Local development

Requirements: Node.js 22+ and PostgreSQL with `gen_random_uuid()` available.

1. Create a local PostgreSQL database.
2. Apply `migrations/001_initial_schema.sql` to a new database after review.
3. For an existing database created from migration 001, review and apply `migrations/002_application_status_history_trigger.sql`.
4. Review and apply `migrations/003_auth_sessions.sql` after migration 001 to prepare session storage. Applying it does not enable authentication.
5. Review and apply `migrations/004_program_portfolio_lifecycle.sql` after migration 001 to add program governance and milestone structures. Applying it does not create or approve real programs.
6. Review and apply `migrations/005_application_workflow_tasks_sla.sql` after migrations 001-004 to add task and workflow-event structures. Applying it does not create tasks or enable scheduled escalation.
7. Review and apply `migrations/006_scoped_role_grants.sql` after migration 001 to add explicit program, organization, and contour-scoped grants.
8. Install dependencies with `npm install`.
9. Set `DATABASE_URL` and optional configuration variables from `.env.example` in your shell.
10. Run `npm test`, `npm run check`, then `npm start`.

Migrations are reviewed SQL files, not an automated migration runner. Apply them through a controlled deployment process and verify backups first. Do not run migrations against production until a backup and restore procedure has been verified.

## Endpoints

- `GET /api/v1/health/live` — process liveness; no database query.
- `GET /api/v1/health/ready` — checks database connectivity and returns only a generic status.
- `GET /api/v1/applications/:id` — read-only detail route; requires a valid server-side session and record-level authorization. The principal resolver is wired; access remains `401` until a valid session is issued through a separately reviewed authentication process.
- `GET /api/v1/applications` — returns `503 applications_module_unavailable`; collection access remains disabled.
- `GET /api/v1/programs/:id` — read-only program dossier and milestone timeline; requires a valid server-side session and `programs:read` authorization.
- `GET /api/v1/applications/:id/workflow` — internal read-only task, SLA and event timeline; visible only to the assigned case worker or exact-scope program manager with a valid server-side session.

All other unknown routes return 404; non-GET/HEAD methods return 405. The applications module deliberately fails closed: it does not read or write application records until identity, authorization, validation, and audit requirements are implemented and tested.

## Authentication implementation requirements

The session table is only a storage foundation. Before enabling authentication, implement and test all of the following:

- Password hashing with a maintained password-hashing algorithm and safe parameters; never store plaintext passwords.
- Wire the tested session-token primitives into a reviewed login/session lifecycle with database persistence, expiry checks, rotation, revocation, CSRF protection, and MFA. The current helpers alone do not authenticate requests.
- High-entropy random session tokens; persist only their cryptographic hashes, never raw tokens.
- Cookies with `HttpOnly`, `Secure` in production, and an appropriate `SameSite` policy; protect state-changing requests against CSRF.
- Session expiry, rotation after authentication or privilege changes, logout/revocation, and invalidation for suspended/closed accounts.
- Rate limiting and generic error messages for login attempts; do not reveal whether an email address exists.
- Server-side role checks and per-record authorization for every read and write, with audit events for sensitive actions.
- A reviewed account recovery process and MFA policy before real beneficiary accounts are enabled.

## Production blockers — do not accept real applications yet

- Login, session issuance/rotation/revocation endpoints, account recovery, MFA, and CSRF-protected state-changing flows are not implemented. The read-only routes resolve existing sessions and trusted database-backed grants; without an issued valid session they remain inaccessible.
- Application and program write/lifecycle routes remain disabled. All future routes must use trusted database-loaded grants and per-record checks.
- Application CRUD, task creation/update, file upload/download, malware scanning, notifications, and reporting are not implemented.
- SLA overdue state is computed on read; no background scheduler, automatic escalation worker, notification channel, or task write endpoint is deployed. Escalation levels are data fields awaiting a governed write workflow.
- Secrets management, production hosting, TLS termination, migrations automation, monitoring, backups, and restore tests must be configured and verified separately.
- Review applicable personal-data, consent, retention, and incident-response requirements before collecting real beneficiary data.

Never put real applicant data, uploaded documents, database credentials, or access tokens in this repository or test fixtures.
