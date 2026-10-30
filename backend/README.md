# USERDIE Digital API foundation

This directory is the initial backend service scaffold. It is separate from the static site in `website/`; it does not change the current GitHub Pages publication target.

## Included

- Node.js HTTP API foundation with liveness and database-readiness endpoints.
- PostgreSQL connection pool and graceful shutdown.
- Initial relational schema for users, roles, programs, applications, status history, private document metadata, and audit events.
- A migration that records application creation and status changes in the status-history table.
- A session-storage migration designed to store only hashes of opaque random session tokens, with expiry and revocation support. It does not enable login.
- Tested security primitives for generating 256-bit opaque session tokens, hashing them for database lookup, parsing a unique session cookie, and serializing host-only `HttpOnly; Secure; SameSite=Lax` cookies. These primitives do not create sessions, authenticate users, or enable login.
- Automated HTTP tests for health checks, error handling, and the fail-closed applications endpoint.

## Local development

Requirements: Node.js 22+ and PostgreSQL with `gen_random_uuid()` available.

1. Create a local PostgreSQL database.
2. Apply `migrations/001_initial_schema.sql` to a new database after review.
3. For an existing database created from migration 001, review and apply `migrations/002_application_status_history_trigger.sql`.
4. Review and apply `migrations/003_auth_sessions.sql` after migration 001 to prepare session storage. Applying it does not enable authentication.
5. Install dependencies with `npm install`.
6. Set `DATABASE_URL` and optional configuration variables from `.env.example` in your shell.
7. Run `npm test`, `npm run check`, then `npm start`.

Migrations are reviewed SQL files, not an automated migration runner. Apply them through a controlled deployment process and verify backups first. Do not run migrations against production until a backup and restore procedure has been verified.

## Endpoints

- `GET /api/v1/health/live` — process liveness; no database query.
- `GET /api/v1/health/ready` — checks database connectivity and returns only a generic status.
- `GET /api/v1/applications` — returns `503 applications_module_unavailable` until authentication and record-level authorization are implemented.

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

- Authentication, session lifecycle, account recovery, and MFA policy are not implemented.
- Role-based authorization and per-record access control are not implemented.
- Application CRUD, file upload/download, malware scanning, notifications, and reporting are not implemented.
- Secrets management, production hosting, TLS termination, migrations automation, monitoring, backups, and restore tests must be configured and verified separately.
- Review applicable personal-data, consent, retention, and incident-response requirements before collecting real beneficiary data.

Never put real applicant data, uploaded documents, database credentials, or access tokens in this repository or test fixtures.
