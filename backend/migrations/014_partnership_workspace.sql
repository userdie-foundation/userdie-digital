-- Partnership workspace domain model.
-- Reuses organizations, organization-scoped grants, independent approvals,
-- and audit_events. Private file bytes remain outside this repository/database.
BEGIN;

CREATE TABLE partner_profiles (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  historical_name text NOT NULL CHECK (length(trim(historical_name)) BETWEEN 1 AND 240),
  legal_name text CHECK (legal_name IS NULL OR length(trim(legal_name)) BETWEEN 1 AND 240),
  legal_form text CHECK (legal_form IS NULL OR length(trim(legal_form)) <= 120),
  region text CHECK (region IS NULL OR length(trim(region)) <= 160),
  official_website text CHECK (
    official_website IS NULL OR
    (length(official_website) <= 500 AND official_website ~* '^https?://')
  ),
  identity_status text NOT NULL DEFAULT 'requires_identification'
    CHECK (identity_status IN ('requires_identification', 'identified', 'rejected')),
  source_reference text NOT NULL CHECK (length(trim(source_reference)) BETWEEN 1 AND 1000),
  last_verified_at timestamptz,
  assigned_to uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX partner_profiles_identity_status_idx
  ON partner_profiles(identity_status, updated_at DESC);
CREATE INDEX partner_profiles_assigned_to_idx
  ON partner_profiles(assigned_to, identity_status);

CREATE TABLE partnerships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  relationship_type text NOT NULL
    CHECK (relationship_type IN ('historical', 'prospective', 'programmatic', 'strategic')),
  status text NOT NULL DEFAULT 'historical_record'
    CHECK (status IN (
      'historical_record', 'requires_identification', 'identified',
      'documents_requested', 'historical_contact_confirmed', 'contact_restored',
      'active_confirmed', 'suspended', 'completed'
    )),
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 2000),
  started_on date,
  ended_on date,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  confirmation_submitted_by uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  confirmation_approval_id uuid REFERENCES approval_requests(id) ON DELETE RESTRICT,
  confirmed_by uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_on IS NULL OR started_on IS NULL OR ended_on >= started_on),
  CHECK (
    (status = 'active_confirmed'
      AND confirmation_submitted_by IS NOT NULL
      AND confirmation_approval_id IS NOT NULL
      AND confirmed_by IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND confirmation_submitted_by <> confirmed_by)
    OR
    (status <> 'active_confirmed'
      AND confirmation_submitted_by IS NULL
      AND confirmation_approval_id IS NULL
      AND confirmed_by IS NULL
      AND confirmed_at IS NULL)
  )
);

CREATE INDEX partnerships_organization_idx
  ON partnerships(organization_id, created_at DESC);
CREATE INDEX partnerships_status_idx
  ON partnerships(status, updated_at DESC);

CREATE FUNCTION enforce_partnership_confirmation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  approval_status text;
  approval_object_type text;
  approval_object_id text;
  approval_submitter uuid;
  approval_reviewer uuid;
BEGIN
  IF NEW.status <> 'active_confirmed' THEN
    RETURN NEW;
  END IF;

  SELECT status, object_type, object_id, submitted_by, reviewer_id
    INTO approval_status, approval_object_type, approval_object_id,
         approval_submitter, approval_reviewer
  FROM approval_requests
  WHERE id = NEW.confirmation_approval_id;

  IF NOT FOUND
     OR approval_status <> 'approved'
     OR approval_object_type <> 'partnership'
     OR approval_object_id <> NEW.id::text
     OR approval_submitter <> NEW.confirmation_submitted_by
     OR approval_reviewer <> NEW.confirmed_by
     OR approval_submitter = approval_reviewer THEN
    RAISE EXCEPTION 'active partnership requires a matching independent approved decision';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER partnerships_confirmation_guard
BEFORE INSERT OR UPDATE OF status, confirmation_submitted_by,
  confirmation_approval_id, confirmed_by, confirmed_at
ON partnerships
FOR EACH ROW EXECUTE FUNCTION enforce_partnership_confirmation();

CREATE TABLE partnership_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_id uuid NOT NULL REFERENCES partnerships(id) ON DELETE RESTRICT,
  evidence_type text NOT NULL
    CHECK (evidence_type IN (
      'agreement', 'letter', 'protocol', 'act', 'certificate',
      'correspondence', 'archive_record', 'other'
    )),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 240),
  document_date date,
  issuer text CHECK (issuer IS NULL OR length(issuer) <= 240),
  storage_key text NOT NULL UNIQUE CHECK (length(trim(storage_key)) BETWEEN 1 AND 500),
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'rejected')),
  verified_by uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  verified_at timestamptz,
  access_level text NOT NULL DEFAULT 'restricted'
    CHECK (access_level IN ('restricted', 'internal')),
  publication_status text NOT NULL DEFAULT 'not_publishable'
    CHECK (publication_status IN ('not_publishable', 'pending_approval', 'approved')),
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (verification_status = 'verified' AND verified_by IS NOT NULL AND verified_at IS NOT NULL)
    OR
    (verification_status <> 'verified' AND verified_by IS NULL AND verified_at IS NULL)
  ),
  CHECK (publication_status <> 'approved' OR verification_status = 'verified')
);

CREATE INDEX partnership_evidence_partnership_idx
  ON partnership_evidence(partnership_id, created_at DESC);
CREATE INDEX partnership_evidence_review_idx
  ON partnership_evidence(verification_status, created_at ASC);

CREATE TABLE partnership_status_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  partnership_id uuid NOT NULL REFERENCES partnerships(id) ON DELETE RESTRICT,
  previous_status text,
  new_status text NOT NULL
    CHECK (new_status IN (
      'historical_record', 'requires_identification', 'identified',
      'documents_requested', 'historical_contact_confirmed', 'contact_restored',
      'active_confirmed', 'suspended', 'completed'
    )),
  actor_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  rationale text NOT NULL DEFAULT '' CHECK (length(rationale) <= 1000),
  evidence_id uuid REFERENCES partnership_evidence(id) ON DELETE RESTRICT,
  approval_id uuid REFERENCES approval_requests(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX partnership_status_events_timeline_idx
  ON partnership_status_events(partnership_id, created_at DESC, id DESC);

CREATE FUNCTION prevent_partnership_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'partnership history is append-only';
END;
$$;

CREATE TRIGGER partnership_status_events_no_update_delete
BEFORE UPDATE OR DELETE ON partnership_status_events
FOR EACH ROW EXECUTE FUNCTION prevent_partnership_history_mutation();

CREATE TRIGGER partnership_status_events_no_truncate
BEFORE TRUNCATE ON partnership_status_events
FOR EACH STATEMENT EXECUTE FUNCTION prevent_partnership_history_mutation();

COMMIT;
