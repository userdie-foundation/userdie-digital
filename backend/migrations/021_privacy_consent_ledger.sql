-- Versioned, append-only consent evidence. No consent document is active until
-- a legally approved version is registered by a controlled deployment process.
BEGIN;

CREATE TABLE privacy_consent_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_code text NOT NULL CHECK (document_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  document_version text NOT NULL CHECK (document_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.[0-9]+$'),
  consent_type text NOT NULL CHECK (consent_type IN ('personal_data', 'special_category', 'dissemination')),
  purpose_code text NOT NULL CHECK (purpose_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  document_sha256 char(64) NOT NULL CHECK (document_sha256 ~ '^[a-f0-9]{64}$'),
  approved_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_code, document_version),
  CHECK (revoked_at IS NULL OR revoked_at >= published_at)
);

CREATE INDEX privacy_consent_documents_active_idx
  ON privacy_consent_documents(document_code, document_version)
  WHERE revoked_at IS NULL;

CREATE TABLE privacy_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES privacy_consent_documents(id) ON DELETE RESTRICT,
  subject_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('granted', 'withdrawn')),
  choices jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(choices) = 'object'),
  previous_event_id uuid REFERENCES privacy_consent_events(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (event_type = 'granted' AND previous_event_id IS NULL)
    OR (event_type = 'withdrawn' AND previous_event_id IS NOT NULL)
  )
);

CREATE INDEX privacy_consent_events_subject_idx
  ON privacy_consent_events(subject_user_id, occurred_at DESC, id DESC);
CREATE INDEX privacy_consent_events_document_idx
  ON privacy_consent_events(subject_user_id, document_id, occurred_at DESC, id DESC);

CREATE FUNCTION prevent_privacy_consent_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'privacy consent events are append-only';
END;
$$;

CREATE TRIGGER privacy_consent_events_no_update_delete
  BEFORE UPDATE OR DELETE ON privacy_consent_events
  FOR EACH ROW EXECUTE FUNCTION prevent_privacy_consent_event_mutation();
CREATE TRIGGER privacy_consent_events_no_truncate
  BEFORE TRUNCATE ON privacy_consent_events
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_privacy_consent_event_mutation();

CREATE FUNCTION protect_privacy_consent_document_versions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'privacy consent document versions cannot be deleted';
  END IF;
  IF OLD.document_code IS DISTINCT FROM NEW.document_code
    OR OLD.document_version IS DISTINCT FROM NEW.document_version
    OR OLD.consent_type IS DISTINCT FROM NEW.consent_type
    OR OLD.purpose_code IS DISTINCT FROM NEW.purpose_code
    OR OLD.document_sha256 IS DISTINCT FROM NEW.document_sha256
    OR OLD.approved_by IS DISTINCT FROM NEW.approved_by
    OR OLD.approved_at IS DISTINCT FROM NEW.approved_at
    OR OLD.published_at IS DISTINCT FROM NEW.published_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at
    OR (OLD.revoked_at IS NOT NULL AND OLD.revoked_at IS DISTINCT FROM NEW.revoked_at)
  THEN
    RAISE EXCEPTION 'privacy consent document version is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER privacy_consent_documents_immutable
  BEFORE UPDATE OR DELETE ON privacy_consent_documents
  FOR EACH ROW EXECUTE FUNCTION protect_privacy_consent_document_versions();

COMMENT ON TABLE privacy_consent_documents IS
  'Controlled registry of legally approved, versioned consent documents. No rows are seeded by default.';
COMMENT ON TABLE privacy_consent_events IS
  'Append-only evidence of grant/withdrawal. Stores only controlled choice flags, not free text or health information.';

COMMIT;
