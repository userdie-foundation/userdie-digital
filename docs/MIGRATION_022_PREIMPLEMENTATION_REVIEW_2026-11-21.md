# Migration 022 — pre-implementation architecture review
**Date:** 2026-11-21  
**Repository:** `userdie-foundation/userdie-digital`  
**Branch:** `feature/valuation-workspace-api-integration`  
**Baseline before this document:** `cc05a913b9bc8421a669c4c9ef9dd5aeb296cc9e`  
**Status:** design review only. No executable SQL, backend code, API route, feature flag, or database was changed.

## 1. Decision

Migration 022 remains **not ready for SQL implementation**. The existing design correctly preserves migration 021's self-only consent invariant, but several schema and lifecycle decisions must be made explicit before implementation. This review records those decisions and blockers so that SQL is not produced from ambiguous legal or operational assumptions.

Migration 022 is limited to:
1. independent verification evidence for a specific immutable consent-document version;
2. a separately controlled register of representative authority and its append-only status history.

It does not implement representative consent capture. It does not enable written special-category consent or dissemination consent. It does not modify the 021 event table's actor/subject constraint.

## 2. Source facts and invariants to preserve

Verified from the current branch source:
- `privacy_consent_documents` is the version registry with approval, publication, SHA-256 and choice-key fields.
- `privacy_consent_events` is append-only and 021's database trigger requires `actor_user_id = subject_user_id` and `capture_method = authenticated_session`.
- The current service resolves the subject from the authenticated principal; the request body cannot choose a subject.
- The ordinary capture endpoint accepts only `personal_data`; `special_category` and `dissemination` fail closed.
- migration runner uses a separate migration credential and explicit `MIGRATIONS_ALLOW_APPLY=true`.
- PostgreSQL integration tests may be skipped when `PG_INTEGRATION_URL` is absent. A green general CI run is not, by itself, proof that PostgreSQL tests executed.

No source change in 022 may weaken these invariants.

## 3. Document verification — refined data model

### 3.1 Verification evidence must be append-only and version-bound

Keep a successful verification record bound to exactly one `privacy_consent_documents.id`. The record must snapshot:
- the exact `document_sha256`;
- the exact ordered or canonicalized `choice_keys` set;
- `approved_by` and `approved_at` as read from the source document row;
- a non-sensitive approval-record reference;
- verifier identity and database-owned verification timestamp.

Use a uniqueness constraint for one accepted verification per document version. If failed attempts need auditability, record them in a separate append-only verification-attempt/event table; do not overwrite the accepted evidence row or store free-form sensitive reviewer notes.

Do not store the consent PDF, raw text, identity documents, signatures, or personal data in the verification table. The exact artifact remains in a separately controlled document archive. Its immutable object identifier and hash are evidence pointers, not a substitute for retention controls.

### 3.2 Identity and independence

The verifier must be a different user from the approver. Whether the author may also be the approver is a Foundation policy decision; do not silently assume that it is permitted. If author identity is not reliably represented by an existing `app_users.id`, do not add a nullable or fabricated author ID merely to satisfy a schema. Use a controlled author reference only after its identity model is approved.

A foreign key to `app_users` proves that an account exists; it does not prove that the person had legal or organizational authority. The verifier's permission must be checked against an approved server-side role/permission policy, and the role assignment must be auditable. Do not hard-code a guessed role name.

### 3.3 Gate and publication chronology

A verification record must match the document's approver, hash and choice keys exactly. The database must reject a grant event for a document version without accepted verification evidence.

Before choosing a strict publication rule, inspect the existing document-registration workflow: migration 021 stores `published_at` on the document row and treats the row as immutable apart from one-time revocation. Therefore a design that requires verification before publication must ensure the operator workflow can verify the artifact before the row is inserted, or introduce a separately reviewed draft/activation lifecycle. Do not create a trigger that makes every existing registration impossible.

No automatic backfill is permitted. If the catalogue is non-empty in any target environment, inventory every row and produce a real second-checker evidence plan. Never substitute the approver as verifier or manufacture historical verification timestamps.

### 3.4 Fail-closed event check

The final grant gate belongs in PostgreSQL, not only in the HTTP handler. It must check the accepted verification record inside the same transaction and under the same document-level serialization lock used by migration 021. Verification does not activate a document, alter its legal purpose, or bypass approval/publication/revocation checks.

## 4. Representative authority — refined lifecycle

### 4.1 Separate authority record from authority events

The authority record represents a claimed legal basis and scope; the append-only event stream records review decisions and subsequent revocation. Do not duplicate mutable `status` in both places. The current effective state is derived from the event stream plus validity dates.

A new authority record begins in a non-authorizing state. Only an authorized independent reviewer can record a verified/accepted event. Rejection and revocation are terminal for that authority record; a new legal instrument requires a new record.

### 4.2 Minimum data and evidence minimization

Store only:
- subject account ID and representative account ID;
- legally approved representative-type code;
- legally approved authority-basis code;
- narrowly defined scope codes;
- validity interval;
- opaque evidence object reference and SHA-256;
- registrar/reviewer identities and database-owned timestamps.

Do not store passport numbers, addresses, scans, medical facts, free-text family circumstances, or document contents in the relational record, ordinary API responses, or application logs. The secure evidence repository needs its own access-control, encryption, residency, retention, deletion and incident requirements before any evidence is uploaded.

An evidence hash alone does not prove authenticity, validity, or legal sufficiency. Human review of the underlying instrument remains mandatory.

### 4.3 No universal representative code set

Do not seed or invent codes such as parent, guardian, trustee, attorney-in-fact, or caregiver as if they were legally interchangeable. The Foundation's Russian counsel must approve the code dictionary and an applicability matrix covering:
- subject age and legal capacity;
- representative category and legal basis;
- permitted action and purpose;
- required evidence;
- validity and revocation conditions;
- whether the subject's own will/participation is required;
- whether the action requires a written form or additional signature evidence.

Kinship or caregiving status alone must not imply authority.

### 4.4 Atomic authorization decision

A future representative workflow must resolve the subject server-side from a verified authority record. It must ignore any client-supplied subject identifier, check the latest authority event, validity interval and scope, and repeat those checks inside the transaction immediately before any consent event is inserted.

The check and insert must be serialized against concurrent revocation/expiry. If the authority is revoked, rejected, expired, out of scope, ambiguous, or its evidence store is unavailable, the action fails closed.

**This is a future service requirement only.** Migration 022 must not alter `privacy_consent_events` to permit actor/subject mismatch. A separate future migration and legal approval would be required to record representative consent events safely.

## 5. Decisions required before SQL

| Decision | Required owner | Blocking effect |
|---|---|---|
| Legal representative types and authority-basis dictionary | Foundation + Russian counsel | No authority table CHECK/enum or representative API |
| Scope codes and purpose mapping | Foundation + privacy/legal owner | No authorization resolver |
| Author/approver/verifier separation policy | Foundation governance | No final verification constraints |
| Identity source for document author | Product/security owner | No author FK or identity field |
| Evidence storage provider, region, ACL, retention and deletion | Infrastructure + privacy owner | No evidence upload or evidence reference activation |
| Existing consent catalogue inventory per environment | DBA | No strict verification gate or backfill |
| Verification-before-publication workflow | Product + legal + operations | No final publication chronology trigger |
| Reviewer permission source and audit policy | Security + governance | No accepted verification or authority event |
| PostgreSQL runtime grants and owner separation | DBA/security | No staging acceptance |

A blank or undecided item is a release blocker, not permission to select a convenient default.

## 6. Required SQL structure — constraints, not executable migration

When authorized, the migration should be forward-only and transactional. Expected object groups:
1. accepted document-verification evidence, unique by document version;
2. optional append-only verification-attempt events, if the audit policy requires failed-attempt evidence;
3. representative-authority records;
4. append-only representative-authority events;
5. narrow indexes for document/version lookup, subject/representative lookup, event chronology and validity checks;
6. trigger functions enforcing immutability, valid event transitions, role checks, exact evidence snapshot matching and transaction serialization.

Every FK to `app_users` and source document rows should use restrictive deletion semantics. Use database-owned timestamps. Avoid broad JSON metadata; if metadata is unavoidable, define a strict allowlist and reject sensitive values.

Do not add RLS as a cosmetic control. If later required, design it against the actual connection-pool identity model and test it with the runtime role. Do not grant the runtime role schema ownership, DDL, trigger-disabling, role-management or migration privileges.

## 7. Required test matrix before accepting SQL

### Verification
- exact document hash, approver and choice-key snapshot match;
- any mismatch rejects the record;
- verifier differs from approver and has the approved permission;
- duplicate accepted verification is rejected;
- accepted verification cannot be updated, deleted or truncated;
- no grant can be inserted without accepted verification;
- document approval/publication/revocation checks remain enforced;
- concurrency between verification, revocation and grant is serialized;
- empty and non-empty document-catalogue migration paths are tested without fabricated backfill.

### Authority
- subject and representative differ;
- only approved code values are accepted;
- no authority is effective before a verified event;
- expired, rejected, revoked, out-of-scope or ambiguous authority is rejected;
- invalid transitions and duplicate terminal events are rejected;
- concurrent verification/revocation is serialized;
- the application cannot select a subject by request-body ID;
- evidence object references and hashes are validated, but no evidence contents leak into API/log/audit output;
- account deletion cannot cascade away evidence history.

### Regression and environment
- migrations 001–021 and all self-only consent tests pass unchanged;
- actor must still equal subject in migration 021;
- special-category and dissemination remain rejected by ordinary capture;
- feature flag remains false and public capture remains disabled;
- PostgreSQL integration is proven executed, not skipped;
- runtime role is verified against the effective-privilege audit before staging acceptance.

## 8. Implementation sequence after approvals

1. Obtain written decisions for every item in section 5.
2. Inventory the consent-document catalogue in each target environment without exporting personal data.
3. Approve the verification-before-publication operating procedure and secure evidence-store design.
4. Produce migration 022 as a separate code change; do not bundle API activation.
5. Add unit and PostgreSQL 16 integration tests with a mandatory CI job that fails when the integration URL is missing in the protected PR workflow.
6. Run migration and regression tests only in disposable test schemas first.
7. Review effective grants, trigger/function ownership and migration-runner separation.
8. Conduct independent legal/security review.
9. Obtain separate written Foundation authorization before any staging data capture; production remains out of scope until a later release decision.

## 9. Current status

- [x] Existing migration 021 and service guard reviewed.
- [x] Existing migration 022 proposal reviewed for ambiguity and implementation hazards.
- [x] Self-only invariant and separate special-category/dissemination controls retained.
- [x] Missing legal/governance/operational decisions listed explicitly.
- [ ] Legal authority dictionary approved.
- [ ] Reviewer/author policy approved.
- [ ] Evidence storage and retention approved.
- [ ] Consent catalogue inventory completed for target environments.
- [ ] Migration 022 SQL created and independently reviewed.
- [ ] PostgreSQL integration tests executed against migration 022.
- [ ] Staging acceptance completed.

**Decision: HOLD SQL implementation.** The next safe activity is to obtain the listed legal and operational decisions. This review does not authorize data collection, migration execution, representative capture, staging activation or production deployment.
