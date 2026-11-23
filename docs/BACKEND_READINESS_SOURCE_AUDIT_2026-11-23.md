# USERDIE Digital — Backend readiness source audit

**Date:** 2026-11-23  
**Scope:** read-only review of repository source, deployment documentation and GitHub Actions configuration.  
**Status:** source review only. No cloud provider, database, secrets, DNS, mail routing, deployment or production resource was created or changed.

## Executive result

The repository contains a usable starting point for a separately hosted Node.js 22 API: a production-oriented Dockerfile, an explicit PostgreSQL migration CLI, separate API/migration connection variables, liveness/readiness endpoints, and a PostgreSQL-backed CI test workflow.

This does **not** establish that Backend Staging exists or that the API is deployable without further operator configuration. No hosting manifest, Compose stack, registry publication, backend deployment workflow, managed database, runtime secret store, persistent volume, or live API endpoint was identified in the inspected source and runbook.

## Verified source facts

| Area | Evidence | Finding |
|---|---|---|
| Runtime | `backend/package.json`, `backend/src/index.mjs` | Node.js ESM API; `npm start` runs `src/index.mjs`; API pool uses `DATABASE_URL`. |
| Container | `backend/Dockerfile`, `backend/.dockerignore` | Node 22 slim image; production dependencies only; non-root `node` user; migrations copied; local secrets/tests excluded; liveness health check configured. |
| Build context | `.github/workflows/backend-checks.yml` and staging runbook | CI builds from `backend/` using `docker build --pull -f Dockerfile ... .`; runbook's root-relative command uses `-f backend/Dockerfile ... backend`. These contexts are consistent with the Dockerfile's relative COPY paths. |
| Database | `backend/src/db/migrate.mjs`, `backend/src/db/migrations.mjs` | Migration CLI requires `MIGRATIONS_ALLOW_APPLY=true` and separate `MIGRATIONS_DATABASE_URL`; applies sequential migrations with checksums and an advisory lock. |
| API startup | `backend/src/index.mjs` | API startup does not invoke the migration runner; schema changes are an explicit operator action. |
| TLS | `backend/src/config.mjs`, `backend/src/db/migrate.mjs` | TLS certificate validation is enabled when the respective SSL flag is true; both flags default to false and must be deliberately configured for a remote database. |
| Privacy | `backend/src/config.mjs` | `PRIVACY_CONSENT_LEDGER_ENABLED` defaults to false. Keep it disabled until legal and operational gates are approved. |
| CI | `.github/workflows/backend-checks.yml` | Backend workflow provisions an ephemeral PostgreSQL 16 service, runs syntax and integration tests, builds the image and smoke-tests non-root execution, liveness and fail-closed readiness. It does not publish or deploy the image. |

## Documentation defect corrected in this branch

The backend README contained an outdated statement that the public recovery/reset page did not exist. The same README and the staging runbook identify `website/recovery.html` and `website/reset-password.html` as present. The correct limitation is that these pages keep the API origin blank and remain unavailable until an HTTPS API origin, runtime secrets, verified sender and end-to-end reset test are in place.

## Pull request #47 check interpretation

PR #47 changes only the staging-decision document. Its observed Public repository security check and USERDIE security guard runs completed with `success`. The Backend checks workflow is path-filtered to `backend/**` and its own workflow file, so a docs-only PR is not expected to start the PostgreSQL/container workflow. Do not interpret the two security checks as backend integration-test evidence.

## Outstanding gates — NOT VERIFIED

1. Provider, region and monthly budget selection.
2. Isolated staging project/network and managed PostgreSQL provisioning.
3. Separate migration-owner, API runtime and inspection identities, including effective grants and role membership.
4. Actual database TLS, certificate validation and private network path.
5. Controlled application of migrations 001–021 to a new empty staging database.
6. Private persistent storage for issued PDF artifacts and verified backup/restore.
7. Protected runtime secrets, exact Origin, API host and TLS certificate.
8. Synthetic-data acceptance tests against the hosted staging service and independent review of the read-only evidence pack.
9. Operational monitoring, log redaction, rollback and incident procedures.

## Next safe sequence

- Correct documentation drift without changing runtime behavior.
- Continue static review of the backend security, migration and CI contracts.
- Keep PR #47 open until its document is reviewed; do not merge it automatically.
- Defer provider selection and all paid provisioning until the Foundation decides.
- Do not connect the public workspace, enable consent capture, or use real beneficiary/donor data before the applicable gates pass.

**Non-actions:** no database connection or SQL execution; no migration run; no secrets accessed; no roles or grants changed; no Docker image published; no backend deployed; no Production, DNS or MX changes.
