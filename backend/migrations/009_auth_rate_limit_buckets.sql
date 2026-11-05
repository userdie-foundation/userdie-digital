-- Database-backed login throttling buckets.
-- Store keyed digests only; never persist raw email addresses or client IPs here.
-- This migration does not enable login or establish proxy trust.
BEGIN;

CREATE TABLE auth_rate_limit_buckets (
  bucket_type text NOT NULL CHECK (bucket_type IN ('account', 'network')),
  key_hash bytea NOT NULL CHECK (octet_length(key_hash) = 32),
  window_started_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_type, key_hash),
  CHECK (blocked_until IS NULL OR blocked_until >= window_started_at)
);

CREATE INDEX auth_rate_limit_cleanup_idx
  ON auth_rate_limit_buckets(updated_at);

COMMENT ON TABLE auth_rate_limit_buckets IS
  'Mutable login throttling counters keyed by HMAC-SHA-256 digests; raw account identifiers and client addresses are not stored.';
COMMENT ON COLUMN auth_rate_limit_buckets.key_hash IS
  'HMAC-SHA-256 digest using an application secret held outside the database.';

COMMIT;
