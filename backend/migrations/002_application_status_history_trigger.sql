-- Record initial application status and subsequent status transitions.
-- Apply after 001_initial_schema.sql through a reviewed migration process.
BEGIN;

CREATE OR REPLACE FUNCTION record_application_status_history()
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
    INSERT INTO application_status_history (
      application_id, previous_status, new_status, changed_by, reason
    ) VALUES (
      NEW.id, NULL, NEW.status, actor_uuid, 'application_created'
    );
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO application_status_history (
      application_id, previous_status, new_status, changed_by, reason
    ) VALUES (
      NEW.id, OLD.status, NEW.status, actor_uuid, 'status_changed'
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER applications_status_history_on_insert
AFTER INSERT ON applications
FOR EACH ROW
EXECUTE FUNCTION record_application_status_history();

CREATE TRIGGER applications_status_history_on_update
AFTER UPDATE OF status ON applications
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION record_application_status_history();

COMMIT;
