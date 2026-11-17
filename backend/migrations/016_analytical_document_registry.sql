-- Analytical document registry foundation for the Asset Valuation Center.
-- Persistence schema only: HTTP write routes remain disabled until separately reviewed.
BEGIN;

CREATE TABLE analytical_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number text UNIQUE,
  document_type text NOT NULL
    CHECK (document_type IN (
      'asset_analysis', 'preliminary_valuation',
      'investment_analysis', 'capital_structure_analysis'
    )),
  organizational_contour text NOT NULL
    CHECK (organizational_contour IN ('foundation', 'assets', 'analytics')),
  asset_reference text CHECK (
    asset_reference IS NULL OR length(trim(asset_reference)) BETWEEN 1 AND 128
  ),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 240),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'submitted_for_review', 'changes_requested',
      'approved', 'issued', 'archived'
    )),
  created_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  assigned_reviewer_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  approved_by uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  approved_at timestamptz,
  issued_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (assigned_reviewer_id IS NULL OR assigned_reviewer_id <> created_by),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  CHECK (
    (status IN ('approved', 'issued', 'archived')
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR
    (status NOT IN ('approved', 'issued', 'archived')
      AND approved_by IS NULL AND approved_at IS NULL)
  ),
  CHECK (
    (status IN ('issued', 'archived')
      AND document_number IS NOT NULL
      AND issued_at IS NOT NULL)
    OR
    (status NOT IN ('issued', 'archived')
      AND document_number IS NULL AND issued_at IS NULL)
  ),
  CHECK (
    (status = 'archived' AND archived_at IS NOT NULL)
    OR (status <> 'archived' AND archived_at IS NULL)
  )
);

CREATE INDEX analytical_documents_status_idx
  ON analytical_documents(status, updated_at DESC);
CREATE INDEX analytical_documents_asset_idx
  ON analytical_documents(asset_reference, created_at DESC)
  WHERE asset_reference IS NOT NULL;
CREATE INDEX analytical_documents_author_idx
  ON analytical_documents(created_by, created_at DESC);

CREATE TABLE analytical_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES analytical_documents(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_storage_key text CHECK (
    pdf_storage_key IS NULL OR length(trim(pdf_storage_key)) BETWEEN 1 AND 500
  ),
  created_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number),
  UNIQUE (document_id, id)
);

CREATE INDEX analytical_document_versions_history_idx
  ON analytical_document_versions(document_id, version_number DESC);

CREATE FUNCTION prevent_analytical_document_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'analytical document versions are immutable';
END;
$$;

CREATE TRIGGER analytical_document_versions_no_update_delete
BEFORE UPDATE OR DELETE ON analytical_document_versions
FOR EACH ROW EXECUTE FUNCTION prevent_analytical_document_version_mutation();

CREATE TRIGGER analytical_document_versions_no_truncate
BEFORE TRUNCATE ON analytical_document_versions
FOR EACH STATEMENT EXECUTE FUNCTION prevent_analytical_document_version_mutation();

CREATE TABLE analytical_document_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES analytical_documents(id) ON DELETE RESTRICT,
  document_version_id uuid NOT NULL,
  submitted_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  reviewer_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested', 'cancelled')),
  decision_rationale text NOT NULL DEFAULT '' CHECK (length(decision_rationale) <= 2000),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (submitted_by <> reviewer_id),
  FOREIGN KEY (document_id, document_version_id)
    REFERENCES analytical_document_versions(document_id, id) ON DELETE RESTRICT,
  CHECK (
    (status IN ('approved', 'rejected', 'changes_requested') AND decided_at IS NOT NULL)
    OR
    (status IN ('pending', 'cancelled') AND decided_at IS NULL)
  )
);

CREATE INDEX analytical_document_approvals_reviewer_idx
  ON analytical_document_approvals(reviewer_id, status, submitted_at ASC);
CREATE INDEX analytical_document_approvals_document_idx
  ON analytical_document_approvals(document_id, submitted_at DESC);

CREATE TABLE analytical_document_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES analytical_documents(id) ON DELETE RESTRICT,
  document_version_id uuid,
  actor_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  event_type text NOT NULL
    CHECK (event_type IN (
      'draft_created', 'version_created', 'submitted_for_review',
      'review_started', 'changes_requested', 'approved',
      'rejected', 'issued', 'archived'
    )),
  previous_status text,
  new_status text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (document_id, document_version_id)
    REFERENCES analytical_document_versions(document_id, id) ON DELETE RESTRICT
);

CREATE INDEX analytical_document_events_timeline_idx
  ON analytical_document_events(document_id, created_at ASC, id ASC);

CREATE FUNCTION prevent_analytical_document_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'analytical document events are append-only';
END;
$$;

CREATE TRIGGER analytical_document_events_no_update_delete
BEFORE UPDATE OR DELETE ON analytical_document_events
FOR EACH ROW EXECUTE FUNCTION prevent_analytical_document_event_mutation();

CREATE TRIGGER analytical_document_events_no_truncate
BEFORE TRUNCATE ON analytical_document_events
FOR EACH STATEMENT EXECUTE FUNCTION prevent_analytical_document_event_mutation();

CREATE FUNCTION prevent_analytical_document_approval_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'analytical document approval history is append-only';
END;
$$;

CREATE TRIGGER analytical_document_approvals_no_delete
BEFORE DELETE ON analytical_document_approvals
FOR EACH ROW EXECUTE FUNCTION prevent_analytical_document_approval_event_mutation();

COMMENT ON TABLE analytical_documents IS
  'Server-side registry for analytical documents. Registration number is assigned only at issue; author and approver must be different.';
COMMENT ON TABLE analytical_document_versions IS
  'Immutable content snapshots. New edits create a new version; UPDATE, DELETE and TRUNCATE are blocked.';
COMMENT ON TABLE analytical_document_approvals IS
  'Independent review records bound to an exact immutable document version; self-review is prohibited.';
COMMENT ON TABLE analytical_document_events IS
  'Append-only document lifecycle history.';

COMMIT;
