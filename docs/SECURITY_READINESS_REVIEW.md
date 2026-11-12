# USERDIE Digital — security readiness review

**Review date:** 2026-11-12  
**Repository:** `userdie-foundation/userdie-digital`  
**Branch:** `main`  
**Reviewed revision:** `9c0fb77a7f552c0555a1b4bc0c83dc642046f4bc` plus source re-check on 2026-11-12  
**Status:** repository and implementation review; not a penetration test, independent security audit, production deployment verification or certification.

## Executive finding

The repository contains a Node.js HTTP service, PostgreSQL schema migrations 001–014, password-login/logout and session lifecycle handlers, database-backed principal resolution, account/network throttling, scoped role grants, protected read routes, a narrow task-status transition route, and partnership persistence groundwork.

These are source-level foundations, not production readiness. No backend hosting, staging/production database, managed secrets, or execution of migrations 001–014 against a live environment is confirmed. Recovery request/reset handlers exist in `server.mjs`, but `index.mjs` does not inject the recovery service, so they fail closed with `503 recovery_unavailable`; no trusted email delivery adapter is configured. MFA persistence schema exists (migration 012), but enrollment, verification, managed key custody and enforcement are not implemented. Application intake remains disabled (`503 applications_module_unavailable`), and partnership HTTP routes/file transfer are not implemented. Public applicant and partner pages remain demonstrational.

Do not enter real beneficiary, donor, employee or partner personal data through static demo pages or an unapproved backend deployment.

## Evidence reviewed

- `backend/src/index.mjs`: creates the PostgreSQL pool, injects the database-backed principal resolver and configures authentication only when the login rate-limit HMAC secret is present.
- `backend/src/server.mjs`: implements login, logout, session rotation, protected routes and recovery request/reset handlers; recovery handlers fail closed until a service is injected. Login and other state-changing authentication routes enforce the configured exact Origin.
- `backend/src/security/authentication.mjs`: password verification, opaque session issuance, transactional audit event and rate-limiter calls.
- `backend/src/security/login-rate-limit.mjs`: PostgreSQL account/network buckets use HMAC digests; the HTTP login path supplies the socket peer address rather than trusting forwarded headers.
- `backend/src/security/principal.mjs` and authorization modules: validate server-side session state and load active grants from trusted storage.
- `backend/src/security/account-recovery.mjs`: recovery service core stores token digests and revokes active sessions after a successful reset. Request/reset handlers exist in `server.mjs`, but the production entry point does not inject this service; the routes therefore fail closed with `503 recovery_unavailable`.
- `backend/migrations/001_initial_schema.sql` through `014_partnership_workspace.sql`: schema and security-control migrations are present in source. Migration 011 blocks ordinary UPDATE/DELETE/TRUNCATE operations on audit events; migration 012 adds MFA persistence structures only; migration 014 adds partnership persistence and a database guard for independently approved confirmation.
- `backend/test/`: HTTP and PostgreSQL integration tests use synthetic identities and records. PostgreSQL integration execution depends on `PG_INTEGRATION_URL`.
- `backend/README.md` and `docs/AUTHENTICATION_OPERATIONS.md`: document runtime requirements and activation gates.
- `website/prototype/workspace.html`: public prototype workspace remains a demonstrator and must not collect real case data.
- `website/prototype/api/openapi.yaml`: draft API contract still uses a placeholder server URL and must not be mistaken for the deployed API endpoint.

## Implemented in source — not proof of production activation

1. Password login and logout HTTP handlers.
2. Opaque, high-entropy session tokens; only token hashes are persisted.
3. Server-side session resolution, expiry/revocation checks and principal/grant loading.
4. Session rotation.
5. PostgreSQL-backed account and network throttling, enabled in the login service when the HMAC secret is configured.
6. Scoped role grants and auditable grant revocation.
7. Read-only protected application, program, workflow and approval routes with server-side authorization.
8. Account-recovery token storage/service logic and HTTP request/reset handlers are present in source; runtime injection is absent, so handlers return `503 recovery_unavailable`. No production mail provider is configured.
9. A central exact-Origin guard rejects state-changing HTTP methods when Origin is missing, null or does not match the configured origin; proxy/TLS and CSRF threat-model review remain required.
10. Database triggers block ordinary UPDATE, DELETE and TRUNCATE operations on audit events; privileged database ownership and DDL controls remain necessary.
11. MFA schema groundwork for encrypted TOTP metadata, short-lived challenge digests and one-time recovery-code verifiers; no enrollment, verification, KMS integration or enforcement.

## Release blockers before real personal data is processed

### 1. Identity and authentication
- Confirm production configuration for `DATABASE_URL`, `ALLOWED_ORIGIN`, `LOGIN_RATE_LIMIT_HMAC_KEY`, database TLS and the actual HTTPS proxy topology.
- Review, apply and verify migrations 001–014 through a controlled process after backup/restore verification; migration 012 does not activate MFA and migration 014 does not expose partner routes.
- Complete CSRF threat-model review and acceptance tests for browser-originated state changes, including session rotation and logout; verify exact-Origin enforcement behind the actual TLS proxy.
- Review password policy, administrator bootstrap, session lifetime, revocation and account suspension behavior.
- Implement MFA enrollment, challenge verification, recovery codes, privileged-role enforcement and audit coverage.

### 2. Account recovery
- Inject the existing recovery service into the runtime only after configuring a trusted email-delivery adapter and required secrets.
- Verify the existing request/reset HTTP handlers with strict validation, generic responses, abuse throttling, expiry/replay and delivery-failure tests; never log or expose raw recovery tokens.
- Test expiry, single-use behavior, replay, token rotation, session revocation, audit failure and delivery-provider failure.
- Define support and identity-verification procedures for recovery requests.

### 3. Authorization and data isolation
- Enforce deny-by-default authorization on every server request.
- Test cross-user, cross-program and cross-role access, including direct object-ID substitution.
- Keep internal task assignments, escalation details and audit records unavailable to applicants and partners.
- Verify that browser-supplied role, owner, program and user identifiers cannot widen server-authorized scope.
- Review approval independence and maker-checker separation for every high-impact operation.

### 4. Personal and sensitive information
- Approve the legal basis, privacy notice, data minimization, retention schedule and deletion/archiving procedure before collection.
- Prohibit sensitive personal data and free text in analytics and general event payloads unless separately justified and protected.
- Encrypt transport and stored data; define backup encryption and controlled restoration.
- Keep production secrets out of Git, static assets, browser bundles and workflow logs.

### 5. Audit integrity
- Record actor, action, target, timestamp and correlation identifier on security-relevant changes.
- Prevent ordinary application roles from modifying or deleting audit history.
- Restrict audit access and log access to the audit log itself.
- Test append-only behavior, ordering, duplicate/idempotency handling and failure behavior.

### 6. Operational readiness
- Select and document API hosting, database hosting, secret management, network boundaries, TLS termination and deployment ownership.
- Configure monitoring, alerting, structured redacted logs, dependency response and incident runbooks.
- Demonstrate backup restoration in a non-production environment and define RPO/RTO.
- Perform independent security testing before a limited pilot.

## Required acceptance tests

- Unauthenticated requests receive no protected data.
- Expired, revoked and malformed sessions are rejected.
- Inactive or suspended accounts cannot use protected routes.
- An applicant cannot read another applicant's record or internal workflow.
- A partner cannot read internal case tasks, escalations or unrelated partner material.
- A program manager cannot access a program outside the manager's assigned scope.
- Client-supplied role/owner filters cannot widen server-authorized scope.
- Account and network throttling block repeated login attempts without storing raw email/IP identifiers.
- CSRF and Origin protections behave correctly behind the actual production TLS proxy.
- Recovery tokens expire, cannot be replayed, are never logged, and revoke active sessions after successful reset.
- MFA is required for the privileged roles defined by policy.
- Audit records cannot be changed or deleted by ordinary application roles.
- Small-cohort analytics are suppressed and direct identifiers/free text are absent.
- Backup restoration is demonstrated in a non-production environment.
- Secrets and personal data do not appear in repository history, static bundles or CI logs.

## Immediate implementation sequence

1. Complete the CSRF/proxy review and verify the authentication lifecycle in a controlled non-production environment, including the exact-Origin guard.
2. Complete runtime injection for the existing recovery handlers, trusted email delivery, and expiry/replay/abuse tests.
3. Implement MFA enrollment, verification, managed key custody, recovery-code consumption and privileged-role enforcement; migration 012 is schema groundwork only.
4. Complete the role/scope negative test matrix and privacy controls.
5. Verify migration execution, secrets, monitoring, backups and restore.
6. Only then authorize a limited pilot with synthetic-to-real data transition approval, documented owners and rollback criteria.

## Publication and reporting rule

A Git commit is not a deployment. A green CI run is evidence only for the checks that actually ran. Report the public website as updated only after the GitHub Pages workflow succeeds; report live visual behavior only after an external client check. Report authentication or data processing as production-ready only after the actual deployed environment and acceptance tests have been independently verified.
