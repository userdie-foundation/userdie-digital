# Engineering checkpoint — 3 November 2026 (session principal and scoped grants)

## Repository

- Repository: `userdie-foundation/userdie-digital`
- Branch: `main`
- Work area: backend authentication boundary and authorization principal loading.
- No public website files were changed.

## Implemented in source

1. Added `backend/src/security/principal.mjs`.
   - Reads exactly one valid `__Host-userdie_session` cookie.
   - Hashes the opaque token and queries the server-side session table; raw bearer tokens are not sent to SQL or stored.
   - Rejects absent, revoked, expired sessions and inactive accounts.
   - Loads global roles from `user_roles` and resource-scoped grants from `user_role_grants`.
   - Deduplicates grants and returns a trusted principal object.
   - Does not trust request headers, query parameters, or body fields for identity, role, or scope.
2. Added migration `backend/migrations/006_scoped_role_grants.sql`.
   - Adds explicit program, organization, and contour scopes.
   - Existing `user_roles` remain global role grants.
3. Wired `createPrincipalResolver({ pool })` into the production API entry point `backend/src/index.mjs`.
4. Added unit tests for malformed/duplicate cookies, token hashing, global and scoped grant loading, and fail-closed behavior.
5. Extended the PostgreSQL integration test to apply migration 006, create a synthetic session and scoped grant, and exercise the actual resolver through the active PostgreSQL client.
6. Updated backend syntax checks and README.

## Relevant commits

- `38ed98c9585f56314073679aaf6cc07d117cf008` — scoped role grants migration.
- `f2207459ec1463635eccd93d637ed7a08c7c9b10` — session principal resolver.
- `b061c3a33de1cad3aa8590476c35133f60cd3aa0` — production API wiring.
- `5e3a53df6539c7af02551e811f36ca2f9cf7c7b8` — resolver unit tests.
- `7dd363fed96947b1a4411a7365c24c1bed72139a` — PostgreSQL integration of session resolution.
- `5241754d38a5b8e317d939d6a646b978f10e587b` — avoid pool starvation in the single-connection integration fixture.

## Verification and limits

- Changed source, tests, migration, workflow, and README were fetched again from GitHub `main`; blob SHAs and expected wiring were checked.
- Latest commit search confirms the changes are present on `main`.
- GitHub combined commit status is empty and the available workflow-run lookup returned no runs. A green CI result is **not confirmed**.
- PostgreSQL tests are committed and configured for the PostgreSQL 16 CI service, but were not independently executed in this session.
- Migration 006 has not been applied to staging or production. It must be applied through a reviewed migration process before deploying the new resolver, because the resolver reads `user_role_grants`.
- No login, password verification, session issuance, session rotation/revocation endpoint, MFA, recovery, or CSRF-protected write flow was added. The resolver validates sessions that already exist; it does not create them.
- No write endpoints or task dispatcher/SLA worker were added. No live backend or GitHub Pages deployment was performed.

## Security gates before real use

1. Implement a reviewed login and session lifecycle, with password hashing, rate limits, session rotation/revocation, MFA policy, and recovery controls.
2. Add audited grant administration and revocation; do not treat direct database edits as an operational role-management workflow.
3. Add transaction-scoped actor identity for database audit triggers only after identity is established by the trusted server layer; never accept `app.actor_id` from client input.
4. Add CSRF controls and record-level authorization for any future state-changing route.
5. Apply migrations only after backup/restore verification and confirm PostgreSQL 16 CI is green.
6. Keep real beneficiary and donor data out of test fixtures and static pages until privacy, retention, access, and incident controls are verified.
