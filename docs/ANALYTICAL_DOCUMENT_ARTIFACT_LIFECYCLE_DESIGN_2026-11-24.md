# Analytical Document and PDF Artifact Lifecycle — Design Review

**Date:** 2026-11-24  
**Repository:** `userdie-foundation/userdie-digital`  
**Baseline:** `main` at `66f79c863de7d73c3053f039e09dade73c417ff7`  
**Status:** Architecture proposal; not an approved retention policy and not an implementation authorization.

## 1. Purpose and scope

This note defines the controls required before USERDIE Digital introduces archive operations, retention scheduling, regulated deletion, or automated reconciliation for analytical-document PDF artifacts.

It covers:
- analytical document lifecycle records;
- immutable document versions and approval/issuance provenance;
- private PDF binary storage;
- audit and operational evidence;
- recovery from partial writes, missing files, and orphan files.

It does **not** authorize production storage changes, deletion of existing files, a retention duration, a new permission role, or a change to beneficiary/donor data processing.

## 2. Verified baseline

The source and migrations currently establish the following:

1. The document lifecycle includes `draft`, `submitted_for_review`, `approved`, `changes_requested`, `issued`, and `archived` transitions. The database guard permits `issued → archived` and preserves issued/approved facts.
2. The HTTP API implements creation, versioning, submission, independent review, decision, issuance, document reading, and PDF retrieval. It does not currently expose an archive action.
3. PDF artifact metadata is stored in `analytical_document_artifacts`, bound to a specific document version, and protected by append-only database triggers. The metadata includes a UUID-based storage key, SHA-256 digest, byte size, media type, generator, and timestamp.
4. PDF bytes are stored separately in a private filesystem directory. The storage module checks the directory and file type, owner and POSIX permissions, rejects symlinks, validates canonical UUID keys, and verifies the digest and byte size on reads.
5. The PDF download route is GET-only. It authorizes the principal, requires the document to be `issued`, verifies the stored artifact, responds with `private, no-store`, and records a download audit event.
6. Artifact creation currently writes the file before committing its metadata row. Normal error paths attempt to remove a file when registration fails, but a process or host failure between those operations can leave an unregistered file.
7. There is no approved retention schedule, legal-hold model, archive API, regulated purge workflow, or periodic file-to-database reconciliation worker in the reviewed implementation.

Relevant implementation references:
- `backend/src/analytical-documents.mjs`
- `backend/src/analytical-document-pdf.mjs`
- `backend/migrations/016_analytical_document_registry.sql`
- `backend/migrations/017_analytical_document_lifecycle_guard.sql`
- `backend/migrations/018_analytical_document_pdf_artifacts.sql`
- `backend/migrations/019_analytical_document_lifecycle_immutability.sql`
- `backend/migrations/020_analytical_document_artifact_immutability.sql`
- `backend/migrations/022_analytical_document_pdf_storage_key_constraint.sql` (present on the active PDF hardening branch; not yet part of `main` at this baseline)

## 3. Non-negotiable invariants

Any future implementation must preserve these invariants:

- **No silent history rewrite.** Issued document facts, approved version references, artifact provenance, and audit records must not be overwritten to make a retention operation easier.
- **No path-based deletion API.** A caller must never supply an absolute or relative filesystem path. Operations resolve only a server-controlled storage key beneath the configured private directory.
- **No deletion by UI state.** Hiding a document, archiving it, or removing a UI card must not imply physical deletion.
- **No automatic deletion on archive.** Archive and purge are separate governed actions.
- **No retention assumptions in code.** A duration, start date, legal basis, or exception must come from an approved, versioned policy.
- **No implicit role escalation.** Existing administrator, auditor, asset-valuator, and reviewer grants must not be repurposed as a deletion permission without an explicit access-control decision.
- **No orphan auto-purge on first sight.** A file not yet linked to a database row may be the result of an in-flight write or recovery event. It must first be classified and quarantined under a documented process.
- **No silent regeneration.** If a registered artifact is missing or fails integrity verification, return an unavailable/error state and create an operational incident. Do not silently replace the immutable artifact with a newly rendered PDF.
- **No beneficiary/donor content in operational logs.** Reconciliation and purge logs should contain identifiers, storage keys, digests, sizes, timestamps, policy versions and error codes—not document bodies or personal data.

## 4. Separate the lifecycle into three records

The current schema correctly treats artifact provenance as append-only. Do not weaken the existing trigger on `analytical_document_artifacts` to support lifecycle bookkeeping.

The target model should distinguish:

### 4.1 Document lifecycle

The existing `analytical_documents.status` remains the business lifecycle:
- `issued`: approved version has been formally issued;
- `archived`: the issued record is closed to ordinary workflow changes but retained as a governed record.

Archive must preserve the document number, issued version, approval facts, issuance timestamp and historical events.

### 4.2 Immutable artifact provenance

The existing `analytical_document_artifacts` remains the immutable record of what was generated:
- exact document/version binding;
- storage key;
- content digest and byte size;
- media type;
- generator and generation timestamp.

Do not mutate or delete this row to represent a file deletion. A retained tombstone/provenance record is necessary to explain what existed and what happened to it.

### 4.3 Mutable operational state and work queue

Introduce a separate, append-audited operational model only after design approval. It should represent file-management state without changing the immutable artifact record. Candidate states (names are illustrative, not approved schema) are:

- `registered` — artifact is expected at its registered key;
- `verification_pending` — a reconciliation or integrity check is queued;
- `quarantined` — file is isolated pending investigation;
- `deletion_eligible` — a policy evaluation found no active hold and all prerequisites are satisfied;
- `deletion_pending` — an authorized deletion operation has been accepted;
- `deleted` — physical deletion was verified and recorded;
- `missing` — registry entry exists but the file is absent;
- `integrity_failed` — bytes do not match the registered digest/size.

The implementation should prefer a dedicated artifact-operations table plus an append-only operation/event ledger or an outbox-backed job table. The exact schema, state transitions, and retention of operational records require review before migration.

## 5. Archive semantics and authorization

The database already permits `issued → archived`; the API does not yet expose this transition.

Before adding an endpoint, governance and security owners must decide:

1. Which actor may request archive, which actor may approve it, and whether dual control is mandatory.
2. Whether archive is allowed only after a defined business event or may be initiated manually with a mandatory rationale.
3. Whether an archived PDF remains downloadable, by which roles/scopes, and whether archive access is separately audited.
4. Whether a legal hold or active dispute blocks archive, purge, or both.
5. Whether archive is reversible, and if so, which explicit transition and approval are required.

Implementation requirements once approved:
- derive identity and grants only from the trusted server-side session resolver;
- re-read and lock the document row inside a transaction;
- verify current status is `issued` and that the expected issued version is unchanged;
- require an explicit reason code and a bounded rationale;
- record actor, approver (if required), timestamp, policy/version reference, previous/new status, document ID and issued version;
- append document and security audit events in the same transaction;
- return an idempotent conflict/validation response for stale or repeated requests;
- preserve the immutable issued facts enforced by the database trigger.

No role code or authorization grant is prescribed in this design.

## 6. Retention policy: required decisions before implementation

A retention policy must be approved by the foundation's legal/privacy and records-governance owners. The engineering team must not choose a duration by convention.

The policy must define, at minimum:

| Policy dimension | Required decision |
|---|---|
| Record classes | Which analytical document types, contours, and artifact types are covered |
| Legal basis | Applicable contractual, statutory, regulatory, donor, and internal obligations |
| Retention period | Approved duration per record class; no default is assumed here |
| Retention start | Event that starts the clock (creation, issue, closure, contract end, or another approved event) |
| Hold conditions | Litigation, audit, investigation, complaint, grant conditions, or other holds |
| Hold authority | Who may place, review, release, and extend a hold |
| Deletion authority | Requester, independent approver, and separation-of-duties requirements |
| Exceptions | Records that must be retained longer or cannot be deleted |
| Derivatives | Treatment of exports, replicas, backups, cached copies and generated derivatives |
| Verification | Evidence required to confirm deletion and handle inaccessible backup copies |
| Policy changes | Versioning, effective dates, grandfathering and treatment of already-issued records |

A policy decision must be stored with a version identifier and effective date. Each eligibility decision and deletion operation must reference the exact policy version used.

## 7. Regulated deletion workflow

After policy and role approval, a deletion workflow should be implemented as a controlled job—not as a generic DELETE endpoint.

Recommended sequence:

1. **Eligibility evaluation:** evaluate record class, retention clock, active holds, open investigations, outstanding access requests, and applicable exceptions.
2. **Request creation:** create a deletion request with document/artifact IDs, reason code, requester, policy version, eligibility evidence and timestamp. Do not expose storage paths.
3. **Independent approval:** require the approved separation-of-duties control; the requester must not approve their own request.
4. **Atomic scheduling:** in one database transaction, lock the relevant record, re-check eligibility and holds, record approval, and enqueue a durable deletion job/outbox event.
5. **Worker execution:** revalidate the job, derive the private storage key from the artifact registry, verify that the resolved file is beneath the configured storage directory, and delete only the validated regular file.
6. **Postcondition:** verify the file is absent; record the result, digest, byte size, storage key, actor/worker identity, timestamps, job ID and policy version.
7. **Tombstone:** retain immutable artifact provenance and the deletion event/tombstone according to the approved records policy. Do not delete the audit trail to make the artifact appear never to have existed.
8. **Failure handling:** retry only classified transient failures; quarantine ambiguous or integrity-failed files and require human review. Do not retry unsafe path, ownership or symlink failures as if they were transient.

The job must be idempotent. A repeated execution must not delete a different file or erase its own evidence. The worker must not accept a caller-provided path or arbitrary storage key.

## 8. Reconciliation and orphan-file controls

A reconciliation worker is needed because filesystem writes and PostgreSQL transactions cannot be made one atomic transaction with the current local filesystem design.

The worker should compare two inventories:

- **Database inventory:** immutable artifact rows and their expected storage keys, digests, sizes and document/version bindings.
- **Filesystem inventory:** canonical UUID PDF files found directly within the configured private storage directory, with file type, owner, permissions, size, timestamps and digest where safe to calculate.

Classify discrepancies without destructive action:

| Condition | Initial response |
|---|---|
| Registry row and matching file | Mark/check as healthy; no mutation to provenance |
| Registry row but file absent | Record `missing` incident; block download; require controlled recovery |
| Registry row but digest/size mismatch | Record integrity incident; quarantine where safe; block download |
| File exists with no registry row | Mark as orphan candidate; quarantine after a configured safety window and review |
| Symlink, non-regular file, wrong owner or unsafe permissions | Refuse access/deletion; raise high-priority security incident |
| Duplicate/unexpected key or path | Do not guess; quarantine and require operator investigation |

The orphan grace period must be configurable only after operational evidence and approval. It must account for in-flight generation, retries, worker outages, deployment restarts and clock skew.

Reconciliation must:
- use a single-flight or lease mechanism so concurrent workers do not race;
- paginate/batch large inventories;
- avoid following symlinks;
- avoid reading or logging PDF content;
- emit metrics for healthy, missing, orphaned, quarantined and integrity-failed artifacts;
- preserve a durable run ID, start/end timestamps, software version and policy/config version;
- support dry-run mode and produce a reviewable report before any quarantine or deletion action;
- never automatically purge an orphan merely because it is absent from the database.

## 9. Safer artifact-generation consistency

Current generation writes the PDF file and then registers its metadata. Error handlers attempt cleanup, but a hard process/host failure can interrupt cleanup and leave an orphan.

A future implementation should use a durable generation intent/outbox and explicit temporary-file protocol:

1. Create a generation intent bound to the locked issued document version.
2. Render to a server-generated temporary filename in the same private filesystem.
3. Flush and close the file; verify regular-file type, owner, permissions, size and digest.
4. Atomically rename to a canonical UUID key within the same filesystem.
5. In a database transaction, register immutable artifact provenance and mark the generation intent complete.
6. Make retries idempotent and reconcile interrupted intents.

The exact order must be tested against crash points. Because the filesystem and database do not share a transaction manager, the design must explicitly handle:
- crash before temp-file completion;
- crash after temp-file completion but before rename;
- crash after rename but before artifact registration;
- crash after registration but before response delivery;
- concurrent generation attempts for the same document version.

A durable intent and reconciliation process reduce ambiguity; they do not make the filesystem/database operation globally atomic.

## 10. Access behavior for archived and unavailable artifacts

The existing PDF endpoint permits downloads only when the document status is `issued`. The behavior for `archived` must not be inferred.

Before implementation, approve an access matrix covering:
- ordinary author;
- assigned reviewer;
- scoped asset evaluator;
- administrator;
- auditor;
- records/privacy custodian (if such a grant is approved);
- service/worker identity.

For each actor, decide whether they may view metadata, download an archived PDF, request a restoration, approve a deletion, or inspect audit evidence.

Missing, quarantined, or integrity-failed artifacts must not be returned as a successful PDF response. Responses should avoid leaking whether an inaccessible document exists to unauthorized principals. Authorized operational users may receive a generic unavailable status plus an incident reference, without PDF content.

## 11. Test and release gates

No production rollout until all applicable gates pass:

- migration tests prove artifact provenance remains append-only;
- lifecycle tests prove archive transitions preserve issued facts;
- authorization tests cover allowed and denied roles/scopes, self-approval and cross-contour access;
- legal-hold tests prove no deletion can proceed while a hold is active;
- retention tests cover policy versions, boundary dates, time zones and exceptions;
- worker tests cover idempotency, leases, retries and concurrent execution;
- filesystem tests cover traversal, symlink swaps, ownership, permissions, hard links where relevant, path replacement and unexpected file types;
- crash-injection tests cover every generation/deletion boundary;
- PostgreSQL integration tests verify transaction and outbox behavior;
- reconciliation tests prove dry-run is non-destructive and no orphan is purged automatically;
- audit tests prove every state change and physical operation is attributable;
- backup/restore and disaster-recovery procedures are tested;
- staging acceptance is completed with synthetic data before any production data is introduced.

## 12. Decisions still open

This document deliberately leaves the following unresolved:

- approved retention periods and legal bases;
- archive and purge permission model;
- whether archive PDF downloads remain available and to whom;
- legal-hold authority and release procedure;
- backup/replica deletion obligations and evidence standard;
- orphan quarantine grace period and operator workflow;
- operational-state schema and worker technology;
- whether the current local filesystem remains the approved storage backend or is replaced by a managed private object store.

These are governance and architecture decisions, not safe defaults for an implementation to invent.

## 13. Recommended implementation sequence

1. Review and approve this lifecycle design with legal/privacy, records governance, security and asset-valuation process owners.
2. Decide archive semantics and the role/scope matrix.
3. Approve a versioned retention schedule and legal-hold model.
4. Design the operational artifact-state/outbox schema without weakening append-only provenance.
5. Implement dry-run reconciliation and observability first.
6. Implement archive API and access behavior with tests.
7. Implement controlled deletion request/approval/worker workflow only after policy approval.
8. Test crash recovery, backup handling and restoration in staging.
9. Enable production operations only after explicit acceptance and operational runbooks.

**Release boundary:** this proposal changes no runtime behavior, performs no file deletion, does not change database schema, and does not authorize production storage or deployment work.
