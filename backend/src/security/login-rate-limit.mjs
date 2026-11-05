import { createHmac } from "node:crypto";
import { isIP } from "node:net";

const BUCKET_TYPES = ["account", "network"];

function digestIdentifier(secret, type, value) {
  return createHmac("sha256", secret)
    .update(type, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest();
}

function normalizeEmail(value) {
  if (typeof value !== "string") throw new TypeError("Email is required");
  const normalized = value.trim().toLowerCase();
  if (normalized.length < 3 || normalized.length > 320 || !normalized.includes("@")) {
    throw new TypeError("Email is invalid");
  }
  return normalized;
}

function validateAddress(value) {
  if (typeof value !== "string" || isIP(value) === 0) {
    throw new TypeError("A verified client network address is required");
  }
  return value;
}

/**
 * PostgreSQL-backed login throttling. Pass the socket peer address from the
 * HTTP server; do not pass an untrusted X-Forwarded-For value.
 * Only HMAC digests are stored. Keep hmacKey outside source control and rotate
 * it only with an explicit operational plan because rotation resets buckets.
 */
export function createLoginRateLimiter({
  pool,
  hmacKey,
  maxAttempts = 5,
  windowSeconds = 900,
  blockSeconds = 900,
} = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A database pool with query() is required");
  }
  const secret = Buffer.isBuffer(hmacKey)
    ? Buffer.from(hmacKey)
    : typeof hmacKey === "string" ? Buffer.from(hmacKey, "utf8") : null;
  if (!secret || secret.length < 32) {
    throw new TypeError("hmacKey must contain at least 32 bytes");
  }
  for (const [name, value, min, max] of [
    ["maxAttempts", maxAttempts, 2, 100],
    ["windowSeconds", windowSeconds, 30, 86400],
    ["blockSeconds", blockSeconds, 30, 86400],
  ]) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new RangeError(`${name} is outside the permitted range`);
    }
  }

  function buckets(email, clientAddress) {
    const normalizedEmail = normalizeEmail(email);
    const address = validateAddress(clientAddress);
    return [
      { type: "account", hash: digestIdentifier(secret, "account", normalizedEmail) },
      { type: "network", hash: digestIdentifier(secret, "network", address) },
    ];
  }

  return {
    async isBlocked({ email, clientAddress } = {}) {
      const keys = buckets(email, clientAddress);
      for (const key of keys) {
        const result = await pool.query(
          "SELECT blocked_until > now() AS blocked FROM auth_rate_limit_buckets WHERE bucket_type = $1 AND key_hash = $2 LIMIT 1",
          [key.type, key.hash],
        );
        if (result.rows?.[0]?.blocked === true) return true;
      }
      return false;
    },

    async recordFailure({ email, clientAddress } = {}) {
      const keys = buckets(email, clientAddress);
      let blocked = false;
      for (const key of keys) {
        const result = await pool.query(
          `INSERT INTO auth_rate_limit_buckets
             (bucket_type, key_hash, window_started_at, attempt_count)
           VALUES ($1, $2, now(), 1)
           ON CONFLICT (bucket_type, key_hash) DO UPDATE SET
             attempt_count = CASE
               WHEN auth_rate_limit_buckets.window_started_at <= now() - ($3::integer * interval '1 second') THEN 1
               ELSE LEAST(auth_rate_limit_buckets.attempt_count + 1, 2147483647)
             END,
             window_started_at = CASE
               WHEN auth_rate_limit_buckets.window_started_at <= now() - ($3::integer * interval '1 second') THEN now()
               ELSE auth_rate_limit_buckets.window_started_at
             END,
             blocked_until = CASE
               WHEN auth_rate_limit_buckets.blocked_until > now() THEN auth_rate_limit_buckets.blocked_until
               WHEN auth_rate_limit_buckets.window_started_at <= now() - ($3::integer * interval '1 second') THEN NULL
               WHEN auth_rate_limit_buckets.attempt_count + 1 >= $4::integer
                 THEN now() + ($5::integer * interval '1 second')
               ELSE NULL
             END,
             updated_at = now()
           RETURNING blocked_until > now() AS blocked`,
          [key.type, key.hash, windowSeconds, maxAttempts, blockSeconds],
        );
        blocked ||= result.rows?.[0]?.blocked === true;
      }
      return { blocked };
    },

    async clearAccountFailures({ email } = {}) {
      const normalizedEmail = normalizeEmail(email);
      const hash = digestIdentifier(secret, "account", normalizedEmail);
      await pool.query(
        "DELETE FROM auth_rate_limit_buckets WHERE bucket_type = 'account' AND key_hash = $1",
        [hash],
      );
    },
  };
}
