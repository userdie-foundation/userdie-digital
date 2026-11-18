-- Private, integrity-checked PDF artifacts for issued analytical document versions.
BEGIN;

CREATE TABLE analytical_document_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  document_version_id uuid NOT NULL,
  artifact_type text NOT NULL DEFAULT 'pdf'
    CHECK (artifact_type = 'pdf'),
  storage_key text NOT NULL UNIQUE
    CHECK (storage_key ~ '^[0-9a-f-]{36}\.pdf$'),
  content_sha256 char(64) NOT NULL
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 25000000),
  media_type text NOT NULL DEFAULT 'application/pdf'
    CHECK (media_type = 'application/pdf'),
  generated_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  generated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (document_id, document_version_id)
    REFERENCES analytical_document_versions(document_id, id) ON DELETE RESTRICT,
  UNIQUE (document_id, document_version_id, artifact_type)
);

CREATE INDEX analytical_document_artifacts_version_idx
  ON analytical_document_artifacts(document_id, document_version_id);

COMMENT ON TABLE analytical_document_artifacts IS
  'Private generated artifacts bound to exact immutable analytical-document versions. File bytes live in separately managed private storage; hashes and access events are recorded here.';

COMMIT;
