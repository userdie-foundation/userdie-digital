import { createHash, randomBytes } from "node:crypto";
import { hashPassword } from "./password.mjs";

const TOKEN_TTL_SECONDS = 30 * 60;
const GENERIC_RESULT = Object.freeze({ accepted: true });

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length >= 3 && email.length <= 320 &&
    /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) ? email : null;
}

function tokenDigest(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHash("sha256").update(token, "utf8").digest();
}

/**
 * Password recovery core. The caller supplies a trusted mail-delivery adapter;
 * no route or production delivery is enabled by this module alone.
 */
export function createAccountRecoveryService({
  pool,
  sendRecoveryMessage,
  tokenTtlSeconds = TOKEN_TTL_SECONDS,
} = {}) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw new TypeError("A PostgreSQL pool with query() and connect() is required");
  }
  if (typeof sendRecoveryMessage !== "function") {
    throw new TypeError("A configured recovery-message delivery adapter is required");
  }
  if (!Number.isSafeInteger(tokenTtlSeconds) || tokenTtlSeconds < 300 || tokenTtlSeconds > 3600) {
    throw new RangeError("tokenTtlSeconds must be between 300 and 3600");
  }

  return {
    async request({ email: rawEmail } = {}) {
      const email = normalizeEmail(rawEmail);
      if (!email) return GENERIC_RESULT;
      const found = await pool.query(
        "SELECT id, email FROM app_users WHERE lower(email) = $1 AND account_status = 'active' LIMIT 1",
        [email],
      );
      const user = found.rows?.[0];
      if (!user) return GENERIC_RESULT;

      const token = randomBytes(32).toString("base64url");
      const digest = tokenDigest(token);
      const client = await pool.connect();
      let open = false;
      try {
        await client.query("BEGIN");
        open = true;
        await client.query(
          "UPDATE auth_recovery_tokens SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL",
          [user.id],
        );
        const inserted = await client.query(
          "INSERT INTO auth_recovery_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3::integer * interval '1 second')) RETURNING id",
          [user.id, digest, tokenTtlSeconds],
        );
        const tokenId = inserted.rows?.[0]?.id;
        if (!tokenId) throw new Error("Recovery token was not persisted");
        await client.query(
          "INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, 'auth.recovery_requested', 'user', $1::text, $2::jsonb)",
          [user.id, JSON.stringify({ tokenId: String(tokenId) })],
        );
        await client.query("COMMIT");
        open = false;
      } catch (error) {
        if (open) {
          try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
        }
        throw error;
      } finally {
        client.release();
      }

      // Delivery is intentionally outside the DB transaction. The raw token is
      // passed only to the trusted adapter and never returned from this service.
      await sendRecoveryMessage({ email: user.email, token, expiresInSeconds: tokenTtlSeconds });
      return GENERIC_RESULT;
    },

    async consume({ token, newPassword } = {}) {
      const digest = tokenDigest(token);
      if (!digest || typeof newPassword !== "string") return { reset: false };
      // Reject weak passwords before opening a transaction.
      try { await hashPassword(newPassword); } catch { return { reset: false }; }
      const passwordHash = await hashPassword(newPassword);
      const client = await pool.connect();
      let open = false;
      try {
        await client.query("BEGIN");
        open = true;
        const selected = await client.query(
          "SELECT id, user_id FROM auth_recovery_tokens WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now() FOR UPDATE",
          [digest],
        );
        const recovery = selected.rows?.[0];
        if (!recovery) {
          await client.query("ROLLBACK");
          open = false;
          return { reset: false };
        }
        await client.query(
          "UPDATE app_users SET password_hash = $1, updated_at = now() WHERE id = $2 AND account_status = 'active'",
          [passwordHash, recovery.user_id],
        );
        await client.query(
          "UPDATE auth_recovery_tokens SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL",
          [recovery.id],
        );
        await client.query(
          "UPDATE auth_sessions SET revoked_at = now(), revoke_reason = 'password_reset' WHERE user_id = $1 AND revoked_at IS NULL",
          [recovery.user_id],
        );
        await client.query(
          "INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata) VALUES ($1, 'auth.password_reset_completed', 'user', $1::text, '{}'::jsonb)",
          [recovery.user_id],
        );
        await client.query("COMMIT");
        open = false;
        return { reset: true };
      } catch (error) {
        if (open) {
          try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
