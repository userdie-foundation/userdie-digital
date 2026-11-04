-- USERDIE Digital — PostgreSQL initial schema draft
-- Status: DESIGN DRAFT ONLY. Not executed against any database.
-- PostgreSQL target: 15+. Apply only after security, legal and backend review.
-- No beneficiary PII, document bodies, credentials, wallet keys or token balances belong here.
-- Identifying data must be held in a separately protected PII vault; use opaque subject_ref values here.

BEGIN;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS cases;
CREATE SCHEMA IF NOT EXISTS assets;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS automation;

CREATE TABLE core.organizational_units (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    unit_type text NOT NULL CHECK (unit_type IN ('foundation', 'valuation_center', 'analytics_center', 'program_unit')),
    parent_unit_id uuid REFERENCES core.organizational_units(id),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.organizational_units IS
'Functional units of the Foundation. Valuation and Analytics Centers are not legal entities by implication.';

CREATE TABLE core.programs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    title text NOT NULL,
    summary text,
    status text NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
    owner_unit_id uuid REFERENCES core.organizational_units(id),
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.partners (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name text NOT NULL,
    partner_type text NOT NULL CHECK (partner_type IN ('nonprofit', 'business', 'public_body', 'individual', 'other')),
    status text NOT NULL CHECK (status IN ('prospect', 'active', 'paused', 'closed')),
    public_contact_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity.app_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    external_subject text NOT NULL UNIQUE,
    display_label text NOT NULL,
    status text NOT NULL CHECK (status IN ('invited', 'active', 'suspended', 'closed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_authenticated_at timestamptz
);
COMMENT ON COLUMN identity.app_users.external_subject IS
'Opaque identity-provider subject; never store passwords, access tokens or authentication secrets.';

CREATE TABLE identity.roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    title text NOT NULL,
    description text
);

CREATE TABLE identity.permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    description text NOT NULL
);

CREATE TABLE identity.role_permissions (
    role_id uuid NOT NULL REFERENCES identity.roles(id) ON DELETE RESTRICT,
    permission_id uuid NOT NULL REFERENCES identity.permissions(id) ON DELETE RESTRICT,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE identity.user_role_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES identity.app_users(id) ON DELETE RESTRICT,
    role_id uuid NOT NULL REFERENCES identity.roles(id) ON DELETE RESTRICT,
    unit_id uuid REFERENCES core.organizational_units(id) ON DELETE RESTRICT,
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz,
    assigned_by uuid REFERENCES identity.app_users(id) ON DELETE RESTRICT,
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE INDEX user_role_assignments_user_idx ON identity.user_role_assignments(user_id, valid_from DESC);

CREATE TABLE cases.requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_reference text NOT NULL UNIQUE,
    subject_ref text NOT NULL,
    program_id uuid REFERENCES core.programs(id) ON DELETE RESTRICT,
    responsible_unit_id uuid REFERENCES core.organizational_units(id) ON DELETE RESTRICT,
    category_code text NOT NULL,
    status text NOT NULL CHECK (status IN ('received', 'triage', 'in_review', 'awaiting_information', 'approved', 'declined', 'completed', 'withdrawn')),
    priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    summary_redacted text,
    created_by uuid REFERENCES identity.app_users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz
);
COMMENT ON COLUMN cases.requests.subject_ref IS
'Opaque reference to a separately protected identity record. Must not contain a name, phone, email or government identifier.';
CREATE INDEX requests_status_created_idx ON cases.requests(status, created_at DESC);
CREATE INDEX requests_subject_ref_idx ON cases.requests(subject_ref);
CREATE INDEX requests_program_status_idx ON cases.requests(program_id, status);

CREATE TABLE cases.case_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL REFERENCES cases.requests(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES identity.app_users(id) ON DELETE RESTRICT,
    assigned_by uuid NOT NULL REFERENCES identity.app_users(id) ON DELETE RESTRICT,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    released_at timestamptz,
    CHECK (released_at IS NULL OR released_at > assigned_at)
);
CREATE INDEX case_assignments_active_idx ON cases.case_assignments(request_id, user_id) WHERE released_at IS NULL;

CREATE TABLE cases.status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL REFERENCES cases.requests(id) ON DELETE RESTRICT,
    previous_status text,
    new_status text NOT NULL,
    changed_by uuid REFERENCES identity.app_users(id) ON DELETE RESTRICT,
    reason_code text,
    changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_status_history_request_idx ON cases.status_history(request_id, changed_at DESC);

CREATE TABLE cases.legal_bases_and_consents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_ref text NOT NULL,
    purpose_code text NOT NULL,
    legal_basis_code text NOT NULL,
    consent_version text,
    status text NOT NULL CHECK (status IN ('active', 'withdrawn', 'expired', 'not_required')),
    recorded_at timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz,
    evidence_ref text,
    recorded_by uuid REFERENCES identity.app_users(id) ON DELETE RESTRICT
);
CREATE INDEX legal_basis_subject_purpose_idx ON cases.legal_bases_and_consents(subject_ref, purpose_code, recorded_at DESC);

CREATE TABLE cases.document_metadata (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid REFERENCES cases.requests(id) ON DELETE RESTRICT,
    subject_ref text,
    storage_object_ref text NOT NULL UNIQUE,
    document_type text NOT NULL,
    classification text NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
    checksum_sha256 text,
    uploaded_by uuid REFERENCES identity.app_users(id) ON DELETE RESTRICT,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    retention_policy_code text NOT NULL,
    CHECK (request_id IS NOT NULL OR subject_ref IS NOT NULL)
);
COMMENT ON TABLE cases.document_metadata IS
'Metadata only. Binary documents reside in private controlled storage, never in the public repository or this table.';

CREATE TABLE assets.asset_register (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_code text NOT NULL UNIQUE,
    title text NOT NULL,
    asset_class text NOT NULL CHECK (asset_class IN ('financial', 'intellectual', 'digital', 'property', 'equipment', 'partnership', 'other')),
    description_redacted text,
    owner_unit_id uuid REFERENCES core.organizational_units(id) ON DELETE RESTRICT,
    lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('identified', 'under_review', 'valued', 'approved', 'disposed', 'archived')),
    currency_code char(3),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX asset_register_class_status_idx ON assets.asset_register(asset_class, lifecycle_status);

CREATE TABLE assets.valuations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id uuid NOT NULL REFERENCES assets.asset_register(id) ON DELETE RESTRICT,
    methodology_code text NOT NULL,
    valuation_amount numeric(20, 2) NOT NULL CHECK (valuation_amount >= 0),
    currency_code char(3) NOT NULL,
    valuation_date date NOT NULL,
    prepared_by uuid NOT NULL REFERENCES identity.app_users(id) ON DELETE RESTRICT,
    status text NOT NULL CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'superseded')),
    assumptions_redacted text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX valuations_asset_date_idx ON assets.valuations(asset_id, valuation_date DESC);

CREATE TABLE assets.valuation_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    valuation_id uuid NOT NULL REFERENCES assets.valuations(id) ON DELETE RESTRICT,
    evidence_type text NOT NULL,
    evidence_ref text NOT NULL,
    source_date date,
    reliability_grade text CHECK (reliability_grade IN ('A', 'B', 'C', 'unverified')),
    note_redacted text
);

CREATE TABLE core.approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    object_type text NOT NULL CHECK (object_type IN ('valuation', 'asset_record', 'case_decision', 'financial_instruction')),
    object_id uuid NOT NULL,
    decision text NOT NULL CHECK (decision IN ('approved', 'rejected', 'returned_for_revision')),
    decided_by uuid NOT NULL REFERENCES identity.app_users(id) ON DELETE RESTRICT,
    decided_at timestamptz NOT NULL DEFAULT now(),
    rationale_code text NOT NULL,
);
COMMENT ON TABLE core.approvals IS
'Approval record design. Application/service layer must enforce independent reviewer and separation of duties before production.';

CREATE TABLE automation.ai_proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_type text NOT NULL,
    target_type text NOT NULL,
    target_id uuid,
    proposed_action jsonb NOT NULL,
    rationale_redacted text,
    model_identifier text NOT NULL,
    prompt_version text NOT NULL,
    provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL CHECK (status IN ('proposed', 'accepted_by_human', 'rejected_by_human', 'expired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    reviewed_by uuid REFERENCES identity.app_users(id) ON DELETE RESTRICT,
    reviewed_at timestamptz
);
COMMENT ON TABLE automation.ai_proposals IS
'AI may propose and explain. It must not execute case decisions, valuations, access changes or financial transactions.';

CREATE TABLE audit.events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    actor_user_id uuid REFERENCES identity.app_users(id) ON DELETE RESTRICT,
    actor_type text NOT NULL CHECK (actor_type IN ('user', 'service', 'system', 'ai_assistant')),
    action_code text NOT NULL,
    object_type text NOT NULL,
    object_id uuid,
    outcome text NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
    correlation_id uuid NOT NULL,
    source_service text NOT NULL,
    metadata_redacted jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_events_time_idx ON audit.events(occurred_at DESC);
CREATE INDEX audit_events_object_idx ON audit.events(object_type, object_id, occurred_at DESC);
CREATE INDEX audit_events_correlation_idx ON audit.events(correlation_id);

COMMENT ON TABLE audit.events IS
'Append-only audit intent. Production DB roles, triggers and retention controls must prevent UPDATE/DELETE and redact sensitive payloads.';

-- Before production:
-- 1. Add and test row-level security policies for every tenant/unit-scoped table.
-- 2. Enforce object-level and field-level authorization in the backend, never only in the UI.
-- 3. Enforce approval segregation, immutable audit writes, retention and deletion workflows.
-- 4. Define legal basis, data residency, DPA and retention schedule with counsel/DPO.
-- 5. Add migration rollback, backup/restore and disaster-recovery tests.
-- 6. Keep BFU and ZHAKIN Points in separate bounded contexts and ledgers; no shared balances/tables.
-- 7. Use synthetic test data until security and privacy acceptance is complete.

COMMIT;
