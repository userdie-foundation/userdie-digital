-- Versioned, append-only consent evidence. No consent document is active until
-- a legally approved version is registered by a controlled deployment process.
BEGIN;

CREATE TABLE privacy_consent_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_code text NOT NULL CHECK (document_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  document_version text NOT NULL CHECK (document_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$'),
  consent_type text NOT NULL CHECK (consent_type IN ('personal_data', 'special_category', 'dissemination')),
  purpose_code text NOT NULL CHECK (purpose_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  document_sha256 char(64) NOT NULL CHECK (document_sha256 ~ '^[a-f0-9]{64}$'),
  choice_keys text[] NOT NULL CHECK (cardinality(choice_keys) BETWEEN 1 AND 16),
  approved_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL,
  published_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_code, document_version),
  CHECK (approved_at <= published_at),
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
  capture_method text NOT NULL DEFAULT 'authenticated_session'
    CHECK (capture_method = 'authenticated_session'),
  previous_event_id uuid REFERENCES privacy_consent_events(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
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
    OR OLD.choice_keys IS DISTINCT FROM NEW.choice_keys
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


-- Enforce the consent event chain at the database boundary as well as in the
-- HTTP service. This protects integrity if another trusted process writes SQL.
CREATE UNIQUE INDEX privacy_consent_events_withdrawal_once_idx
  ON privacy_consent_events(previous_event_id)
  WHERE event_type = 'withdrawn';

CREATE FUNCTION prevent_privacy_consent_document_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $
BEGIN
  RAISE EXCEPTION 'privacy consent document versions cannot be truncated';
END;
$;

CREATE TRIGGER privacy_consent_documents_no_truncate
  BEFORE TRUNCATE ON privacy_consent_documents
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_privacy_consent_document_truncate();

CREATE FUNCTION enforce_privacy_consent_event_integrity()
RETURNS trigger
LANGUAGE plpgsql
AS $
DECLARE
  document_row privacy_consent_documents%ROWTYPE;
  latest_event_id uuid;
  latest_event_type text;
BEGIN
  -- Serialize all consent changes for a subject, including direct SQL writes.
  PERFORM 1 FROM app_users WHERE id = NEW.subject_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy consent subject does not exist';
  END IF;

  IF NEW.actor_user_id IS DISTINCT FROM NEW.subject_user_id THEN
    RAISE EXCEPTION 'authenticated-session consent actor must be the subject';
  END IF;

  IF NEW.capture_method <> 'authenticated_session' THEN
    RAISE EXCEPTION 'unsupported privacy consent capture method';
  END IF;

  SELECT * INTO document_row
  FROM privacy_consent_documents
  WHERE id = NEW.document_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy consent document version does not exist';
  END IF;

  SELECT id, event_type
    INTO latest_event_id, latest_event_type
  FROM privacy_consent_events
  WHERE subject_user_id = NEW.subject_user_id
    AND document_id = NEW.document_id
  ORDER BY occurred_at DESC, id DESC
  LIMIT 1;

  IF NEW.event_type = 'granted' THEN
    IF NEW.previous_event_id IS NOT NULL THEN
      RAISE EXCEPTION 'grant event cannot reference a previous event';
    END IF;
    IF document_row.approved_at > clock_timestamp()
      OR document_row.published_at > clock_timestamp()
      OR document_row.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'privacy consent document version is not active';
    END IF;
    IF document_row.consent_type = 'special_category' THEN
      RAISE EXCEPTION 'written consent capture is required for special-category data';
    END IF;
    IF latest_event_type = 'granted' THEN
      RAISE EXCEPTION 'active privacy consent already exists';
    END IF;
    IF cardinality(document_row.choice_keys) = 0
      OR (SELECT count(*) FROM jsonb_object_keys(NEW.choices)) <> cardinality(document_row.choice_keys)
      OR EXISTS (
        SELECT 1 FROM unnest(document_row.choice_keys) AS approved(key)
        WHERE NOT (NEW.choices ? approved.key)
      )
      OR EXISTS (
        SELECT 1 FROM jsonb_each(NEW.choices) AS submitted(key, value)
        WHERE jsonb_typeof(submitted.value) <> 'boolean'
      )
      OR NOT EXISTS (
        SELECT 1 FROM jsonb_each(NEW.choices) AS submitted(key, value)
        WHERE submitted.value = 'true'::jsonb
      ) THEN
      RAISE EXCEPTION 'privacy consent choices do not match the approved document';
    END IF;
  ELSIF NEW.event_type = 'withdrawn' THEN
    IF NEW.choices <> '{}'::jsonb THEN
      RAISE EXCEPTION 'withdrawal event must not contain consent choices';
    END IF;
    IF latest_event_type IS DISTINCT FROM 'granted'
      OR latest_event_id IS DISTINCT FROM NEW.previous_event_id THEN
      RAISE EXCEPTION 'withdrawal must reference the latest active grant for this subject and document';
    END IF;
  END IF;

  RETURN NEW;
END;
$;

CREATE TRIGGER privacy_consent_events_integrity
  BEFORE INSERT ON privacy_consent_events
  FOR EACH ROW EXECUTE FUNCTION enforce_privacy_consent_event_integrity();

COMMIT;
