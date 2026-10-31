import { isAuthorized } from "./security/authorization.mjs";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

function sendJson(res, status, body, method = "GET") {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(method === "HEAD" ? undefined : JSON.stringify(body));
}

function createApplicationRepository(pool) {
  return {
    async getById(id) {
      const result = await pool.query(
        "SELECT id, applicant_id, assigned_to, program_id, status, subject FROM applications WHERE id = $1 LIMIT 1",
        [id],
      );
      const row = result.rows?.[0];
      if (!row) return null;
      return {
        id: row.id,
        applicantId: row.applicant_id,
        assignedTo: row.assigned_to,
        programId: row.program_id,
        status: row.status,
        subject: row.subject,
        // Partner sharing is intentionally unavailable until its persistence
        // model and governance rules are reviewed and migrated.
        sharedWithPrincipalIds: [],
      };
    },
  };
}

/**
 * resolvePrincipal must verify a server-side session and load account status
 * and grants from trusted storage. Never trust role/user/scope claims supplied
 * by request headers, query parameters, or request bodies.
 *
 * The production entry point currently omits this resolver; protected routes
 * therefore remain unavailable (401) until authentication is implemented.
 */
export function createServer({ pool, allowedOrigin, resolvePrincipal, applicationRepository } = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A database pool with query() is required");
  }
  const applications = applicationRepository ?? createApplicationRepository(pool);

  return async function handleRequest(req, res) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(name, value);
    }

    if (allowedOrigin && req.headers.origin === allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      res.setHeader("Vary", "Origin");
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "method_not_allowed" }, req.method);
    }

    if (url.pathname === "/api/v1/health/live") {
      return sendJson(res, 200, { status: "ok" }, req.method);
    }

    if (url.pathname === "/api/v1/health/ready") {
      try {
        await pool.query("SELECT 1");
        return sendJson(res, 200, { status: "ready" }, req.method);
      } catch {
        return sendJson(res, 503, { status: "unavailable" }, req.method);
      }
    }

    const applicationMatch = url.pathname.match(/^\/api\/v1\/applications\/([^/]+)$/);
    if (applicationMatch) {
      if (typeof resolvePrincipal !== "function") {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }

      let principal;
      try {
        principal = await resolvePrincipal(req);
      } catch {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      if (!principal) {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }

      let application;
      try {
        application = await applications.getById(decodeURIComponent(applicationMatch[1]));
      } catch {
        return sendJson(res, 503, { error: "applications_unavailable" }, req.method);
      }

      // Identical response for missing and unauthorized records reduces ID probing.
      if (!application || !isAuthorized({
        principal,
        permission: "applications:read",
        resource: application,
      })) {
        return sendJson(res, 404, { error: "not_found" }, req.method);
      }

      return sendJson(res, 200, {
        application: {
          id: application.id,
          programId: application.programId,
          status: application.status,
          subject: application.subject,
        },
      }, req.method);
    }

    if (url.pathname === "/api/v1/applications") {
      return sendJson(res, 503, { error: "applications_module_unavailable" }, req.method);
    }

    return sendJson(res, 404, { error: "not_found" }, req.method);
  };
}
