-- Prevent direct SQL from rewriting approved or issued document lifecycle facts.
BEGIN;

CREATE OR REPLACE FUNCTION enforce_analytical_document_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status = 'submitted_for_review')
    OR (OLD.status = 'submitted_for_review' AND NEW.status IN ('approved', 'changes_requested'))
    OR (OLD.status = 'changes_requested' AND NEW.status = 'draft')
    OR (OLD.status = 'approved' AND NEW.status = 'issued')
    OR (OLD.status = 'issued' AND NEW.status = 'archived')
  ) THEN
    RAISE EXCEPTION 'invalid analytical document lifecycle transition';
  END IF;

  IF OLD.status IN ('approved', 'issued', 'archived') AND (
    NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.approved_version_id IS DISTINCT FROM OLD.approved_version_id
  ) THEN
    RAISE EXCEPTION 'approved analytical document facts are immutable';
  END IF;

  IF OLD.status IN ('issued', 'archived') AND (
    NEW.issued_version_id IS DISTINCT FROM OLD.issued_version_id
    OR NEW.document_number IS DISTINCT FROM OLD.document_number
    OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
  ) THEN
    RAISE EXCEPTION 'issued analytical document facts are immutable';
  END IF;

  IF OLD.status = 'archived' AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'archived analytical document facts are immutable';
  END IF;

  IF NEW.status = 'approved' THEN
    IF OLD.status <> 'submitted_for_review' THEN
      RAISE EXCEPTION 'analytical document must be submitted before approval';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM analytical_document_approvals approval
      WHERE approval.document_id = NEW.id
        AND approval.document_version_id = NEW.approved_version_id
        AND approval.submitted_by = NEW.created_by
        AND approval.reviewer_id = NEW.approved_by
        AND approval.status = 'approved'
    ) THEN
      RAISE EXCEPTION 'approval must match the author, independent reviewer, and exact document version';
    END IF;
  ELSIF NEW.status = 'issued' THEN
    IF OLD.status <> 'approved'
       OR NEW.issued_version_id IS DISTINCT FROM OLD.approved_version_id
       OR NEW.approved_version_id IS DISTINCT FROM OLD.approved_version_id
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
       OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'only the previously approved document version may be issued';
    END IF;
  ELSIF NEW.status = 'archived' THEN
    IF OLD.status <> 'issued'
       OR NEW.issued_version_id IS DISTINCT FROM OLD.issued_version_id
       OR NEW.approved_version_id IS DISTINCT FROM OLD.approved_version_id
       OR NEW.document_number IS DISTINCT FROM OLD.document_number
       OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
      RAISE EXCEPTION 'only an issued analytical document may be archived without changing its issued facts';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_analytical_document_lifecycle() IS
  'Enforces allowed lifecycle transitions and prevents direct SQL from rewriting approved or issued version facts.';

COMMIT;
