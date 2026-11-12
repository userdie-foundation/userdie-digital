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
- A scoped task-status transition endpoint (`PATCH /api/v1/workspace/tasks/:id/status`) permits only the assigned case worker or an exact-scope program manager to perform an allowlisted status transition. It uses a PostgreSQL transaction, compare-and-set against the previously read status, actor context for the workflow-event trigger, and rejects terminal-state changes. It does not create tasks or edit other task fields.
- Migration 009 adds PostgreSQL-backed account and network throttling buckets keyed by HMAC digests. The runtime entry point conditionally injects the authentication service, including this limiter, only when `LOGIN_RATE_LIMIT_HMAC_KEY` is configured; this is source wiring, not evidence of a deployed or production-approved login service.
- Migration 010 adds short-lived, single-use password-recovery token storage. Only SHA-256 token digests are persisted.
- Migration 011 blocks UPDATE, DELETE and TRUNCATE on `audit_events` with PostgreSQL triggers; database ownership and DDL permissions must still be restricted operationally.
- Migration 013 prepares separate PostgreSQL-backed account and network throttling buckets for password-recovery requests; raw email addresses and client IP addresses are not stored.
- Migration 012 prepares MFA persistence: encrypted TOTP ciphertext/nonce/tag and key identifier, pending/active/disabled lifecycle, hashed short-lived login challenges, attempt ceilings, TOTP replay watermark, and one-way recovery-code verifiers. It does not implement KMS, enrollment, verification, challenge consumption, session gating, or MFA enforcement.
- The account-recovery service core validates and normalizes email, returns a generic request result, rotates outstanding recovery tokens, sends the raw token only to a caller-supplied delivery adapter, and on successful reset revokes active sessions and writes an audit event. HTTP request/reset routes exist in `src/server.mjs`, but `src/index.mjs` does not yet instantiate or inject the recovery service; no production email-delivery adapter is configured. The routes therefore remain fail-closed and unavailable to users.
- Migration 007 adds one-way scoped-grant revocation, active-only uniqueness, hard-delete protection, and append-only grant/revocation audit events. No public grant-management endpoint is exposed.
- Migration 014 adds the partnership workspace persistence foundation: partner identity profiles linked to the existing organizations directory, partnership lifecycle records, private evidence metadata, append-only status history, and a database guard requiring a matching independently approved request before a relationship can be marked active-confirmed. It does not add partnership HTTP routes, file upload/download, or a public partner catalogue.
- Automated HTTP tests cover health checks, error handling, and the fail-closed application endpoint. PostgreSQL integration coverage exercises migrations 001–014, synthetic session resolution, scoped-grant creation and revocation, immediate permission removal, hard-delete prevention, append-only audit histories, recovery-token storage, account/network login-throttling behavior, and partnership confirmation/evidence constraints.

## Local development

Requirements: Node.js 22+ and PostgreSQL with `gen_random_uuid()` available.

1. Create a new, empty local or isolated non-production PostgreSQL database.
2. Install dependencies with `npm install`.
3. Run `npm test` and `npm run check`.
4. For this new empty database only, provide a dedicated schema-owner connection as `MIGRATIONS_DATABASE_URL` and explicitly run `MIGRATIONS_ALLOW_APPLY=true npm run migrate`. Set `MIGRATIONS_DATABASE_SSL=true` when verified TLS is required.
5. Configure the API runtime with a separate least-privilege, non-owner `DATABASE_URL` and run `npm start`.

The migration CLI stores SHA-256 checksums in `public.schema_migrations`, takes a PostgreSQL advisory lock, and applies each migration and its ledger row in one transaction. It skips a previously applied migration only when its checksum matches, and refuses filename gaps or edited applied migrations. It requires the explicit `MIGRATIONS_ALLOW_APPLY=true` flag and `MIGRATIONS_DATABASE_URL`; API startup and Docker startup never execute migrations.

**Important:** this runner is intended for a new empty staging database. It does not automatically baseline databases whose migrations were applied manually. Do not use it against an existing database until a separate baseline/reconciliation procedure is reviewed. Keep the migration-owner credential separate from the non-owner API runtime role. Verify backups and a restore rehearsal before any production migration.

## Endpoints

- `GET /api/v1/health/live` — process liveness; no database query.
- `GET /api/v1/health/ready` — checks database connectivity and returns only a generic status.
- `POST /api/v1/auth/login` — password login; requires the exact configured origin, database, and login rate-limit HMAC secret.
- `POST /api/v1/auth/logout` — revokes the current server-side session and clears its cookie.
- `GET /api/v1/applications/:id` — read-only detail route; requires a valid server-side session and record-level authorization.
- `GET /api/v1/applications` — returns `503 applications_module_unavailable`; collection access remains disabled.
- `GET /api/v1/programs?limit=25` — read-only program directory (limit 1–50); applicants and partners see open programs, program managers see exact granted scopes, and administrators/auditors/case workers see the governed portfolio.
- `GET /api/v1/partnerships?limit=25` — read-only partnership directory (limit 1–50); administrators and auditors can review the directory, case workers see only records assigned to them, and partner accounts require an exact organization-scoped grant.
- `GET /api/v1/partnerships/:id` — read-only partnership detail with the same record-level authorization; missing and unauthorized records both return 404.
- `GET /api/v1/partnerships/:id/evidence` — internal read-only evidence metadata for administrators, auditors, and the assigned case worker only. The response excludes storage keys and file bytes; partner grants do not grant evidence access. File download, upload, write operations, confirmation, and public partner publication remain unavailable.
- `GET /api/v1/programs/:id` — read-only program dossier and milestone timeline; requires a valid server-side session and `programs:read` authorization.
- `GET /api/v1/applications/:id/workflow` — internal read-only task, SLA and event timeline; visible only to the assigned case worker or exact-scope program manager with a valid server-side session.
- `PATCH /api/v1/workspace/tasks/:id/status` — allowlisted task-status transition; requires a valid session, trusted scoped permission, exact Origin, and a valid transition. The route is implemented and CI-tested but is not connected to the public static-site UI or a confirmed production API deployment.

Account-recovery HTTP request/reset routes exist but remain unavailable because the production entry point does not inject the recovery service; a production email-delivery adapter is also not configured. MFA enrollment, verification, recovery-code consumption, KMS integration, and enforcement are not implemented. Migration 012 is schema groundwork only; no normal session is gated on a second factor yet. All unknown routes return 404; non-GET/HEAD methods return 405 unless explicitly supported. The applications module deliberately fails closed: it does not read or write application records until identity, authorization, validation, and audit requirements are implemented and tested.

The partnership directory exposes read-only relationship metadata and a separate internal-only evidence metadata endpoint through the authenticated API. The database query narrows results by global reviewer role, exact assigned case-worker identity, or exact partner organization grants, and the route repeats record-level authorization before returning a response. Partner-facing responses omit internal assignment metadata. The evidence metadata query uses an explicit column allowlist and excludes storage keys and document bytes. Evidence is visible only to administrators, auditors, and the case worker assigned to the parent partnership; partner organization grants do not expose evidence. Partnership writes and independent confirmation remain disabled.

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
- Logout revokes an active server-side session and appends `auth.session_revoked` in the same PostgreSQL transaction; if the audit insert fails, revocation is rolled back and the endpoint returns a generic service error.

## Production blockers — do not accept real applications yet

- A central exact-Origin guard now rejects every state-changing HTTP method (POST, PUT, PATCH, DELETE) when Origin is absent, null, or does not match the configured application origin; safe reads and OPTIONS preflight are excluded. Route-specific Origin checks remain on authentication endpoints. This is a CSRF control, not a substitute for production review of proxy/origin configuration, browser behavior, and future cross-origin requirements. Production activation is not confirmed; recovery routes and trusted delivery are not wired, and MFA remains incomplete.
- Application and program write/lifecycle routes remain disabled. All future routes must use trusted database-loaded grants and per-record checks.
- Application CRUD, task creation/update, file upload/download, malware scanning, notifications, and reporting are not implemented.
- SLA overdue state is computed on read; no background scheduler, automatic escalation worker, or notification channel is deployed. Only the narrow task-status transition route is implemented; task creation, assignment changes, due-date edits, and other task-field writes remain unavailable.
- Secrets management, production hosting, TLS termination, migrations automation, monitoring, backups, and restore tests must be configured and verified separately.
- Review applicable personal-data, consent, retention, and incident-response requirements before collecting real beneficiary data.

Never put real applicant data, uploaded documents, database credentials, or access tokens in this repository or test fixtures.


## Runtime wiring clarification — 2026-11-09

- The entry point creates and injects the authentication service only when `LOGIN_RATE_LIMIT_HMAC_KEY` is configured. The login route then remains fail-closed if that service is absent.
- The entry point creates and injects the recovery rate limiter when `RECOVERY_RATE_LIMIT_HMAC_KEY` is configured, but does not create or inject `recoveryService`. Recovery request/reset handlers therefore return `503 recovery_unavailable` and are not operational.
- No backend hosting, staging database, deployment workflow or provider configuration is confirmed. See `docs/BACKEND_STAGING_DEPLOYMENT_RUNBOOK.md` before any provisioning.


## Container image

A minimal production image is defined in `Dockerfile`:

```sh
docker build --pull -f Dockerfile -t userdie-digital-api:local .
```

The image uses Node.js 22, installs production dependencies only, excludes tests and local secrets, runs as the unprivileged `node` user, and provides a process-liveness health check at `/api/v1/health/live`.

Run it only with an explicitly configured, isolated non-production PostgreSQL database and secrets supplied through the runtime environment. The container does not run schema migrations automatically. Do not mount a developer's `.env` file into a shared or production runtime, and do not publish the image or expose a public endpoint until the staging runbook acceptance checks are complete.

The GitHub Actions backend workflow builds the image as a CI check. It does not push to a registry or deploy a hosted service.
