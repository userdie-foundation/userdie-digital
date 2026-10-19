const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(body));
}

export function createServer({ pool, allowedOrigin } = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A database pool with query() is required");
  }

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
      return sendJson(res, 405, { error: "method_not_allowed" });
    }

    if (url.pathname === "/api/v1/health/live") {
      return sendJson(res, 200, { status: "ok" });
    }

    if (url.pathname === "/api/v1/health/ready") {
      try {
        await pool.query("SELECT 1");
        return sendJson(res, 200, { status: "ready" });
      } catch {
        return sendJson(res, 503, { status: "unavailable" });
      }
    }

    return sendJson(res, 404, { error: "not_found" });
  };
}
