-- MFA persistence primitives. This migration stores encrypted TOTP material only;
-- key custody, challenge handling, enrollment, verification and enforcement remain
-- application responsibilities and are not activated by applying this schema.
BEGIN;

CREATE TABLE auth_mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  factor_type text NOT NULL CHECK (factor_type IN ('totp')),
  secret_ciphertext bytea NOT NULL CHECK (octet_length(secret_ciphertext) > 0),
  secret_nonce bytea NOT NULL CHECK (octet_length(secret_nonce) = 12),
  secret_auth_tag bytea NOT NULL CHECK (octet_length(secret_auth_tag) = 16),
  encryption_key_id text NOT NULL CHECK (length(encryption_key_id) BETWEEN 1 AND 128),
  encryption_algorithm text NOT NULL DEFAULT 'AES-256-GCM'
    CHECK (encryption_algorithm = 'AES-256-GCM'),
  totp_digits smallint NOT NULL DEFAULT 6 CHECK (totp_digits = 6),
  totp_period_seconds smallint NOT NULL DEFAULT 30 CHECK (totp_period_seconds = 30),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  disabled_at timestamptz,
  last_accepted_step bigint CHECK (last_accepted_step IS NULL OR last_accepted_step >= 0),
  CHECK (confirmed_at IS NULL OR confirmed_at >= created_at),
  CHECK (disabled_at IS NULL OR disabled_at >= created_at),
  CHECK (
    (status = 'pending' AND confirmed_at IS NULL AND disabled_at IS NULL)
    OR (status = 'active' AND confirmed_at IS NOT NULL AND disabled_at IS NULL)
    OR (status = 'disabled' AND disabled_at IS NOT NULL)
  )
);

CREATE INDEX auth_mfa_factors_user_status_idx
  ON auth_mfa_factors(user_id, status, created_at DESC);

CREATE TABLE auth_mfa_challenges (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  challenge_hash bytea NOT NULL UNIQUE CHECK (octet_length(challenge_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  last_attempt_at timestamptz,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (last_attempt_at IS NULL OR last_attempt_at >= created_at),
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX auth_mfa_challenges_user_pending_idx
  ON auth_mfa_challenges(user_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE INDEX auth_mfa_challenges_expiry_idx
  ON auth_mfa_challenges(expires_at);

CREATE TABLE auth_mfa_recovery_codes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  verifier bytea NOT NULL UNIQUE CHECK (octet_length(verifier) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX auth_mfa_recovery_codes_user_unused_idx
  ON auth_mfa_recovery_codes(user_id, batch_id)
  WHERE consumed_at IS NULL;

COMMENT ON TABLE auth_mfa_factors IS
  'MFA factor metadata. TOTP secret material must be envelope-encrypted before insertion; plaintext seeds and provisioning URIs are forbidden.';
COMMENT ON COLUMN auth_mfa_factors.secret_ciphertext IS
  'Ciphertext only; encryption keys are held outside PostgreSQL in a managed key service.';
COMMENT ON COLUMN auth_mfa_factors.last_accepted_step IS
  'Replay-prevention watermark; verification must atomically advance only to a strictly newer TOTP time step.';
COMMENT ON TABLE auth_mfa_challenges IS
  'Short-lived pending MFA challenges. Persist only SHA-256 digests of high-entropy opaque browser tokens; never issue a normal session before successful verification.';
COMMENT ON TABLE auth_mfa_recovery_codes IS
  'One-time recovery-code verifiers. Store a keyed verifier or suitable one-way verifier, never plaintext recovery codes.';

COMMIT;
