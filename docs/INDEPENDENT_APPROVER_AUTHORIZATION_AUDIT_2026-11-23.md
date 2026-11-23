# Independent approver authorization boundary audit — 2026-11-23

**Status:** source-level finding corrected in a dedicated pull request; CI verification pending. This is not a production security approval.

## Scope

Reviewed the analytical-document review flow in:

- `backend/src/analytical-documents.mjs`
- `backend/migrations/016_analytical_document_registry.sql`
- `backend/migrations/017_analytical_document_lifecycle_guard.sql`
- `backend/migrations/019_analytical_document_lifecycle_immutability.sql`
- `backend/test/postgres-migrations.integration.test.mjs`

The review covered reviewer eligibility, assignment, submission, decision authorization, version binding, and audit/event persistence.

## Finding: administrator privilege was treated as an independent-approval grant

The `canReview` authorization helper previously accepted either:

- a global `administrator` grant; or
- an explicit `independent_approver` grant for the global or assets contour.

This was broader than the documented separation-of-duties model. A user assigned as an independent reviewer could retain decision authority through the administrator role even after the independent-approver grant had been revoked. The decision route correctly restricts the decision to the reviewer ID recorded on the pending approval and rejects self-approval; the defect was the administrator fallback in the role check, not unrestricted approval access.

## Correction

The helper now requires an explicit `independent_approver` grant. Administrator access alone is not sufficient to decide an analytical document approval.

A PostgreSQL-backed HTTP integration regression test now:

1. Creates a synthetic user with both global administrator and independent-approver roles.
2. Assigns that user as the reviewer of a synthetic document and submits the document.
3. Removes the independent-approver role while leaving the administrator role.
4. Attempts the decision using an administrator-only trusted principal.
5. Requires HTTP 403.

The existing positive path for a reviewer with an explicit independent-approver grant remains covered by the analytical-document lifecycle integration scenario.

## Controls confirmed at source level

- Reviewer assignment excludes the document author and requires an active account with an independent-approver role.
- Submission creates an approval row bound to the exact immutable document version.
- The decision query is limited to the assigned reviewer and a pending approval.
- The database lifecycle guard verifies author/reviewer separation and exact approved-version matching.
- Approval decisions become immutable after the pending decision is made.
- Analytical-document events, approval events, and general audit events have append-only DML guards.

## Remaining acceptance gaps

1. **Global role lifecycle:** global roles in `user_roles` do not yet have the same one-way, append-only revocation lifecycle as scoped grants in `user_role_grants`. There is no public role-management API; global-role changes remain an operator-controlled procedure. A separately reviewed migration and two-person administrative workflow are still required before operational role administration.
2. **Database ownership boundary:** append-only triggers block ordinary UPDATE/DELETE/TRUNCATE operations but do not protect against table/schema owners, superusers, or principals able to alter DDL or disable triggers. The runtime-role acceptance audit remains NOT VERIFIED until effective privileges are measured in an isolated target database.
3. **External audit durability:** repository triggers provide database-level mutation resistance for ordinary DML; they are not a cryptographic hash chain or an independently administered immutable/WORM archive. External retention and independent audit export remain deployment controls.
4. **Environment evidence:** no live staging database or production environment was inspected. No database roles, grants, trigger states, backups, or external log retention were verified.

## Safety boundary

No schema migration, database connection, cloud provisioning, secret change, DNS/MX change, or production deployment was performed. All regression fixtures use synthetic data. The code change is subject to GitHub Actions and independent review; it is not considered accepted until the checks complete successfully.
