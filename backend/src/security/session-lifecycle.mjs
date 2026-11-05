import { createSessionToken, hashSessionToken } from "./session.mjs";

/**
 * Atomically replace one active session with a fresh opaque token.
 * The old token is revoked before the replacement is committed; only token
 * digests are written to PostgreSQL. A failed audit write rolls back rotation.
 */
export async function rotateSession({ pool, token, maxAgeSeconds = 3600 } = {}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new TypeError("A database pool with connect() is required");
  }
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 604800) {
    throw new RangeError("maxAgeSeconds must be between 1 and 604800");
  }

  let previousHash;
  try {
    previousHash = hashSessionToken(token);
  } catch {
    return null;
  }

  const replacement = createSessionToken();
  const client = await pool.connect();
  let transactionOpen = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;

    const revoked = await client.query(
      `UPDATE auth_sessions
       SET revoked_at = now(), revoke_reason = 'rotated'
       WHERE token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > now()
       RETURNING user_id`,
      [previousHash],
    );
    const userId = revoked.rows?.[0]?.user_id;
    if (typeof userId !== "string") {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return null;
    }

    const inserted = await client.query(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + ($3::integer * interval '1 second'))
       RETURNING id, expires_at`,
      [userId, replacement.tokenHash, maxAgeSeconds],
    );
    const session = inserted.rows?.[0];
    if (!session) throw new Error("Replacement session was not persisted");

    await client.query(
      `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'auth.session_rotated', 'auth_session', $2, $3::jsonb)`,
      [userId, String(session.id), JSON.stringify({ reason: "scheduled_rotation" })],
    );

    await client.query("COMMIT");
    transactionOpen = false;
    return {
      token: replacement.token,
      expiresAt: session.expires_at,
    };
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original database error; the connection is released below.
      }
    }
    throw error;
  } finally {
    client.release();
  }
}
