# Workspace task authorization — atomicity hardening

**Date:** 2026-11-23  
**Scope:** source-level review and regression coverage for the existing task-status PATCH endpoint.  
**Change type:** narrowly scoped backend security fix; no schema migration.

## Finding

Before this change, the route loaded a task, authorized the principal against the task's current assignee/program, and then called the repository to update the task. The repository's final SQL statement compared only the task ID and previously read status.

That left a time-of-check/time-of-use window: if the task were reassigned after the route's authorization lookup but before the status UPDATE, the former assignee could still complete the write as long as the status had not changed.

The window requires a concurrent reassignment, but authorization should be evaluated at the write boundary rather than relying on a stale read.

## Change

The repository's final UPDATE now includes both conditions in the same SQL statement:

- compare-and-set on the previously observed task status;
- either the task is still assigned to the authenticated global case worker, or its program remains within the authenticated program-manager scopes.

The route passes the already-resolved trusted principal to the repository. The repository derives permitted scope identifiers from that server-side principal; no client-supplied roles or scopes are accepted. A stale or unauthorized update affects zero rows and returns the existing not-found behavior.

The transaction and `app.actor_id` workflow-event context are preserved. No database schema or migration changed.

## Regression coverage

- Updated HTTP route test to assert that the trusted principal is passed to the repository.
- Extended the PostgreSQL integration test: after a task is reassigned, the former assignee's attempted status update must affect zero rows and leave the status unchanged; the new assignee can then make the allowed transition, and the event records the new assignee as actor.
- Updated backend documentation to describe the atomic authorization predicate.

## Verification status

The code and regression test changes are committed to a dedicated branch and will be submitted in a Draft PR. The PostgreSQL integration test and Backend CI are **pending GitHub Actions execution** at the time this document is authored. Do not report them as passed until the workflow completes successfully.

## Safety boundary

No staging or production database was connected. No migration was applied. No secrets, DNS/MX, cloud resources, or production deployment were touched.
