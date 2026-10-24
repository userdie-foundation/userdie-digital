-- Server-side session storage foundation for future authentication.
-- Store only a cryptographic hash of a high-entropy opaque session token.
-- This migration does not enable login or create any sessions.
BEGIN;

CREATE TABLE auth_sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoke_reason text,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (revoke_reason IS NULL OR revoked_at IS NOT NULL)
);

CREATE INDEX auth_sessions_user_active_idx
  ON auth_sessions(user_id, expires_at DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX auth_sessions_expiry_idx
  ON auth_sessions(expires_at);

COMMENT ON TABLE auth_sessions IS
  'Server-side sessions; token_hash must be a cryptographic hash of a random opaque token, never the raw cookie token.';
COMMENT ON COLUMN auth_sessions.token_hash IS
  'SHA-256 or stronger digest of a high-entropy random token; never store bearer tokens in plaintext.';
COMMENT ON COLUMN auth_sessions.revoked_at IS
  'Set to revoke a session immediately; do not reuse revoked session rows.';

COMMIT;
