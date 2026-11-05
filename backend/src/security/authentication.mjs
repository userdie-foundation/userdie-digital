import { verifyPassword } from "./password.mjs";
import { createSessionToken } from "./session.mjs";

const DEFAULT_SESSION_SECONDS = 8 * 60 * 60;
// Valid, non-user verifier used to equalize scrypt work for unknown/inactive
// accounts. Its random salt and derived key are public and cannot authenticate.
const DUMMY_PASSWORD_HASH = "scrypt$32768$8$1$ih3pg5cXAgRg1Zzyto3dsQ$KZywyEx1FZserQknQ0eHzt82tkGSs3NbhLUfr28Lomsxgrqma0K0j0F7T8JX3XeWK_LIcaADVgolnPEx7Aqmjg";
const isUsablePasswordHash = (value) => typeof value === "string" &&
  /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/.test(value);

function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * Authenticate an account and persist a server-side session.
 * The caller must supply the socket peer address, never an untrusted proxy header.
 * This service intentionally does not create accounts or grant roles.
 */
export function createAuthenticationService({
  pool,
  rateLimiter,
  sessionTtlSeconds = DEFAULT_SESSION_SECONDS,
  verify = verifyPassword,
} = {}) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw new TypeError("A PostgreSQL pool with query() and connect() is required");
  }
  if (!rateLimiter || typeof rateLimiter.isBlocked !== "function" ||
      typeof rateLimiter.recordFailure !== "function" ||
      typeof rateLimiter.clearAccountFailures !== "function") {
    throw new TypeError("A configured login rate limiter is required");
  }
  if (!Number.isSafeInteger(sessionTtlSeconds) || sessionTtlSeconds < 300 || sessionTtlSeconds > 604800) {
    throw new RangeError("sessionTtlSeconds must be between 300 and 604800");
  }
  if (typeof verify !== "function") throw new TypeError("verify must be a function");

  return {
    async authenticate({ email: rawEmail, password, clientAddress } = {}) {
      const email = normalizeEmail(rawEmail);
      if (!email || typeof password !== "string" || Buffer.byteLength(password, "utf8") > 1024 ||
          typeof clientAddress !== "string") {
        return { ok: false, reason: "invalid_credentials" };
      }

      if (await rateLimiter.isBlocked({ email, clientAddress })) {
        return { ok: false, reason: "temporarily_blocked" };
      }

      const result = await pool.query(
        `SELECT id, password_hash, account_status
         FROM app_users
         WHERE lower(email) = $1
         LIMIT 1`,
        [email],
      );
      const user = result.rows?.[0];
      // Always perform one scrypt verification, including unknown, inactive,
      // and malformed-password-hash accounts, to reduce account enumeration
      // through response-time differences.
      const passwordHash = isUsablePasswordHash(user?.password_hash)
        ? user.password_hash
        : DUMMY_PASSWORD_HASH;
      const validPassword = await verify(password, passwordHash);

      if (!user || user.account_status !== "active" || !validPassword) {
        const failure = await rateLimiter.recordFailure({ email, clientAddress });
        return {
          ok: false,
          reason: failure?.blocked ? "temporarily_blocked" : "invalid_credentials",
        };
      }

      await rateLimiter.clearAccountFailures({ email });

      const session = createSessionToken();
      const client = await pool.connect();
      let transactionOpen = false;
      try {
        await client.query("BEGIN");
        transactionOpen = true;
        const inserted = await client.query(
          `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
           VALUES ($1, $2, now() + ($3::integer * interval '1 second'))
           RETURNING expires_at`,
          [user.id, session.tokenHash, sessionTtlSeconds],
        );
        const expiresAt = inserted.rows?.[0]?.expires_at;
        if (!expiresAt) throw new Error("Session persistence failed");
        await client.query(
          `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
           VALUES ($1, 'auth.login_succeeded', 'user', $1::text, $2::jsonb)`,
          [user.id, JSON.stringify({ authentication: "password" })],
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return { ok: true, token: session.token, expiresAt };
      } catch (error) {
        if (transactionOpen) {
          try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
