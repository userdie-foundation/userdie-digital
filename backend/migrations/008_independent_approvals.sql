-- Independent approval inbox foundation.
-- Read-only API is enabled separately; no approval or decision write route is added here.
BEGIN;

INSERT INTO roles (code, description)
VALUES ('independent_approver', 'Independent reviewer; cannot approve own submitted records')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type text NOT NULL
    CHECK (object_type IN ('application', 'program', 'asset_valuation', 'partnership', 'financial_instruction', 'other')),
  object_id text NOT NULL CHECK (length(trim(object_id)) BETWEEN 1 AND 128),
  program_id uuid REFERENCES programs(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 200),
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 1000),
  submitted_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  reviewer_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'returned_for_revision', 'cancelled')),
  materials_version text NOT NULL
    CHECK (length(trim(materials_version)) BETWEEN 1 AND 80),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (submitted_by <> reviewer_id),
  CHECK (
    (status IN ('approved', 'rejected', 'returned_for_revision') AND decided_at IS NOT NULL)
    OR (status NOT IN ('approved', 'rejected', 'returned_for_revision') AND decided_at IS NULL)
  )
);

CREATE INDEX approval_requests_reviewer_queue_idx
  ON approval_requests(reviewer_id, status, submitted_at DESC);
CREATE INDEX approval_requests_program_queue_idx
  ON approval_requests(program_id, status, submitted_at DESC)
  WHERE program_id IS NOT NULL;

CREATE TABLE approval_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  approval_id uuid NOT NULL REFERENCES approval_requests(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES app_users(id) ON DELETE RESTRICT,
  event_type text NOT NULL
    CHECK (event_type IN (
      'submitted', 'review_started', 'approved', 'rejected',
      'returned_for_revision', 'reassigned', 'materials_revised', 'cancelled'
    )),
  rationale text NOT NULL DEFAULT '' CHECK (length(rationale) <= 1000),
  materials_version text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX approval_events_request_idx
  ON approval_events(approval_id, created_at DESC);

CREATE OR REPLACE FUNCTION prevent_approval_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'approval_events is append-only';
END;
$$;

CREATE TRIGGER approval_events_no_update
BEFORE UPDATE OR DELETE ON approval_events
FOR EACH ROW
EXECUTE FUNCTION prevent_approval_event_mutation();

CREATE TRIGGER approval_events_no_truncate
BEFORE TRUNCATE ON approval_events
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_approval_event_mutation();

COMMIT;
