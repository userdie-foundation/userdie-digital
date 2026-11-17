# PostgreSQL document registry — implementation boundary

Date: 2026-11-17  
Status: schema proposal committed to a review branch; not merged or deployed.

## Scope of migration 015

Migration `015_workspace_document_registry.sql` creates a general metadata registry independent of the existing application-upload table and partnership-evidence table.

It contains:
- `workspace_documents`: registration number, title, type, organizational contour, lifecycle status, source kind, owner, next review date and summary;
- `workspace_document_versions`: immutable version register, optional SHA-256 digest and source reference; it stores no file bytes or storage key;
- explicit link tables for programs, applications, application tasks and partnerships, each with real foreign keys;
- `workspace_document_events`: append-only domain event history.

The three organizational contours are constrained to `foundation`, `asset_valuation` and `analytics`.

## Security and integrity boundaries

- A document-to-object relation is metadata only; it does not grant permission to read the linked object or document.
- No polymorphic `object_type/object_id` link is used. Each supported relationship has a foreign key.
- Version rows and event rows reject UPDATE, DELETE and TRUNCATE.
- Document state changes, domain events and general `audit_events` must be written in one transaction by a future API.
- The schema does not introduce routes, permissions, upload endpoints, file storage, public links or signed URLs.
- Existing `documents` remains scoped to application uploads; `partnership_evidence` remains scoped to partnership evidence. Neither is repurposed.

## Deliberately deferred

1. Record-level read policy and scoped grants for all three contours.
2. Server API, pagination, filtering, metadata writes, optimistic concurrency and 401/403/404/409 behavior.
3. Transactional audit integration and independent approval rules for sensitive transitions.
4. File-storage provider/region decision, encryption, malware scanning, retention, backup and restore tests.
5. Production migration execution and UI integration.

## Validation required before merge

- Apply all migrations 001–015 to an empty PostgreSQL database.
- Verify all four link-table foreign keys and uniqueness constraints.
- Verify version/event mutation guards for UPDATE, DELETE and TRUNCATE.
- Run the complete backend test suite and security workflows.
- Review the schema against the deployed database migration ledger before production execution.

No production database was changed by this commit.
