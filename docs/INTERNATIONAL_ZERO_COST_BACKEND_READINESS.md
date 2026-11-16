# USERDIE Digital — zero-cost and secure backend readiness

**Decision date:** 2026-11-16  
**Status:** engineering and test stage only; no production backend is deployed by this document.  
**Budget constraint:** €0 of new recurring spend. No new cloud account, paid server, managed database, paid add-on, DNS change, or mail change is authorized.

## 1. Architecture decision

The platform is designed to be internationally deployable and provider-independent. This is an architectural direction, not a decision to place all personal data in a foreign region.

- Keep the public static website on its existing GitHub Pages deployment.
- Keep the API in the existing Node.js 22 application and existing Docker image.
- Keep PostgreSQL as the database engine.
- Keep the existing Resend integration; do not replace the mail provider or assume a paid tier.
- Do not make the public frontend depend on a production API until a real deployment has passed the acceptance gates.
- Keep provider-specific deployment configuration outside application business logic. Prefer standard Docker/Compose, PostgreSQL, HTTPS, environment variables, and documented backup/restore procedures.
- Any future regional data partitioning must be based on applicable data-protection and localization requirements, not on a provider marketing claim.

## 2. What may be used at €0 now

1. Existing GitHub repository and GitHub Pages deployment, subject to the current account's plan limits and terms.
2. Existing GitHub Actions workflow for automated tests, syntax checks, PostgreSQL integration tests, Docker build, and container smoke tests, subject to included Actions minutes/storage limits.
3. Local Docker Engine/Compose and a local PostgreSQL instance for development and synthetic-data tests.
4. Existing Resend integration only within the account's currently available plan and verified sender configuration. Do not assume free quota or enable live recovery delivery without a controlled test.
5. Documentation, configuration validation, code review, static checks, and test fixtures that do not require a paid external service.

No third-party free-tier cloud database or server is selected for production. Free-tier services can have suspension, data-retention, geographic, quota, and support limitations; they are not accepted as the only production store for beneficiary or donor records.

## 3. Current verified code baseline

Reviewed on the default branch on 2026-11-16:

- `backend/package.json`: Node.js >=22, ESM, `pg` dependency, syntax-check and Node test scripts.
- `backend/Dockerfile`: Node 22 Bookworm Slim, production mode, non-root `node` runtime, port 8080, liveness health check.
- `backend/src/config.mjs`: validates PostgreSQL URL, exact HTTP(S) origin, HTTPS recovery URL, minimum 32-byte rate-limit HMAC keys, and complete Resend configuration.
- `backend/src/index.mjs`: database pool; separate login and recovery rate limiters; recovery service is not initialized unless required runtime settings are present; logs avoid printing database credentials.
- `backend/src/server.mjs`: security headers, bounded JSON body parsing, server-side principal resolution, and fail-closed protected routes (full route-by-route audit remains outstanding).
- `backend/src/security/authorization.mjs`: malformed principals fail closed; trusted roles/scopes are not accepted from client input; several sensitive write permissions intentionally return false.
- `backend/src/security/resend-recovery-mailer.mjs`: validates HTTPS recovery URL and token format; avoids exposing provider response bodies.
- `.github/workflows/backend-checks.yml`: Node 22 syntax checks, PostgreSQL 16 integration service, automated tests, Docker build, and container smoke test including non-root UID and fail-closed readiness.

The repository's continuity record reports a successful backend workflow run `43948429499` on commit `5a80d7372560c106b73696ff3642a56475a24706`. The latest documentation commit itself has no reported status checks in the connector response. Do not infer that a new workflow passed merely because the workflow file exists.

## 4. Security observations and remaining audit work

### Positive controls observed

- Docker application process runs as the unprivileged `node` user.
- PostgreSQL is accessed through the `pg` client; connection pool has finite size and timeouts.
- Database connection errors are not logged with credentials.
- Separate login and recovery HMAC keys are expected, each at least 32 bytes.
- Exact-origin configuration rejects malformed origins and does not accept wildcard origins.
- Recovery URL must use HTTPS and cannot include credentials, query, or fragment.
- Recovery mail is fail-closed unless its runtime settings are complete.
- Session cookie parser rejects duplicate session-cookie names and oversized cookie headers.
- Authorization policy defaults to deny for unknown permissions and disables sensitive partnership writes pending review.
- CI uses a disposable PostgreSQL service and synthetic credentials; container smoke test checks non-root execution and readiness failure when the database is unavailable.

### Remaining checks before any real deployment

- Complete route-by-route review of `backend/src/server.mjs`, including CORS preflight, CSRF protections, cookie attributes, method handling, error paths, and rate limiting.
- Review all authentication, session lifecycle, password hashing, recovery token expiry/one-time-use, and audit-log flows together.
- Verify every SQL query is parameterized and review database grants/ownership.
- Review all SQL migrations for least privilege, PII minimization, indexing, rollback/recovery, and schema consistency.
- Verify repository secret scanning and dependency vulnerability checks are enabled and passing on the exact candidate commit.
- Verify lockfile is committed and Docker dependency installation is reproducible. Do not change dependency versions without tests.
- Review logs for PII, tokens, email addresses, session IDs, and recovery URLs.
- Confirm backup encryption, access controls, retention, region, and an actual restore rehearsal before production data.
- Obtain a legal assessment of controller/processor roles, data location, international transfers, retention, and user rights for each jurisdiction served.

## 5. Safe operating boundaries

Until the foundation explicitly approves a deployment and its budget:

- Do not create or activate a cloud VPS, managed database, storage bucket, CDN add-on, or paid monitoring service.
- Do not add payment details or start a trial that can convert to paid service.
- Do not change DNS, MX, domain settings, GitHub Pages source, or public API origin.
- Do not place real beneficiary, donor, employee, or partner personal data in development or CI.
- Do not enable public login, public recovery delivery, or write workflows.
- Do not place credentials, API keys, private keys, tokens, or real environment files in GitHub or chat.
- Do not describe local/CI tests as a production deployment.

## 6. €0 execution sequence

1. Audit the backend source and migration files in the repository.
2. Fix only defects supported by code review or reproducible tests; keep changes minimal.
3. Run the existing Backend checks workflow on the candidate commit.
4. Record the exact commit, workflow run, job outcomes, and test evidence.
5. Keep all test data synthetic and all database services ephemeral/local.
6. Prepare provider-neutral Docker/Compose deployment files only after reviewing the full source and without embedding secrets.
7. Revisit providers and regional placement only when a real deployment budget and legal/data-location requirements are approved.

## 7. Production release gates

A production launch is not approved until all are true:

- [ ] A provider and region are explicitly approved, including contract, price, data-processing terms, and legal review.
- [ ] HTTPS and origin configuration are verified against the real public domain.
- [ ] SSH/admin access is restricted; no public database, Docker socket, or admin panel.
- [ ] Runtime and migration database roles are separate and least-privilege.
- [ ] Secrets are held outside GitHub source and protected by appropriate access controls.
- [ ] All tests pass on the exact release commit.
- [ ] Authentication, authorization, recovery, CORS/CSRF, and audit logging have passed focused security review.
- [ ] Encrypted backups have been restored successfully in an isolated environment.
- [ ] Data location, retention, incident response, and recovery objectives are documented.
- [ ] The foundation approves enabling any public-facing account feature.

## 8. Superseded hosting note

The earlier `docs/REG_RU_BACKEND_HOSTING_PLAN.md` is retained for historical context only. Its REG.RU-first hosting assumption is superseded by this provider-independent, international, zero-new-spend decision. No REG.RU or international production infrastructure is currently selected or deployed.


## 9. Focused integration audit — findings to resolve before deployment

The following issues were identified by source review on 2026-11-16. They are release blockers or integration requirements, not evidence of a production compromise.

### P1 — Cross-origin browser authentication is not yet enabled

The API currently returns `Access-Control-Allow-Origin` for the configured website origin, but does not return `Access-Control-Allow-Credentials: true`. Its OPTIONS allowlist currently permits preflight only for the two password-recovery routes. A browser frontend on GitHub Pages calling a separately hosted API will need a carefully scoped credentialed CORS policy and preflight rules for the required authentication/session endpoints. Do not enable this broadly: keep the exact origin, explicit methods/headers, and same-origin Origin validation on state-changing requests. Add integration tests before changing this behavior.

### P1 — Reverse-proxy client IP boundary is not configured

Login and recovery throttling currently use `req.socket.remoteAddress` and intentionally do not trust forwarded headers. This is safe against spoofed `X-Forwarded-For`, but behind a reverse proxy the socket peer may be the proxy address for every user. Before deployment behind any proxy/load balancer, implement a narrowly configured trusted-proxy boundary or enforce equivalent per-client throttling at the trusted edge. Never simply trust arbitrary forwarded headers.

### P2 — Dependency lockfile was not found at `backend/package-lock.json`

The inspected path returned 404. The CI and Docker build currently use `npm install`, so dependency resolution is not pinned by a committed npm lockfile. Before a production release, generate and commit a lockfile from the declared dependencies, then use `npm ci` in CI and the Docker build, and rerun the full test suite. Do not make this change without verifying the resulting lockfile and tests.

### P2 — Full authorization and migration audit remains open

The review confirmed parameterized queries in the inspected repository methods and several deny-by-default controls, but this was not a complete audit of every route, migration, grant, and data field. Review all route-level permission checks, transaction boundaries, audit events, and all migrations 001 onward before any real user data is introduced.

## 10. CI evidence

The existing Backend checks run `43948429499` was inspected directly. Its single `test` job completed with conclusion `success`; the steps for dependency installation, syntax checks, automated tests, Docker image build, and production-container smoke test all completed successfully. This run belongs to the earlier commit recorded in the project continuity notes, not to the documentation commits in this file. The documentation-only commits did not trigger the backend workflow. No claim of a fresh test run on the current HEAD is made.
