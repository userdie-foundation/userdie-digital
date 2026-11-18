import { createHash } from "node:crypto";
import {
  persistAnalyticalDocumentPdf,
  readStoredAnalyticalDocumentPdf,
  removeStoredAnalyticalDocumentPdf,
  renderAnalyticalDocumentPdf,
} from "./analytical-document-pdf.mjs";

const ROOT = "/api/v1/analytical-documents";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set(["asset_analysis", "preliminary_valuation", "investment_analysis", "capital_structure_analysis"]);
const CONTOURS = new Set(["foundation", "assets", "analytics"]);
const DECISIONS = new Set(["approved", "changes_requested"]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function serializeContent(content) {
  return JSON.stringify(stableValue(content));
}

function hasGrant(principal, roleCode, scopeType, scopeId) {
  return principal.grants.some((grant) =>
    grant?.roleCode === roleCode && grant.scopeType === scopeType &&
    (scopeType === "global" || grant.scopeId === scopeId)
  );
}

function canCreate(principal, contour = "assets") {
  return hasGrant(principal, "administrator", "global") ||
    hasGrant(principal, "asset_valuator", "global") ||
    (contour === "assets" && hasGrant(principal, "asset_valuator", "contour", "assets"));
}

function canReview(principal) {
  return hasGrant(principal, "administrator", "global") ||
    hasGrant(principal, "independent_approver", "global") ||
    hasGrant(principal, "independent_approver", "contour", "assets");
}

function canReadAll(principal) {
  return hasGrant(principal, "administrator", "global") ||
    hasGrant(principal, "auditor", "global") ||
    hasGrant(principal, "asset_valuator", "global");
}

function canReadDocument(principal, document) {
  const scopedAssetReader = document.organizational_contour === "assets" &&
    hasGrant(principal, "asset_valuator", "contour", "assets");
  return canReadAll(principal) || scopedAssetReader ||
    document.created_by === principal.id || document.assigned_reviewer_id === principal.id;
}

async function readBody(req, maxBytes = 65536) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers?.["content-type"] ?? "")) {
    return { error: "unsupported_media_type" };
  }
  let body = "";
  let size = 0;
  try {
    for await (const chunk of req) {
      const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += part.length;
      if (size > maxBytes) return { error: "payload_too_large" };
      body += part.toString("utf8");
    }
  } catch {
    return { error: "invalid_request_body" };
  }
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value)
      ? { value } : { error: "invalid_request_body" };
  } catch {
    return { error: "invalid_request_body" };
  }
}

function send(res, status, body, method) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(method === "HEAD" ? undefined : JSON.stringify(body));
}

function validContent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try { return Buffer.byteLength(serializeContent(value), "utf8") <= 50000; } catch { return false; }
}

function validRationale(value) {
  return typeof value === "string" && value.trim().length >= 3 && value.length <= 2000;
}

async function inTransaction(pool, operation) {
  if (typeof pool.connect !== "function") throw new TypeError("Transactional database connection required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function appendEvent(client, { documentId, versionId = null, actorId, type, previousStatus = null, newStatus = null, details = {} }) {
  await client.query(
    `INSERT INTO analytical_document_events
      (document_id, document_version_id, actor_id, event_type, previous_status, new_status, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [documentId, versionId, actorId, type, previousStatus, newStatus, JSON.stringify(details)],
  );
  await client.query(
    `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
     VALUES ($1, $2, 'analytical_document', $3, $4::jsonb)`,
    [actorId, `analytical_document.${type}`, documentId, JSON.stringify(details)],
  );
}

async function resolvePrincipal(req, resolver) {
  if (typeof resolver !== "function") return null;
  try {
    const principal = await resolver(req);
    return principal && typeof principal.id === "string" &&
      principal.accountStatus === "active" && Array.isArray(principal.grants)
      ? principal : null;
  } catch {
    return null;
  }
}

export function isAnalyticalDocumentRoute(pathname) {
  return pathname === ROOT ||
    /^\/api\/v1\/analytical-documents\/[0-9a-f-]{36}(?:\/(?:versions|submit|decision|issue|pdf))?$/i.test(pathname);
}

export function isAnalyticalDocumentMethodAllowed(method, pathname) {
  if (pathname === ROOT) return method === "GET" || method === "HEAD" || method === "POST";
  const match = pathname.match(/^\/api\/v1\/analytical-documents\/([0-9a-f-]{36})(?:\/(versions|submit|decision|issue|pdf))?$/i);
  if (!match || !UUID.test(match[1])) return false;
  const action = match[2];
  if (!action) return method === "GET" || method === "HEAD";
  if (action === "pdf") return method === "GET" || method === "HEAD";
  return method === "POST";
}

export async function handleAnalyticalDocumentRequest({ req, res, url, pool, principalResolver, pdfStorageDirectory, pdfFontRegularPath, pdfFontBoldPath }) {
  const pathname = url.pathname;
  if (!isAnalyticalDocumentRoute(pathname)) return false;

  const method = req.method ?? "GET";
  if (!isAnalyticalDocumentMethodAllowed(method, pathname)) {
    res.setHeader("Allow", pathname === ROOT ? "GET, HEAD, POST" : "GET, HEAD, POST");
    send(res, 405, { error: "method_not_allowed" }, method);
    return true;
  }

  const principal = await resolvePrincipal(req, principalResolver);
  if (!principal) {
    send(res, 401, { error: "authentication_required" }, method);
    return true;
  }

  if (pathname === ROOT && (method === "GET" || method === "HEAD")) {
    const limitValue = url.searchParams.get("limit");
    const limit = limitValue === null ? 25 : Number(limitValue);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      send(res, 400, { error: "invalid_limit" }, method);
      return true;
    }
    try {
      const result = await pool.query(
        `SELECT id, document_number, document_type, organizational_contour,
                asset_reference, title, status, created_by, assigned_reviewer_id,
                approved_by, approved_at, issued_at, created_at, updated_at
         FROM analytical_documents
         WHERE ($1::boolean OR ($2::boolean AND organizational_contour = 'assets')
           OR created_by = $3::uuid OR assigned_reviewer_id = $3::uuid)
         ORDER BY updated_at DESC, id DESC
         LIMIT $4`,
        [canReadAll(principal), hasGrant(principal, "asset_valuator", "contour", "assets"), principal.id, limit],
      );
      const documents = (result.rows ?? []).map((row) => ({
        id: row.id, documentNumber: row.document_number, documentType: row.document_type,
        organizationalContour: row.organizational_contour, assetReference: row.asset_reference,
        title: row.title, status: row.status, createdBy: row.created_by,
        assignedReviewerId: row.assigned_reviewer_id, approvedBy: row.approved_by,
        approvedAt: row.approved_at, issuedAt: row.issued_at,
        createdAt: row.created_at, updatedAt: row.updated_at,
      }));
      send(res, 200, { documents, count: documents.length }, method);
    } catch {
      send(res, 503, { error: "analytical_documents_unavailable" }, method);
    }
    return true;
  }

  if (pathname === ROOT && method === "POST") {
    if (!canCreate(principal)) {
      send(res, 403, { error: "analytical_document_create_denied" }, method);
      return true;
    }
    const parsed = await readBody(req);
    if (parsed.error) {
      const status = parsed.error === "payload_too_large" ? 413 : parsed.error === "unsupported_media_type" ? 415 : 400;
      send(res, status, { error: parsed.error }, method);
      return true;
    }
    const body = parsed.value;
    const allowed = new Set(["documentType", "organizationalContour", "assetReference", "title", "reviewerId", "content"]);
    if (Object.keys(body).some((key) => !allowed.has(key)) ||
        !TYPES.has(body.documentType) || !CONTOURS.has(body.organizationalContour) || !canCreate(principal, body.organizationalContour) ||
        typeof body.title !== "string" || body.title.trim().length < 3 || body.title.trim().length > 240 ||
        !UUID.test(body.reviewerId ?? "") || body.reviewerId === principal.id ||
        (body.assetReference !== undefined && body.assetReference !== null &&
          (typeof body.assetReference !== "string" || body.assetReference.trim().length < 1 || body.assetReference.trim().length > 128)) ||
        !validContent(body.content)) {
      send(res, 400, { error: "invalid_analytical_document" }, method);
      return true;
    }
    try {
      const reviewer = await pool.query(
        `SELECT 1
         FROM app_users u
         WHERE u.id = $1::uuid AND u.account_status = 'active'
           AND (
             EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                     WHERE ur.user_id = u.id AND r.code = 'independent_approver')
             OR EXISTS (SELECT 1 FROM user_role_grants g JOIN roles r ON r.id = g.role_id
                        WHERE g.user_id = u.id AND g.revoked_at IS NULL
                          AND r.code = 'independent_approver'
                          AND g.scope_type = 'contour' AND g.scope_id = 'assets')
           )
         LIMIT 1`,
        [body.reviewerId],
      );
      if (!reviewer.rows?.length) {
        send(res, 400, { error: "invalid_reviewer_assignment" }, method);
        return true;
      }
      const content = serializeContent(body.content);
      const digest = createHash("sha256").update(content, "utf8").digest("hex");
      const created = await inTransaction(pool, async (client) => {
        const doc = await client.query(
          `INSERT INTO analytical_documents
            (document_type, organizational_contour, asset_reference, title, created_by, assigned_reviewer_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, status, created_at`,
          [body.documentType, body.organizationalContour, body.assetReference?.trim() || null,
            body.title.trim(), principal.id, body.reviewerId],
        );
        const row = doc.rows[0];
        const version = await client.query(
          `INSERT INTO analytical_document_versions
            (document_id, version_number, content, content_sha256, created_by)
           VALUES ($1, 1, $2::jsonb, $3, $4)
           RETURNING id, version_number, content_sha256, created_at`,
          [row.id, content, digest, principal.id],
        );
        await appendEvent(client, {
          documentId: row.id, versionId: version.rows[0].id, actorId: principal.id,
          type: "draft_created", newStatus: "draft",
          details: { documentType: body.documentType, organizationalContour: body.organizationalContour },
        });
        return { id: row.id, status: row.status, createdAt: row.created_at, version: version.rows[0] };
      });
      send(res, 201, {
        document: { id: created.id, status: created.status, createdAt: created.createdAt },
        version: { id: created.version.id, number: created.version.version_number, sha256: created.version.content_sha256 },
      }, method);
    } catch {
      send(res, 503, { error: "analytical_document_write_unavailable" }, method);
    }
    return true;
  }

  const match = pathname.match(/^\/api\/v1\/analytical-documents\/([0-9a-f-]{36})(?:\/(versions|submit|decision|issue|pdf))?$/i);
  if (!match || !UUID.test(match[1])) {
    send(res, 404, { error: "not_found" }, method);
    return true;
  }
  const documentId = match[1];
  const action = match[2] ?? null;

  if (!action && (method === "GET" || method === "HEAD")) {
    try {
      const found = await pool.query(
        `SELECT id, document_number, document_type, organizational_contour, asset_reference,
                title, status, created_by, assigned_reviewer_id, approved_by, approved_at,
                issued_at, created_at, updated_at
         FROM analytical_documents d
         LEFT JOIN app_users approver ON approver.id = d.approved_by
         WHERE d.id = $1::uuid LIMIT 1`,
        [documentId],
      );
      const document = found.rows?.[0];
      if (!document || !canReadDocument(principal, document)) {
        send(res, 404, { error: "not_found" }, method);
        return true;
      }
      const [versions, approvals, events] = await Promise.all([
        pool.query(
          `SELECT id, version_number, content, content_sha256, created_by, created_at
           FROM analytical_document_versions WHERE document_id = $1::uuid
           ORDER BY version_number DESC LIMIT 25`, [documentId],
        ),
        pool.query(
          `SELECT id, document_version_id, submitted_by, reviewer_id, status,
                  decision_rationale, submitted_at, decided_at
           FROM analytical_document_approvals WHERE document_id = $1::uuid
           ORDER BY submitted_at DESC LIMIT 25`, [documentId],
        ),
        pool.query(
          `SELECT id, document_version_id, actor_id, event_type, previous_status,
                  new_status, details, created_at
           FROM analytical_document_events WHERE document_id = $1::uuid
           ORDER BY created_at ASC, id ASC LIMIT 100`, [documentId],
        ),
      ]);
      send(res, 200, {
        document: {
          id: document.id, documentNumber: document.document_number, documentType: document.document_type,
          organizationalContour: document.organizational_contour, assetReference: document.asset_reference,
          title: document.title, status: document.status, createdBy: document.created_by,
          assignedReviewerId: document.assigned_reviewer_id, approvedBy: document.approved_by,
          approvedAt: document.approved_at, issuedAt: document.issued_at,
          createdAt: document.created_at, updatedAt: document.updated_at,
        },
        versions: versions.rows ?? [], approvals: approvals.rows ?? [], events: events.rows ?? [],
      }, method);
    } catch {
      send(res, 503, { error: "analytical_document_unavailable" }, method);
    }
    return true;
  }

  if (action === "pdf") {
    if (!pdfStorageDirectory) {
      send(res, 503, { error: "analytical_document_pdf_storage_unavailable" }, method);
      return true;
    }
    try {
      const found = await pool.query(
        `SELECT id, document_number, document_type, organizational_contour,
                asset_reference, title, status, created_by, assigned_reviewer_id,
                approved_by, approver.display_name AS approved_by_name,
                approved_at, issued_at, issued_version_id
         FROM analytical_documents WHERE id = $1::uuid LIMIT 1`,
        [documentId],
      );
      const document = found.rows?.[0];
      if (!document || !canReadDocument(principal, document)) {
        send(res, 404, { error: "not_found" }, method);
        return true;
      }
      if (document.status !== "issued" || !document.issued_version_id) {
        send(res, 409, { error: "analytical_document_not_issued" }, method);
        return true;
      }
      const versionResult = await pool.query(
        `SELECT id, version_number, content, content_sha256, created_by, created_at
         FROM analytical_document_versions
         WHERE document_id = $1::uuid AND id = $2::uuid LIMIT 1`,
        [documentId, document.issued_version_id],
      );
      const version = versionResult.rows?.[0];
      if (!version) {
        send(res, 503, { error: "analytical_document_pdf_source_unavailable" }, method);
        return true;
      }

      let artifactResult = await pool.query(
        `SELECT storage_key, content_sha256, byte_size
         FROM analytical_document_artifacts
         WHERE document_id = $1::uuid AND document_version_id = $2::uuid
           AND artifact_type = 'pdf' LIMIT 1`,
        [documentId, version.id],
      );
      let bytes;
      if (artifactResult.rows?.[0]) {
        bytes = await readStoredAnalyticalDocumentPdf({
          directory: pdfStorageDirectory,
          key: artifactResult.rows[0].storage_key,
          sha256: artifactResult.rows[0].content_sha256,
          byteSize: Number(artifactResult.rows[0].byte_size),
        });
        await pool.query(
          `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
           VALUES ($1, 'analytical_document.pdf_downloaded', 'analytical_document', $2, $3::jsonb)`,
          [principal.id, documentId, JSON.stringify({
            versionId: version.id,
            sha256: artifactResult.rows[0].content_sha256,
          })],
        );
      } else {
        bytes = await renderAnalyticalDocumentPdf({
          document,
          version,
          issuedAt: document.issued_at,
          fontRegularPath: pdfFontRegularPath,
          fontBoldPath: pdfFontBoldPath,
        });
        if (!Buffer.isBuffer(bytes) || bytes.length < 100 || bytes.length > 25000000) {
          throw new Error("Generated PDF size is outside the permitted range");
        }
        const stored = await persistAnalyticalDocumentPdf({ directory: pdfStorageDirectory, bytes });
        try {
          const persisted = await inTransaction(pool, async (client) => {
            const locked = await client.query(
              "SELECT status, issued_version_id FROM analytical_documents WHERE id = $1::uuid FOR UPDATE",
              [documentId],
            );
            if (locked.rows?.[0]?.status !== "issued" ||
                locked.rows[0].issued_version_id !== version.id) {
              throw new Error("The issued analytical document version changed during PDF generation");
            }
            const inserted = await client.query(
              `INSERT INTO analytical_document_artifacts
                (document_id, document_version_id, storage_key, content_sha256,
                 byte_size, generated_by)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (document_id, document_version_id, artifact_type) DO NOTHING
               RETURNING storage_key, content_sha256, byte_size`,
              [documentId, version.id, stored.key, stored.sha256, stored.byteSize, principal.id],
            );
            const artifact = inserted.rows?.[0] ?? (await client.query(
              `SELECT storage_key, content_sha256, byte_size
               FROM analytical_document_artifacts
               WHERE document_id = $1::uuid AND document_version_id = $2::uuid
                 AND artifact_type = 'pdf' LIMIT 1`,
              [documentId, version.id],
            )).rows?.[0];
            if (!artifact) throw new Error("PDF artifact registration failed");
            await client.query(
              `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
               VALUES ($1, 'analytical_document.pdf_generated', 'analytical_document', $2, $3::jsonb)`,
              [principal.id, documentId, JSON.stringify({
                versionId: version.id,
                sha256: artifact.content_sha256,
                byteSize: Number(artifact.byte_size),
              })],
            );
            await client.query(
              `INSERT INTO audit_events (actor_id, action, entity_type, entity_id, metadata)
               VALUES ($1, 'analytical_document.pdf_downloaded', 'analytical_document', $2, $3::jsonb)`,
              [principal.id, documentId, JSON.stringify({
                versionId: version.id,
                sha256: artifact.content_sha256,
              })],
            );
            return { artifact, created: Boolean(inserted.rows?.[0]) };
          });
          if (persisted.created) {
            artifactResult = { rows: [persisted.artifact] };
          } else {
            await removeStoredAnalyticalDocumentPdf(stored.target);
            artifactResult = { rows: [persisted.artifact] };
            bytes = await readStoredAnalyticalDocumentPdf({
              directory: pdfStorageDirectory,
              key: persisted.artifact.storage_key,
              sha256: persisted.artifact.content_sha256,
              byteSize: Number(persisted.artifact.byte_size),
            });
          }
        } catch (error) {
          await removeStoredAnalyticalDocumentPdf(stored.target);
          throw error;
        }
      }

      const safeNumber = /^[A-Za-z0-9_-]+$/.test(document.document_number ?? "")
        ? document.document_number : documentId;
      res.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.length),
        "Content-Disposition": "attachment; filename=\"" + safeNumber + ".pdf\"",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Document-Version-SHA256": version.content_sha256,
      });
      res.end(method === "HEAD" ? undefined : bytes);
    } catch {
      send(res, 503, { error: "analytical_document_pdf_unavailable" }, method);
    }
    return true;
  }

  if (action === "versions") {
    if (!canCreate(principal)) {
      send(res, 403, { error: "analytical_document_version_denied" }, method);
      return true;
    }
    const parsed = await readBody(req);
    if (parsed.error) {
      const status = parsed.error === "payload_too_large" ? 413 : parsed.error === "unsupported_media_type" ? 415 : 400;
      send(res, status, { error: parsed.error }, method);
      return true;
    }
    if (Object.keys(parsed.value).length !== 1 || !validContent(parsed.value.content)) {
      send(res, 400, { error: "invalid_document_version" }, method);
      return true;
    }
    try {
      const result = await inTransaction(pool, async (client) => {
        const locked = await client.query(
          "SELECT id, created_by, status FROM analytical_documents WHERE id = $1::uuid FOR UPDATE",
          [documentId],
        );
        const doc = locked.rows?.[0];
        if (!doc || doc.created_by !== principal.id || !["draft", "changes_requested"].includes(doc.status)) return null;
        const next = await client.query(
          "SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version FROM analytical_document_versions WHERE document_id = $1::uuid",
          [documentId],
        );
        const content = serializeContent(parsed.value.content);
        const digest = createHash("sha256").update(content, "utf8").digest("hex");
        const version = await client.query(
          `INSERT INTO analytical_document_versions
            (document_id, version_number, content, content_sha256, created_by)
           VALUES ($1, $2, $3::jsonb, $4, $5)
           RETURNING id, version_number, content_sha256, created_at`,
          [documentId, next.rows[0].next_version, content, digest, principal.id],
        );
        if (doc.status === "changes_requested") {
          await client.query("UPDATE analytical_documents SET status = 'draft', updated_at = now() WHERE id = $1::uuid", [documentId]);
        } else {
          await client.query("UPDATE analytical_documents SET updated_at = now() WHERE id = $1::uuid", [documentId]);
        }
        await appendEvent(client, {
          documentId, versionId: version.rows[0].id, actorId: principal.id,
          type: "version_created", previousStatus: doc.status, newStatus: "draft",
          details: { version: version.rows[0].version_number, sha256: digest },
        });
        return version.rows[0];
      });
      if (!result) {
        send(res, 404, { error: "not_found" }, method);
      } else {
        send(res, 201, { version: { id: result.id, number: result.version_number, sha256: result.content_sha256, createdAt: result.created_at } }, method);
      }
    } catch {
      send(res, 503, { error: "analytical_document_version_unavailable" }, method);
    }
    return true;
  }

  if (action === "submit") {
    if (!canCreate(principal)) {
      send(res, 403, { error: "analytical_document_submit_denied" }, method);
      return true;
    }
    try {
      const result = await inTransaction(pool, async (client) => {
        const locked = await client.query(
          "SELECT id, created_by, assigned_reviewer_id, status FROM analytical_documents WHERE id = $1::uuid FOR UPDATE",
          [documentId],
        );
        const doc = locked.rows?.[0];
        if (!doc || doc.created_by !== principal.id || doc.status !== "draft" ||
            !doc.assigned_reviewer_id || doc.assigned_reviewer_id === principal.id) return null;
        const latest = await client.query(
          "SELECT id, version_number FROM analytical_document_versions WHERE document_id = $1::uuid ORDER BY version_number DESC LIMIT 1",
          [documentId],
        );
        if (!latest.rows?.[0]) return null;
        const approval = await client.query(
          `INSERT INTO analytical_document_approvals
            (document_id, document_version_id, submitted_by, reviewer_id)
           VALUES ($1, $2, $3, $4)
           RETURNING id, document_version_id, reviewer_id, status, submitted_at`,
          [documentId, latest.rows[0].id, principal.id, doc.assigned_reviewer_id],
        );
        await client.query(
          "UPDATE analytical_documents SET status = 'submitted_for_review', updated_at = now() WHERE id = $1::uuid",
          [documentId],
        );
        await appendEvent(client, {
          documentId, versionId: latest.rows[0].id, actorId: principal.id,
          type: "submitted_for_review", previousStatus: doc.status, newStatus: "submitted_for_review",
          details: { approvalId: approval.rows[0].id, reviewerId: doc.assigned_reviewer_id },
        });
        return approval.rows[0];
      });
      if (!result) send(res, 409, { error: "document_not_submittable" }, method);
      else send(res, 201, { approval: result }, method);
    } catch {
      send(res, 503, { error: "analytical_document_submit_unavailable" }, method);
    }
    return true;
  }

  if (action === "decision") {
    if (!canReview(principal)) {
      send(res, 403, { error: "analytical_document_review_denied" }, method);
      return true;
    }
    const parsed = await readBody(req, 8192);
    if (parsed.error) {
      const status = parsed.error === "payload_too_large" ? 413 : parsed.error === "unsupported_media_type" ? 415 : 400;
      send(res, status, { error: parsed.error }, method);
      return true;
    }
    const body = parsed.value;
    if (Object.keys(body).some((key) => !["decision", "rationale"].includes(key)) ||
        !DECISIONS.has(body.decision) || !validRationale(body.rationale)) {
      send(res, 400, { error: "invalid_analytical_document_decision" }, method);
      return true;
    }
    try {
      const result = await inTransaction(pool, async (client) => {
        const approvalResult = await client.query(
          `SELECT id, document_version_id, submitted_by, reviewer_id, status
           FROM analytical_document_approvals
           WHERE document_id = $1::uuid AND reviewer_id = $2::uuid AND status = 'pending'
           ORDER BY submitted_at DESC LIMIT 1 FOR UPDATE`,
          [documentId, principal.id],
        );
        const approval = approvalResult.rows?.[0];
        if (!approval || approval.submitted_by === principal.id) return null;
        const docResult = await client.query(
          "SELECT id, created_by, status FROM analytical_documents WHERE id = $1::uuid FOR UPDATE",
          [documentId],
        );
        const doc = docResult.rows?.[0];
        if (!doc || doc.status !== "submitted_for_review" || doc.created_by !== approval.submitted_by) return null;
        await client.query(
          "UPDATE analytical_document_approvals SET status = $2, decision_rationale = $3, decided_at = now() WHERE id = $1::uuid",
          [approval.id, body.decision, body.rationale.trim()],
        );
        const nextStatus = body.decision === "approved" ? "approved" : "changes_requested";
        if (nextStatus === "approved") {
          await client.query(
            `UPDATE analytical_documents
             SET status = 'approved', approved_by = $2, approved_at = now(),
                 approved_version_id = $3, updated_at = now()
             WHERE id = $1::uuid`,
            [documentId, principal.id, approval.document_version_id],
          );
        } else {
          await client.query(
            "UPDATE analytical_documents SET status = 'changes_requested', updated_at = now() WHERE id = $1::uuid",
            [documentId],
          );
        }
        await appendEvent(client, {
          documentId, versionId: approval.document_version_id, actorId: principal.id,
          type: nextStatus === "approved" ? "approved" : "changes_requested",
          previousStatus: "submitted_for_review", newStatus: nextStatus,
          details: { approvalId: approval.id, rationale: body.rationale.trim() },
        });
        return { approvalId: approval.id, status: nextStatus };
      });
      if (!result) send(res, 404, { error: "not_found" }, method);
      else send(res, 200, { decision: result }, method);
    } catch {
      send(res, 503, { error: "analytical_document_decision_unavailable" }, method);
    }
    return true;
  }

  if (action === "issue") {
    if (!canCreate(principal) && !hasGrant(principal, "administrator", "global")) {
      send(res, 403, { error: "analytical_document_issue_denied" }, method);
      return true;
    }
    try {
      const issued = await inTransaction(pool, async (client) => {
        const locked = await client.query(
          "SELECT id, created_by, status, approved_version_id FROM analytical_documents WHERE id = $1::uuid FOR UPDATE",
          [documentId],
        );
        const doc = locked.rows?.[0];
        if (!doc || (doc.created_by !== principal.id && !hasGrant(principal, "administrator", "global")) ||
            doc.status !== "approved" || !doc.approved_version_id) return null;
        const year = new Date().getUTCFullYear();
        const registration = `UA-${year}-${doc.id.replace(/-/g, "").slice(0, 10).toUpperCase()}`;
        await client.query(
          `UPDATE analytical_documents
           SET status = 'issued', document_number = $2, issued_at = now(),
               issued_version_id = approved_version_id, updated_at = now()
           WHERE id = $1::uuid`,
          [documentId, registration],
        );
        await appendEvent(client, {
          documentId, versionId: doc.approved_version_id, actorId: principal.id,
          type: "issued", previousStatus: "approved", newStatus: "issued",
          details: { documentNumber: registration },
        });
        return { id: doc.id, documentNumber: registration, issuedVersionId: doc.approved_version_id };
      });
      if (!issued) send(res, 409, { error: "document_not_issuable" }, method);
      else send(res, 200, { document: issued }, method);
    } catch {
      send(res, 503, { error: "analytical_document_issue_unavailable" }, method);
    }
    return true;
  }

  send(res, 404, { error: "not_found" }, method);
  return true;
}
