-- Enforce canonical UUID storage keys at the database boundary as well as in the API.
BEGIN;

ALTER TABLE analytical_document_artifacts
  ADD CONSTRAINT analytical_document_artifacts_storage_key_uuid_check
  CHECK (
    storage_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$'
  );

COMMIT;
