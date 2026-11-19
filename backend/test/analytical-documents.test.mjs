import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import {
  isAnalyticalDocumentMethodAllowed,
  isAnalyticalDocumentRoute,
} from "../src/analytical-documents.mjs";
import { createServer as createHandler } from "../src/server.mjs";

async function withServer(pool, run, options = {}) {
  const server = createHttpServer(createHandler({ pool, ...options }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally {
    server.close();
    await once(server, "close");
  }
}

const principal = (id, ...grants) => ({ id, accountStatus: "active", grants });
const grant = (roleCode, scopeType = "global", scopeId) => ({
  roleCode, scopeType, ...(scopeId ? { scopeId } : {}),
});
const noDb = { async query() { return { rows: [] }; } };
const root = "/api/v1/analytical-documents";
const docId = "123e4567-e89b-42d3-a456-426614174000";

test("analytical document routes expose only the intended methods", () => {
  assert.equal(isAnalyticalDocumentRoute(root), true);
  assert.equal(isAnalyticalDocumentRoute(`${root}/reviewers`), true);
  assert.equal(isAnalyticalDocumentMethodAllowed("GET", `${root}/reviewers`), true);
  assert.equal(isAnalyticalDocumentMethodAllowed("HEAD", `${root}/reviewers`), true);
  assert.equal(isAnalyticalDocumentMethodAllowed("POST", `${root}/reviewers`), false);
  assert.equal(isAnalyticalDocumentRoute(`${root}/${docId}`), true);
  assert.equal(isAnalyticalDocumentRoute(`${root}/${docId}/decision`), true);
  assert.equal(isAnalyticalDocumentRoute(`${root}/${docId}/pdf`), true);
  assert.equal(isAnalyticalDocumentRoute(`${root}/not-a-uuid`), false);
  assert.equal(isAnalyticalDocumentMethodAllowed("GET", root), true);
  assert.equal(isAnalyticalDocumentMethodAllowed("POST", root), true);
  assert.equal(isAnalyticalDocumentMethodAllowed("DELETE", root), false);
  assert.equal(isAnalyticalDocumentMethodAllowed("POST", `${root}/${docId}/submit`), true);
  assert.equal(isAnalyticalDocumentMethodAllowed("GET", `${root}/${docId}/submit`), false);
  assert.equal(isAnalyticalDocumentMethodAllowed("PATCH", `${root}/${docId}/issue`), false);
  assert.equal(isAnalyticalDocumentMethodAllowed("GET", `${root}/${docId}/pdf`), true);
  assert.equal(isAnalyticalDocumentMethodAllowed("HEAD", `${root}/${docId}/pdf`), true);
  assert.equal(isAnalyticalDocumentMethodAllowed("POST", `${root}/${docId}/pdf`), false);
});

test("analytical document API requires a trusted active session", async () => {
  await withServer(noDb, async (base) => {
    const response = await fetch(base + root);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
  });
});

test("analytical document creation is denied to roles without valuation authority", async () => {
  await withServer(noDb, async (base) => {
    const response = await fetch(base + root, {
      method: "POST",
      headers: { origin: "https://platform.example", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "analytical_document_create_denied" });
  }, {
    allowedOrigin: "https://platform.example",
    resolvePrincipal: async () => principal("worker-1", grant("case_worker")),
  });
});

test("analytical document creation rejects self-review before database writes", async () => {
  let queries = 0;
  const pool = { async query() { queries += 1; return { rows: [] }; } };
  await withServer(pool, async (base) => {
    const response = await fetch(base + root, {
      method: "POST",
      headers: { origin: "https://platform.example", "content-type": "application/json" },
      body: JSON.stringify({
        documentType: "preliminary_valuation",
        organizationalContour: "assets",
        title: "Synthetic report",
        reviewerId: "123e4567-e89b-42d3-a456-426614174000",
        content: { summary: "Synthetic content" },
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_analytical_document" });
  }, {
    allowedOrigin: "https://platform.example",
    resolvePrincipal: async () => principal(
      "123e4567-e89b-42d3-a456-426614174000",
      grant("asset_valuator", "contour", "assets"),
    ),
  });
  assert.equal(queries, 0);
});

test("reviewer discovery is scoped to active independent approvers and hides account identifiers from display metadata", async () => {
  const calls = [];
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    return { rows: [{ id: "reviewer-uuid", display_name: "Independent reviewer" }] };
  } };
  await withServer(pool, async (base) => {
    const response = await fetch(base + `${root}/reviewers`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      reviewers: [{ id: "reviewer-uuid", displayName: "Independent reviewer" }],
    });
  }, {
    resolvePrincipal: async () => principal("valuator-1", grant("asset_valuator", "contour", "assets")),
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /r.code = 'independent_approver'/);
  assert.match(calls[0].sql, /u.account_status = 'active'/);
  assert.equal(calls[0].params[0], "valuator-1");
});

test("reviewer discovery is denied outside the asset valuation authority", async () => {
  await withServer(noDb, async (base) => {
    const response = await fetch(base + `${root}/reviewers`);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "analytical_document_reviewer_list_denied" });
  }, {
    resolvePrincipal: async () => principal("worker-1", grant("case_worker")),
  });
});

test("analytical document list is read through the authenticated database boundary", async () => {
  const calls = [];
  const pool = { async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; } };
  await withServer(pool, async (base) => {
    const response = await fetch(base + root);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { documents: [], count: 0 });
  }, {
    resolvePrincipal: async () => principal("auditor-1", grant("auditor")),
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM analytical_documents/);
  assert.equal(calls[0].params[0], true);
});

test("analytical document writes remain same-origin protected", async () => {
  await withServer(noDb, async (base) => {
    const response = await fetch(base + root, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "origin_not_allowed" });
  }, {
    allowedOrigin: "https://platform.example",
    resolvePrincipal: async () => principal("valuator-1", grant("asset_valuator", "contour", "assets")),
  });
});


test("analytical document detail returns the latest version content to an authorized author", async () => {
  const calls = [];
  const content = { summary: "Synthetic revision source", conclusion: "Pending review" };
  const pool = { async query(sql, params) {
    calls.push({ sql, params });
    if (sql.includes("FROM analytical_documents WHERE id")) {
      return { rows: [{
        id: docId, document_number: "AS-0001", document_type: "asset_analysis",
        organizational_contour: "assets", asset_reference: "TEST-ASSET", title: "Synthetic report",
        status: "changes_requested", created_by: "valuator-1", assigned_reviewer_id: "reviewer-1",
        approved_by: null, approved_at: null, issued_at: null,
        created_at: "2026-11-19T08:00:00.000Z", updated_at: "2026-11-19T08:10:00.000Z",
      }] };
    }
    if (sql.includes("FROM analytical_document_versions")) {
      return { rows: [{
        id: "version-1", version_number: 1, content, content_sha256: "a".repeat(64),
        created_by: "valuator-1", created_at: "2026-11-19T08:00:00.000Z",
      }] };
    }
    return { rows: [] };
  } };
  await withServer(pool, async (base) => {
    const response = await fetch(base + root + "/" + docId);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.document.status, "changes_requested");
    assert.deepEqual(body.versions[0].content, content);
    assert.equal(body.versions[0].version_number, 1);
  }, {
    resolvePrincipal: async () => principal("valuator-1", grant("asset_valuator", "contour", "assets")),
  });
  assert.equal(calls.length, 4);
  assert.match(calls[1].sql, /content, content_sha256/);
});

test("analytical document version creation is denied without valuation authority", async () => {
  let queries = 0;
  const pool = { async query() { queries += 1; return { rows: [] }; } };
  await withServer(pool, async (base) => {
    const response = await fetch(base + root + "/" + docId + "/versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: { summary: "Unauthorized attempt" } }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "analytical_document_version_denied" });
  }, {
    resolvePrincipal: async () => principal("worker-1", grant("case_worker")),
  });
  assert.equal(queries, 0);
});
