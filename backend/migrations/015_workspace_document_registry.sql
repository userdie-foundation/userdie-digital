-- General foundation document registry (metadata only; no file storage or upload API).
-- Keep this domain separate from application uploads and partnership evidence.
BEGIN;

CREATE TABLE workspace_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_number text NOT NULL UNIQUE
    CHECK (registration_number ~ '^[A-Z0-9][A-Z0-9._/-]{1,79}$'),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 300),
  document_type text NOT NULL
    CHECK (document_type IN (
      'policy', 'regulation', 'contract', 'agreement', 'letter',
      'order', 'report', 'act', 'certificate', 'financial',
      'application_material', 'analytical', 'other'
    )),
  organizational_contour text NOT NULL DEFAULT 'foundation'
    CHECK (organizational_contour IN ('foundation', 'asset_valuation', 'analytics')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'under_review', 'archived', 'superseded')),
  source_kind text NOT NULL DEFAULT 'original'
    CHECK (source_kind IN ('original', 'generated', 'external_reference', 'legacy_record')),
  owner_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  next_review_on date,
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 2000),
  created_by uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workspace_documents_contour_status_idx
  ON workspace_documents(organizational_contour, status, updated_at DESC);
CREATE INDEX workspace_documents_owner_status_idx
  ON workspace_documents(owner_id, status, updated_at DESC)
  WHERE owner_id IS NOT NULL;
CREATE INDEX workspace_documents_review_due_idx
  ON workspace_documents(next_review_on, status)
  WHERE next_review_on IS NOT NULL AND status <> 'archived';

-- Immutable version register. File bytes and storage keys are deliberately absent.
CREATE TABLE workspace_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES workspace_documents(id) ON DELETE RESTRICT,
  version_number integer NOT NULL CHECK (version_number > 0),
  version_label text NOT NULL CHECK (length(trim(version_label)) BETWEEN 1 AND 40),
  effective_on date,
  content_sha256 text CHECK (
    content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  source_reference text CHECK (
    source_reference IS NULL OR length(trim(source_reference)) BETWEEN 1 AND 1000
  ),
  change_note text NOT NULL DEFAULT '' CHECK (length(change_note) <= 1000),
  registered_by uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  registered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_number),
  UNIQUE (document_id, id)
);

CREATE INDEX workspace_document_versions_timeline_idx
  ON workspace_document_versions(document_id, version_number DESC);

-- Explicit relation tables preserve real foreign keys and do not grant access
-- to the linked program/case/partnership.
CREATE TABLE workspace_document_program_links (
  document_id uuid NOT NULL REFERENCES workspace_documents(id) ON DELETE RESTRICT,
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
  linked_by uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, program_id)
);

CREATE TABLE workspace_document_application_links (
  document_id uuid NOT NULL REFERENCES workspace_documents(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
  linked_by uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, application_id)
);

CREATE TABLE workspace_document_task_links (
  document_id uuid NOT NULL REFERENCES workspace_documents(id) ON DELETE RESTRICT,
  task_id uuid NOT NULL REFERENCES application_tasks(id) ON DELETE RESTRICT,
  linked_by uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, task_id)
);

CREATE TABLE workspace_document_partnership_links (
  document_id uuid NOT NULL REFERENCES workspace_documents(id) ON DELETE RESTRICT,
  partnership_id uuid NOT NULL REFERENCES partnerships(id) ON DELETE RESTRICT,
  linked_by uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, partnership_id)
);

CREATE INDEX workspace_document_program_links_program_idx
  ON workspace_document_program_links(program_id, document_id);
CREATE INDEX workspace_document_application_links_application_idx
  ON workspace_document_application_links(application_id, document_id);
CREATE INDEX workspace_document_task_links_task_idx
  ON workspace_document_task_links(task_id, document_id);
CREATE INDEX workspace_document_partnership_links_partnership_idx
  ON workspace_document_partnership_links(partnership_id, document_id);

-- Append-only domain history; the application must insert this and audit_events
-- in the same database transaction as each corresponding state change.
CREATE TABLE workspace_document_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES workspace_documents(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  event_type text NOT NULL
    CHECK (event_type IN (
      'registered', 'metadata_updated', 'status_changed',
      'version_registered', 'linked', 'unlinked',
      'review_scheduled', 'archived'
    )),
  rationale text NOT NULL DEFAULT '' CHECK (length(rationale) <= 1000),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workspace_document_events_timeline_idx
  ON workspace_document_events(document_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION prevent_workspace_document_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER workspace_document_versions_no_update_delete
BEFORE UPDATE OR DELETE ON workspace_document_versions
FOR EACH ROW EXECUTE FUNCTION prevent_workspace_document_history_mutation();

CREATE TRIGGER workspace_document_versions_no_truncate
BEFORE TRUNCATE ON workspace_document_versions
FOR EACH STATEMENT EXECUTE FUNCTION prevent_workspace_document_history_mutation();

CREATE TRIGGER workspace_document_events_no_update_delete
BEFORE UPDATE OR DELETE ON workspace_document_events
FOR EACH ROW EXECUTE FUNCTION prevent_workspace_document_history_mutation();

CREATE TRIGGER workspace_document_events_no_truncate
BEFORE TRUNCATE ON workspace_document_events
FOR EACH STATEMENT EXECUTE FUNCTION prevent_workspace_document_history_mutation();

COMMIT;
