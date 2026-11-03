-- Scoped role grants for server-loaded authorization principals.
-- Existing user_roles remain global grants; this table adds explicit resource scopes.
BEGIN;

CREATE TABLE user_role_grants (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  role_id smallint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  scope_type text NOT NULL
    CHECK (scope_type IN ('program', 'organization', 'contour')),
  scope_id text NOT NULL
    CHECK (length(trim(scope_id)) BETWEEN 1 AND 128),
  granted_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role_id, scope_type, scope_id)
);

CREATE INDEX user_role_grants_user_scope_idx
  ON user_role_grants(user_id, scope_type, scope_id);

CREATE INDEX user_role_grants_role_scope_idx
  ON user_role_grants(role_id, scope_type, scope_id);

COMMENT ON TABLE user_role_grants IS
  'Explicit resource-scoped role grants. Global roles remain in user_roles. Scope assignments must be administered through a reviewed, audited workflow.';

COMMIT;
