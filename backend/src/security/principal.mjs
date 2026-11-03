import { hashSessionToken, readSessionCookie } from "./session.mjs";

/**
 * Resolve an active server-side session into trusted database-backed grants.
 * Client-supplied identity, roles, and scopes are never consulted.
 */
export function createPrincipalResolver({ pool } = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A database pool with query() is required");
  }

  return async function resolvePrincipal(req) {
    const token = readSessionCookie(req?.headers?.cookie);
    if (!token) return null;

    let tokenHash;
    try {
      tokenHash = hashSessionToken(token);
    } catch {
      return null;
    }

    const result = await pool.query(
      `WITH active_session AS (
         SELECT u.id, u.account_status
         FROM auth_sessions s
         JOIN app_users u ON u.id = s.user_id
         WHERE s.token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > now()
           AND u.account_status = 'active'
         LIMIT 1
       )
       SELECT a.id, a.account_status, r.code AS role_code,
              'global'::text AS scope_type, NULL::text AS scope_id
       FROM active_session a
       LEFT JOIN user_roles ur ON ur.user_id = a.id
       LEFT JOIN roles r ON r.id = ur.role_id
       UNION ALL
       SELECT a.id, a.account_status, r.code AS role_code,
              g.scope_type, g.scope_id
       FROM active_session a
       JOIN user_role_grants g ON g.user_id = a.id AND g.revoked_at IS NULL
       JOIN roles r ON r.id = g.role_id`,
      [tokenHash],
    );

    const rows = result.rows ?? [];
    if (rows.length === 0) return null;

    const first = rows[0];
    if (first.account_status !== "active" || typeof first.id !== "string") return null;

    const grants = [];
    const seen = new Set();
    for (const row of rows) {
      if (typeof row.role_code !== "string") continue;
      const grant = {
        roleCode: row.role_code,
        scopeType: row.scope_type,
        ...(row.scope_id ? { scopeId: row.scope_id } : {}),
      };
      const key = `${grant.roleCode}:${grant.scopeType}:${grant.scopeId ?? ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        grants.push(grant);
      }
    }

    return { id: first.id, accountStatus: first.account_status, grants };
  };
}
