# USERDIE Digital API foundation

This directory is the initial backend service scaffold. It is separate from the static site in `website/`; it does not change the current GitHub Pages publication target.

## Included

- Node.js HTTP API foundation with liveness and database-readiness endpoints.
- PostgreSQL connection pool and graceful shutdown.
- Initial relational schema for users, roles, programs, applications, status history, private document metadata, and audit events.
- Program portfolio lifecycle fields, organizational contours, accountable owners, approval metadata, milestone gates, and append-only program status history (migration 004).
- A migration that records application creation and status changes in the status-history table.
- A session-storage migration designed to store only hashes of opaque random session tokens, with expiry and revocation support. Login and session issuance are implemented separately.
- Tested security primitives for generating 256-bit opaque session tokens, hashing them for database lookup, parsing a unique session cookie, and serializing host-only `HttpOnly; Secure; SameSite=Lax` cookies.
- A versioned password-verifier primitive using Node.js `scrypt` with per-password random salts, bounded parameters, constant-time digest comparison, and tests.
- A production-wired principal resolver validates the opaque session cookie against active, unexpired, non-revoked database sessions and loads global and active scoped role grants from trusted storage. Revoked scoped grants are excluded immediately.
- Program detail reads include approved program fields and milestone timelines; program managers are restricted to their exact program scope.
- Application workflow migration 005 adds task ownership, priorities, due dates, escalation levels, and append-only workflow events linked to the parent application and program.
- A read-only internal workflow endpoint exposes task status, overdue flags, escalation metadata, and the latest 100 workflow events only to the assigned case worker or the program manager for that exact program.
- Migration 009 adds PostgreSQL-backed account and network throttling buckets keyed by HMAC digests; the tested limiter primitive is not yet wired to a login endpoint.
- Migration 010 adds short-lived, single-use password-recovery token storage. Only SHA-256 token digests are persisted.
- The account-recovery service core validates and normalizes email, returns a generic request result, rotates outstanding recovery tokens, sends the raw token only to a caller-supplied delivery adapter, and on successful reset revokes active sessions and writes an audit event. The service is not wired to an HTTP route or production email provider.
- Migration 007 adds one-way scoped-grant revocation, active-only uniqueness, hard-delete protection, and append-only grant/revocation audit events. No public grant-management endpoint is exposed.
- Automated HTTP tests cover health checks, error handling, and the fail-closed application endpoint. PostgreSQL integration coverage exercises migrations 001–010, synthetic session resolution, scoped-grant creation and revocation, immediate permission removal, hard-delete prevention, append-only grant audit events, recovery-token storage, and account/network login-throttling behavior.

## Local development

Requirements: Node.js 22+ and PostgreSQL with `gen_random_uuid()` available.

1. Create a local PostgreSQL database.
2. Apply `migrations/001_initial_schema.sql` to a new database after review.
3. For an existing database created from migration 001, review and apply `migrations/002_application_status_history_trigger.sql`.
4. Review and apply `migrations/003_auth_sessions.sql` after migration 001 to prepare session storage.
5. Review and apply `migrations/004_program_portfolio_lifecycle.sql` after migration 001 to add program governance and milestone structures.
6. Review and apply `migrations/005_application_workflow_tasks_sla.sql` after migrations 001–004 to add task and workflow-event structures.
7. Review and apply `migrations/006_scoped_role_grants.sql` after migration 001 to add explicit program, organization, and contour-scoped grants.
8. Review and apply `migrations/007_scoped_role_grant_lifecycle.sql` after migration 006 to add auditable one-way revocation and append-only grant events.
9. Review and apply `migrations/008_independent_approvals.sql` and `migrations/009_auth_rate_limit_buckets.sql` after reviewing their dependencies.
10. Review and apply `migrations/010_auth_recovery_tokens.sql` after migration 001 to prepare one-time recovery-token storage.
11. Install dependencies with `npm install`.
12. Set `DATABASE_URL` and optional configuration variables from `.env.example` in your shell.
13. Run `npm test`, `npm run check`, then `npm start`.

Migrations are reviewed SQL files, not an automated migration runner. Apply them through a controlled deployment process and verify backups first. Do not run migrations against production until a backup and restore procedure has been verified.

## Endpoints

- `GET /api/v1/health/live` — process liveness; no database query.
- `GET /api/v1/health/ready` — checks database connectivity and returns only a generic status.
- `POST /api/v1/auth/login` — password login; requires the exact configured origin, database, and login rate-limit HMAC secret.
- `POST /api/v1/auth/logout` — revokes the current server-side session and clears its cookie.
- `GET /api/v1/applications/:id` — read-only detail route; requires a valid server-side session and record-level authorization.
- `GET /api/v1/applications` — returns `503 applications_module_unavailable`; collection access remains disabled.
- `GET /api/v1/programs?limit=25` — read-only program directory (limit 1–50); applicants and partners see open programs, program managers see exact granted scopes, and administrators/auditors/case workers see the governed portfolio.
- `GET /api/v1/programs/:id` — read-only program dossier and milestone timeline; requires a valid server-side session and `programs:read` authorization.
- `GET /api/v1/applications/:id/workflow` — internal read-only task, SLA and event timeline; visible only to the assigned case worker or exact-scope program manager with a valid server-side session.

Account-recovery HTTP request/reset routes and a production email-delivery adapter are not connected. MFA enrollment, verification, recovery codes, and enforcement are not implemented. All unknown routes return 404; non-GET/HEAD methods return 405 unless explicitly supported. The applications module deliberately fails closed: it does not read or write application records until identity, authorization, validation, and audit requirements are implemented and tested.

## Authentication implementation requirements

Before enabling real user accounts, complete and test:

- A reviewed login/session lifecycle with database persistence, expiry checks, rotation, revocation, CSRF protection, distributed rate limiting, account recovery, and MFA.
- High-entropy random session tokens; persist only their cryptographic hashes, never raw tokens.
- Cookies with `HttpOnly`, `Secure` in production, and an appropriate `SameSite` policy; protect state-changing requests against CSRF.
- Session expiry, rotation after authentication or privilege changes, logout/revocation, and invalidation for suspended/closed accounts.
- Wire the tested PostgreSQL-backed login limiter into login before password verification; configure a strong HMAC key in the deployment secret manager, pass only the verified socket peer address (never an untrusted forwarded header), and use generic error messages that do not reveal whether an email address exists.
- A complete recovery flow: HTTP routes, trusted mail delivery, one-time token expiry/replay tests, session revocation, audit coverage, abuse throttling, and operational failure handling.
- MFA policy and implementation, including secure enrollment, challenge verification, recovery codes, disable/re-enrollment controls, audit events, and brute-force protection.
- Server-side role checks and per-record authorization for every read and write, with audit events for sensitive actions.

## Production blockers — do not accept real applications yet

- The login/logout code and account-recovery core exist, but production activation is not confirmed. Recovery routes and delivery are not wired; MFA and CSRF-protected state-changing application flows remain incomplete.
- Application and program write/lifecycle routes remain disabled. All future routes must use trusted database-loaded grants and per-record checks.
- Application CRUD, task creation/update, file upload/download, malware scanning, notifications, and reporting are not implemented.
- SLA overdue state is computed on read; no background scheduler, automatic escalation worker, notification channel, or task write endpoint is deployed. Escalation levels are data fields awaiting a governed write workflow.
- Secrets management, production hosting, TLS termination, migrations automation, monitoring, backups, and restore tests must be configured and verified separately.
- Review applicable personal-data, consent, retention, and incident-response requirements before collecting real beneficiary data.

Never put real applicant data, uploaded documents, database credentials, or access tokens in this repository or test fixtures.
