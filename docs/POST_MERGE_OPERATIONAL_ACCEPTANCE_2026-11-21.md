# USERDIE Digital — post-merge operational acceptance plan

**Date:** 2026-11-21  
**Repository:** `userdie-foundation/userdie-digital`  
**Base revision:** `c0c6398e580cd7929cb1866f7b4141c85c2bbc2e`  
**Working branch:** `docs/post-merge-operational-acceptance`  
**Purpose:** carry the project forward after PR #29 without rebuilding the platform or treating source integration as production activation.

## 1. Verified checkpoint

- PR #29 was merged into `main` at `c0c6398e580cd7929cb1866f7b4141c85c2bbc2e`.
- A GitHub compare confirms that `main` is identical to this merge commit at the time of this checkpoint.
- The owner reports that GitHub Pages deployment for the merge commit completed successfully. This is the public static-site deployment, not a backend deployment.
- The merge commit includes the valuation workspace API adapter syntax check, legal-documentation index entries, privacy-consent feature flag defaulting to false, the analytical document workflow, and migration 021.
- Source inspection confirms that `backend/src/index.mjs` wires the account-recovery service to the Resend adapter when the required configuration is present. This is conditional source wiring, not evidence of configured credentials, delivered email, or a deployed backend.
- The valuation workspace keeps `userdie-api-origin` empty by default. It must remain empty until the API host, TLS, database, exact allowed origin, runtime secrets, migrations 001–021, and private PDF storage have passed acceptance.
- The migration 021 consent ledger is append-only and versioned. It has no seeded consent documents; the feature flag defaults to false; special-category and dissemination consent capture are not supported by the ordinary authenticated-session route.
- The repository contains a PostgreSQL runtime-role acceptance audit dated 2026-11-21. It explicitly states that no live database was available and effective staging/production privileges are **NOT VERIFIED**.

## 2. Evidence status — do not conflate the environments

| Area | Current evidence | Status |
|---|---|---|
| PR #29 | Merge commit verified | Merged |
| Main branch | Compare against merge commit is identical | Verified at checkpoint |
| GitHub Pages | Run 44926905675 completed successfully | Verified successful |
| Backend checks on merge commit | Run 44926905491 completed successfully; syntax, automated tests, Docker image build, and container smoke test all passed | Verified successful |
| Backend hosting | No deployed API host or health endpoint evidence | Not configured/verified |
| PostgreSQL migrations 001–021 | Present in source; no target database evidence | Not applied/verified |
| Runtime-role least privilege | Read-only acceptance procedure exists; no live role catalog output | Not verified |
| Private PDF storage | Source integration exists; production volume and access controls unverified | Not configured/verified |
| Account recovery / Resend | Conditional source wiring exists; credentials, verified sender, reset page and delivery test unverified | Not operationally accepted |
| Consent ledger | Source exists; feature flag false, no registered approved documents | Disabled |
| Applicant/partner intake | Existing public pages remain prototypes; real personal-data intake not authorized | Disabled |

A missing workflow record from the available lookup is not a failed check and is not a passed check. Obtain the actual GitHub Actions run and conclusion before recording a CI result.

## 2A. Post-merge CI evidence captured after initial draft

The following GitHub Actions runs were retrieved directly for merge commit `c0c6398e580cd7929cb1866f7b4141c85c2bbc2e` on 2026-11-21:

- [Backend checks — run 44926905491](https://github.com/userdie-foundation/userdie-digital/actions/runs/44926905491): success. Job steps confirm JavaScript syntax check, automated tests with PostgreSQL 16 service, production container build, and container smoke test all completed successfully.
- [Website quality gate — run 44926905493](https://github.com/userdie-foundation/userdie-digital/actions/runs/44926905493): success.
- [USERDIE security guard — run 44926905496](https://github.com/userdie-foundation/userdie-digital/actions/runs/44926905496): success.
- [Public repository security check — run 44926905476](https://github.com/userdie-foundation/userdie-digital/actions/runs/44926905476): success.
- [Robot Team — run 44926905489](https://github.com/userdie-foundation/userdie-digital/actions/runs/44926905489): success.
- [Deploy public website — run 44926905675](https://github.com/userdie-foundation/userdie-digital/actions/runs/44926905675): success.
- [Daily platform health — run 44926954279](https://github.com/userdie-foundation/userdie-digital/actions/runs/44926954279): success.

The backend workflow's PostgreSQL integration suite ran against its ephemeral PostgreSQL 16 service in CI. This is meaningful migration/integration evidence, but it does not establish that a separately provisioned staging or production database exists or that its actual runtime-role grants have been audited.

For PR #32 itself, [Public repository security check — run 44927230578](https://github.com/userdie-foundation/userdie-digital/actions/runs/44927230578) and [USERDIE security guard — run 44927230545](https://github.com/userdie-foundation/userdie-digital/actions/runs/44927230545) both completed successfully. PR #32 is still a Draft and is not merged.

## 3. Release gates — strict order

### Gate A — CI and source integrity

1. Obtain the actual Backend checks, CodeQL/security, Security Guard, and Robot Team workflow results for the merge commit or the latest commit under review.
2. Confirm each required run has conclusion `success`; record its run URL, commit SHA, workflow name, and completion time.
3. If a workflow is absent, determine whether its trigger/filter excludes merge commits. Do not infer success from pre-merge PR checks.
4. Run the complete backend unit, HTTP, migration, and PostgreSQL integration suites on the exact candidate revision.
5. Review any warnings or skipped integration tests; do not weaken gates to obtain a green result.

**Pass evidence:** all required checks are complete and successful on one identified candidate revision, with PostgreSQL integration actually executed.

### Gate B — isolated staging PostgreSQL

1. Provision a new isolated staging database and take a recoverable backup/snapshot before schema application.
2. Apply migrations 001–021 only through the documented migration-owner process, using a separate migration credential. Never use the API runtime credential for migrations.
3. Confirm migration checksums and the schema migration ledger.
4. Create/verify distinct schema-owner/migration, non-owner API runtime, and operator/DBA identities. Do not reuse credentials.
5. Execute every read-only query in `docs/POSTGRES_RUNTIME_ROLE_ACCEPTANCE_AUDIT_2026-11-21.md` against the target database.
6. Confirm no runtime ownership, superuser, inherited privileged memberships, DDL, TRUNCATE, trigger-disable, role-management, or grant-management capability.
7. Confirm effective object/column/routine/default privileges and all required triggers. Investigate PUBLIC and inherited grants.
8. Capture sanitized evidence: environment identifier, timestamp, PostgreSQL version, role names, query outputs, reviewer, and independent second-person approval. Never record passwords or connection strings.

**Pass evidence:** complete privilege matrix and trigger state from the actual staging database, independently reviewed and signed off. A source-level document is not a substitute.

### Gate C — protected analytical document workflow

Use synthetic records and separate test identities for author, reviewer, and operator.

1. Verify unauthorized and unauthenticated requests cannot list, create, change, issue, or download analytical documents.
2. Verify author and reviewer cannot be the same principal; reviewer discovery returns only active independent approvers and does not expose email addresses.
3. Verify the lifecycle: draft → submitted for review → approved or changes requested → corrected draft → resubmitted → approved → issued → archived.
4. Verify approval is bound to the exact immutable document version and that later edits cannot alter an approved/issued version.
5. Verify the issued PDF is the exact approved version, stored outside the public web root, with immutable artifact metadata and SHA-256 provenance.
6. Verify record-level authorization on direct object-ID substitution, PDF download, and reviewer endpoints.
7. Verify audit records capture actor/action/target/time and cannot be modified by the runtime role.
8. Verify storage failures, missing files, and database failures fail closed without leaking paths, credentials, or document contents.

**Pass evidence:** automated integration results plus a staging browser/API walkthrough using synthetic data and separate identities.

### Gate D — consent ledger and legal readiness

1. Keep `PRIVACY_CONSENT_LEDGER_ENABLED=false` until legal approval, document registration, staging acceptance, and accountable operator sign-off are complete.
2. Do not seed placeholder or draft consent documents as approved records.
3. Register only final approved document versions with verified SHA-256, purpose/type, choice keys, approver, and publication timestamp through a controlled process.
4. Keep special-category written consent and dissemination consent outside the ordinary authenticated-session flow until their separate mechanisms are legally and technically reviewed.
5. Verify grant, withdrawal, duplicate submission, concurrent requests, revoked document versions, and immutable event history using synthetic accounts.
6. Confirm privacy notices, operator identity/contact, processing purposes, retention, data locations, processor agreements, and applicable Russian/international transfer requirements.
7. Do not connect applicant forms, document uploads, donor forms, or real beneficiary data during this gate.

**Pass evidence:** approved document register, legal sign-off, end-to-end staging evidence, and a separately approved activation decision.

### Gate E — backend deployment and recovery operations

1. Select and document the backend host, database host, private file volume, TLS termination, network boundaries, and operational owners.
2. Store secrets only in the hosting secret manager: database runtime URL, login/recovery HMAC keys, Resend API key, verified sender, recovery URL, and any valuation-provider key.
3. Verify `ALLOWED_ORIGIN` exactly matches the public workspace origin; review same-site cookie and reverse-proxy behavior.
4. Confirm the password-reset page exists and calls the correct completion endpoint before configuring `RECOVERY_URL`.
5. Test Resend delivery, generic responses for known/unknown email, token expiry, single-use behavior, replay rejection, throttling, session revocation, and redacted logs.
6. Verify private PDF volume permissions, backup/restore, monitoring, alerting, incident response, and rollback.
7. Deploy only to isolated staging first; production requires a separate explicit release approval.

**Pass evidence:** deployed staging API health/readiness, successful controlled end-to-end tests, tested restore, and independent operational sign-off.

## 4. Public platform UX — parallel, no sensitive intake

While backend acceptance proceeds, continue the public interface audit without enabling real data collection:

- Review the live website after the confirmed Pages deployment; distinguish source inspection from actual browser rendering.
- Audit navigation, page links, menus, workspace cards, applicant/partner prototypes, mobile and desktop breakpoints.
- Verify keyboard operation, focus visibility, contrast, semantic headings/labels, zoom/reflow, and reduced-motion behavior.
- Preserve the Foundation tree emblem, «УСЕРДИЕ» identity, and green/gold design system.
- Remove broken links, dead actions, visual artifacts, and misleading operational claims.
- Keep all prototype forms clearly marked as demonstrations and prevent entry of real personal data.

## 5. Immediate next work items

1. Obtain authoritative post-merge workflow run IDs and conclusions for `c0c6398...`; record any later reruns separately.
2. Re-run the complete backend/PostgreSQL suite on the current candidate and retain machine-readable evidence.
3. Complete staging database provisioning and runtime-role evidence; no production migration or blanket GRANT/REVOKE operation.
4. Perform the synthetic-data analytical-document acceptance matrix.
5. Continue the public-site UI audit independently of backend deployment.
6. Update this checkpoint with exact commits, workflow URLs, environment evidence, test counts, failures, and remaining blockers.

## 6. Non-negotiable controls

- Do not modify `main` directly; work in a dedicated branch and use reviewed pull requests.
- Do not force-push or rewrite project history.
- Do not apply migrations to production or enable consent intake without explicit approval.
- Do not enter real beneficiary, donor, employee, or partner data into prototypes or unaccepted staging.
- Do not claim the backend is deployed because GitHub Pages is deployed.
- Do not claim database roles, migrations, private PDF storage, email recovery, or legal compliance are operational without target-environment evidence.
- Keep USERDIE Digital, the Foundation, the Asset Valuation Center, the Analytical Center, BFU, and ZHAKIN Points within their approved organizational and data boundaries.
