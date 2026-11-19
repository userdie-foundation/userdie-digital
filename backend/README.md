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
- The account-recovery service core validates and normalizes email, returns a generic request result, rotates outstanding recovery tokens, sends the raw token only to a caller-supplied delivery adapter, and on successful reset revokes active sessions and writes an audit event. A Resend delivery adapter is now implemented and runtime wiring is present. Delivery remains fail-closed until `RESEND_API_KEY`, a Resend-verified `RESEND_FROM_EMAIL`, `RECOVERY_URL` pointing to a real deployed password-reset page, and `RECOVERY_RATE_LIMIT_HMAC_KEY` are supplied through the backend secret manager.
- Migration 007 adds one-way scoped-grant revocation, active-only uniqueness, hard-delete protection, and append-only grant/revocation audit events. No public grant-management endpoint is exposed.
- Migrations 016–018 provide the analytical document registry, immutable SHA-256 versions, independent approval, lifecycle guards and a private PDF artifact registry. Authenticated API routes implement draft creation, versioning, independent review, issuance and PDF delivery for the exact issued version. The authorized reviewer directory exposes only active independent approvers by display name and internal selection ID; it does not expose email addresses. PDF files are written only to the configured private storage directory; production storage, hosting and production migration execution remain unconfigured.
- The Asset Valuation Center prototype now contains a feature-gated API adapter. It remains in demo-only mode while the `userdie-api-origin` meta value is empty. When an approved HTTPS API origin is supplied, the workspace supports session login/logout, reviewer discovery, server-side draft creation, document lifecycle actions and authorized PDF retrieval. No credentials or draft content are written to browser storage. Cross-origin credentialed CORS is limited to the configured exact origin and explicit login/logout/document POST routes.
- Automated HTTP tests cover health checks, error handling, and the fail-closed application endpoint. PostgreSQL integration coverage exercises migrations 001–018, synthetic session resolution, scoped-grant creation and revocation, immediate permission removal, hard-delete prevention, append-only audit histories, recovery-token storage, account/network login-throttling behavior, and partnership confirmation/evidence constraints.

## Valuation workspace API connection

The public prototype intentionally ships with an empty `<meta name="userdie-api-origin" content="">` value. Keep it empty until the backend host, TLS, database, exact `ALLOWED_ORIGIN`, login rate-limit secret, migrations 001–018, and private PDF volume are approved and verified. The origin must be an HTTPS origin without a path and must exactly match the static workspace origin configured in the backend. Credentialed CORS supports only the explicit login/logout and analytical-document POST routes; browser cookies remain `HttpOnly` and are never read by client JavaScript. Because the session cookie is `SameSite=Lax`, the API should be hosted on the same site (for example, an API subdomain of the platform domain) or exposed through a same-site reverse proxy; a cross-site API hostname will require a separately reviewed cookie deployment design. Do not add passwords, tokens, beneficiary data, or donor data to frontend configuration.

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
- `GET /api/v1/analytical-documents/reviewers` — authorized valuation users receive active independent approvers for the assets contour (display name plus selection ID only).
- `GET|HEAD /api/v1/analytical-documents?limit=25` — authorized document registry list.
- `POST /api/v1/analytical-documents` — create a draft and bind it to an independent reviewer.
- `POST /api/v1/analytical-documents/:id/submit`, `/decision`, `/issue` — protected lifecycle transitions with independent approval.
- `GET|HEAD /api/v1/analytical-documents/:id/pdf` — authorized PDF for the exact issued immutable version; requires configured private storage.
- `GET /api/v1/applications/:id` — read-only detail route; requires a valid server-side session and record-level authorization.
- `GET /api/v1/applications` — returns `503 applications_module_unavailable`; collection access remains disabled.
- `GET /api/v1/programs?limit=25` — read-only program directory (limit 1–50); applicants and partners see open programs, program managers see exact granted scopes, and administrators/auditors/case workers see the governed portfolio.
- `GET /api/v1/partnerships?limit=25` — read-only partnership directory (limit 1–50); administrators and auditors can review the directory, case workers see only records assigned to them, and partner accounts require an exact organization-scoped grant.
- `GET /api/v1/partnerships/:id` — read-only partnership detail with the same record-level authorization; missing and unauthorized records both return 404.
- `GET /api/v1/partnerships/:id/evidence` — internal read-only evidence metadata for administrators, auditors, and the assigned case worker only. The response excludes storage keys and file bytes; partner grants do not grant evidence access. File download, upload, write operations, confirmation, and public partner publication remain unavailable.
- `GET /api/v1/programs/:id` — read-only program dossier and milestone timeline; requires a valid server-side session and `programs:read` authorization.
- `GET /api/v1/applications/:id/workflow` — internal read-only task, SLA and event timeline; visible only to the assigned case worker or exact-scope program manager with a valid server-side session.
- `PATCH /api/v1/workspace/tasks/:id/status` — allowlisted task-status transition; requires a valid session, trusted scoped permission, exact Origin, and a valid transition. The route is implemented and CI-tested but is not connected to the public static-site UI or a confirmed production API deployment.

Account-recovery HTTP request/reset routes are wired to the Resend adapter when the complete runtime configuration is present. They remain unavailable until the Resend sender is verified, the API key and rate-limit key are installed as runtime secrets, and `RECOVERY_URL` targets a deployed reset page that calls `POST /api/v1/auth/recovery/complete`. The current static website tree does not yet contain that reset page, and no backend deployment is confirmed. Do not enable live recovery until those conditions and an end-to-end delivery/reset test pass. MFA enrollment, verification, recovery-code consumption, KMS integration, and enforcement are not implemented. Migration 012 is schema groundwork only; no normal session is gated on a second factor yet. All unknown routes return 404; non-GET/HEAD methods return 405 unless explicitly supported. The applications module deliberately fails closed: it does not read or write application records until identity, authorization, validation, and audit requirements are implemented and tested.

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

- A central exact-Origin guard now rejects every state-changing HTTP method (POST, PUT, PATCH, DELETE) when Origin is absent, null, or does not match the configured application origin; safe reads and OPTIONS preflight are excluded. Route-specific Origin checks remain on authentication endpoints. This is a CSRF control, not a substitute for production review of proxy/origin configuration, browser behavior, and future cross-origin requirements. Production activation is not confirmed. Recovery routes are wired to Resend in source but remain gated on a confirmed backend host, runtime secrets, exact-origin CORS configuration, verified sender identity, and end-to-end tests. MFA remains incomplete.
- Application and program write/lifecycle routes remain disabled. All future routes must use trusted database-loaded grants and per-record checks.
- Application CRUD, task creation/update, file upload/download, malware scanning, notifications, and reporting are not implemented.
- SLA overdue state is computed on read; no background scheduler, automatic escalation worker, or notification channel is deployed. Only the narrow task-status transition route is implemented; task creation, assignment changes, due-date edits, and other task-field writes remain unavailable.
- Secrets management, production hosting, TLS termination, migrations automation, monitoring, backups, and restore tests must be configured and verified separately.
- Review applicable personal-data, consent, retention, and incident-response requirements before collecting real beneficiary data.

Never put real applicant data, uploaded documents, database credentials, or access tokens in this repository or test fixtures.


## Runtime wiring clarification — 2026-11-09

- The entry point creates and injects the authentication service only when `LOGIN_RATE_LIMIT_HMAC_KEY` is configured. The login route then remains fail-closed if that service is absent.
- The entry point creates and injects the recovery rate limiter when `RECOVERY_RATE_LIMIT_HMAC_KEY` is configured. It creates and injects `recoveryService` only when the Resend API key, verified sender address, recovery-page URL, and dedicated rate-limit key are all present.
- The public recovery request and reset pages now exist in `website/recovery.html` and `website/reset-password.html`. Their `userdie-api-base` meta value is intentionally blank until a real HTTPS backend origin is confirmed; the pages remain fail-closed while blank.
- No backend hosting, staging database, deployment workflow or provider configuration is confirmed. See `docs/BACKEND_STAGING_DEPLOYMENT_RUNBOOK.md` before any provisioning.


## Container image

A minimal production image is defined in `Dockerfile`:

```sh
docker build --pull -f Dockerfile -t userdie-digital-api:local .
```

The image uses Node.js 22, installs production dependencies only, excludes tests and local secrets, runs as the unprivileged `node` user, and provides a process-liveness health check at `/api/v1/health/live`.

Run it only with an explicitly configured, isolated non-production PostgreSQL database and secrets supplied through the runtime environment. The container does not run schema migrations automatically. Do not mount a developer's `.env` file into a shared or production runtime, and do not publish the image or expose a public endpoint until the staging runbook acceptance checks are complete.

The GitHub Actions backend workflow builds the image as a CI check. It does not push to a registry or deploy a hosted service.


## Resend recovery delivery configuration

The backend includes a Resend adapter using the HTTPS API endpoint `https://api.resend.com/emails`. It sends a plain-text, single-use recovery link and does not log or return the raw token or provider response details.

Configure these values only in the backend hosting provider's protected runtime secret/configuration store; never commit them to Git:

- `RESEND_API_KEY` — Resend API key.
- `RESEND_FROM_EMAIL` — sender identity verified in the Resend account, for example `USERDIE Digital <security@your-verified-domain>`.
- `RECOVERY_URL` — HTTPS URL of the deployed password-reset page. The page must read the `token` query parameter and submit the new password to `POST /api/v1/auth/recovery/complete`.
- `RECOVERY_RATE_LIMIT_HMAC_KEY` — dedicated random secret of at least 32 bytes for recovery throttling.

The three Resend settings must be supplied together. The recovery service is instantiated only when the Resend settings and dedicated recovery rate-limit key are both present. The reset page is present at `https://xn--d1abbl2ben.online/reset-password.html`. Set this exact value as `RECOVERY_URL` only in the confirmed backend runtime secret store. The API origin is not yet confirmed, so `website/reset-password.html` and `website/recovery.html` intentionally keep `userdie-api-base` blank; update that meta value to the real HTTPS API origin before enabling the forms.

No DNS or MX changes are part of this code integration. Resend sender-domain verification must be checked in the existing Resend account separately; do not alter existing mail-routing records without an explicit review.


## Public recovery pages and cross-origin API

- Request page: `website/recovery.html`.
- Password reset page: `website/reset-password.html`; the Resend link uses the `token` query parameter.
- Shared browser logic and styles: `website/auth-recovery.js` and `website/auth-recovery.css`.
- Both pages are marked `noindex,nofollow`, use a no-referrer policy, do not persist passwords/tokens in browser storage, and remove the one-time token from the address bar as soon as the reset page loads.
- The browser API origin is configured through `<meta name="userdie-api-base" content="https://YOUR-CONFIRMED-API-ORIGIN">`. Replace the blank value only after the backend host and HTTPS certificate are confirmed. The value must be an HTTPS origin without a path, query, or fragment.
- Backend `ALLOWED_ORIGIN` must exactly equal `https://xn--d1abbl2ben.online`. The API now answers CORS preflight only for the two recovery endpoints, that exact origin, JSON `POST`, and the `Content-Type` header; other paths, origins, methods, and headers are rejected.
- If the API is placed behind the same public origin with a reverse proxy, configure the meta value as that exact HTTPS origin and route `/api/v1/` to the backend. If the API has a separate origin, use that confirmed origin and preserve the exact CORS allow-list.
- The recovery pages remain unavailable until the API origin is configured. A successful GitHub Pages deployment does not deploy the API.


## Analytical document registry API

The Asset Valuation Center now has source-level authenticated API operations backed by migrations 016–017:

- `GET /api/v1/analytical-documents?limit=25` — lists only records visible to the authenticated principal; global administrators, auditors and authorized asset valuators can review the governed registry.
- `POST /api/v1/analytical-documents` — creates a draft and its first immutable JSON content version. The caller must have the administrator or asset-valuator grant and must assign an active independent approver. The author cannot be assigned as reviewer.
- `GET /api/v1/analytical-documents/:id` — returns the document, bounded version history, approval decisions and append-only event timeline to its author, assigned reviewer or an authorized registry reader.
- `POST /api/v1/analytical-documents/:id/versions` — adds a new immutable JSON version while the document is a draft or has requested changes. The author alone may revise it.
- `POST /api/v1/analytical-documents/:id/submit` — submits the latest version to the previously assigned independent reviewer.
- `POST /api/v1/analytical-documents/:id/decision` — allows the assigned independent approver to approve the exact submitted version or request changes with a reason. Self-approval is prohibited.
- `POST /api/v1/analytical-documents/:id/issue` — issues only the exact approved version and assigns a registration number at issuance.
- `GET /api/v1/analytical-documents/:id/pdf` — generates or downloads the PDF for the exact issued version only; requires record-level authorization, private storage configuration and an integrity-checked artifact registry.

Every write runs in a PostgreSQL transaction and appends both a document lifecycle event and a global audit event; if audit persistence fails, the operation rolls back. Request bodies are bounded and strict, writes require the configured exact Origin, and role/scope claims are loaded only from the server-side session. Content is stored as immutable JSON snapshots with a server-computed SHA-256 digest. A protected `GET /api/v1/analytical-documents/:id/pdf` route now generates a Cyrillic-capable PDF only for an issued record and its exact immutable issued version. The generated PDF is stored outside the public web root in a private directory, registered with a SHA-256 digest and byte size, and checked for integrity on every download. Generation and download are appended to the global audit log. Configure `ANALYTICAL_DOCUMENT_STORAGE_DIR` as an absolute path on a persistent private volume; the route remains fail-closed with 503 until this storage path is configured. The container includes Noto Sans core fonts for Cyrillic output. The PDF endpoint is source-implemented and covered by the PostgreSQL HTTP integration test; no backend hosting, persistent production volume, production migration execution or public workspace persistence is implied. The static website is unchanged.

## Preliminary valuation AI endpoint

- `POST /api/v1/valuation/analyze` — protected, non-persistent preliminary analysis for a supplied asset summary. Requires a valid server-side session and either the global administrator role or the dedicated `asset_valuator` role (global or contour scope `assets`). Every successful analysis writes a minimal append-only audit event; if audit persistence fails, the result is not returned.
- The endpoint accepts only bounded asset metadata and an evidence summary; it does not accept uploaded documents or arbitrary extra fields. Do not send beneficiary, donor, account, identity, or other sensitive personal data to an external AI provider.
- Provider calls are disabled unless `VALUATION_AI_API_KEY` and `VALUATION_AI_MODEL` are configured together in the backend runtime secret manager. `VALUATION_AI_BASE_URL` is optional and must use HTTPS. The key is never sent to the browser or stored in this repository.
- Asset-class guidance is separated for financial, real-property, and intellectual assets; the `other` class first requires classification and does not force a standard method. These are preliminary method-selection prompts, not completed valuation methodologies.
- Provider output is schema-checked and bounded server-side, labelled as preliminary, and always requires human approval. Until a verified evidence registry and review workflow exist, the backend forcibly sets `valueConclusion.status` to `not_estimable` and `low`, `central`, and `high` to `null`, regardless of any numeric values returned by the model. The model is instructed not to invent sources, comparables, prices, or legal facts.
- Migration 015 seeds the `asset_valuator` role. Apply it only through the reviewed migration process on an isolated staging database; do not apply it to an unreviewed or production database.
- The route is source-implemented and CI-tested only after the current workflow completes. No backend host, provider secret, live provider call, or production deployment is implied by this source change.


## Privacy consent ledger (disabled by default)

Migration `021_privacy_consent_ledger.sql` creates a controlled registry of approved, versioned consent documents and an append-only event ledger. The service is intentionally fail-closed:

- `PRIVACY_CONSENT_LEDGER_ENABLED=false` is the default and blocks new grants. Read access and withdrawal remain available after the ledger has been deployed, so turning off new grants does not disable the withdrawal route. Enabling grants is not a legal approval and must not be done until the Foundation has approved the exact document versions, purpose codes, infrastructure and release checklist.
- No consent documents are seeded. A version must be inserted into `privacy_consent_documents` through a controlled, reviewed deployment process with the final document SHA-256, approval identity and publication timestamp. The registry protects the content fields from later mutation; a version can only be revoked.
- `GET /api/v1/privacy/consents` returns only the authenticated user's own events.
- `POST /api/v1/privacy/consents` records a grant only for a registered, non-revoked document version. The request accepts only `documentCode`, `documentVersion` and a bounded map of boolean choices. Subject identity is derived from the authenticated session, never from the request body.
- `POST /api/v1/privacy/consents/:documentCode/:documentVersion/withdraw` appends a withdrawal event linked to the active grant for that exact document version. Existing events are never updated or deleted.
- Each grant/withdrawal is written in a transaction with an audit event. The event ledger stores controlled choice flags only; it must not contain health details, case narratives, identity-document contents or arbitrary free text. The submitted choice keys must exactly match the approved document registry. Special-category consent is rejected by this authenticated-session endpoint until a separately reviewed written-consent capture mechanism is implemented.
- The routes inherit exact-Origin CSRF protection and narrow JSON preflight rules. No public/anonymous consent submission endpoint exists.

The ledger is not yet connected to applicant-facing checkboxes or public intake forms. It does not prove that an individual document satisfies applicable law, that an electronic signature is sufficient, that a legal representative has authority, or that any particular processing purpose is lawful. Do not enable the flag or collect real beneficiary data until counsel has approved each document, the document registry is populated, operational notices and contacts are confirmed, and the staging security review has passed.
