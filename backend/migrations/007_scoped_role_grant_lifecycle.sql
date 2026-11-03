-- Auditable, one-way lifecycle for scoped role grants.
-- Grant changes remain database-administered; no public mutation endpoint is exposed.
BEGIN;

ALTER TABLE user_role_grants
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN revoked_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN revoke_reason text,
  DROP CONSTRAINT user_role_grants_user_id_role_id_scope_type_scope_id_key,
  ADD CONSTRAINT user_role_grants_revocation_consistency
    CHECK (
      (revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL)
      OR
      (revoked_at IS NOT NULL AND length(trim(coalesce(revoke_reason, ''))) BETWEEN 1 AND 500)
    );

CREATE UNIQUE INDEX user_role_grants_active_unique_idx
  ON user_role_grants(user_id, role_id, scope_type, scope_id)
  WHERE revoked_at IS NULL;

CREATE INDEX user_role_grants_active_user_scope_idx
  ON user_role_grants(user_id, scope_type, scope_id)
  WHERE revoked_at IS NULL;

CREATE TABLE user_role_grant_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  grant_id bigint NOT NULL REFERENCES user_role_grants(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('grant_created', 'grant_revoked')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_role_grant_events_grant_idx
  ON user_role_grant_events(grant_id, created_at, id);

CREATE FUNCTION enforce_scoped_role_grant_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'scoped role grants cannot be hard-deleted; revoke the grant';
  END IF;

  IF OLD.revoked_at IS NOT NULL
     OR NEW.revoked_at IS NULL
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.role_id IS DISTINCT FROM OLD.role_id
     OR NEW.scope_type IS DISTINCT FROM OLD.scope_type
     OR NEW.scope_id IS DISTINCT FROM OLD.scope_id
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
     OR (NEW.granted_by IS DISTINCT FROM OLD.granted_by AND NEW.granted_by IS NOT NULL)
     OR NEW.revoked_by IS NULL
     OR NEW.revoke_reason IS NULL
     OR NEW.revoked_at < OLD.granted_at THEN
    RAISE EXCEPTION 'scoped role grants may only be revoked once without changing grant attributes';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER user_role_grants_lifecycle_guard
  BEFORE UPDATE OR DELETE ON user_role_grants
  FOR EACH ROW EXECUTE FUNCTION enforce_scoped_role_grant_lifecycle();

CREATE FUNCTION record_scoped_role_grant_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO user_role_grant_events (grant_id, actor_id, event_type, details)
    VALUES (NEW.id, NEW.granted_by, 'grant_created',
      jsonb_build_object('role_id', NEW.role_id, 'scope_type', NEW.scope_type, 'scope_id', NEW.scope_id));
  ELSE
    INSERT INTO user_role_grant_events (grant_id, actor_id, event_type, details)
    VALUES (NEW.id, NEW.revoked_by, 'grant_revoked',
      jsonb_build_object('role_id', NEW.role_id, 'scope_type', NEW.scope_type, 'scope_id', NEW.scope_id,
        'reason', NEW.revoke_reason));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_role_grants_record_insert
  AFTER INSERT ON user_role_grants
  FOR EACH ROW EXECUTE FUNCTION record_scoped_role_grant_event();

CREATE TRIGGER user_role_grants_record_revoke
  AFTER UPDATE OF revoked_at ON user_role_grants
  FOR EACH ROW WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION record_scoped_role_grant_event();

CREATE FUNCTION prevent_role_grant_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'scoped role grant events are append-only';
END;
$$;

CREATE TRIGGER user_role_grant_events_no_update_delete
  BEFORE UPDATE OR DELETE ON user_role_grant_events
  FOR EACH ROW EXECUTE FUNCTION prevent_role_grant_event_mutation();

CREATE TRIGGER user_role_grant_events_no_truncate
  BEFORE TRUNCATE ON user_role_grant_events
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_role_grant_event_mutation();

COMMENT ON TABLE user_role_grant_events IS
  'Append-only audit trail for scoped role grant creation and one-way revocation.';

COMMIT;
