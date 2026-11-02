-- Program portfolio lifecycle and milestone governance.
-- Apply after 001_initial_schema.sql through a reviewed migration process.
-- This extends the existing programs table; it does not create real program records.
BEGIN;

ALTER TABLE programs
  ADD COLUMN code text,
  ADD COLUMN organizational_contour text NOT NULL DEFAULT 'foundation'
    CHECK (organizational_contour IN ('foundation', 'asset_valuation', 'analytics')),
  ADD COLUMN objective text NOT NULL DEFAULT '',
  ADD COLUMN target_groups jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(target_groups) = 'array'),
  ADD COLUMN geography text NOT NULL DEFAULT '',
  ADD COLUMN owner_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN approved_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN approved_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT programs_code_format_check
    CHECK (code IS NULL OR code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  ADD CONSTRAINT programs_approval_pair_check
    CHECK ((approved_by IS NULL) = (approved_at IS NULL));

CREATE UNIQUE INDEX programs_code_unique_idx
  ON programs(code) WHERE code IS NOT NULL;
CREATE INDEX programs_contour_status_idx
  ON programs(organizational_contour, status, created_at DESC);
CREATE INDEX programs_owner_status_idx
  ON programs(owner_id, status) WHERE owner_id IS NOT NULL;

CREATE TABLE program_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
  code text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'in_progress', 'blocked', 'completed', 'cancelled')),
  owner_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  completion_evidence text,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, code),
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  ),
  CHECK (
    (completed_at IS NULL AND completed_by IS NULL)
    OR (completed_at IS NOT NULL)
  )
);

CREATE INDEX program_milestones_program_status_idx
  ON program_milestones(program_id, status, due_at);
CREATE INDEX program_milestones_owner_due_idx
  ON program_milestones(owner_id, due_at)
  WHERE owner_id IS NOT NULL;

CREATE TABLE program_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  program_id uuid NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
  previous_status text,
  new_status text NOT NULL
    CHECK (new_status IN ('draft', 'open', 'paused', 'closed')),
  changed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  reason text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX program_status_history_program_idx
  ON program_status_history(program_id, changed_at DESC);

CREATE OR REPLACE FUNCTION record_program_status_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor_setting text;
  actor_uuid uuid;
BEGIN
  actor_setting := current_setting('app.actor_id', true);
  IF actor_setting ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    actor_uuid := actor_setting::uuid;
  ELSE
    actor_uuid := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO program_status_history (
      program_id, previous_status, new_status, changed_by, reason
    ) VALUES (
      NEW.id, NULL, NEW.status, actor_uuid, 'program_created'
    );
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO program_status_history (
      program_id, previous_status, new_status, changed_by, reason
    ) VALUES (
      NEW.id, OLD.status, NEW.status, actor_uuid, 'status_changed'
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER programs_status_history_on_insert
AFTER INSERT ON programs
FOR EACH ROW
EXECUTE FUNCTION record_program_status_history();

CREATE TRIGGER programs_status_history_on_update
AFTER UPDATE OF status ON programs
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION record_program_status_history();

COMMIT;
