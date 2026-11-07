-- Separate PostgreSQL-backed throttling for password-recovery requests.
-- HMAC digests only: raw email addresses and peer IPs are never persisted.
BEGIN;

CREATE TABLE auth_recovery_rate_limit_buckets (
  bucket_type text NOT NULL CHECK (bucket_type IN ('account', 'network')),
  key_hash bytea NOT NULL CHECK (octet_length(key_hash) = 32),
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_type, key_hash),
  CHECK (blocked_until IS NULL OR blocked_until >= window_started_at)
);

CREATE INDEX auth_recovery_rate_limit_cleanup_idx
  ON auth_recovery_rate_limit_buckets(updated_at);

COMMENT ON TABLE auth_recovery_rate_limit_buckets IS
  'Separate recovery-request throttling counters keyed by HMAC-SHA-256; no raw account identifiers or client addresses are stored.';

COMMIT;
