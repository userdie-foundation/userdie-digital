# USERDIE Digital — post-merge operational checkpoint

**Date:** 2026-11-22  
**Repository:** `userdie-foundation/userdie-digital`  
**Base branch:** `main`  
**Verified main SHA:** `c0c6398e580cd7929cb1866f7b4141c85c2bbc2e`  
**Scope:** post-merge verification of PR #29 and release-gate review. This is a source/repository/CI audit, not a production certification.

## 1. Repository state

- PR #29, “Integrate protected analytical document workflow into valuation workspace”, is **closed and merged** on 2026-11-21.
- The merge commit is `c0c6398e580cd7929cb1866f7b4141c85c2bbc2e`.
- The repository branch API reports `main.protected = false`; required branch protection and required status checks are not enforced.
- PR #29 introduced the protected workspace adapter `website/prototype/workspace-api.js` and connected its script to `workspace.html`.
- The `userdie-api-origin` meta value is empty on `main`. The adapter therefore remains in its explicit demo-only state; no live API request is made from the workspace.

## 2. CI and deployment evidence

All listed runs target the merged main SHA unless noted:

| Control | Run | Result |
|---|---:|---|
| Backend checks (PostgreSQL 16 integration suite, tests, Docker build and smoke test) | [44926905491](https://github.com/userdie-foundation/userdie-digital/actions/runs/44926905491) | success |
| Public website build and deployment | [44926905675](https://github.com/userdie-foundation/userdie-digital/actions/runs/44926905675) | build + deploy success |
| Website quality gate | [44926905493](https://github.com/userdie-foundation/userdie-digital/actions/runs/44926905493) | success |
| Public repository security check | [44926905476](https://github.com/userdie-foundation/userdie-digital/actions/runs/44926905476) | success |
| Security Guard (secret scan, CodeQL, operating notes) | [45010028097](https://github.com/userdie-foundation/userdie-digital/actions/runs/45010028097) | success |
| Robot Team | [45027786878](https://github.com/userdie-foundation/userdie-digital/actions/runs/45027786878) | success |
| Daily platform health check | [45017580693](https://github.com/userdie-foundation/userdie-digital/actions/runs/45017580693) | success |

The CI PostgreSQL service is disposable test infrastructure. It does not create a persistent staging database. The successful website deployment is for the static public site; it is not a backend API deployment.

## 3. Confirmed implementation in source

- Analytical-document lifecycle and PostgreSQL integration tests.
- Independent reviewer assignment and separation of author/reviewer.
- Immutable content versions and lifecycle/identity guards (migrations 019).
- Append-only PDF artifact metadata (migration 020).
- PDF generation from the exact issued version, SHA-256 integrity metadata and authenticated retrieval.
- Workspace API adapter for authentication, reviewer discovery, document creation, review/issue actions and PDF download; feature-gated pending an approved API origin.
- Privacy-consent ledger schema in migration 021, disabled by default through `PRIVACY_CONSENT_LEDGER_ENABLED=false`.

## 4. Release blockers — not completed

1. Select and approve a backend hosting provider/region and staging budget.
2. Provision isolated staging API and PostgreSQL; configure TLS and exact `ALLOWED_ORIGIN`.
3. Provision persistent private PDF storage and test backup/restore.
4. Configure runtime and migration credentials through a secret manager; use separate least-privilege database roles.
5. Apply migrations 001–021 only to a new verified staging database after reviewing migration order and the migration runbook. Do not run production migrations.
6. Configure verified email delivery and complete end-to-end recovery tests before enabling account recovery.
7. Complete security/privacy acceptance and synthetic-data end-to-end tests.
8. Only then set the workspace API origin and test the live staging integration.
9. Define and enforce branch protection / required checks after confirming exact check names and repository settings.
10. Obtain legal approval of consent documents and ledger activation before enabling any consent collection.

No hosted backend, staging database, persistent storage, production secrets, backend deployment, or production migration is confirmed by this audit.

## 5. Next implementation sequence

1. Keep the public website and backend release boundaries separate.
2. Resolve hosting region/provider and budget with the project owner before creating paid resources.
3. Prepare staging only after approval; run migration and role acceptance with synthetic data.
4. Execute end-to-end document lifecycle tests through the deployed staging API.
5. Connect the workspace by setting an approved HTTPS API origin only after TLS, CORS, authentication, authorization and private storage pass acceptance.
6. Address the separate Analytics Center KPI governance gaps: analyst role/scope, small-cell suppression, KPI dictionary, SLA rules and source lineage.
7. Run manual mobile/accessibility review in Safari iOS and Chrome Android; CI/source checks alone do not constitute visual acceptance.

## 6. Integrity rules

- Do not treat a merged PR as a production deployment.
- Do not treat CI's temporary PostgreSQL service as hosted staging.
- Do not enable public intake or consent collection before legal and security sign-off.
- Do not put real beneficiary, donor, employee or partner data into development/test fixtures.
- Do not change DNS or MX as part of this backend work.
- Record each status as one of: source implemented, CI-tested, staging-verified, production-deployed.

