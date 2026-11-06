-- Protect the backend audit log from mutation through ordinary SQL operations.
-- Database ownership and DDL permissions remain an operational control: this trigger
-- does not protect against a superuser or an owner deliberately disabling it.
BEGIN;

CREATE FUNCTION prevent_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_event_mutation();

COMMENT ON TABLE audit_events IS
  'Append-only audit history. UPDATE, DELETE and TRUNCATE are blocked by database triggers; restrict DDL and table ownership separately.';

COMMIT;
