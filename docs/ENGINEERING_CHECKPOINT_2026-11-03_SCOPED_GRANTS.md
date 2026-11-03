# Engineering checkpoint — 3 November 2026 (scoped authorization lifecycle)

## Repository
- Repository: `userdie-foundation/userdie-digital`
- Branch: `main`
- Scope: backend authorization and database audit integrity only.
- The static website in `website/` and GitHub Pages publication target were not changed.

## Completed in this continuation
1. Added `backend/migrations/007_scoped_role_grant_lifecycle.sql`.
   - Scoped grants can be revoked once; hard deletion is blocked.
   - Active-grant uniqueness is enforced while allowing a revoked grant to be reissued as a new record.
   - Grant creation and revocation produce append-only audit events.
   - Audit events reject UPDATE, DELETE, and TRUNCATE.
2. Updated `backend/src/security/principal.mjs` to exclude revoked scoped grants immediately when resolving a session principal.
3. Corrected stale implementation comments in `backend/src/server.mjs` and `backend/src/security/authorization.mjs`.
4. Extended the PostgreSQL integration test to apply migrations 001–007 and verify grant creation, duplicate-active rejection, revocation, resolver exclusion, hard-delete prevention, and immutable audit history.
5. Extended the principal unit test to assert that revoked grants are filtered by the resolver query.
6. Updated `backend/README.md` with migration order and current security boundaries.

## Relevant commits
- Migration 007: `b7192f7a090378a3d8641a470bcb61dd724329cc`
- Hardened migration 007: `15f1f45c5da75b757e0acd94293b7dee3bf917ac`
- Principal resolver: `32fe4d837b62bbc630f263014c1e1e04bbfba555`
- Server documentation correction: `32386ce8fb47e1ad234d9efab18402d56065641e`
- Authorization documentation correction: `ed95a890490a624dd28b8da1259ec41f1af13996`
- PostgreSQL integration coverage: `bb37497d714b14aa1e8198a097dcaf8eaa9032dc`
- Principal unit test: `995defd2f4273629b6c8cbcf590a5c8caecb4018`
- README: `fe8e8d2b357a96fdcd8886c31808a60af811e9b3`

## Verification status — do not overstate
- GitHub fetch confirmed the changed files are present on `main`.
- The commit-status endpoint returned no status records for the sampled commits. A green CI run is therefore **not confirmed**.
- PostgreSQL integration tests have been authored but were not executed in this session.
- Migration 007 has **not** been applied to any staging or production database.
- No login/session issuance, MFA, account recovery, role-grant management API, or grant-revocation UI has been deployed.
- No website UI was changed in this backend-only stage; therefore there is no honest new public-site screenshot to show. No screenshot has been fabricated.

## Next controlled stage
- Obtain a confirmed CI run for migrations 001–007 and the backend test suite.
- Review the full migration against the target PostgreSQL version and backup/restore procedure before any database application.
- Then design an administrator-approved grant issuance/revocation service with actor identity, authorization, CSRF protection, validation, and audit read access. Do not expose direct grant mutation endpoints before those controls exist.
- Keep the website and domain/HTTPS work separate; do not alter DNS or mail records as part of backend authorization work.
