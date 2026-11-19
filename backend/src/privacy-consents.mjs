import { isValidPrincipal } from "./security/authorization.mjs";

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

function respond(res, status, body, method = "GET") {
  res.writeHead(status, { ...HEADERS, "Content-Type": "application/json; charset=utf-8" });
  res.end(method === "HEAD" ? undefined : JSON.stringify(body));
}

async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.["content-type"] ?? "")) {
    return { error: "unsupported_media_type" };
  }
  let body = "";
  let size = 0;
  try {
    for await (const chunk of req) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += part.length;
      if (size > 8192) return { error: "payload_too_large" };
      body += part.toString("utf8");
    }
  } catch {
    return { error: "invalid_request_body" };
  }
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "invalid_request_body" };
    return { value };
  } catch {
    return { error: "invalid_request_body" };
  }
}

function validChoices(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length > 0 && entries.length <= 16 &&
    entries.every(([key, selected]) => /^[a-z][a-z0-9_]{1,39}$/.test(key) && typeof selected === "boolean") &&
    entries.some(([, selected]) => selected === true);
}

export function isPrivacyConsentRoute(pathname) {
  return pathname === "/api/v1/privacy/consents" ||
    /^\/api\/v1\/privacy\/consents\/[a-z][a-z0-9_]{2,63}\/withdraw$/.test(pathname);
}

export function isPrivacyConsentMethodAllowed(method, pathname) {
  if (pathname === "/api/v1/privacy/consents") return ["GET", "POST"].includes(method);
  return method === "POST" && /^\/api\/v1\/privacy\/consents\/[a-z][a-z0-9_]{2,63}\/withdraw$/.test(pathname);
}

async function resolveSubject(req, resolver) {
  if (typeof resolver !== "function") return null;
  try {
    const principal = await resolver(req);
    return isValidPrincipal(principal) ? principal : null;
  } catch {
    return null;
  }
}

export async function handlePrivacyConsentRequest({
  req, res, url, pool, principalResolver, enabled = false,
} = {}) {
  const pathname = url.pathname;
  if (!isPrivacyConsentRoute(pathname)) return false;
  if (!isPrivacyConsentMethodAllowed(req.method, pathname)) {
    res.setHeader("Allow", pathname === "/api/v1/privacy/consents" ? "GET, POST" : "POST");
    respond(res, 405, { error: "method_not_allowed" }, req.method);
    return true;
  }
  if (!enabled) {
    respond(res, 503, { error: "privacy_consent_ledger_disabled" }, req.method);
    return true;
  }

  const subject = await resolveSubject(req, principalResolver);
  if (!subject) {
    respond(res, 401, { error: "authentication_required" }, req.method);
    return true;
  }

  if (req.method === "GET") {
    try {
      const result = await pool.query(
        `SELECT e.id, d.document_code, d.document_version, d.consent_type,
                d.purpose_code, e.event_type, e.choices, e.previous_event_id, e.occurred_at
         FROM privacy_consent_events e
         JOIN privacy_consent_documents d ON d.id = e.document_id
         WHERE e.subject_user_id = $1
         ORDER BY e.occurred_at DESC, e.id DESC
         LIMIT 100`,
        [subject.id],
      );
      respond(res, 200, { events: result.rows ?? [] }, req.method);
    } catch {
      respond(res, 503, { error: "privacy_consent_service_unavailable" }, req.method);
    }
    return true;
  }

  const withdrawal = pathname.match(/^\/api\/v1\/privacy\/consents\/([a-z][a-z0-9_]{2,63})\/withdraw$/);
  if (withdrawal) {
    const documentCode = withdrawal[1];
    let client;
    try {
      if (typeof pool.connect !== "function") throw new TypeError("transaction support required");
      client = await pool.connect();
      await client.query("BEGIN");
      await client.query("SELECT id FROM app_users WHERE id = $1 FOR UPDATE", [subject.id]);
      const latest = await client.query(
        `SELECT e.id, e.event_type, d.id AS document_id
         FROM privacy_consent_events e
         JOIN privacy_consent_documents d ON d.id = e.document_id
         WHERE e.subject_user_id = $1 AND d.document_code = $2
         ORDER BY e.occurred_at DESC, e.id DESC
         LIMIT 1`,
        [subject.id, documentCode],
      );
      const event = latest.rows?.[0];
      if (!event || event.event_type !== "granted") {
        await client.query("ROLLBACK");
        respond(res, 409, { error: "active_consent_not_found" }, req.method);
        return true;
      }
      const inserted = await client.query(
        `INSERT INTO privacy_consent_events
           (document_id, subject_user_id, actor_user_id, event_type, choices, previous_event_id)
         VALUES ($1, $2, $2, 'withdrawn', '{}'::jsonb, $3)
         RETURNING id, event_type, occurred_at`,
        [event.document_id, subject.id, event.id],
      );
      await client.query(
        `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'privacy.consent_withdrawn', 'privacy_consent', $2, $3::jsonb)`,
        [subject.id, inserted.rows[0].id, JSON.stringify({ documentCode })],
      );
      await client.query("COMMIT");
      respond(res, 201, { event: inserted.rows[0] }, req.method);
    } catch {
      try { await client?.query("ROLLBACK"); } catch { /* keep generic failure */ }
      respond(res, 503, { error: "privacy_consent_service_unavailable" }, req.method);
    } finally {
      client?.release();
    }
    return true;
  }

  const parsed = await readBody(req);
  if (parsed.error) {
    const status = parsed.error === "payload_too_large" ? 413 :
      parsed.error === "unsupported_media_type" ? 415 : 400;
    respond(res, status, { error: parsed.error }, req.method);
    return true;
  }
  const body = parsed.value;
  const keys = Object.keys(body).sort();
  if (keys.join(",") !== ["choices", "documentCode", "documentVersion"].sort().join(",") ||
      typeof body.documentCode !== "string" || !/^[a-z][a-z0-9_]{2,63}$/.test(body.documentCode) ||
      typeof body.documentVersion !== "string" || !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(body.documentVersion) ||
      !validChoices(body.choices)) {
    respond(res, 400, { error: "invalid_consent_payload" }, req.method);
    return true;
  }

  let client;
  try {
    if (typeof pool.connect !== "function") throw new TypeError("transaction support required");
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SELECT id FROM app_users WHERE id = $1 FOR UPDATE", [subject.id]);
    const document = await client.query(
      `SELECT id, document_code, document_version, consent_type, purpose_code, document_sha256
       FROM privacy_consent_documents
       WHERE document_code = $1 AND document_version = $2 AND revoked_at IS NULL
       LIMIT 1`,
      [body.documentCode, body.documentVersion],
    );
    const approved = document.rows?.[0];
    if (!approved) {
      await client.query("ROLLBACK");
      respond(res, 409, { error: "approved_consent_document_not_found" }, req.method);
      return true;
    }
    const latest = await client.query(
      `SELECT e.event_type
       FROM privacy_consent_events e
       WHERE e.subject_user_id = $1 AND e.document_id = $2
       ORDER BY e.occurred_at DESC, e.id DESC
       LIMIT 1`,
      [subject.id, approved.id],
    );
    if (latest.rows?.[0]?.event_type === "granted") {
      await client.query("ROLLBACK");
      respond(res, 409, { error: "consent_already_active" }, req.method);
      return true;
    }
    const inserted = await client.query(
      `INSERT INTO privacy_consent_events
         (document_id, subject_user_id, actor_user_id, event_type, choices)
       VALUES ($1, $2, $2, 'granted', $3::jsonb)
       RETURNING id, event_type, occurred_at`,
      [approved.id, subject.id, JSON.stringify(body.choices)],
    );
    await client.query(
      `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'privacy.consent_granted', 'privacy_consent', $2, $3::jsonb)`,
      [subject.id, inserted.rows[0].id, JSON.stringify({
        documentCode: approved.document_code,
        documentVersion: approved.document_version,
        documentSha256: approved.document_sha256,
        consentType: approved.consent_type,
        purposeCode: approved.purpose_code,
      })],
    );
    await client.query("COMMIT");
    respond(res, 201, { event: inserted.rows[0] }, req.method);
  } catch {
    try { await client?.query("ROLLBACK"); } catch { /* keep generic failure */ }
    respond(res, 503, { error: "privacy_consent_service_unavailable" }, req.method);
  } finally {
    client?.release();
  }
  return true;
}
