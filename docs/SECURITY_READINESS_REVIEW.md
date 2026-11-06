# USERDIE Digital — security readiness review

**Review date:** 2026-11-06  
**Repository:** `userdie-foundation/userdie-digital`  
**Branch:** `main`  
**Reviewed revision:** `58a05a2c0f6a9624268504a0250f9e4a06cfa735`  
**Status:** repository and implementation review; not a penetration test, independent security audit, production deployment verification or certification.

## Executive finding

The repository now contains more than a draft API contract. It includes a Node.js HTTP service, PostgreSQL schema migrations 001–010, password-login and logout handlers, database-backed session validation and rotation, account/network login throttling, scoped role grants, protected read routes and a password-recovery service core.

These are meaningful implementation foundations, but they do not establish production readiness. The runtime still depends on deployment configuration and an actual database; production migrations and secrets are not confirmed as applied. Account-recovery HTTP routes and trusted email delivery are not connected. MFA is not implemented. Application intake and write operations remain deliberately disabled or unavailable. The public website and prototype workspaces remain demonstrational.

Do not enter real beneficiary, donor, employee or partner personal data through static demo pages or an unapproved backend deployment.

## Evidence reviewed

- `backend/src/index.mjs`: creates the PostgreSQL pool, injects the database-backed principal resolver and configures authentication only when the login rate-limit HMAC secret is present.
- `backend/src/server.mjs`: implements login, logout, session rotation and protected routes; login and other state-changing authentication routes enforce the configured exact Origin.
- `backend/src/security/authentication.mjs`: password verification, opaque session issuance, transactional audit event and rate-limiter calls.
- `backend/src/security/login-rate-limit.mjs`: PostgreSQL account/network buckets use HMAC digests; the HTTP login path supplies the socket peer address rather than trusting forwarded headers.
- `backend/src/security/principal.mjs` and authorization modules: validate server-side session state and load active grants from trusted storage.
- `backend/src/security/account-recovery.mjs`: recovery service core stores token digests and revokes active sessions after a successful reset; HTTP routes and production delivery are not connected.
- `backend/migrations/001_initial_schema.sql` through `010_auth_recovery_tokens.sql`: schema and security-control migrations are present in source.
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
8. Account-recovery token storage and service logic, without user-facing HTTP routes or a production mail provider.

## Release blockers before real personal data is processed

### 1. Identity and authentication
- Confirm production configuration for `DATABASE_URL`, `ALLOWED_ORIGIN`, `LOGIN_RATE_LIMIT_HMAC_KEY`, database TLS and the actual HTTPS proxy topology.
- Apply and verify migrations 001–010 through a controlled process after backup verification.
- Complete CSRF threat-model review and acceptance tests for browser-originated state changes, including session rotation and logout.
- Review password policy, administrator bootstrap, session lifetime, revocation and account suspension behavior.
- Implement MFA enrollment, challenge verification, recovery codes, privileged-role enforcement and audit coverage.

### 2. Account recovery
- Add request/reset HTTP routes with strict validation, generic responses and abuse throttling.
- Connect a trusted email-delivery provider without logging or exposing raw recovery tokens.
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

1. Complete the CSRF/proxy review and verify the authentication lifecycle in a controlled non-production environment.
2. Implement recovery HTTP routes and trusted email delivery; add expiry/replay and abuse tests.
3. Implement MFA and privileged-role enforcement.
4. Complete the role/scope negative test matrix and privacy controls.
5. Verify migration execution, secrets, monitoring, backups and restore.
6. Only then authorize a limited pilot with synthetic-to-real data transition approval, documented owners and rollback criteria.

## Publication and reporting rule

A Git commit is not a deployment. A green CI run is evidence only for the checks that actually ran. Report the public website as updated only after the GitHub Pages workflow succeeds; report live visual behavior only after an external client check. Report authentication or data processing as production-ready only after the actual deployed environment and acceptance tests have been independently verified.
