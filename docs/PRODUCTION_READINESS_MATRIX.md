# USERDIE Digital — production readiness matrix

Updated: 2026-11-03  
Repository: `userdie-foundation/userdie-digital`  
Publication: GitHub Pages (`website/`)

This document distinguishes published website content, demonstrators, tested backend foundations, and production capabilities. A green CI run is evidence that the checked code passed its automated tests; it is not evidence that a production API, database, authentication service, or beneficiary workflow has been deployed.

## Current verified baseline

| Area | Current state | Production meaning |
|---|---|---|
| Public website | Published through GitHub Pages; custom domain and HTTPS were confirmed by the project owner in GitHub Pages settings | Public informational website is available; application hosting is separate |
| Public content and navigation | Static HTML/CSS with linked prototype pages | Navigation is published; linked workspaces are demonstrators |
| Applicant / partner / staff workspaces | Static demonstrator pages | No real accounts, records, submissions, or document exchange |
| API process | Node.js HTTP service scaffold with liveness and database-readiness routes | Source exists; production hosting and operational controls are not evidenced by this repository |
| PostgreSQL schema | Migrations 001–007, including applications, program lifecycle, workflow/SLA metadata, sessions, scoped grants and revocation audit | Schema is prepared in source; production migration execution is not confirmed |
| Identity and authorization | Opaque-session validation and database-backed principal/grant resolution; read-only protected routes | No login or session issuance flow; protected endpoints remain inaccessible without a separately issued valid session |
| Applications | Read-only detail route with record-level authorization; collection route deliberately unavailable | No intake, create/update, task write, attachment, or notification workflow |
| Programs | Read-only program dossier and milestones with scoped authorization | No governed program creation, approval, or lifecycle write API |
| Workflow / SLA | Read-only tasks/events endpoint; overdue status calculated on read | No task write API, scheduler, escalation worker, or notification delivery |
| BFU Treasury / Wallet / Exchange | Specifications and demonstrator materials | No production custody, signing, transfers, exchange, or minting operations |
| Monitoring / continuity | CI checks exist | Production monitoring, alerting, backups, restore drills and incident response need deployment evidence |

## Release gates

### Gate 1 — Public website quality
- Check every internal link and asset path in the published website.
- Verify mobile layout, keyboard navigation, visible focus, heading structure, contrast, and screen-reader labels.
- Verify HTTP-to-HTTPS redirect, certificate chain, canonical host, and 404 behavior from an external client.
- Capture a dated desktop and mobile screenshot after any visual change.
- Keep all prototype labels explicit; never imply a form is live if it does not submit to a protected service.

**Acceptance evidence:** automated link/asset check passes; manual desktop/mobile review is recorded; screenshots correspond to the deployed commit.

### Gate 2 — Identity and account security
- Approve the account lifecycle, administrator bootstrap, identity proofing, password policy, MFA policy, account recovery, and suspension process.
- Implement login, session issuance, rotation, logout/revocation, CSRF protection, rate limiting, and generic authentication errors.
- Store password verifiers using a maintained password-hashing scheme and reviewed parameters; never store plaintext credentials.
- Add negative tests for expired/revoked sessions, inactive accounts, CSRF, brute-force throttling, and privilege changes.
- Verify secure cookie behavior behind the actual production TLS proxy.

**Acceptance evidence:** threat-model review, passing automated security tests, deployment configuration review, and an independently tested account lifecycle. Until then, no real beneficiary accounts.

### Gate 3 — Application intake and case operations
- Approve minimum data fields, consent/legal basis, retention schedule, deletion and access procedures.
- Implement validated application submission, idempotency, controlled status transitions, task assignment, and append-only audit events.
- Add private document storage outside the public web root, short-lived authorized downloads, file-size/type controls, malware scanning, and retention enforcement.
- Add notification delivery with retry, deduplication, and no sensitive data in message previews.
- Enforce record-level authorization on every endpoint and test cross-user / cross-program denial.

**Acceptance evidence:** end-to-end synthetic case test; access-control test matrix; audit trail; recovery and retention test. Do not use real personal data in CI.

### Gate 4 — Programs, partners and governance
- Define approved program states and who may create, review, approve, publish, suspend, or close a program.
- Add explicit partner access grants with purpose, scope, expiry, and revocation.
- Add governed write APIs and approval history; keep partner and program scopes separate.
- Add reports that distinguish draft, approved, published, and closed records.

**Acceptance evidence:** role/scope test matrix and signed-off operating rules.

### Gate 5 — Finance, assets and BFU separation
- Keep foundation accounting, asset valuation records, BFU token infrastructure, and ZHAKIN Points as separate ledgers and permission domains.
- Implement maker-checker approvals, immutable audit history, reconciliation, and export controls before financial writes.
- Keep wallet keys outside the application; no private-key custody or autonomous transfers.
- Require legal, accounting, security, and governance review before any live token or treasury operation.

**Acceptance evidence:** reviewed control design, testnet-only rehearsal where applicable, reconciliation evidence, and explicit authorization.

### Gate 6 — Production operations
- Select and document API hosting, database hosting, secrets management, network boundaries, TLS termination, and deployment ownership.
- Apply migrations only through a controlled process after backup and restore verification.
- Configure health checks, structured redacted logs, metrics, alerting, dependency updates, vulnerability response, and incident runbooks.
- Test backup restoration and disaster recovery; document RPO/RTO and responsible operators.

**Acceptance evidence:** deployment record, successful restore drill, monitoring alerts tested, and operational owner sign-off.

## Immediate implementation order

1. Complete the public-site link, asset, accessibility, and responsive review.
2. Finalize the identity and account-lifecycle threat model before implementing login.
3. Implement and test authentication/session lifecycle as an isolated backend milestone.
4. Add controlled application intake and case workflow only after identity and privacy gates pass.
5. Add program/partner governance, then finance and BFU controls.
6. Deploy the API and database only after hosting, secrets, backups, monitoring, and restore procedures are verified.

## Non-negotiable release rule

A module is **production-ready** only when implementation, automated tests, deployment, operational controls, and acceptance evidence all exist. A mockup, schema, specification, or passing CI workflow alone does not satisfy this rule.
