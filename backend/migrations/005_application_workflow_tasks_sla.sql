-- Application workflow, task ownership, SLA deadlines, and escalation history.
-- Apply after migrations 001-004 through a reviewed, backed-up deployment.
-- This creates workflow structures only; it does not create or import real cases/tasks.
BEGIN;

ALTER TABLE applications
  ADD COLUMN due_at timestamptz,
  ADD COLUMN sla_policy_code text,
  ADD CONSTRAINT applications_sla_policy_code_check
    CHECK (sla_policy_code IS NULL OR sla_policy_code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  ADD CONSTRAINT applications_id_program_unique UNIQUE (id, program_id);

CREATE INDEX applications_due_status_idx
  ON applications(status, due_at)
  WHERE due_at IS NOT NULL;

CREATE TABLE application_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL,
  program_id uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'blocked', 'completed', 'cancelled')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  assigned_to uuid REFERENCES app_users(id) ON DELETE SET NULL,
  due_at timestamptz,
  escalation_level smallint NOT NULL DEFAULT 0
    CHECK (escalation_level BETWEEN 0 AND 3),
  escalated_at timestamptz,
  completed_at timestamptz,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_tasks_case_program_fk
    FOREIGN KEY (application_id, program_id)
    REFERENCES applications(id, program_id) ON DELETE RESTRICT,
  CONSTRAINT application_tasks_completion_check
    CHECK (
      (status = 'completed' AND completed_at IS NOT NULL)
      OR (status <> 'completed' AND completed_at IS NULL)
    ),
  CONSTRAINT application_tasks_escalation_check
    CHECK (
      (escalation_level = 0 AND escalated_at IS NULL)
      OR (escalation_level > 0 AND escalated_at IS NOT NULL)
    ),
  UNIQUE (id, application_id)
);

CREATE INDEX application_tasks_case_status_idx
  ON application_tasks(application_id, status, due_at);
CREATE INDEX application_tasks_owner_due_idx
  ON application_tasks(assigned_to, due_at)
  WHERE assigned_to IS NOT NULL;
CREATE INDEX application_tasks_overdue_idx
  ON application_tasks(due_at, priority)
  WHERE status IN ('open', 'in_progress', 'blocked') AND due_at IS NOT NULL;

CREATE TABLE application_workflow_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE RESTRICT,
  task_id uuid,
  event_type text NOT NULL
    CHECK (event_type IN (
      'case_created', 'case_assigned', 'case_status_changed',
      'task_created', 'task_assigned', 'task_status_changed',
      'sla_escalated', 'comment_added', 'milestone_linked'
    )),
  actor_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  summary text NOT NULL DEFAULT '' CHECK (length(summary) <= 500),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_workflow_event_task_fk
    FOREIGN KEY (task_id, application_id)
    REFERENCES application_tasks(id, application_id) ON DELETE RESTRICT
);

CREATE INDEX application_workflow_events_case_idx
  ON application_workflow_events(application_id, created_at DESC);
CREATE INDEX application_workflow_events_task_idx
  ON application_workflow_events(task_id, created_at DESC)
  WHERE task_id IS NOT NULL;

CREATE OR REPLACE FUNCTION record_application_task_workflow_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor_setting text;
  actor_uuid uuid;
  event_name text;
  event_summary text;
BEGIN
  actor_setting := current_setting('app.actor_id', true);
  IF actor_setting ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    actor_uuid := actor_setting::uuid;
  ELSE
    actor_uuid := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO application_workflow_events (
      application_id, task_id, event_type, actor_id, summary, metadata
    ) VALUES (
      NEW.application_id, NEW.id, 'task_created', actor_uuid, 'task_created',
      jsonb_build_object('status', NEW.status, 'priority', NEW.priority, 'escalation_level', NEW.escalation_level)
    );
    RETURN NEW;
  END IF;

  IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
    INSERT INTO application_workflow_events (
      application_id, task_id, event_type, actor_id, summary, metadata
    ) VALUES (
      NEW.application_id, NEW.id, 'task_assigned', actor_uuid, 'task_assigned',
      jsonb_build_object('assigned_to', NEW.assigned_to)
    );
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO application_workflow_events (
      application_id, task_id, event_type, actor_id, summary, metadata
    ) VALUES (
      NEW.application_id, NEW.id, 'task_status_changed', actor_uuid, 'task_status_changed',
      jsonb_build_object('previous_status', OLD.status, 'status', NEW.status)
    );
  END IF;
  IF OLD.escalation_level IS DISTINCT FROM NEW.escalation_level THEN
    INSERT INTO application_workflow_events (
      application_id, task_id, event_type, actor_id, summary, metadata
    ) VALUES (
      NEW.application_id, NEW.id, 'sla_escalated', actor_uuid, 'sla_escalated',
      jsonb_build_object('escalation_level', NEW.escalation_level, 'due_at', NEW.due_at)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION set_application_task_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$;

CREATE TRIGGER application_tasks_updated_at
BEFORE UPDATE ON application_tasks
FOR EACH ROW
EXECUTE FUNCTION set_application_task_updated_at();

CREATE OR REPLACE FUNCTION record_application_case_workflow_event()
RETURNS trigger
LANGUAGE plpgsql
AS $
DECLARE
  actor_setting text;
  actor_uuid uuid;
BEGIN
  actor_setting := current_setting('app.actor_id', true);
  IF actor_setting ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}AFTER INSERT ON application_tasks
FOR EACH ROW
EXECUTE FUNCTION record_application_task_workflow_event();

CREATE TRIGGER application_tasks_workflow_event_update
AFTER UPDATE OF assigned_to, status, escalation_level ON application_tasks
FOR EACH ROW
WHEN (
  OLD.assigned_to IS DISTINCT FROM NEW.assigned_to
  OR OLD.status IS DISTINCT FROM NEW.status
  OR OLD.escalation_level IS DISTINCT FROM NEW.escalation_level
)
EXECUTE FUNCTION record_application_task_workflow_event();

CREATE OR REPLACE FUNCTION prevent_application_workflow_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'application_workflow_events is append-only';
END;
$$;

CREATE TRIGGER application_workflow_events_no_update
BEFORE UPDATE OR DELETE ON application_workflow_events
FOR EACH ROW
EXECUTE FUNCTION prevent_application_workflow_event_mutation();

COMMIT;
 THEN
    actor_uuid := actor_setting::uuid;
  ELSE
    actor_uuid := NULL;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO application_workflow_events (
      application_id, event_type, actor_id, summary, metadata
    ) VALUES (
      NEW.id, 'case_created', actor_uuid, 'case_created',
      jsonb_build_object('program_id', NEW.program_id, 'status', NEW.status)
    );
    RETURN NEW;
  END IF;

  IF OLD.assigned_to IS DISTINCT FROM NEW.assigned_to THEN
    INSERT INTO application_workflow_events (
      application_id, event_type, actor_id, summary, metadata
    ) VALUES (
      NEW.id, 'case_assigned', actor_uuid, 'case_assigned',
      jsonb_build_object('assigned_to', NEW.assigned_to)
    );
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO application_workflow_events (
      application_id, event_type, actor_id, summary, metadata
    ) VALUES (
      NEW.id, 'case_status_changed', actor_uuid, 'case_status_changed',
      jsonb_build_object('previous_status', OLD.status, 'status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$;

CREATE TRIGGER applications_workflow_event_insert
AFTER INSERT ON applications
FOR EACH ROW
EXECUTE FUNCTION record_application_case_workflow_event();

CREATE TRIGGER applications_workflow_event_update
AFTER UPDATE OF assigned_to, status ON applications
FOR EACH ROW
WHEN (
  OLD.assigned_to IS DISTINCT FROM NEW.assigned_to
  OR OLD.status IS DISTINCT FROM NEW.status
)
EXECUTE FUNCTION record_application_case_workflow_event();

CREATE TRIGGER application_tasks_workflow_event_insert
AFTER INSERT ON application_tasks
FOR EACH ROW
EXECUTE FUNCTION record_application_task_workflow_event();

CREATE TRIGGER application_tasks_workflow_event_update
AFTER UPDATE OF assigned_to, status, escalation_level ON application_tasks
FOR EACH ROW
WHEN (
  OLD.assigned_to IS DISTINCT FROM NEW.assigned_to
  OR OLD.status IS DISTINCT FROM NEW.status
  OR OLD.escalation_level IS DISTINCT FROM NEW.escalation_level
)
EXECUTE FUNCTION record_application_task_workflow_event();

CREATE OR REPLACE FUNCTION prevent_application_workflow_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'application_workflow_events is append-only';
END;
$$;

CREATE TRIGGER application_workflow_events_no_update
BEFORE UPDATE OR DELETE ON application_workflow_events
FOR EACH ROW
EXECUTE FUNCTION prevent_application_workflow_event_mutation();

COMMIT;
