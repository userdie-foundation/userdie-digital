# Engineering checkpoint — 3 November 2026 (PostgreSQL integration)

## Repository and branch

- Repository: `userdie-foundation/userdie-digital`
- Branch: `main`
- Scope: backend workflow schema and CI verification.
- No public website files were changed.

## Work completed

1. Added `backend/test/postgres-migrations.integration.test.mjs`.
   - Applies migrations 001–005 in order to an isolated, uniquely named PostgreSQL schema.
   - Seeds synthetic users, programs, and applications only.
   - Verifies application status-history creation and workflow case-event creation.
   - Verifies task creation, assignment/status/SLA escalation/update events.
   - Verifies composite application/program and task/application foreign-key boundaries.
   - Verifies task completion constraints and append-only UPDATE/DELETE protection.
   - Skips locally when `PG_INTEGRATION_URL` is not configured; the CI job supplies it.
2. Updated `.github/workflows/backend-checks.yml`.
   - Adds a PostgreSQL 16 service container with readiness health check.
   - Supplies `PG_INTEGRATION_URL` to the Node test suite.
   - Existing Node 22 syntax checks and test command remain in place.

## Commits

- `7f33832bf500ad40b8c10820ad39a90e96bbdad9` — add PostgreSQL integration coverage.
- `a5bf600cb6501558629fd90e6055f7ca49c22d3f` — add PostgreSQL 16 to backend CI.
- `d74068f24f2e475d642e8f1834fe91bc3571c16a` — strengthen the test to use a second real application for composite parent-link validation.

## Verification status and limits

- Both changed files were fetched again from GitHub `main`; their contents and blob SHAs were confirmed.
- The latest commit is visible in the repository commit search.
- The GitHub connector's combined commit status returned an empty status list; its workflow-run lookup only returns pull-request-triggered runs and returned none. Therefore a successful GitHub Actions run is **not yet confirmed**.
- PostgreSQL integration tests have been committed and wired into CI, but they have **not** been independently executed in this session.
- No migration was applied to a live/staging database.
- No authentication/session resolver, task write API, scheduled SLA worker, notifications, or production backend deployment was added.
- No GitHub Pages deployment or public-site visual change was made; no screenshot is applicable to this backend-only work.

## Next engineering gates

1. Confirm the PostgreSQL 16 CI job is green and inspect its test output.
2. Fix any PostgreSQL-specific failures before adding more workflow behavior.
3. Add a reviewed transaction-scoped actor identity mechanism before enabling writes; never accept `app.actor_id` directly from client input.
4. Only then design task create/update endpoints with record-level authorization, audit logging, CSRF protection, and explicit human approval gates.
5. Keep production applications disabled until authentication, privacy controls, backups, and restore tests are verified.
