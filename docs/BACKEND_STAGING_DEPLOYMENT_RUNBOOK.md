# Backend staging deployment runbook

**Status:** preparation document only. No hosting provider, database instance, secret, DNS record, deployment or production service is created by this runbook.

**Baseline reviewed:** `main` after the 2026-11-12 containerization changes. Re-check the deployed commit before provisioning.

## 1. Deployment boundary

- Keep the public website on its existing GitHub Pages workflow.
- Deploy the Node.js API as a separate service from the `backend/` directory.
- Use a dedicated non-production PostgreSQL database and isolated credentials.
- Do not point the public website or any live user traffic at staging.
- Do not use real beneficiary, donor, employee or partner data in staging.
- Do not change the domain's DNS or mail records as part of backend staging.

A production-oriented `backend/Dockerfile` now builds a minimal Node.js 22 image, installs production dependencies only, copies runtime source and migrations, runs as the unprivileged `node` user, and exposes a liveness health check. `.dockerignore` excludes local environment files, dependencies, tests and Git metadata. Backend CI builds this image but does not publish it to a registry or deploy it. No Compose stack, hosting manifest, registry, cloud resource or backend deployment workflow is configured.

## 2. Runtime requirements verified in source

- Node.js 22 or newer.
- Install production dependency `pg` from `backend/package.json`.
- Start command: `npm start` (runs `node src/index.mjs`).
- HTTP port: `PORT` (default 8080); process binds to `0.0.0.0`.
- Liveness: `GET /api/v1/health/live`.
- Database readiness: `GET /api/v1/health/ready`.
- Graceful shutdown handles SIGTERM and SIGINT.
- Database migrations use the explicit CLI `npm run migrate`; API startup never applies schema changes.

## 3. Required staging configuration

Set values through the hosting provider's protected environment/secret facility. Never commit actual values.

| Variable | Requirement |
|---|---|
| `PORT` | Provider-assigned port, or 8080 if supported |
| `DATABASE_URL` | Dedicated staging PostgreSQL connection URL |
| `DB_POOL_MAX` | Start conservatively; default is 10 |
| `DATABASE_SSL` | `true` when required by the database provider; source enforces certificate validation |
| `ALLOWED_ORIGIN` | Exact browser origin, including scheme and host; no path, wildcard or trailing slash |
| `LOGIN_RATE_LIMIT_HMAC_KEY` | At least 32 bytes; required to instantiate the login/authentication service |
| `RECOVERY_RATE_LIMIT_HMAC_KEY` | At least 32 bytes for recovery throttling; recovery remains unavailable until a delivery-backed recovery service is injected |

The sample `backend/.env.example` is not a production configuration. Confirm the canonical public origin before copying it. Do not trust forwarded client-IP headers unless a separately reviewed trusted-proxy boundary is implemented.

## 4. Database preparation

1. Provision a new, empty, isolated staging database. Do not point the runner at a database that has already received migrations manually.
2. Create two distinct credentials: a schema-owner/migration role for controlled DDL, and a non-owner API runtime role with only the required DML, sequence and function privileges. Do not use the migration owner as the API `DATABASE_URL`.
3. Review migrations `001`–`014` and their dependencies before execution.
4. From a protected operator environment, set `MIGRATIONS_DATABASE_URL` to the migration-owner connection and run `MIGRATIONS_ALLOW_APPLY=true npm run migrate`. Set `MIGRATIONS_DATABASE_SSL=true` when verified TLS is required. Never commit either credential.
5. The runner takes a PostgreSQL advisory lock, validates sequential filenames, stores SHA-256 checksums in `public.schema_migrations`, and commits each migration together with its ledger row. A checksum mismatch or SQL error stops the process; failed migration SQL is rolled back.
6. Verify all 14 versions are recorded, then configure the separate API runtime `DATABASE_URL` and test readiness using the runtime role.
7. Run the PostgreSQL integration tests against a disposable staging/test schema.
8. Confirm the application role cannot alter database ownership or bypass append-only audit protections.
9. Create only synthetic test accounts and records.

Do not run migrations against production as part of this staging procedure. A production migration requires a separately verified backup and restore procedure.

## 5. Deployment acceptance checks

- [ ] Build/install from the repository's current `main` revision.
- [ ] `docker build --pull -f backend/Dockerfile -t userdie-digital-api:staging backend` succeeds; verify the image runs as the non-root `node` user.
- [ ] `npm run check` passes.
- [ ] `npm test` passes against an isolated PostgreSQL test database.
- [ ] Backend CI builds the image and passes its container smoke test: non-root runtime, liveness success, and database readiness returning 503 when the database is deliberately unavailable.
- [ ] Service starts without logging connection strings, credentials or tokens.
- [ ] `/api/v1/health/live` returns success.
- [ ] `/api/v1/health/ready` returns success only when the database is reachable.
- [ ] Invalid/missing configuration prevents startup rather than silently weakening security.
- [ ] Exact-origin checks reject absent, null and foreign Origin on state-changing requests.
- [ ] Login remains unavailable unless the login HMAC key and required database migrations are configured.
- [ ] Recovery endpoints remain fail-closed until a recovery service and trusted delivery adapter are implemented and injected.
- [ ] No staging URL is published in the public website and no live DNS is changed.
- [ ] Deployment logs, runtime owner, rollback procedure and data-reset procedure are documented.

Passing these checks in a local CI environment is not evidence that a hosted staging deployment exists. Record the host URL, deployed commit, test date and operator only after a real deployment has been completed and verified.

## 6. Known limitations before user-interface integration

- The public workspace prototype uses browser-local demonstration data and identifiers; it is not connected to the API.
- The task-status PATCH endpoint is implemented and CI-tested, but there is no production API host confirmed.
- Application collection and write/intake workflows remain disabled.
- Task creation, assignment changes and other task-field writes are not implemented.
- Account recovery has route handlers and throttling hooks, but the runtime entry point does not inject a recovery service or trusted email adapter.
- MFA persistence is schema groundwork, not an enforced second factor.
- Private document storage, malware scanning, notifications, monitoring, backups and restore drills are not confirmed as deployed.

Do not connect the UI until the API host, TLS, exact origin, authentication lifecycle, server-side authorization, privacy review and end-to-end tests are accepted.

## 7. Decision required before provisioning

Choose a hosting region/provider and an acceptable monthly staging budget. Compare data-location terms, PostgreSQL backup/restore, TLS, secrets management, exportability and access controls before creating resources. No paid resource should be provisioned without explicit approval.


## Migration runner controls — 2026-11-12

- The explicit CLI is `backend/src/db/migrate.mjs`; transaction, checksum, ordering and advisory-lock logic is in `backend/src/db/migrations.mjs`.
- The command requires both `MIGRATIONS_ALLOW_APPLY=true` and `MIGRATIONS_DATABASE_URL`. It is not called from API startup or the Docker image command.
- Use the migration-owner credential only for the CLI. Use a separate non-owner credential for the API process.
- Initial supported target is a new empty staging database. Existing databases with manually applied migrations require a reviewed baseline/reconciliation plan; do not run this CLI against them.
- Unit tests validate migration wrapper parsing and all 14 filenames. PostgreSQL CI integration remains separate; no staging database has been provisioned or migrated.
