-- One-time account recovery tokens. Store only SHA-256 digests; raw tokens are delivered once.
BEGIN;

CREATE TABLE auth_recovery_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX auth_recovery_tokens_user_active_idx
  ON auth_recovery_tokens(user_id, expires_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX auth_recovery_tokens_expiry_idx
  ON auth_recovery_tokens(expires_at);

COMMENT ON TABLE auth_recovery_tokens IS
  'Single-use, short-lived password recovery tokens. Persist only token_hash; never raw bearer tokens.';

COMMIT;
