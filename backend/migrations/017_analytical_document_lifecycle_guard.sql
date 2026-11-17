-- Harden analytical document lifecycle and bind issue to the independently approved version.
BEGIN;

ALTER TABLE analytical_documents
  ADD COLUMN approved_version_id uuid,
  ADD COLUMN issued_version_id uuid;

ALTER TABLE analytical_documents
  ADD CONSTRAINT analytical_documents_approved_version_fk
    FOREIGN KEY (id, approved_version_id)
    REFERENCES analytical_document_versions(document_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT analytical_documents_issued_version_fk
    FOREIGN KEY (id, issued_version_id)
    REFERENCES analytical_document_versions(document_id, id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT analytical_documents_approved_version_state_check
    CHECK (
      (status IN ('approved', 'issued', 'archived') AND approved_version_id IS NOT NULL)
      OR
      (status NOT IN ('approved', 'issued', 'archived') AND approved_version_id IS NULL)
    ),
  ADD CONSTRAINT analytical_documents_issued_version_state_check
    CHECK (
      (status IN ('issued', 'archived') AND issued_version_id IS NOT NULL)
      OR
      (status NOT IN ('issued', 'archived') AND issued_version_id IS NULL)
    );

CREATE FUNCTION enforce_analytical_document_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
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
         OR NEW.issued_version_id IS DISTINCT FROM NEW.approved_version_id THEN
        RAISE EXCEPTION 'only the approved document version may be issued';
      END IF;
    ELSIF NEW.status = 'archived' AND OLD.status <> 'issued' THEN
      RAISE EXCEPTION 'only an issued analytical document may be archived';
    ELSIF NEW.status = 'changes_requested'
      AND OLD.status NOT IN ('submitted_for_review') THEN
      RAISE EXCEPTION 'changes can only be requested during independent review';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER analytical_documents_lifecycle_guard
BEFORE UPDATE OF status, approved_version_id, approved_by, approved_at,
  issued_version_id, issued_at, document_number, archived_at
ON analytical_documents
FOR EACH ROW EXECUTE FUNCTION enforce_analytical_document_lifecycle();

CREATE FUNCTION protect_analytical_document_approval_decision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'analytical document approval decision is immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.document_version_id IS DISTINCT FROM OLD.document_version_id
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.reviewer_id IS DISTINCT FROM OLD.reviewer_id
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'analytical document approval assignment is immutable';
  END IF;
  IF NEW.status NOT IN ('approved', 'rejected', 'changes_requested', 'cancelled') THEN
    RAISE EXCEPTION 'invalid analytical document approval transition';
  END IF;
  IF (NEW.status IN ('approved', 'rejected', 'changes_requested') AND NEW.decided_at IS NULL)
     OR (NEW.status = 'cancelled' AND NEW.decided_at IS NOT NULL) THEN
    RAISE EXCEPTION 'analytical document approval decision timestamp is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER analytical_document_approvals_decision_guard
BEFORE UPDATE ON analytical_document_approvals
FOR EACH ROW EXECUTE FUNCTION protect_analytical_document_approval_decision();

COMMENT ON COLUMN analytical_documents.approved_version_id IS
  'Exact immutable content version accepted by the independent reviewer.';
COMMENT ON COLUMN analytical_documents.issued_version_id IS
  'Exact approved content version issued under the registration number.';

COMMIT;
