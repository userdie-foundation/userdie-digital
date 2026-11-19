-- Preserve the provenance of generated analytical-document PDF artifacts.
BEGIN;

CREATE FUNCTION prevent_analytical_document_artifact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'analytical document artifacts are append-only';
END;
$$;

CREATE TRIGGER analytical_document_artifacts_no_update_delete
BEFORE UPDATE OR DELETE ON analytical_document_artifacts
FOR EACH ROW EXECUTE FUNCTION prevent_analytical_document_artifact_mutation();

CREATE TRIGGER analytical_document_artifacts_no_truncate
BEFORE TRUNCATE ON analytical_document_artifacts
FOR EACH STATEMENT EXECUTE FUNCTION prevent_analytical_document_artifact_mutation();

COMMENT ON TABLE analytical_document_artifacts IS
  'Append-only PDF artifact metadata bound to exact immutable analytical-document versions. File bytes live in separately managed private storage.';

COMMIT;
