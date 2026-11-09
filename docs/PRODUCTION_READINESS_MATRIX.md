# USERDIE Digital — production readiness matrix

Updated: 2026-11-06  
Reviewed revision: `58a05a2c0f6a9624268504a0250f9e4a06cfa735`  
Repository: `userdie-foundation/userdie-digital`  
Publication: GitHub Pages (`website/`)

This matrix distinguishes repository implementation, automated test evidence, public deployment, and production operation. Passing CI does not prove that the API or database is deployed, configured, or approved for real personal data.

## Current verified baseline

| Area | Repository evidence | Production meaning |
|---|---|---|
| Public website | Static site is built from `website/` and deployed through GitHub Pages. The latest public-site commit passed the deployment workflow. | Public informational site is published. External visual smoke testing of the live URL remains separate. |
| Applicant / partner / staff workspaces | HTML demonstrators and prototype screens exist. | These are not production intake or document-exchange services. Do not enter real beneficiary, donor, employee, or partner data. |
| API process | Node.js HTTP service, PostgreSQL pool, liveness/readiness routes, graceful shutdown and configuration validation exist in source. | API hosting, network boundaries, TLS termination, runtime configuration and operational ownership are not evidenced as deployed. |
| PostgreSQL | Migrations 001–010 cover core records, history, sessions, program lifecycle, workflow/SLA, scoped grants, approvals, login throttling and recovery-token storage. Integration tests apply the migrations in an isolated schema when `PG_INTEGRATION_URL` is configured. | Production migration execution and database backup/restore are not confirmed. |
| Login and logout | HTTP login/logout handlers and a database-backed opaque-session lifecycle exist. The runtime entry point conditionally injects the authentication service only when `LOGIN_RATE_LIMIT_HMAC_KEY` is configured; the service uses the PostgreSQL-backed account/network limiter. | This is conditional source wiring, not a deployed or accepted identity service. Production secrets, migrations, HTTPS/proxy settings, account bootstrap, CSRF review and MFA policy still require verification. |
| Session and authorization | Server-side session validation, principal loading from trusted storage, scoped role grants, revocation and read-only protected routes exist. Session rotation is implemented. | Access-control acceptance and deployment review remain required. No client-supplied role or owner value may be trusted. |
| Account recovery | Token-storage and recovery-throttling migrations, service core, request/reset route handlers and a PostgreSQL-backed recovery rate-limiter hook exist. | The runtime entry point injects the rate limiter but does **not** inject `recoveryService`; no trusted email-delivery adapter is configured. The routes fail closed with `503 recovery_unavailable`. Recovery is not operational for users. |
| MFA | Requirements are documented. | Enrollment, challenge verification, recovery codes and enforcement are not implemented. |
| Applications / cases | Read-only detail access is guarded by server-side authorization; the collection route deliberately fails closed. | No production application intake, case create/update, task-write, attachment or notification workflow. |
| Programs | Read-only program dossier and milestone route with scoped authorization exists. | Governed program creation, approval, publication and lifecycle write APIs are not complete. |
| Workflow / SLA | Read-only task and event views, database event history, and a narrowly scoped task-status transition route (`PATCH /api/v1/workspace/tasks/:id/status`) exist; the route has passing Backend CI tests on 9 Nov 2026. | The route is not deployed to a confirmed API host or connected to the public UI. Task creation, assignment changes, other task-field writes, scheduled escalation workers and notification delivery are not complete. |
| Independent approvals | Approval schema, audit events and read paths are present in the backend. | End-to-end governed approval operations and production authorization sign-off remain outstanding. |
| Finance, asset valuation and BFU | Specifications and demonstrator materials exist. | No production financial ledger, token custody, signing, transfer, exchange or minting operation is confirmed. Keep BFU and ZHAKIN Points separate from USERDIE Digital. |
| Operations | CI, security scans and health-check workflows exist. | Production monitoring, alerting, backups, restore drills, incident response and operational ownership still need deployment evidence. |

## Release gates

### Gate 1 — Public website quality
- Check every internal link and asset path in the published website.
- Verify mobile layout, keyboard navigation, visible focus, heading structure, contrast and screen-reader labels.
- Verify redirects, certificate chain, canonical host and 404 behavior from an external client.
- Capture dated desktop and mobile screenshots after visual changes.
- Keep prototype labels explicit; never imply that a form is live if it does not submit to a protected service.

**Acceptance evidence:** automated link/asset checks pass; manual desktop/mobile review is recorded; screenshots correspond to the deployed commit.

### Gate 2 — Identity and account security
- Approve the account lifecycle, administrator bootstrap, identity proofing, password policy, MFA policy, recovery process and suspension process.
- Verify login, logout, session rotation, expiry, revocation and account/network throttling in the actual deployment.
- Complete CSRF and proxy-topology review for browser-originated state changes.
- Complete recovery HTTP routes, trusted email delivery, token expiry/replay tests, abuse throttling and operational failure handling.
- Implement and enforce MFA for privileged roles according to the approved policy.
- Add negative tests for expired/revoked sessions, inactive accounts, CSRF, brute-force throttling and privilege changes.

**Acceptance evidence:** threat-model review, passing automated security tests, deployment configuration review and independently tested account lifecycle. Until then, no real beneficiary accounts.

### Gate 3 — Application intake and case operations
- Approve minimum data fields, consent/legal basis, retention schedule, deletion and access procedures.
- Implement validated application submission, idempotency, controlled status transitions, task assignment and append-only audit events.
- Add private document storage outside the public web root, short-lived authorized downloads, file-size/type controls, malware scanning and retention enforcement.
- Add notification delivery with retry, deduplication and no sensitive data in message previews.
- Enforce record-level authorization on every endpoint and test cross-user / cross-program denial.

**Acceptance evidence:** end-to-end synthetic case test; access-control test matrix; audit trail; recovery and retention test. Do not use real personal data in CI.

### Gate 4 — Programs, partners and governance
- Define approved program states and who may create, review, approve, publish, suspend or close a program.
- Add explicit partner access grants with purpose, scope, expiry and revocation.
- Complete governed write APIs and approval history; keep partner and program scopes separate.
- Add reports that distinguish draft, approved, published and closed records.

**Acceptance evidence:** role/scope test matrix and signed-off operating rules.

### Gate 5 — Finance, assets and BFU separation
- Keep foundation accounting, asset valuation records, BFU token infrastructure and ZHAKIN Points as separate ledgers and permission domains.
- Implement maker-checker approvals, immutable audit history, reconciliation and export controls before financial writes.
- Keep wallet keys outside the application; no private-key custody or autonomous transfers.
- Require legal, accounting, security and governance review before any live token or treasury operation.

**Acceptance evidence:** reviewed control design, testnet-only rehearsal where applicable, reconciliation evidence and explicit authorization.

### Gate 6 — Production operations
- Select and document API hosting, database hosting, secrets management, network boundaries, TLS termination and deployment ownership.
- Apply migrations only through a controlled process after backup and restore verification.
- Configure health checks, structured redacted logs, metrics, alerting, dependency updates, vulnerability response and incident runbooks.
- Test backup restoration and disaster recovery; document RPO/RTO and responsible operators.

**Acceptance evidence:** deployment record, successful restore drill, monitoring alerts tested and operational owner sign-off.

## Immediate implementation order

1. Complete the public-site link, asset, accessibility and responsive review.
2. Close identity lifecycle gaps: CSRF review, account recovery delivery/routes and MFA.
3. Verify the API and PostgreSQL stack in a controlled non-production deployment.
4. Complete negative authorization tests and privacy acceptance checks.
5. Add controlled application intake and case workflow only after identity and privacy gates pass.
6. Add program/partner governance, then finance and BFU controls.
7. Approve production hosting, secrets, backups, monitoring and restore procedures before any live data.

## Non-negotiable release rule

A module is **production-ready** only when implementation, automated tests, deployment, operational controls and acceptance evidence all exist. A mockup, schema, source implementation or passing CI workflow alone does not satisfy this rule.

## Verified update — 2026-11-09

- Backend checks for commit `c04b55dd5b42ae68dfc8cfb0ff8c1753bcd11976` completed successfully: JavaScript syntax check and all 143 automated tests passed (0 failed).
- USERDIE Digital robot team for the same commit completed successfully.
- The only new workflow write capability is a scoped status transition for an existing task. It uses trusted server-side scope, an allowlisted transition map, transaction handling and compare-and-set against the expected prior status.
- The workspace page still uses browser `localStorage` demo records; it is not connected to this API route. Backend hosting, production database/migrations, secrets, TLS/origin configuration, monitoring and restore evidence remain unverified. No real beneficiary data should be entered.


## Verified infrastructure preparation — 2026-11-09

- Rechecked the latest `main` revision: `4c74a235a30006bbb07bbd89710576f3a5ffd2e9`.
- USERDIE Security Guard, Public Repository Security Check and USERDIE Digital Robot Team all completed with `success` for that revision.
- Added `docs/BACKEND_STAGING_DEPLOYMENT_RUNBOOK.md` as a provider-neutral preparation document. It does not provision infrastructure or claim that a staging service exists.
- Repository inspection confirms there is no backend Dockerfile, Compose file, provider manifest or backend deployment workflow. Node.js 22+, PostgreSQL, runtime variables and health endpoints are present in source.
- The public website and backend remain separate deployment surfaces. No DNS, MX, hosting resource, database or secret was changed or provisioned.
- The workspace UI remains a local-storage demonstrator; no frontend/API integration was attempted.
